import { strict as assert } from 'assert';
import {
  buildSendMessageRequest,
  extractResponseText,
  extractContextId,
  extractTaskState,
  resolveLocationMetadata,
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
