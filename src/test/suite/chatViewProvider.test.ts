import { strict as assert } from 'assert';
import * as fs from 'fs';
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
const capturedPrompts: string[] = [];
const workIqRequests: Array<{ token: string; query: string; contextId?: string }> = [];
let replies: string[] = [];
let workIqReplies: Array<{ text: string; contextId?: string }> = [];
let workspaceFolders: Array<{ uri: { fsPath: string } }> | undefined;
let quickPickSelection: string[] | undefined;
let embeddedQuickPickSelection: { label: string; source: { name: string; containerTypeId: string; enabled: boolean } } | undefined;
const embeddedRequests: Array<{ token: string; query: string; source: { name: string; containerTypeId: string; enabled: boolean } }> = [];
let embeddedReplies: Array<unknown[]> = [];
let embeddedQuickPickOverride: (() => Promise<typeof embeddedQuickPickSelection>) | undefined;
let embeddedOverride: ((token: string, query: string, source: { name: string; containerTypeId: string; enabled: boolean }) => Promise<unknown[]>) | undefined;
let configurationChangeHandler: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;
let sendOverride: ((onProgress?: (fullTextSoFar: string) => void, signal?: AbortSignal) => Promise<string>) | undefined;

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
      get workspaceFolders() {
        return workspaceFolders as unknown as vscode.WorkspaceFolder[] | undefined;
      },
      getWorkspaceFolder: (uri: { fsPath: string }) => {
        const folders = workspaceFolders ?? [];
        return folders.find(folder =>
          uri.fsPath === folder.uri.fsPath ||
          uri.fsPath.startsWith(`${folder.uri.fsPath}${path.sep}`)
        ) as unknown as vscode.WorkspaceFolder | undefined;
      },
      findFiles: async () => [],
      getConfiguration: () => ({
        get: <T>(key: string, defaultValue: T): T =>
          (configValues.has(key) ? configValues.get(key) : defaultValue) as T
      }),
      onDidChangeConfiguration: (handler: typeof configurationChangeHandler) => {
        configurationChangeHandler = handler;
        return { dispose: () => undefined };
      }
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
      },
      showQuickPick: async (items?: Array<{ label: string; source?: unknown }>) => {
        if (items?.some(item => item.source)) {
          return embeddedQuickPickOverride ? embeddedQuickPickOverride() : embeddedQuickPickSelection;
        }
        return quickPickSelection;
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
          sendMessageAuto: async (
            _token: string,
            _conversationId: string,
            prompt: string,
            payload?: unknown,
            streamingEnabled?: boolean,
            onProgress?: (fullTextSoFar: string) => void,
            signal?: AbortSignal
          ) => {
            capturedPrompts.push(prompt);
            capturedPayloads.push(payload);
            if (sendOverride) {
              return sendOverride(onProgress, signal);
            }
            const reply = replies.shift() ?? 'stub reply';
            if (streamingEnabled) {
              onProgress?.(reply.slice(0, Math.ceil(reply.length / 2)));
              onProgress?.(reply);
            }
            return reply;
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
        return {
          searchRetrieval: async () => [],
          searchEmbedded: async (token: string, query: string, source: { name: string; containerTypeId: string; enabled: boolean }) => {
            embeddedRequests.push({ token, query, source });
            if (embeddedOverride) {
              return embeddedOverride(token, query, source);
            }
            return embeddedReplies.shift() ?? [];
          }
        };
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
    capturedPrompts.length = 0;
    workIqRequests.length = 0;
    replies = ['First answer', 'Second answer'];
    workIqReplies = [
      { text: 'Work IQ first answer', contextId: 'ctx-workiq-1' },
      { text: 'Work IQ second answer', contextId: 'ctx-workiq-2' }
    ];
    workspaceFolders = undefined;
    quickPickSelection = undefined;
    embeddedQuickPickSelection = undefined;
    embeddedRequests.length = 0;
    embeddedReplies = [];
    embeddedQuickPickOverride = undefined;
    embeddedOverride = undefined;
    configurationChangeHandler = undefined;
    sendOverride = undefined;
  });

  test('loads the webview script via external URI (no blocking file read)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-webview-'));

    try {
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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not re-send the previous Copilot reply as context on the next turn', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('first prompt', []);
    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('follow-up prompt', []);

    assert.equal(capturedPayloads.length, 2);
    assert.equal((capturedPayloads[0] as { additionalContext?: unknown }).additionalContext, undefined);

    const secondPayload = capturedPayloads[1] as {
      additionalContext?: Array<{ description: string; text: string }>;
      labels: string[];
    };
    assert.equal(secondPayload.additionalContext, undefined);
    assert.deepEqual(secondPayload.labels, []);
    // The prompt itself must also be untouched (no grounding instruction and
    // no reference to the previous answer).
    assert.equal(capturedPrompts[1], 'follow-up prompt');
  });

  test('plain chat (no /ask) attaches pinned snippets and disables web grounding for that turn', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handlePinSnippet(item: unknown): Promise<void> }).handlePinSnippet({
      source: 'teams',
      title: 'standup notes',
      snippet: 'Release is blocked by test failures.',
      cache: { hit: false }
    });

    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('what is blocking the release?', []);

    assert.equal(capturedPayloads.length, 1);
    const payload = capturedPayloads[0] as {
      additionalContext?: Array<{ description: string; text: string }>;
      contextualResources?: { webContext?: { isWebEnabled: boolean } };
      labels: string[];
    };
    assert.ok(payload.additionalContext?.some(item => item.text.includes('Release is blocked')));
    assert.ok(payload.labels.some(label => label.startsWith('📌 ')));
    assert.equal(payload.contextualResources?.webContext?.isWebEnabled, false);

    // The prompt sent to Copilot must carry the grounding instruction ahead
    // of the user's own request.
    assert.ok(capturedPrompts[0].startsWith('[ContextRelay grounding]'));
    assert.ok(capturedPrompts[0].endsWith('what is blocking the release?'));
  });

  test('plain chat without pins or #file mentions sends the prompt through unchanged', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );

    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('hello there', []);

    assert.equal(capturedPayloads.length, 1);
    const payload = capturedPayloads[0] as {
      additionalContext?: unknown;
      contextualResources?: unknown;
    };
    assert.equal(payload.additionalContext, undefined);
    assert.equal(payload.contextualResources, undefined);
    assert.equal(capturedPrompts[0], 'hello there');
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

  test('/ask with # file mention does not require pinned snippets', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-ask-mentions-'));
    fs.writeFileSync(path.join(root, 'notes.md'), 'ship checklist', 'utf8');
    workspaceFolders = [{ uri: { fsPath: root } }];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );

      await provider.submitQuery('/ask #notes.md summarize this');

      assert.equal(warningMessages.length, 0);
      assert.equal(capturedPayloads.length, 1);
      const payload = capturedPayloads[0] as {
        additionalContext?: Array<{ description: string; text: string }>;
        contextualResources?: { files?: Array<{ uri: string }>; webContext?: { isWebEnabled: boolean } };
      };
      // Local file content is inlined; file:// URIs are never sent as contextual resources.
      assert.equal(payload.contextualResources?.files, undefined);
      assert.deepEqual(payload.additionalContext, [
        { description: 'Local file: notes.md', text: 'ship checklist' }
      ]);
      assert.equal(payload.contextualResources?.webContext?.isWebEnabled, false);
      assert.ok(capturedPrompts[0].startsWith('[ContextRelay grounding]'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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

  test('/embedded requires explicit enablement and never searches from /all', async () => {
    let tokenCalls = 0;
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => { tokenCalls += 1; return 'token-embedded'; } } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string }> = [];
    (provider as unknown as { postMessage(message: { command: string; message?: string }): void }).postMessage = message => messages.push(message);

    await provider.submitQuery('/embedded auth decision');
    assert.equal(tokenCalls, 0);
    await provider.submitQuery('/all architecture decision');

    assert.equal(embeddedRequests.length, 0);
    assert.ok(messages.some(message => message.command === 'queryError' && message.message?.includes('contextRelay.embedded.enabled')));
  });

  test('/embedded rejects queries over 1,500 trimmed characters before picking or authenticating', async () => {
    let tokenCalls = 0;
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => { tokenCalls += 1; return 'token-embedded'; } } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);

    await provider.submitQuery(`/embedded  ${'a'.repeat(1501)}  `);

    assert.equal(tokenCalls, 0);
    assert.equal(embeddedRequests.length, 0);
    assert.ok(messages.some(message => message.command === 'queryError' && message.message?.includes('1,500 characters')));
  });

  test('/embedded searches one configured friendly source directly and uses all extracts', async () => {
    configValues.set('embedded.enabled', true);
    configValues.set('embedded.sources', [
      { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true }
    ]);
    const source = { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    embeddedReplies.push([{
      source: 'sharepoint-embedded',
      title: 'Authentication decision',
      snippet: 'First extract\n\nSecond extract',
      url: 'https://example.invalid/content',
      cache: { hit: false },
      raw: { sourceName: source.name, containerTypeId: source.containerTypeId, extracts: ['First extract', 'Second extract'] }
    }]);
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => 'token-embedded' } as never,
      {} as never
    );
    const messages: Array<{ command: string; items?: Array<{ snippet: string; raw?: unknown }>; source?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);

    await provider.submitQuery('/embedded What did we decide about authentication?');

    assert.deepEqual(embeddedRequests, [{
      token: 'token-embedded',
      query: 'What did we decide about authentication?',
      source
    }]);
    const result = messages.find(message => message.command === 'queryResult');
    assert.equal(result?.source, 'sharepoint-embedded');
    assert.equal(result?.items?.[0].snippet, 'First extract\n\nSecond extract');
  });

  test('/embedded prompts for a friendly source and cancel avoids authentication and search', async () => {
    configValues.set('embedded.enabled', true);
    const first = { name: 'Team Notes', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    const second = { name: 'Project Archive', containerTypeId: 'abcdefab-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [first, second]);
    let tokenCalls = 0;
    embeddedQuickPickSelection = undefined;
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => { tokenCalls += 1; return 'token-embedded'; } } as never,
      {} as never
    );
    const messages: Array<{ command: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);

    await provider.submitQuery('/embedded decisions');

    assert.equal(tokenCalls, 0);
    assert.equal(embeddedRequests.length, 0);
    assert.equal(messages[messages.length - 1]?.command, 'submissionCancelled', 'cancelling the picker must re-enable the input');
  });

  test('clearing the chat supersedes an in-flight /embedded search and releases its loader', async () => {
    configValues.set('embedded.enabled', true);
    const source = { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [source]);
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => 'token-embedded' } as never,
      {} as never
    );
    const messages: Array<{ command: string; isLoading?: boolean }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);
    let resolveSearch!: (items: unknown[]) => void;
    embeddedOverride = () => new Promise(resolve => { resolveSearch = resolve; });

    const pending = provider.submitQuery('/embedded access design');
    while (!resolveSearch) {
      await Promise.resolve();
    }
    provider.clearChat();
    const clearIndex = messages.findIndex(message => message.command === 'clearChat');
    resolveSearch([{
      source: 'sharepoint-embedded',
      title: 'Stale item',
      snippet: 'Result from before the clear',
      cache: { hit: false },
      raw: { sourceName: source.name, containerTypeId: source.containerTypeId, extracts: ['Result from before the clear'] }
    }]);
    await pending;

    assert.ok(clearIndex > 0);
    assert.deepEqual(messages[clearIndex - 1], { command: 'loading', source: 'sharepoint-embedded', isLoading: false });
    assert.deepEqual(messages.slice(clearIndex + 1).filter(message =>
      message.command === 'queryResult' || message.command === 'queryError' || message.command === 'loading'
    ), []);
    assert.equal((provider as unknown as { latestSearchSummary?: string }).latestSearchSummary, undefined);
  });

  test('/embedded uses the friendly source selected from the configured list', async () => {
    configValues.set('embedded.enabled', true);
    const first = { name: 'Team Notes', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    const second = { name: 'Project Archive', containerTypeId: 'abcdefab-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [first, second]);
    embeddedQuickPickSelection = { label: second.name, source: second };
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => 'token-embedded' } as never,
      {} as never
    );
    (provider as unknown as { postMessage(message: unknown): void }).postMessage = () => undefined;

    await provider.submitQuery('/embedded archive notes');

    assert.deepEqual(embeddedRequests, [{ token: 'token-embedded', query: 'archive notes', source: second }]);
  });

  test('/embedded turns permission and missing-container errors into actionable guidance without fallback', async () => {
    configValues.set('embedded.enabled', true);
    configValues.set('embedded.sources', [
      { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true }
    ]);
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => 'token-embedded' } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string; source?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);
    embeddedOverride = async () => { throw new Error('403 Forbidden'); };

    await provider.submitQuery('/embedded architecture');
    const forbiddenErrors = messages.filter(message => message.command === 'queryError');
    const forbidden = forbiddenErrors[forbiddenErrors.length - 1]?.message ?? '';
    assert.ok(forbidden.includes('FileStorageContainer.Selected'));
    assert.ok(forbidden.includes('signed-in user'));

    embeddedOverride = async () => { throw new Error('404 Not Found'); };
    await provider.submitQuery('/embedded architecture');
    const missingErrors = messages.filter(message => message.command === 'queryError');
    const missing = missingErrors[missingErrors.length - 1]?.message ?? '';
    assert.ok(missing.includes('container type ID'));
    assert.ok(missing.includes('does not fall back'));
    assert.equal(messages.some(message => message.command === 'queryResult' && message.source !== 'sharepoint-embedded'), false);
  });

  test('/embedded cancels a selection when source settings change while Quick Pick is open', async () => {
    configValues.set('embedded.enabled', true);
    const oldSource = { name: 'Old Source', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    const newSource = { name: 'New Source', containerTypeId: 'abcdefab-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [oldSource, { ...newSource, containerTypeId: 'fedcba98-1234-1234-1234-123456789abc' }]);
    let resolvePick!: (value: typeof embeddedQuickPickSelection) => void;
    embeddedQuickPickOverride = () => new Promise(resolve => { resolvePick = resolve; });
    let tokenCalls = 0;
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => { tokenCalls += 1; return 'token-embedded'; } } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);

    const pending = provider.submitQuery('/embedded notes');
    while (!resolvePick) {
      await Promise.resolve();
    }
    configValues.set('embedded.sources', [newSource]);
    configurationChangeHandler?.({ affectsConfiguration: section => section === 'contextRelay.embedded' });
    resolvePick({ label: oldSource.name, source: oldSource });
    await pending;

    assert.equal(tokenCalls, 0);
    assert.equal(embeddedRequests.length, 0);
    assert.ok(messages.some(message => message.command === 'queryError' && message.message?.includes('settings changed')));
  });

  test('/embedded rechecks settings after a deferred authentication call', async () => {
    configValues.set('embedded.enabled', true);
    configValues.set('embedded.sources', [
      { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true }
    ]);
    let resolveToken!: (value: string) => void;
    let tokenCalls = 0;
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => { tokenCalls += 1; return new Promise(resolve => { resolveToken = resolve; }); } } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);

    const pending = provider.submitQuery('/embedded authentication');
    while (!resolveToken) {
      await Promise.resolve();
    }
    configValues.set('embedded.enabled', false);
    configurationChangeHandler?.({ affectsConfiguration: section => section === 'contextRelay.embedded' });
    resolveToken('token-embedded');
    await pending;

    assert.equal(tokenCalls, 1);
    assert.equal(embeddedRequests.length, 0);
    assert.ok(messages.some(message => message.command === 'queryError' && message.message?.includes('settings changed during sign-in')));
  });

  test('/embedded tolerates the initial auth session event, then discards an in-flight search after config changes and says so', async () => {
    configValues.set('embedded.enabled', true);
    const source = { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [source]);
    let resolveToken!: (value: string) => void;
    let sessionChanged: (() => void) | undefined;
    const provider = new ChatViewProvider(
      createContext(),
      {
        getEmbeddedAccessToken: async () => new Promise(resolve => { resolveToken = resolve; }),
        onSessionChange: (handler: () => void) => { sessionChanged = handler; return { dispose: () => undefined }; }
      } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string; isLoading?: boolean }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);
    let resolveSearch!: (items: unknown[]) => void;
    embeddedOverride = () => new Promise(resolve => { resolveSearch = resolve; });

    const pending = provider.submitQuery('/embedded access design');
    while (!resolveToken) {
      await Promise.resolve();
    }
    sessionChanged?.();
    resolveToken('token-embedded');
    while (!resolveSearch) {
      await Promise.resolve();
    }
    configurationChangeHandler?.({ affectsConfiguration: section => section === 'contextRelay.embedded' });
    resolveSearch([{
      source: 'sharepoint-embedded',
      title: 'Stale item',
      snippet: 'Old configuration result',
      cache: { hit: false },
      raw: { sourceName: source.name, containerTypeId: source.containerTypeId, extracts: ['Old configuration result'] }
    }]);
    await pending;

    assert.equal(messages.some(message => message.command === 'queryResult'), false);
    assert.ok(messages.some(message => message.command === 'queryError' && message.message?.includes('results were discarded')));
    assert.ok((provider as unknown as { latestSearchSummary?: string }).latestSearchSummary?.includes('results were discarded'));
    assert.equal(messages[messages.length - 1].command, 'loading');
    assert.equal(messages[messages.length - 1].isLoading, false);
  });

  test('/embedded still shows an in-flight result when another Microsoft session changes, but drops cached results', async () => {
    configValues.set('embedded.enabled', true);
    const source = { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [source]);
    let sessionChanged: (() => void) | undefined;
    const provider = new ChatViewProvider(
      createContext(),
      {
        getEmbeddedAccessToken: async () => 'token-embedded',
        onSessionChange: (handler: () => void) => { sessionChanged = handler; return { dispose: () => undefined }; }
      } as never,
      {} as never
    );
    const messages: Array<{ command: string; message?: string }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);
    await provider.submitQuery('/embedded cached design');
    assert.equal(embeddedRequests.length, 1);

    let resolveSearch!: (items: unknown[]) => void;
    embeddedOverride = () => new Promise(resolve => { resolveSearch = resolve; });
    const pending = provider.submitQuery('/embedded access design');
    while (!resolveSearch) {
      await Promise.resolve();
    }
    // For example, /workiq creating its session while the Embedded search is running.
    sessionChanged?.();
    resolveSearch([{
      source: 'sharepoint-embedded',
      title: 'Access design',
      snippet: 'Current answer',
      cache: { hit: false },
      raw: { sourceName: source.name, containerTypeId: source.containerTypeId, extracts: ['Current answer'] }
    }]);
    await pending;

    assert.equal(messages.some(message => message.command === 'queryError'), false);
    assert.equal(messages.filter(message => message.command === 'queryResult').length, 2);

    embeddedOverride = undefined;
    await provider.submitQuery('/embedded cached design');
    assert.equal(embeddedRequests.length, 3, 'the session change must drop the earlier cached result');
  });

  test('only the newest overlapping Embedded search can render results, summaries, errors, or loading completion', async () => {
    configValues.set('embedded.enabled', true);
    configValues.set('embedded.sources', [
      { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true }
    ]);
    const provider = new ChatViewProvider(
      createContext(),
      { getEmbeddedAccessToken: async () => 'token-embedded' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: typeof messages[number]): void }).postMessage = message => messages.push(message);
    const pendingSearches: Array<{ query: string; resolve(items: unknown[]): void }> = [];
    embeddedOverride = (_token, query) => new Promise(resolve => {
      pendingSearches.push({ query, resolve });
    });

    const alpha = provider.submitQuery('/embedded alpha');
    while (pendingSearches.length < 1) {
      await Promise.resolve();
    }
    const beta = provider.submitQuery('/embedded beta');
    while (pendingSearches.length < 2) {
      await Promise.resolve();
    }

    pendingSearches[1].resolve([{
      source: 'sharepoint-embedded',
      title: 'Beta evidence',
      snippet: 'Newest answer',
      cache: { hit: false },
      raw: { sourceName: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', extracts: ['Newest answer'] }
    }]);
    await beta;
    pendingSearches[0].resolve([{
      source: 'sharepoint-embedded',
      title: 'Alpha evidence',
      snippet: 'Older answer',
      cache: { hit: false },
      raw: { sourceName: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', extracts: ['Older answer'] }
    }]);
    await alpha;

    const renderedQueries = messages
      .filter(message => message.command === 'queryResult')
      .map(message => message.query);
    assert.deepEqual(renderedQueries, ['beta']);
    assert.ok((provider as unknown as { latestSearchSummary?: string }).latestSearchSummary?.includes('Beta evidence'));
    const loadingCompletions = messages.filter(message =>
      message.command === 'loading' && message.isLoading === false
    );
    assert.equal(loadingCompletions.length, 2, 'superseding the first request clears its loader; its late completion must not clear the second loader');
  });

  test('Embedded result cache is memory-only, scoped by session, source, query and maxResults, and cleared on config change', async () => {
    configValues.set('embedded.enabled', true);
    const source = { name: 'Project Knowledge', containerTypeId: '12345678-1234-1234-1234-123456789abc', enabled: true };
    configValues.set('embedded.sources', [source]);
    configValues.set('maxResults', 5);
    const context = createContext();
    let sessionChanged: (() => void) | undefined;
    const auth = {
      getEmbeddedAccessToken: async () => 'token-embedded',
      onSessionChange: (handler: () => void) => { sessionChanged = handler; return { dispose: () => undefined }; }
    };
    const provider = new ChatViewProvider(context, auth as never, {} as never);
    (provider as unknown as { postMessage(message: unknown): void }).postMessage = () => undefined;

    await provider.submitQuery('/embedded architecture');
    await provider.submitQuery('/embedded architecture');
    assert.equal(embeddedRequests.length, 1);

    configValues.set('maxResults', 6);
    await provider.submitQuery('/embedded architecture');
    assert.equal(embeddedRequests.length, 2);

    configurationChangeHandler?.({ affectsConfiguration: section => section === 'contextRelay.maxResults' });
    await provider.submitQuery('/embedded architecture');
    assert.equal(embeddedRequests.length, 3);

    sessionChanged?.();
    await provider.submitQuery('/embedded architecture');
    assert.equal(embeddedRequests.length, 4);
    assert.deepEqual((context.workspaceState as unknown as InMemoryMemento).keys(), []);
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

  test('plain chat attaches #file mentions as inlined local file content and grounds the prompt', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-chat-mentions-'));
    fs.writeFileSync(path.join(root, 'notes.md'), 'meeting notes', 'utf8');
    workspaceFolders = [{ uri: { fsPath: root } }];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );

      await provider.submitQuery('Summarize #notes.md');

      const payload = capturedPayloads[0] as {
        additionalContext?: Array<{ description: string; text: string }>;
        contextualResources?: { files?: Array<{ uri: string }>; webContext?: { isWebEnabled: boolean } };
        labels: string[];
      };
      assert.equal(payload.contextualResources?.files, undefined);
      assert.ok(payload.additionalContext?.some(item => item.text.includes('meeting notes')));
      assert.ok(payload.labels.some(label => label.includes('Local file: notes.md')));
      assert.equal(payload.contextualResources?.webContext?.isWebEnabled, false);
      assert.ok(capturedPrompts[0].startsWith('[ContextRelay grounding]'));
      assert.ok(capturedPrompts[0].endsWith('Summarize'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('attach-file picker resolves a relative candidate against whichever workspace root actually contains it and satisfies the /ask guard', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-attach-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-attach-b-'));
    fs.writeFileSync(path.join(rootB, 'notes.md'), 'root B body', 'utf8');
    // notes.md only exists under rootB (index 1), not rootA (index 0). A
    // picker resolver that always joins against workspaceRoots[0] would fail
    // to find it in a multi-root workspace.
    workspaceFolders = [{ uri: { fsPath: rootA } }, { uri: { fsPath: rootB } }];
    quickPickSelection = ['notes.md'];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );

      await (provider as unknown as { handleAttachFilePicker(): Promise<void> }).handleAttachFilePicker();
      assert.equal(warningMessages.length, 0);

      // No pins and no # mention: the picker attachment alone must satisfy the /ask guard.
      await (provider as unknown as { handleAskCommand(prompt: string): Promise<void> }).handleAskCommand('summarize');
      assert.equal(warningMessages.length, 0);
      assert.equal(capturedPayloads.length, 1);
      const payload = capturedPayloads[0] as {
        additionalContext?: Array<{ description: string; text: string }>;
      };
      assert.equal(payload.additionalContext?.length, 1);
      assert.equal(payload.additionalContext?.[0].description, 'Local file: notes.md');
      assert.ok(payload.additionalContext?.[0].text.includes('root B body'));
      assert.ok(capturedPrompts[0].startsWith('[ContextRelay grounding]'));

      // Pending attachments are consumed by the message they were sent with.
      await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('next', []);
      assert.equal((capturedPayloads[1] as { additionalContext?: unknown }).additionalContext, undefined);
      assert.equal(capturedPrompts[1], 'next');
    } finally {
      fs.rmSync(rootA, { recursive: true, force: true });
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });

  test('streams progress with the grounded prompt and finishes with the raw reply', async () => {
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
      messages.push(message);
    };

    await (provider as unknown as { handlePinSnippet(item: unknown): Promise<void> }).handlePinSnippet({
      source: 'teams',
      title: 'standup notes',
      snippet: 'Release is blocked by test failures.',
      cache: { hit: false }
    });
    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('what is blocking?', []);

    assert.ok(capturedPrompts[0].startsWith('[ContextRelay grounding]'));
    const commands = messages.map(message => message.command).filter(command => command.startsWith('assistantMessage'));
    assert.deepEqual(commands, ['assistantMessageStart', 'assistantMessageProgress', 'assistantMessageProgress', 'assistantMessageEnd']);
    const end = messages.find(message => message.command === 'assistantMessageEnd');
    assert.equal(end?.text, 'First answer');
    assert.equal(end?.kind, 'chat');
  });

  test('does not emit streaming progress when contextRelay.chat.streamResponses is off', async () => {
    configValues.set('chat.streamResponses', false);
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
      messages.push(message);
    };

    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('hello', []);

    const commands = messages.map(message => message.command).filter(command => command.startsWith('assistantMessage'));
    assert.deepEqual(commands, ['assistantMessageEnd']);
  });

  test('/ask stays blocked when its only attachment can no longer be read', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-ask-deleted-')));
    fs.writeFileSync(path.join(root, 'notes.md'), 'draft', 'utf8');
    workspaceFolders = [{ uri: { fsPath: root } }];
    quickPickSelection = ['notes.md'];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );

      await (provider as unknown as { handleAttachFilePicker(): Promise<void> }).handleAttachFilePicker();
      fs.rmSync(path.join(root, 'notes.md'));
      await (provider as unknown as { handleAskCommand(prompt: string): Promise<void> }).handleAskCommand('summarize');

      assert.equal(warningMessages.length, 1);
      assert.equal(capturedPayloads.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('caps merged attachments at contextRelay.chat.maxAttachedFiles, preferring # mentions', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-cap-')));
    fs.writeFileSync(path.join(root, 'a.md'), 'alpha body', 'utf8');
    fs.writeFileSync(path.join(root, 'b.md'), 'beta body', 'utf8');
    workspaceFolders = [{ uri: { fsPath: root } }];
    quickPickSelection = ['b.md'];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );
      const messages: Array<{ command: string; [key: string]: unknown }> = [];
      (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
        messages.push(message);
      };

      await (provider as unknown as { handleAttachFilePicker(): Promise<void> }).handleAttachFilePicker();
      configValues.set('chat.maxAttachedFiles', 1);
      await provider.submitQuery('Summarize #a.md');

      const payload = capturedPayloads[0] as { additionalContext?: Array<{ description: string; text: string }> };
      assert.equal(payload.additionalContext?.length, 1);
      assert.ok(payload.additionalContext?.[0].text.includes('alpha body'));
      assert.ok(messages.some(message => message.command === 'assistantMessage' && String(message.text).includes('b.md')));
      // The file left out stays attached for the next message.
      const pending = (provider as unknown as { pendingAttachments: Array<{ relativePath: string }> }).pendingAttachments;
      assert.deepEqual(pending.map(attachment => attachment.relativePath), ['b.md']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('clearing the chat while a reply is in flight posts nothing for the aborted request', async () => {
    sendOverride = (_onProgress, signal) => new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
      messages.push(message);
    };

    const pending = (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('long question', []);
    for (let attempt = 0; attempt < 100 && capturedPrompts.length === 0; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(capturedPrompts.length, 1);

    provider.clearChat();
    await pending;

    const clearIndex = messages.findIndex(message => message.command === 'clearChat');
    assert.ok(clearIndex >= 0);
    assert.deepEqual(messages.slice(clearIndex + 1).map(message => message.command), []);
  });

  test('a stream that fails after progress is closed before the error is reported', async () => {
    sendOverride = async onProgress => {
      onProgress?.('partial answer');
      throw new Error('stream broke');
    };
    const provider = new ChatViewProvider(
      createContext(),
      { getAccessToken: async () => 'token-123' } as never,
      {} as never
    );
    const messages: Array<{ command: string; [key: string]: unknown }> = [];
    (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
      messages.push(message);
    };

    await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('question', []);

    const commands = messages
      .map(message => message.command)
      .filter(command => command.startsWith('assistantMessage') || command === 'queryError');
    assert.deepEqual(commands, ['assistantMessageStart', 'assistantMessageProgress', 'assistantMessageEnd', 'queryError']);
    assert.equal(messages.find(message => message.command === 'assistantMessageEnd')?.text, 'partial answer');
  });

  test('attachments sent with a submitted turn are consumed even when it fails, and files attached meanwhile stay pending', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-consume-')));
    fs.writeFileSync(path.join(root, 'a.md'), 'alpha body', 'utf8');
    fs.writeFileSync(path.join(root, 'b.md'), 'beta body', 'utf8');
    workspaceFolders = [{ uri: { fsPath: root } }];
    quickPickSelection = ['a.md'];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getAccessToken: async () => 'token-123' } as never,
        {} as never
      );
      (provider as unknown as { postMessage(message: unknown): void }).postMessage = () => {};
      const pickFiles = (provider as unknown as { handleAttachFilePicker(): Promise<void> }).handleAttachFilePicker.bind(provider);

      await pickFiles();
      sendOverride = async () => {
        // A file attached while the reply is in flight belongs to the next message.
        quickPickSelection = ['b.md'];
        await pickFiles();
        throw new Error('stream broke');
      };
      await (provider as unknown as { handlePlainChat(prompt: string, mentionFiles: unknown[]): Promise<void> }).handlePlainChat('question', []);

      const pending = (provider as unknown as { pendingAttachments: Array<{ relativePath: string }> }).pendingAttachments;
      assert.deepEqual(pending.map(attachment => attachment.relativePath), ['b.md']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('/workiq blocks execution when #file mention is invalid', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-relay-workiq-invalid-'));
    workspaceFolders = [{ uri: { fsPath: root } }];

    try {
      const provider = new ChatViewProvider(
        createContext(),
        { getWorkIqAccessToken: async () => 'workiq-token' } as never,
        {} as never
      );
      const messages: Array<{ command: string; [key: string]: unknown }> = [];
      (provider as unknown as { postMessage(message: { command: string; [key: string]: unknown }): void }).postMessage = (message) => {
        messages.push(message);
      };

      await provider.submitQuery('/workiq summarize #missing.md');

      assert.equal(workIqRequests.length, 0);
      assert.equal(messages.some(message => message.command === 'queryError'), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
