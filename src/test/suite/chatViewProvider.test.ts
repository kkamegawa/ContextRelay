import { strict as assert } from 'assert';
import Module from 'module';
import type * as vscode from 'vscode';

type ChatViewProviderClass = typeof import('../../panel/chatViewProvider').ChatViewProvider;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let ChatViewProvider: ChatViewProviderClass;

const configValues = new Map<string, unknown>();
const warningMessages: string[] = [];
const errorMessages: string[] = [];
const infoMessages: string[] = [];
const capturedPayloads: Array<unknown> = [];
let replies: string[] = [];

class InMemoryMemento implements vscode.Memento {
  private readonly store = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }

    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
      return;
    }

    this.store.set(key, value);
  }
}

function createContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: new InMemoryMemento()
  } as unknown as vscode.ExtensionContext;
}

function createVscodeStub(): typeof vscode {
  return {
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string, defaultValue: T): T =>
          (configValues.has(key) ? configValues.get(key) : defaultValue) as T
      })
    },
    window: {
      showWarningMessage: async (message: string) => {
        warningMessages.push(message);
        return undefined;
      },
      showErrorMessage: async (message: string) => {
        errorMessages.push(message);
        return undefined;
      },
      showInformationMessage: async (message: string) => {
        infoMessages.push(message);
        return undefined;
      }
    },
    env: {
      openExternal: async () => true,
      clipboard: {
        writeText: async () => undefined
      }
    },
    Uri: {
      parse: (value: string) => ({ scheme: value.split(':', 1)[0] })
    }
  } as unknown as typeof vscode;
}

suite('ChatViewProvider', () => {
  suiteSetup(async () => {
    moduleLoader._load = (request: string, parent: object | null | undefined, isMain: boolean): unknown => {
      if (request === 'vscode') {
        return createVscodeStub();
      }

      if (request === '../adapters/chatAdapter') {
        return {
          createConversation: async () => 'conv-1',
          sendMessage: async (_token: string, _conversationId: string, _prompt: string, payload?: unknown) => {
            capturedPayloads.push(payload);
            return replies.shift() ?? 'stub reply';
          }
        };
      }

      if (request === '../adapters/handoffContentAdapter') {
        return {
          hydrateItemForHandoff: async (_token: string, item: unknown) => item
        };
      }

      if (request === '../adapters/mailAdapter') {
        return { searchMail: async () => [] };
      }

      if (request === '../adapters/onenoteAdapter') {
        return { searchOneNote: async () => [] };
      }

      if (request === '../adapters/plannerAdapter') {
        return { searchPlanner: async () => [] };
      }

      if (request === '../adapters/retrievalAdapter') {
        return { searchRetrieval: async () => [] };
      }

      if (request === '../adapters/teamsAdapter') {
        return { searchTeams: async () => [] };
      }

      if (request === '../adapters/todoAdapter') {
        return { searchTodo: async () => [] };
      }

      if (request === '../docs/docGenerator') {
        return {
          DocGenerator: class {}
        };
      }

      if (request === './openResult') {
        return {
          buildPreviewWebviewHtml: () => ''
        };
      }

      if (request === './outputLanguage') {
        return {
          detectOutputLanguage: (_prompt: string, reply: string) => ({ content: reply })
        };
      }

      if (request === './previewResolver') {
        return {
          resolvePreview: async () => undefined
        };
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      ({ ChatViewProvider } = await import('../../panel/chatViewProvider'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  setup(() => {
    configValues.clear();
    warningMessages.length = 0;
    errorMessages.length = 0;
    infoMessages.length = 0;
    capturedPayloads.length = 0;
    replies = ['First answer', 'Second answer'];
  });

  test('includes the latest visible result in follow-up Copilot chat context', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handlePlainChat(prompt: string): Promise<void> }).handlePlainChat('first prompt');
    await (provider as unknown as { handlePlainChat(prompt: string): Promise<void> }).handlePlainChat('follow-up prompt');

    assert.equal(capturedPayloads.length, 2);
    assert.equal((capturedPayloads[0] as { additionalContext?: unknown }).additionalContext, undefined);

    const secondPayload = capturedPayloads[1] as {
      additionalContext?: Array<{ description: string; text: string }>;
      labels: string[];
    };
    assert.ok(secondPayload.additionalContext?.some(item =>
      item.description === 'Latest visible ContextRelay result' && item.text.includes('First answer')
    ));
    assert.ok(secondPayload.labels.includes('Latest visible ContextRelay result'));
  });

  test('clearChat removes the latest visible result from future context payloads', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handlePlainChat(prompt: string): Promise<void> }).handlePlainChat('first prompt');
    provider.clearChat();
    await (provider as unknown as { handlePlainChat(prompt: string): Promise<void> }).handlePlainChat('after clear');

    const secondPayload = capturedPayloads[1] as {
      additionalContext?: Array<{ description: string; text: string }>;
      labels: string[];
    };
    assert.equal(secondPayload.additionalContext, undefined);
    assert.deepEqual(secondPayload.labels, []);
  });

  test('ask without pinned snippets surfaces a single guard message and skips Copilot calls', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handleAskCommand(prompt: string): Promise<void> }).handleAskCommand('need a summary');

    assert.equal(warningMessages.length, 1);
    assert.equal(capturedPayloads.length, 0);
    assert.equal(errorMessages.length, 0);
    assert.equal(infoMessages.length, 0);
  });
});
