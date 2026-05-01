import { strict as assert } from 'assert';
import {
  buildSendMessageRequest,
  extractResponseText,
  extractContextId,
  extractTaskState,
  resolveRetryDelayMs,
  resolveLocationMetadata,
  sendWorkIqMessage,
  setWorkIqLogger,
  WORKIQ_ENDPOINT,
  A2A_VERSION
} from '../../adapters/workIqAdapter';
import { buildWorkIqProviderScopes, WORKIQ_SCOPE } from '../../auth/authScopes';

suite('WorkIqAdapter', () => {
  suite('resolveLocationMetadata', () => {
    test('returns timeZone and timeZoneOffset', () => {
      const location = resolveLocationMetadata();
      assert.ok(typeof location.timeZone === 'string');
      assert.ok(location.timeZone.length > 0);
      assert.ok(typeof location.timeZoneOffset === 'number');
    });
  });

  suite('buildSendMessageRequest', () => {
    test('builds valid JSON-RPC 2.0 envelope for admin query', () => {
      const { body, requestId } = buildSendMessageRequest('admin permissions for Microsoft 365');
      const parsed = JSON.parse(body);

      assert.equal(parsed.jsonrpc, '2.0');
      assert.equal(parsed.id, requestId);
      assert.equal(parsed.method, 'SendMessage');
      assert.ok(parsed.params);
      assert.ok(parsed.params.message);
    });

    test('message has correct role and parts for Japanese query', () => {
      const { body } = buildSendMessageRequest('品川オフィスの会議室を予約して');
      const parsed = JSON.parse(body);
      const message = parsed.params.message;

      assert.equal(message.role, 'ROLE_USER');
      assert.ok(Array.isArray(message.parts));
      assert.equal(message.parts.length, 1);
      assert.equal(message.parts[0].text, '品川オフィスの会議室を予約して');
    });

    test('message includes Location metadata', () => {
      const { body } = buildSendMessageRequest('admin user list');
      const parsed = JSON.parse(body);
      const metadata = parsed.params.message.metadata;

      assert.ok(metadata);
      assert.ok(metadata.Location);
      assert.ok(typeof metadata.Location.timeZone === 'string');
      assert.ok(typeof metadata.Location.timeZoneOffset === 'number');
    });

    test('message has unique messageId', () => {
      const { body: body1 } = buildSendMessageRequest('admin query 1');
      const { body: body2 } = buildSendMessageRequest('admin query 2');
      const msg1 = JSON.parse(body1).params.message;
      const msg2 = JSON.parse(body2).params.message;

      assert.notEqual(msg1.messageId, msg2.messageId);
    });

    test('includes contextId when provided for multi-turn', () => {
      const { body } = buildSendMessageRequest('Microsoft 365 admin center', 'ctx-123');
      const parsed = JSON.parse(body);
      const message = parsed.params.message;

      assert.equal(message.contextId, 'ctx-123');
    });

    test('omits contextId when not provided', () => {
      const { body } = buildSendMessageRequest('廃止されたサービスについて教えて');
      const parsed = JSON.parse(body);
      const message = parsed.params.message;

      assert.equal(message.contextId, undefined);
    });

    test('each request has a unique requestId', () => {
      const result1 = buildSendMessageRequest('admin query');
      const result2 = buildSendMessageRequest('admin query');

      assert.notEqual(result1.requestId, result2.requestId);
    });
  });

  suite('extractResponseText', () => {
    test('extracts text from task artifacts for admin response', () => {
      const result = {
        task: {
          id: 'task-1',
          contextId: 'ctx-1',
          status: { state: 'TASK_STATE_COMPLETED' },
          artifacts: [
            {
              artifactId: 'art-1',
              name: 'Answer',
              parts: [
                { text: 'The admin permissions for Microsoft 365 include Global Admin, User Admin, and Exchange Admin.' }
              ]
            }
          ]
        }
      };

      const text = extractResponseText(result);
      assert.ok(text.includes('admin permissions'));
      assert.ok(text.includes('Microsoft 365'));
    });

    test('extracts text from multiple artifacts', () => {
      const result = {
        task: {
          id: 'task-1',
          artifacts: [
            { parts: [{ text: '品川のミーティングは3件あります。' }] },
            { parts: [{ text: '次のミーティングは14:00からです。' }] }
          ]
        }
      };

      const text = extractResponseText(result);
      assert.ok(text.includes('品川'));
      assert.ok(text.includes('14:00'));
    });

    test('returns empty string when no task in result', () => {
      const text = extractResponseText({});
      assert.equal(text, '');
    });

    test('returns empty string when no artifacts in task', () => {
      const text = extractResponseText({ task: { id: 'task-1' } });
      assert.equal(text, '');
    });

    test('returns empty string when artifacts have no text parts', () => {
      const text = extractResponseText({
        task: {
          artifacts: [{ parts: [{ url: 'https://example.com' }] }]
        }
      });
      assert.equal(text, '');
    });

    test('skips empty text parts', () => {
      const text = extractResponseText({
        task: {
          artifacts: [
            { parts: [{ text: '' }, { text: '廃止されたサービスの一覧です。' }] }
          ]
        }
      });
      assert.ok(text.includes('廃止'));
      assert.ok(!text.startsWith('\n'));
    });

    test('extracts text from direct message payload', () => {
      const text = extractResponseText({
        message: {
          contextId: 'ctx-message-1',
          parts: [
            { text: 'Microsoft 365 admin summary: ' },
            { text: '品川 office update.' }
          ]
        }
      });

      assert.equal(text, 'Microsoft 365 admin summary: 品川 office update.');
    });

    test('prefers task status message over placeholder artifact text', () => {
      const text = extractResponseText({
        task: {
          contextId: 'ctx-1',
          status: {
            state: 'TASK_STATE_COMPLETED',
            message: {
              parts: [
                {
                  text: '## Microsoft 365\n\n- admin updates are available\n- 品川 schedule changes are included'
                }
              ]
            }
          },
          artifacts: [
            {
              parts: [{ text: '？' }]
            }
          ]
        }
      });

      assert.ok(text.includes('Microsoft 365'));
      assert.ok(text.includes('品川'));
      assert.notEqual(text, '？');
    });
  });

  suite('extractContextId', () => {
    test('extracts contextId from task', () => {
      const contextId = extractContextId({
        task: { id: 'task-1', contextId: 'ctx-admin-123' }
      });
      assert.equal(contextId, 'ctx-admin-123');
    });

    test('extracts contextId from message', () => {
      const contextId = extractContextId({
        message: { contextId: 'ctx-品川-456' }
      });
      assert.equal(contextId, 'ctx-品川-456');
    });

    test('extracts contextId from top-level result', () => {
      const contextId = extractContextId({ contextId: 'ctx-789' });
      assert.equal(contextId, 'ctx-789');
    });

    test('returns undefined when no contextId present', () => {
      const contextId = extractContextId({ task: { id: 'task-1' } });
      assert.equal(contextId, undefined);
    });

    test('prefers task contextId over top-level', () => {
      const contextId = extractContextId({
        task: { contextId: 'ctx-task' },
        contextId: 'ctx-top'
      });
      assert.equal(contextId, 'ctx-task');
    });
  });

  suite('extractTaskState', () => {
    test('extracts TASK_STATE_COMPLETED', () => {
      const state = extractTaskState({
        task: { status: { state: 'TASK_STATE_COMPLETED' } }
      });
      assert.equal(state, 'TASK_STATE_COMPLETED');
    });

    test('extracts TASK_STATE_FAILED', () => {
      const state = extractTaskState({
        task: { status: { state: 'TASK_STATE_FAILED' } }
      });
      assert.equal(state, 'TASK_STATE_FAILED');
    });

    test('extracts TASK_STATE_WORKING', () => {
      const state = extractTaskState({
        task: { status: { state: 'TASK_STATE_WORKING' } }
      });
      assert.equal(state, 'TASK_STATE_WORKING');
    });

    test('returns undefined when no task', () => {
      const state = extractTaskState({});
      assert.equal(state, undefined);
    });

    test('returns undefined when no status', () => {
      const state = extractTaskState({ task: { id: 'task-1' } });
      assert.equal(state, undefined);
    });
  });

  suite('constants', () => {
    test('WORKIQ_ENDPOINT is the A2A gateway', () => {
      assert.equal(WORKIQ_ENDPOINT, 'https://workiq.svc.cloud.microsoft/a2a/');
    });

    test('A2A_VERSION is 1.0', () => {
      assert.equal(A2A_VERSION, '1.0');
    });
  });

  suite('sendWorkIqMessage', () => {
    test('logs Work IQ request, response status, and response body', async () => {
      const originalFetch = globalThis.fetch;
      const messages: string[] = [];
      setWorkIqLogger({ log: (message: string) => messages.push(message) });
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'request-1',
          result: {
            task: {
              id: 'task-1',
              status: { state: 'TASK_STATE_COMPLETED' },
              artifacts: [{ parts: [{ text: 'secret admin answer' }] }]
            }
          }
        }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        await sendWorkIqMessage('token', 'admin status');

        assert.equal(messages[0], '→ POST https://workiq.svc.cloud.microsoft/a2a/');
        assert.equal(messages[1], '← 200 OK https://workiq.svc.cloud.microsoft/a2a/');
        assert.equal(messages[2], '↳ Work IQ response body:');
        assert.ok(messages.some(message => message.includes('"jsonrpc": "2.0"')));
        assert.ok(messages.some(message => message.includes('secret admin answer')));
      } finally {
        globalThis.fetch = originalFetch;
        setWorkIqLogger(undefined);
      }
    });

    test('logs HTTP error response bodies before throwing', async () => {
      const originalFetch = globalThis.fetch;
      const messages: string[] = [];
      setWorkIqLogger({ log: (message: string) => messages.push(message) });
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({
          error: {
            code: 'Forbidden',
            message: 'detailed workiq error'
          }
        }), {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', 'admin status'),
          /Missing WorkIQAgent\.Ask permission or Microsoft 365 Copilot license/
        );

        assert.equal(messages[0], '→ POST https://workiq.svc.cloud.microsoft/a2a/');
        assert.equal(messages[1], '← 403 Forbidden https://workiq.svc.cloud.microsoft/a2a/');
        assert.equal(messages[2], '↳ Work IQ response body:');
        assert.ok(messages.some(message => message.includes('"Forbidden"')));
        assert.ok(messages.some(message => message.includes('detailed workiq error')));
      } finally {
        globalThis.fetch = originalFetch;
        setWorkIqLogger(undefined);
      }
    });

    test('parses successful JSON-RPC task response', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'request-1',
          result: {
            task: {
              id: 'task-1',
              contextId: 'ctx-1',
              status: { state: 'TASK_STATE_COMPLETED' },
              artifacts: [
                { parts: [{ text: 'admin summary for Microsoft 365' }] }
              ]
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        const response = await sendWorkIqMessage('token', 'admin summary');
        assert.equal(response.text, 'admin summary for Microsoft 365');
        assert.equal(response.contextId, 'ctx-1');
        assert.equal(response.taskId, 'task-1');
        assert.equal(response.state, 'TASK_STATE_COMPLETED');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('surfaces JSON-RPC errors from 200 responses', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'request-1',
          error: {
            code: -32601,
            message: 'Method not found'
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', 'admin status'),
          /JSON-RPC error \(-32601\): Method not found/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('maps 401 and 403 responses to actionable errors', async () => {
      const originalFetch = globalThis.fetch;
      let status = 401;
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response('forbidden', {
          status,
          headers: { 'Content-Type': 'text/plain' }
        })
      ) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', 'admin status'),
          /session expired/
        );

        status = 403;

        await assert.rejects(
          () => sendWorkIqMessage('token', 'admin status'),
          /Missing WorkIQAgent\.Ask permission or Microsoft 365 Copilot license/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('retries 429 responses and cancels the throttled response body', async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      let cancelled = false;

      const throttledBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('throttled'));
        },
        cancel() {
          cancelled = true;
        }
      });

      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> => {
        calls++;

        if (calls === 1) {
          return new Response(throttledBody, {
            status: 429,
            headers: {
              'Content-Type': 'text/plain',
              'Retry-After': '0'
            }
          });
        }

        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'request-2',
          result: {
            task: {
              id: 'task-2',
              status: { state: 'TASK_STATE_COMPLETED' },
              artifacts: [{ parts: [{ text: '品川 meeting summary' }] }]
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as typeof fetch;

      try {
        const response = await sendWorkIqMessage('token', '品川', undefined, 1);
        assert.equal(response.text, '品川 meeting summary');
        assert.equal(calls, 2);
        assert.equal(cancelled, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('does not retry network errors to avoid duplicate prompts', async () => {
      const originalFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        throw new Error('connection reset');
      }) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', 'admin status', undefined, 2),
          /connection reset/
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('rejects invalid JSON responses without exposing response body', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response('not json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', 'Microsoft 365 admin status'),
          /invalid JSON response/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('rejects non-complete task states without text', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: 'request-1',
          result: {
            task: {
              id: 'task-1',
              contextId: 'ctx-1',
              status: { state: 'TASK_STATE_WORKING' },
              artifacts: []
            }
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      ) as typeof fetch;

      try {
        await assert.rejects(
          () => sendWorkIqMessage('token', '廃止されたサービスについて'),
          /did not complete/
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  suite('resolveRetryDelayMs', () => {
    test('uses fallback when Retry-After is missing', () => {
      assert.equal(resolveRetryDelayMs(null, 1000), 1000);
    });

    test('parses Retry-After seconds', () => {
      assert.equal(resolveRetryDelayMs('3', 1000), 3000);
    });

    test('uses fallback for malformed Retry-After headers', () => {
      assert.equal(resolveRetryDelayMs('not-a-delay', 1000), 1000);
    });

    test('supports Retry-After HTTP-date values', () => {
      const future = new Date(Date.now() + 5000).toUTCString();
      const delay = resolveRetryDelayMs(future, 1000);
      assert.ok(delay > 0);
      assert.ok(delay <= 5000);
    });
  });

  suite('buildWorkIqProviderScopes', () => {
    test('includes OIDC scopes and Work IQ scope', () => {
      const scopes = buildWorkIqProviderScopes();
      assert.ok(scopes.includes('offline_access'));
      assert.ok(scopes.includes('openid'));
      assert.ok(scopes.includes('profile'));
      assert.ok(scopes.includes(WORKIQ_SCOPE));
    });

    test('does not include Graph scopes', () => {
      const scopes = buildWorkIqProviderScopes();
      const graphScopes = scopes.filter(s => s.includes('graph.microsoft.com'));
      assert.equal(graphScopes.length, 0);
    });

    test('includes VSCODE_CLIENT_ID when provided', () => {
      const scopes = buildWorkIqProviderScopes({ clientId: 'test-client-id' });
      assert.ok(scopes.includes('VSCODE_CLIENT_ID:test-client-id'));
    });

    test('includes VSCODE_TENANT when provided', () => {
      const scopes = buildWorkIqProviderScopes({ tenantId: 'test-tenant-id' });
      assert.ok(scopes.includes('VSCODE_TENANT:test-tenant-id'));
    });

    test('trims whitespace from clientId and tenantId', () => {
      const scopes = buildWorkIqProviderScopes({
        clientId: '  my-client  ',
        tenantId: '  my-tenant  '
      });
      assert.ok(scopes.includes('VSCODE_CLIENT_ID:my-client'));
      assert.ok(scopes.includes('VSCODE_TENANT:my-tenant'));
    });

    test('skips empty clientId and tenantId', () => {
      const scopes = buildWorkIqProviderScopes({ clientId: '  ', tenantId: '' });
      const clientScopes = scopes.filter(s => s.startsWith('VSCODE_CLIENT_ID'));
      const tenantScopes = scopes.filter(s => s.startsWith('VSCODE_TENANT'));
      assert.equal(clientScopes.length, 0);
      assert.equal(tenantScopes.length, 0);
    });
  });
});
