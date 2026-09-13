import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';
import { extractLatestReplyText, SseFrameParser } from './sseParser';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatConversation {
  id: string;
  messages: ChatMessage[];
}

export interface CopilotContextMessage {
  text: string;
  description?: string;
}

export interface CopilotContextualResources {
  files?: { uri: string }[];
  webContext?: { isWebEnabled: boolean };
}

export interface SendMessageOptions {
  additionalContext?: CopilotContextMessage[];
  contextualResources?: CopilotContextualResources;
}

interface CreateConversationResponse {
  id?: string;
}

interface CopilotChatResponseMessage {
  '@odata.type'?: string;
  id?: string;
  text?: string;
  createdDateTime?: string;
}

interface ChatResponse {
  messages?: CopilotChatResponseMessage[];
}

/**
 * Resolve the IANA time zone for the `locationHint` parameter required by the
 * Microsoft 365 Copilot Chat API. Falls back to `UTC` when the runtime does not
 * provide a resolvable time zone.
 */
function resolveTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function createConversation(token: string): Promise<string> {
  const url = `${GRAPH_BASE}/beta/copilot/conversations`;
  const body = JSON.stringify({});

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as CreateConversationResponse;

  if (!data?.id) {
    throw new Error('Failed to create Copilot conversation: no ID returned.');
  }
  return data.id;
}

interface ChatRequestBody {
  message: { text: string };
  locationHint: { timeZone: string };
  additionalContext?: CopilotContextMessage[];
  contextualResources?: CopilotContextualResources;
}

function buildChatRequestBody(message: string, options: SendMessageOptions): ChatRequestBody {
  const requestBody: ChatRequestBody = {
    message: { text: message },
    locationHint: { timeZone: resolveTimeZone() }
  };

  if (options.additionalContext && options.additionalContext.length > 0) {
    requestBody.additionalContext = options.additionalContext;
  }

  const contextualResources = options.contextualResources;
  if (
    contextualResources &&
    ((contextualResources.files && contextualResources.files.length > 0) || contextualResources.webContext)
  ) {
    requestBody.contextualResources = contextualResources;
  }

  return requestBody;
}

export async function sendMessage(
  token: string,
  conversationId: string,
  message: string,
  options: SendMessageOptions = {}
): Promise<string> {
  // Microsoft 365 Copilot Chat API (preview):
  // POST /beta/copilot/conversations/{conversationId}/chat
  // See: https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat
  const url = `${GRAPH_BASE}/beta/copilot/conversations/${conversationId}/chat`;
  const body = JSON.stringify(buildChatRequestBody(message, options));

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as ChatResponse;

  // Response contains the full conversation turn: the echoed user message
  // followed by the assistant reply. Pick the last message that has non-empty
  // text and is not the prompt we just sent.
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messages[i]?.text;
    if (typeof text === 'string' && text.trim().length > 0 && text !== message) {
      return text;
    }
  }

  return '';
}

/**
 * Continue a conversation over the streamed endpoint so callers can render
 * the assistant reply incrementally instead of waiting for the full turn.
 *
 * Microsoft 365 Copilot Chat API (preview):
 * POST /beta/copilot/conversations/{conversationId}/chatOverStream
 * See: https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chatoverstream
 *
 * Each server-sent event carries a full `copilotConversation` snapshot (per
 * the Learn docs), not a delta, so `onProgress` is called with the
 * cumulative reply text seen so far — callers should replace their rendered
 * content on each call rather than append.
 */
