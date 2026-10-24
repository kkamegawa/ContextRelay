import { strict as assert } from 'assert';
import Module from 'module';

type AuthProviderClass = typeof import('../../auth/authProvider').AuthProvider;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let AuthProvider: AuthProviderClass;

const configValues = new Map<string, unknown>();
const sessionRequests: string[][] = [];
let getSessionImpl: (scopes: string[]) => Promise<unknown> = async () => undefined;

suite('AuthProvider', () => {
  suiteSetup(async () => {
    moduleLoader._load = (request: string, parent: object | null | undefined, isMain: boolean): unknown => {
      if (request === 'vscode') {
        return {
          workspace: {
            getConfiguration: () => ({
              get: <T>(key: string, defaultValue: T): T =>
                (configValues.has(key) ? configValues.get(key) : defaultValue) as T
            })
          },
          authentication: {
            getSession: async (_providerId: string, scopes: string[]) => {
              sessionRequests.push(scopes);
              return getSessionImpl(scopes);
            },
            onDidChangeSessions: () => ({ dispose: () => undefined })
          }
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      ({ AuthProvider } = await import('../../auth/authProvider'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  setup(() => {
    configValues.clear();
    sessionRequests.length = 0;
    getSessionImpl = async () => undefined;
    configValues.set('auth.tenantId', 'organizations');
    configValues.set('enableChatPreview', false);
    configValues.set('adapters.mail', false);
    configValues.set('adapters.teams', false);
    configValues.set('adapters.sharepoint', false);
    configValues.set('adapters.onedrive', false);
    configValues.set('adapters.todo', false);
    configValues.set('adapters.connectors', false);
    configValues.set('embedded.enabled', false);
    configValues.set('embedded.sources', []);
  });

  test('includes Notes.Read and Tasks.Read when OneNote and Planner are enabled', () => {
    configValues.set('adapters.onenote', true);
    configValues.set('adapters.planner', true);

    const provider = new AuthProvider({} as never);
    const scopes = provider.getRequiredScopes();

    assert.ok(scopes.includes('https://graph.microsoft.com/Notes.Read'));
    assert.ok(scopes.includes('https://graph.microsoft.com/Tasks.Read'));
  });

  test('includes Tasks.Read when Microsoft To Do is enabled without Planner', () => {
    configValues.set('adapters.onenote', false);
    configValues.set('adapters.planner', false);
    configValues.set('adapters.todo', true);

    const provider = new AuthProvider({} as never);
    const scopes = provider.getRequiredScopes();

    assert.ok(scopes.includes('https://graph.microsoft.com/Tasks.Read'));
  });

  test('omits Notes.Read and Tasks.Read when OneNote, Planner, and To Do are disabled', () => {
    configValues.set('adapters.onenote', false);
    configValues.set('adapters.planner', false);
    configValues.set('adapters.todo', false);

    const provider = new AuthProvider({} as never);
    const scopes = provider.getRequiredScopes();

    assert.equal(scopes.includes('https://graph.microsoft.com/Notes.Read'), false);
    assert.equal(scopes.includes('https://graph.microsoft.com/Tasks.Read'), false);
  });

  test('keeps FileStorageContainer.Selected out of the shared session even when Embedded is enabled', () => {
    configValues.set('adapters.mail', true);
    configValues.set('embedded.sources', [{
      name: 'Project knowledge',
      containerTypeId: '11111111-2222-4333-8444-555555555555',
      enabled: true
    }]);
    configValues.set('embedded.enabled', true);

    const scopes = new AuthProvider({} as never).getRequiredScopes();
    assert.ok(scopes.includes('https://graph.microsoft.com/Mail.Read'));
    assert.equal(scopes.includes('https://graph.microsoft.com/FileStorageContainer.Selected'), false);
  });

  test('requests a dedicated Embedded session with only the Embedded Graph scope', async () => {
    configValues.set('auth.clientId', 'client-123');
    configValues.set('adapters.mail', true);
    getSessionImpl = async () => ({ accessToken: 'embedded-token' });

    const token = await new AuthProvider({} as never).getEmbeddedAccessToken();

    assert.equal(token, 'embedded-token');
    assert.deepEqual(sessionRequests, [[
      'offline_access',
      'openid',
      'profile',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/FileStorageContainer.Selected',
      'VSCODE_CLIENT_ID:client-123',
      'VSCODE_TENANT:organizations'
    ]]);
  });

  test('reports missing Embedded consent without affecting the shared session', async () => {
    configValues.set('auth.clientId', 'client-123');
    configValues.set('adapters.mail', true);
    getSessionImpl = async scopes => {
      if (scopes.includes('https://graph.microsoft.com/FileStorageContainer.Selected')) {
        throw new Error('AADSTS65001: The user or administrator has not consented.');
      }
      return { accessToken: 'shared-token' };
    };
    const provider = new AuthProvider({} as never);

    await assert.rejects(provider.getEmbeddedAccessToken(), /FileStorageContainer\.Selected/);
    assert.equal(await provider.getAccessToken(), 'shared-token');
  });
});
