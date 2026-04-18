import { ContextItem, ContextSource } from '../models/contextItem';

const GRAPH_BASE = 'https://graph.microsoft.com';

/**
 * Logger interface for Graph API debug logging.
 * Implementations should write to a VS Code OutputChannel.
 */
export interface GraphLogger {
  log(message: string): void;
}

let _logger: GraphLogger | undefined;

/**
 * Set the global Graph API logger. Call once during extension activation.
 */
export function setGraphLogger(logger: GraphLogger): void {
  _logger = logger;
}

export async function graphFetch(
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  _logger?.log(`→ ${options.method ?? 'GET'} ${url}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {})
    }
  });

  _logger?.log(`← ${response.status} ${response.statusText} ${url}`);

  return response;
}

export async function graphFetchWithRetry(
  url: string,
  token: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | undefined;
  let delay = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await graphFetch(url, token, options);

    if (response.status === 429 || response.status === 503) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryDelay = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : delay;

      if (attempt < maxRetries) {
        _logger?.log(`⚠ Throttled (${response.status}), retry ${attempt + 1}/${maxRetries} after ${retryDelay}ms`);
        await sleep(Math.min(retryDelay, 30000));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
    }

    return response;
  }

  throw lastError ?? new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function handleGraphResponse(response: Response): Promise<unknown> {
  if (response.ok) {
    return response.json();
  }

  const status = response.status;
  let body = '';
  try {
    body = await response.text();
  } catch {
    // ignore
  }

  _logger?.log(`✖ Graph API error ${status}: ${body.slice(0, 500)}`);

  if (status === 401) {
    throw Object.assign(new Error('Unauthorized: session expired, please re-authenticate.'), { code: 401 });
  }
  if (status === 403) {
    if (body.includes('CopilotLicenseRequired') || body.includes('licenseRequired')) {
      throw Object.assign(
        new Error('Microsoft 365 Copilot license is required for this feature.'),
        { code: 403, licenseRequired: true }
      );
    }
    throw Object.assign(
      new Error(`Forbidden (403): Missing required permissions. ${body}`),
      { code: 403 }
    );
  }

  throw new Error(`Graph API error ${status}: ${body}`);
}

export { GRAPH_BASE, ContextItem, ContextSource };
