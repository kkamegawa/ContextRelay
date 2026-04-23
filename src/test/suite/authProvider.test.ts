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
            getSession: async () => undefined,
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
    configValues.set('auth.tenantId', 'organizations');
    configValues.set('enableChatPreview', false);
    configValues.set('adapters.mail', false);
    configValues.set('adapters.teams', false);
    configValues.set('adapters.sharepoint', false);
    configValues.set('adapters.onedrive', false);
    configValues.set('adapters.connectors', false);
  });

  test('includes Notes.Read and Tasks.Read when OneNote and Planner are enabled', () => {
    configValues.set('adapters.onenote', true);
    configValues.set('adapters.planner', true);

    const provider = new AuthProvider({} as never);
    const scopes = provider.getRequiredScopes();

    assert.ok(scopes.includes('https://graph.microsoft.com/Notes.Read'));
    assert.ok(scopes.includes('https://graph.microsoft.com/Tasks.Read'));
  });

  test('omits Notes.Read and Tasks.Read when OneNote and Planner are disabled', () => {
    configValues.set('adapters.onenote', false);
    configValues.set('adapters.planner', false);

    const provider = new AuthProvider({} as never);
    const scopes = provider.getRequiredScopes();

    assert.equal(scopes.includes('https://graph.microsoft.com/Notes.Read'), false);
    assert.equal(scopes.includes('https://graph.microsoft.com/Tasks.Read'), false);
  });
});
