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
 * Some A2A implementations can also return a direct message payload:
 * `{ "result": { "message": { "parts": [{ "text": "..." }] } } }`.
 */
export function extractResponseText(result: Record<string, unknown>): string {
  const candidates: string[] = [];
  const task = result.task as Record<string, unknown> | undefined;
  if (task) {
    const statusMessage = extractTaskStatusMessageText(task);
    if (statusMessage) {
      candidates.push(statusMessage);
    }

    const artifacts = task.artifacts as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(artifacts) && artifacts.length > 0) {
      const artifactTexts = artifacts
        .map(artifact => extractPartsText(artifact))
        .filter(text => text.trim().length > 0);

      if (artifactTexts.length > 0) {
        candidates.push(artifactTexts.join('\n\n'));
      }
    }
  }

  const message = result.message as Record<string, unknown> | undefined;
  if (message) {
    const messageText = extractPartsText(message);
    if (messageText) {
      candidates.push(messageText);
    }
  }

  return selectBestResponseText(candidates);
}

function extractPartsText(container: Record<string, unknown>): string {
  const parts = container.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map(part => typeof part.text === 'string' ? part.text : '')
    .filter(text => text.trim().length > 0)
    .join('');
}

function extractTaskStatusMessageText(task: Record<string, unknown>): string {
  const status = task.status as Record<string, unknown> | undefined;
  const statusMessage = status?.message as Record<string, unknown> | undefined;
  if (!statusMessage) {
    return '';
  }

  return extractPartsText(statusMessage);
}

function selectBestResponseText(candidates: readonly string[]): string {
  const meaningfulCandidates = candidates
    .map(candidate => candidate.trim())
    .filter(candidate => candidate.length > 0);

  if (meaningfulCandidates.length === 0) {
    return '';
  }

  meaningfulCandidates.sort((left, right) => scoreResponseText(right) - scoreResponseText(left));
  return meaningfulCandidates[0];
}

function scoreResponseText(text: string): number {
  const plainText = text.replace(/\s+/g, '');
  if (plainText.length === 0) {
    return 0;
  }

  let score = text.length;
  if (/^[?？!！.。]+$/.test(plainText)) {
    score -= 10_000;
  }
  if (/^#{1,3}\s/m.test(text)) {
    score += 500;
  }
  if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text)) {
    score += 500;
  }
  if (/^[-*]\s/m.test(text) || /^\d+\.\s/m.test(text)) {
    score += 250;
  }

  return score;
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
  let delay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await workIqFetch(token, body);

    if (response.status === 429 || response.status === 503) {
      if (attempt < maxRetries) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryDelay = resolveRetryDelayMs(retryAfterHeader, delay);
        _logger?.log(`⚠ Throttled (${response.status}), retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms`);
        try {
          await response.body?.cancel();
        } catch {
          // Ignore cleanup failures and keep the retry flow moving.
        }
        await sleep(Math.min(retryDelay, 30000));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
    }

    if (!response.ok) {
      const status = response.status;
      try {
        // Discard the body without reading it to avoid logging sensitive content.
        await response.body?.cancel();
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

      const requestId = response.headers.get('x-ms-request-id')
        ?? response.headers.get('request-id')
        ?? response.headers.get('x-request-id')
        ?? response.headers.get('traceparent');
      const requestIdSuffix = requestId ? ` (Request ID: ${requestId})` : '';
      throw new Error(`Work IQ API error ${status}${requestIdSuffix}`);
    }

    const responseText = await response.text();
    if (!responseText.trim()) {
      throw new Error('Work IQ returned an empty response body.');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      throw new Error('Work IQ returned an invalid JSON response.');
    }

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

    const textResponse = extractResponseText(result);
    if (taskState && taskState !== 'TASK_STATE_COMPLETED' && !textResponse.trim()) {
      throw new Error(`Work IQ task did not complete (state: ${taskState}).`);
    }

    const newContextId = extractContextId(result);
    const task = result.task as Record<string, unknown> | undefined;
    const taskId = typeof task?.id === 'string' ? task.id : undefined;

    // Log only structural metadata — no body content to avoid leaking M365 data.
    if (_logger) {
      const metaParts = ['↳ Work IQ response:'];
      if (taskState) { metaParts.push(`state=${taskState}`); }
      if (taskId) { metaParts.push(`taskId=${taskId}`); }
      if (newContextId) { metaParts.push(`contextId=${newContextId}`); }
      _logger.log(metaParts.join(' '));
    }

    return {
      text: textResponse,
      contextId: newContextId,
      taskId,
      state: taskState
    };
  }

  throw new Error('Work IQ: max retries exceeded.');
}

export function resolveRetryDelayMs(retryAfterHeader: string | null, fallbackMs: number): number {
  if (!retryAfterHeader?.trim()) {
    return fallbackMs;
  }

  const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAfterDate = Date.parse(retryAfterHeader);
  if (Number.isFinite(retryAfterDate)) {
    return Math.max(retryAfterDate - Date.now(), 0);
  }

  return fallbackMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { WORKIQ_ENDPOINT, A2A_VERSION };