export async function sendMessageStream(
  token: string,
  conversationId: string,
  message: string,
  options: SendMessageOptions,
  onProgress: (fullTextSoFar: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const url = `${GRAPH_BASE}/beta/copilot/conversations/${conversationId}/chatOverStream`;
  const body = JSON.stringify(buildChatRequestBody(message, options));

  const response = await graphFetchWithRetry(url, token, {
    method: 'POST',
    body,
    headers: { Accept: 'text/event-stream' },
    signal
  });

  if (!response.ok) {
    if (STREAM_UNAVAILABLE_STATUSES.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new StreamUnavailableError(response.status);
    }
    // Reuses the shared status-code handling (401 / 403 / CopilotLicenseRequired / generic).
    // This always throws for a non-ok response.
    await handleGraphResponse(response);
    throw new Error(`Graph API error ${response.status}`);
  }

  if (!response.body) {
    // A 2xx response means the service accepted the request, so this must not fall back.
    throw new StreamAcceptedError(new Error('Microsoft 365 Copilot streamed response had no body.'));
  }

  // From here on, the service has accepted the request and the conversation
  // has very likely already advanced server-side. A failure while reading
  // the rest of the stream must NOT be retried via the synchronous /chat
  // endpoint — that would resend the same prompt and create a duplicate
  // conversation turn. Such failures are wrapped in StreamAcceptedError so
  // sendMessageAuto knows not to fall back.
  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseFrameParser();
    let lastText = '';

    const processEvents = (events: ReturnType<SseFrameParser['push']>): void => {
      for (const evt of events) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          continue; // Ignore malformed/heartbeat frames rather than failing the whole stream.
        }

        const text = extractLatestReplyText(parsed, message);
        if (typeof text === 'string' && text !== lastText) {
          lastText = text;
          onProgress(lastText);
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          // Flush the decoder (no args = stream: false) so trailing bytes of
          // a multi-byte UTF-8 codepoint split across the last two chunks
          // aren't silently dropped from the final frame.
          processEvents(parser.push(decoder.decode()));
          break;
        }
        processEvents(parser.push(decoder.decode(value, { stream: true })));
      }
      processEvents(parser.flush());
    } finally {
      reader.releaseLock();
    }

    return lastText;
  } catch (err) {
    throw new StreamAcceptedError(err);
  }
}

/**
 * HTTP statuses that mean the streamed endpoint itself is unavailable (not
 * deployed for this tenant or not supported), so the prompt was never
 * processed and resending it through the synchronous endpoint is safe.
 */
const STREAM_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

/** The service reported the streamed endpoint as unavailable; see STREAM_UNAVAILABLE_STATUSES. */
export class StreamUnavailableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Microsoft 365 Copilot streamed endpoint is unavailable (HTTP ${status}).`);
    this.name = 'StreamUnavailableError';
    this.status = status;
  }
}

/**
 * Marks a streaming failure that happened after the Chat API had already
 * accepted the request (i.e. after a 200 response with a body was
 * received). Preserves the original error's `name` (e.g. `AbortError` on
 * user cancellation) so callers can still branch on it.
 */
export class StreamAcceptedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = cause instanceof Error ? cause.name : 'StreamAcceptedError';
  }
}

/**
 * Send a message using the streamed endpoint when enabled, falling back to
 * the synchronous endpoint once only when the service reports the streamed
 * endpoint as unavailable (see STREAM_UNAVAILABLE_STATUSES). Every other
 * failure is surfaced instead of retried: a network error or timeout may
 * happen after the service already processed the POST, other HTTP errors
 * are not specific to streaming, a failure after the stream was accepted
 * (StreamAcceptedError) means the turn already exists, and cancellation is
 * the user's choice. Resending in any of those cases could create a
 * duplicate conversation turn.
 */
export async function sendMessageAuto(
  token: string,
  conversationId: string,
  message: string,
  options: SendMessageOptions,
  streamingEnabled: boolean,
  onProgress: (fullTextSoFar: string) => void,
  signal?: AbortSignal
): Promise<string> {
  if (!streamingEnabled) {
    return sendMessage(token, conversationId, message, options);
  }

  try {
    return await sendMessageStream(token, conversationId, message, options, onProgress, signal);
  } catch (err) {
    if (err instanceof StreamUnavailableError) {
      return sendMessage(token, conversationId, message, options);
    }
    throw err;
  }
}

/**
 * Convenience wrapper that creates a fresh Microsoft 365 Copilot conversation
 * and sends a single prompt, returning the assistant reply text.
 */
export async function askCopilot(token: string, prompt: string): Promise<string> {
  const conversationId = await createConversation(token);
  const reply = await sendMessage(token, conversationId, prompt);
  if (!reply.trim()) {
    throw new Error('Microsoft 365 Copilot returned an empty response.');
  }
  return reply;
}
