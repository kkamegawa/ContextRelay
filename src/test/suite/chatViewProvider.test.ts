import { strict as assert } from 'assert';
import Module from 'module';
import * as os from 'os';
import * as path from 'path';
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
const workIqRequests: Array<{ token: string; query: string; contextId?: string }> = [];
let replies: string[] = [];
let workIqReplies: Array<{ text: string; contextId?: string }> = [];

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
      parse: (value: string) => ({ scheme: value.split(':', 1)[0] }),
      joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
        fsPath: path.join(base.fsPath, ...segments)
      })
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

      if (request === '../adapters/workIqAdapter') {
        return {
          sendWorkIqMessage: async (token: string, query: string, contextId?: string) => {
            workIqRequests.push({ token, query, contextId });
            return workIqReplies.shift() ?? { text: 'Work IQ answer', contextId: 'ctx-workiq-1' };
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
    workIqRequests.length = 0;
    replies = ['First answer', 'Second answer'];
    workIqReplies = [
      { text: 'Work IQ first answer', contextId: 'ctx-workiq-1' },
      { text: 'Work IQ second answer', contextId: 'ctx-workiq-2' }
    ];
  });

  test('loads the webview script via external URI (no blocking file read)', () => {
    const root = path.join(os.tmpdir(), 'context-relay-webview-test');

    const provider = new ChatViewProvider(
      createContext(),
      {} as never,
      { fsPath: root, joinPath: (...segments: string[]) => ({ fsPath: path.join(root, ...segments) }) } as never
    );

    const scriptWebviewUri = 'vscode-webview-resource://dist/webview/main.js';
    const webview = {
      cspSource: 'vscode-webview://context-relay-test',
      asWebviewUri: () => ({ toString: () => scriptWebviewUri })
    } as unknown as vscode.Webview;

    const html = (provider as unknown as {
      getHtmlForWebview(webview: vscode.Webview): string;
    }).getHtmlForWebview(webview);

    // Script is loaded via src= attribute, not inlined
    assert.ok(html.includes(`src="${scriptWebviewUri}"`), 'HTML should reference the external script URI');
    assert.ok(html.includes('defer'), 'script tag should have defer so the panel HTML renders first');
    // CSP must allow the webview cspSource for the external script to load
    assert.ok(html.includes(webview.cspSource), 'CSP should include webview.cspSource');
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

  test('/workiq sends query, shows loading, and renders the Work IQ response', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getWorkIqAccessToken: async () => 'workiq-token' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
      messages.push(message);
    };

    await provider.submitQuery('/workiq admin status');

    assert.deepEqual(workIqRequests, [
      { token: 'workiq-token', query: 'admin status', contextId: undefined }
    ]);
    assert.deepEqual(messages.map(message => message.command), [
      'userMessage',
      'loading',
      'assistantMessage',
      'loading'
    ]);
    assert.equal(messages[1].isLoading, true);
    assert.equal(messages[1].text, 'Asking Work IQ...');
    assert.equal(messages[2].text, 'Work IQ first answer');
    assert.equal(messages[3].isLoading, false);
  });

  test('/workiq reuses contextId for follow-up queries and clearChat resets it', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getWorkIqAccessToken: async () => 'workiq-token' } as never,
      {} as never
    );
    (provider as unknown as { postMessage(message: unknown): void }).postMessage = () => {};

    await provider.submitQuery('/workiq Microsoft 365 admin status');
    await provider.submitQuery('/workiq follow up');
    provider.clearChat();
    await provider.submitQuery('/workiq after clear');

    assert.deepEqual(workIqRequests, [
      { token: 'workiq-token', query: 'Microsoft 365 admin status', contextId: undefined },
      { token: 'workiq-token', query: 'follow up', contextId: 'ctx-workiq-1' },
      { token: 'workiq-token', query: 'after clear', contextId: undefined }
    ]);
  });
});
