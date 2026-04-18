import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatConversation {
  id: string;
  messages: ChatMessage[];
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

export async function sendMessage(
  token: string,
  conversationId: string,
  message: string
): Promise<string> {
  // Microsoft 365 Copilot Chat API (preview):
  // POST /beta/copilot/conversations/{conversationId}/chat
  // See: https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat
  const url = `${GRAPH_BASE}/beta/copilot/conversations/${conversationId}/chat`;
  const body = JSON.stringify({
    message: { text: message },
    locationHint: { timeZone: resolveTimeZone() }
  });

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
