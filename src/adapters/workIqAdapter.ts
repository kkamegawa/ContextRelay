import * as crypto from 'crypto';
import { GraphLogger } from './graphClient';

const WORKIQ_ENDPOINT = 'https://workiq.svc.cloud.microsoft/a2a/';
const A2A_VERSION = '1.0';

let _logger: GraphLogger | undefined;

export function setWorkIqLogger(logger: GraphLogger | undefined): void {
  _logger = logger;
}

export interface WorkIqResponse {
  text: string;
  contextId?: string;
  taskId?: string;
  state?: string;
}

/**
 * Resolve the IANA time zone and UTC offset for the `Location` metadata
 * required by Work IQ to ground time-sensitive queries.
 */
export function resolveLocationMetadata(): { timeZoneOffset: number; timeZone: string } {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offsetMinutes = -new Date().getTimezoneOffset();
    return {
      timeZoneOffset: offsetMinutes,
      timeZone: timeZone && timeZone.length > 0 ? timeZone : 'UTC'
    };
  } catch {
    return { timeZoneOffset: 0, timeZone: 'UTC' };
  }
}

/**
 * Build a JSON-RPC 2.0 request body for the A2A v1.0 `SendMessage` method.
 */
export function buildSendMessageRequest(
  text: string,
  contextId?: string
): { body: string; requestId: string } {
  const requestId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const location = resolveLocationMetadata();

  const message: Record<string, unknown> = {
    role: 'ROLE_USER',
    messageId,
    parts: [{ text }],
    metadata: {
      Location: location
    }
  };

  if (contextId) {
    message.contextId = contextId;
  }

  const envelope = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'SendMessage',
    params: { message }
  };

  return { body: JSON.stringify(envelope), requestId };
}

/**
 * Extract the agent reply text from an A2A v1.0 JSON-RPC response.
 *
 * The response shape is:
 * ```json
 * { "result": { "task": { "artifacts": [{ "parts": [{ "text": "..." }] }] } } }
 * ```
 */
export function extractResponseText(result: Record<string, unknown>): string {
  const task = result.task as Record<string, unknown> | undefined;
  if (!task) {
    return '';
  }

  const artifacts = task.artifacts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return '';
  }

  const textParts: string[] = [];
  for (const artifact of artifacts) {
    const parts = artifact.parts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.trim().length > 0) {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join('\n\n');
}

/**
 * Extract the contextId from an A2A v1.0 response for multi-turn conversations.
 */
export function extractContextId(result: Record<string, unknown>): string | undefined {
  for (const key of ['task', 'message']) {
    const inner = result[key] as Record<string, unknown> | undefined;
    if (inner && typeof inner.contextId === 'string') {
      return inner.contextId;
    }
  }

  if (typeof result.contextId === 'string') {
    return result.contextId;
  }

  return undefined;
}

/**
 * Extract the task state from an A2A v1.0 response.
 */
export function extractTaskState(result: Record<string, unknown>): string | undefined {
  const task = result.task as Record<string, unknown> | undefined;
  if (!task) {
    return undefined;
  }

  const status = task.status as Record<string, unknown> | undefined;
  return typeof status?.state === 'string' ? status.state : undefined;
}

async function workIqFetch(
  token: string,
  body: string
): Promise<Response> {
  _logger?.log(`→ POST ${WORKIQ_ENDPOINT}`);

  const response = await fetch(WORKIQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'A2A-Version': A2A_VERSION
    },
    body
  });

  _logger?.log(`← ${response.status} ${response.statusText} ${WORKIQ_ENDPOINT}`);

  return response;
}

/**
 * Send a message to the Work IQ Gateway and return the response.
 * Only retries on 429/503 (safe to retry). Does not retry other errors
 * to avoid duplicating prompts.
 */
export async function sendWorkIqMessage(
  token: string,
  text: string,
  contextId?: string,
  maxRetries = 2
): Promise<WorkIqResponse> {
  const { body } = buildSendMessageRequest(text, contextId);
  let lastError: Error | undefined;
  let delay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = await workIqFetch(token, body);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        _logger?.log(`⚠ Network error, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw lastError;
    }

    if (response.status === 429 || response.status === 503) {
      if (attempt < maxRetries) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryDelay = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : delay;
        _logger?.log(`⚠ Throttled (${response.status}), retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms`);
        await sleep(Math.min(retryDelay, 30000));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
    }

    if (!response.ok) {
      const status = response.status;
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }

      if (status === 401) {
        throw Object.assign(
          new Error('Unauthorized: Work IQ session expired, please re-authenticate.'),
          { code: 401 }
        );
      }
      if (status === 403) {
        throw Object.assign(
          new Error(
            'Forbidden (403): Missing WorkIQAgent.Ask permission or Microsoft 365 Copilot license. ' +
            'Ensure admin consent has been granted and the user has a Copilot license.'
          ),
          { code: 403 }
        );
      }

      throw new Error(`Work IQ API error ${status}: ${errorBody}`);
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      throw new Error('Work IQ returned an empty response body.');
    }

    const parsed = JSON.parse(responseText) as Record<string, unknown>;

    // Check for JSON-RPC error (can come in a 200 response)
    if (parsed.error) {
      const err = parsed.error as Record<string, unknown>;
      const code = err.code ?? 'unknown';
      const message = typeof err.message === 'string' ? err.message : JSON.stringify(err);
      throw new Error(`Work IQ JSON-RPC error (${code}): ${message}`);
    }

    const result = parsed.result as Record<string, unknown> | undefined;
    if (!result) {
      throw new Error('Work IQ response missing result field.');
    }

    const taskState = extractTaskState(result);
    if (taskState === 'TASK_STATE_FAILED') {
      throw new Error('Work IQ task failed. The agent could not process the request.');
    }

    const text_response = extractResponseText(result);
    const newContextId = extractContextId(result);
    const task = result.task as Record<string, unknown> | undefined;

    return {
      text: text_response,
      contextId: newContextId,
      taskId: typeof task?.id === 'string' ? task.id : undefined,
      state: taskState
    };
  }

  throw lastError ?? new Error('Work IQ: max retries exceeded.');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { WORKIQ_ENDPOINT, A2A_VERSION };
