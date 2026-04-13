import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { hydrateItemForHandoff } from '../adapters/handoffContentAdapter';
import { searchMail } from '../adapters/mailAdapter';
import { searchRetrieval } from '../adapters/retrievalAdapter';
import { searchTeams } from '../adapters/teamsAdapter';
import { AuthProvider } from '../auth/authProvider';
import { CacheStore } from '../cache/cacheStore';
import { DocGenerator, type HandoffContext } from '../docs/docGenerator';
import { type ContextItem, type ContextSource } from '../models/contextItem';
import { type RouteTarget, getHelpText, parseCommand } from '../router/commandRouter';
import { SnippetStore } from '../snippets/snippetStore';
import { buildSearchSummary, type SearchSummaryResult } from './searchSummary';
import { type HostToWebviewMessage, type WebviewToHostMessage } from './types';

const DEFAULT_SOURCES: ContextSource[] = ['mail', 'teams', 'sharepoint', 'onedrive'];

/**
 * WebviewViewProvider for the ContextRelay chat panel.
 *
 * Follows the same pattern as vscode-copilot-chat's BaseSuggestionsPanel:
 * - CSP with nonce-based script restriction
 * - postMessage/onDidReceiveMessage for host↔webview communication
 * - VS Code theme variables for styling
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contextRelay.chatView';

  private view?: vscode.WebviewView;
  private webviewReady = false;
  private pendingMessages: HostToWebviewMessage[] = [];
  private latestSearchSummary?: string;
  private readonly cache: CacheStore<ContextItem[]>;
  private readonly snippetStore: SnippetStore;
  private readonly docGenerator: DocGenerator;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly authProvider: AuthProvider,
    private readonly extensionUri: vscode.Uri
  ) {
    this.cache = new CacheStore<ContextItem[]>(
      context,
      () => vscode.workspace.getConfiguration('contextRelay').get<number>('cache.ttlSeconds', 300),
      () => vscode.workspace.getConfiguration('contextRelay').get<number>('cache.maxEntries', 200),
      () => vscode.workspace.getConfiguration('contextRelay').get<boolean>('cache.persistWorkspaceState', true)
    );
    this.snippetStore = new SnippetStore(context);
    this.docGenerator = new DocGenerator();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions
    );
  }

  public async submitQuery(text: string): Promise<void> {
    await this.handleQuery(text);
  }

  public postMessage(message: HostToWebviewMessage): void {
    if (this.view && this.webviewReady) {
      void this.view.webview.postMessage(message);
      return;
    }

    this.pendingMessages.push(message);
  }

  public clearChat(): void {
    if (!this.view) {
      return;
    }

    this.postMessage({ command: 'clearChat' });
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public clearSnippets(): void {
    this.snippetStore.clear();
  }

  public getDocGenerator(): DocGenerator {
    return this.docGenerator;
  }

  public getHandoffContext(): HandoffContext {
    return {
      snippets: this.snippetStore.getAll(),
      searchSummary: this.latestSearchSummary
    };
  }

  private flushPendingMessages(): void {
    if (!this.view || !this.webviewReady || this.pendingMessages.length === 0) {
      return;
    }

    const queued = [...this.pendingMessages];
    this.pendingMessages = [];
    for (const message of queued) {
      void this.view.webview.postMessage(message);
    }
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.command) {
      case 'webviewReady':
        this.webviewReady = true;
        this.flushPendingMessages();
        break;
      case 'submitQuery':
        await this.handleQuery(message.text);
        break;
      case 'openLink':
        await this.handleOpenLink(message.url);
        break;
      case 'copySnippet':
        await this.handleCopySnippet(message.text);
        break;
      case 'pinSnippet':
        await this.handlePinSnippet(message.item);
        break;
    }
  }

  private async handleOpenLink(url: string): Promise<void> {
    if (!url?.trim()) {
      return;
    }

    const uri = vscode.Uri.parse(url);
    if (uri.scheme === 'http' || uri.scheme === 'https') {
      await vscode.env.openExternal(uri);
    }
  }

  private async handleCopySnippet(text: string): Promise<void> {
    if (!text?.trim()) {
      return;
    }

    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('ContextRelay: Text copied to clipboard.');
  }

  private async handlePinSnippet(item: ContextItem): Promise<void> {
    let handoffItem = item;

    if (item.source === 'mail' || item.source === 'sharepoint' || item.source === 'onedrive') {
      try {
        const token = await this.authProvider.getAccessToken();
        handoffItem = await hydrateItemForHandoff(token, item);
      } catch (err) {
        vscode.window.showWarningMessage(
          `ContextRelay: Could not fetch full content for "${item.title}". Saved available excerpt instead. ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const snippet = this.snippetStore.save(handoffItem);
    vscode.window.showInformationMessage(`Snippet "${snippet.name}" saved.`);
  }

  private async handleQuery(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const timestamp = new Date().toISOString();
    this.postMessage({
      command: 'userMessage',
      text: trimmed,
      timestamp
    });

    const parsed = parseCommand(text);
    if (parsed.isEmpty) {
      if (trimmed.startsWith('/')) {
        this.postMessage({
          command: 'slashHelp',
          commandName: `/${parsed.target}`,
          examples: getHelpText(parsed.target)
            .split('\n')
            .map(example => example.trim())
            .filter(Boolean)
        });
      }
      return;
    }

    const targetSources = this.getTargetSources(parsed.target);
    if (targetSources.length === 0) {
      const message = 'No ContextRelay adapters are enabled.';
      this.latestSearchSummary = buildSearchSummary(parsed.query, []);
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message,
        timestamp: new Date().toISOString()
      });
      return;
    }

    let token: string;
    try {
      token = await this.authProvider.getAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication required.';
      const errorSource = targetSources.length === 1 ? targetSources[0] : 'all';
      this.latestSearchSummary = buildSearchSummary(parsed.query, [
        {
          source: errorSource,
          items: [],
          error: message
        }
      ]);
      this.postMessage({
        command: 'queryError',
        source: errorSource,
        message,
        timestamp: new Date().toISOString()
      });
      return;
    }

    for (const source of targetSources) {
      this.postMessage({
        command: 'loading',
        source,
        isLoading: true
      });
    }

    const results = await Promise.all(
      targetSources.map(source => this.querySource(source, parsed.query, token))
    );
    this.latestSearchSummary = buildSearchSummary(parsed.query, results);
  }

  private async querySource(
    source: ContextSource,
    query: string,
    token: string
  ): Promise<SearchSummaryResult> {
    try {
      const items = await this.fetchResults(source, query, token);
      const cached = items.length > 0 && items.every(item => item.cache.hit);

      this.postMessage({
        command: 'queryResult',
        items,
        source,
        query,
        timestamp: new Date().toISOString()
      });

      return {
        source,
        items,
        cached
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.postMessage({
        command: 'queryError',
        source,
        message,
        timestamp: new Date().toISOString()
      });

      return {
        source,
        items: [],
        error: message
      };
    } finally {
      this.postMessage({
        command: 'loading',
        source,
        isLoading: false
      });
    }
  }

  private getTargetSources(target: RouteTarget): ContextSource[] {
    if (target !== 'all') {
      return [target];
    }

    const config = vscode.workspace.getConfiguration('contextRelay');
    const sources = [...DEFAULT_SOURCES];
    if (config.get<boolean>('adapters.connectors', false)) {
      sources.push('connectors');
    }
    return sources;
  }

  private async fetchResults(
    source: ContextSource,
    query: string,
    token: string
  ): Promise<ContextItem[]> {
    const config = vscode.workspace.getConfiguration('contextRelay');
    const ttlSeconds = config.get<number>('cache.ttlSeconds', 300);

    const runCachedSearch = async (
      cacheKey: string,
      enabled: boolean,
      fetchFn: () => Promise<ContextItem[]>
    ): Promise<ContextItem[]> => {
      if (!enabled) {
        throw new Error('Adapter disabled');
      }

      const cached = this.cache.get(cacheKey);
      if (cached) {
        const storedAt = this.cache.getStoredAt(cacheKey);
        return cached.map(item => ({
          ...item,
          cache: {
            ...item.cache,
            hit: true,
            storedAt: storedAt ? new Date(storedAt).toISOString() : undefined,
            ttlSeconds
          }
        }));
      }

      const items = await fetchFn();
      this.cache.set(cacheKey, items);
      return items;
    };

    switch (source) {
      case 'mail':
        return runCachedSearch(
          `mail:${query}`,
          config.get<boolean>('adapters.mail', true),
          () => searchMail(token, query)
        );
      case 'teams':
        return runCachedSearch(
          `teams:${query}`,
          config.get<boolean>('adapters.teams', true),
          () => searchTeams(token, query)
        );
      case 'sharepoint':
        return runCachedSearch(
          `sharepoint:${query}`,
          config.get<boolean>('adapters.sharepoint', true),
          () => searchRetrieval(token, query, 'sharePoint')
        );
      case 'onedrive':
        return runCachedSearch(
          `onedrive:${query}`,
          config.get<boolean>('adapters.onedrive', true),
          () => searchRetrieval(token, query, 'oneDriveBusiness')
        );
      case 'connectors':
        return runCachedSearch(
          `connectors:${query}`,
          config.get<boolean>('adapters.connectors', false),
          () => searchRetrieval(token, query, 'externalItem')
        );
    }
  }

  /**
   * Generate the HTML for the webview with CSP and nonce.
   * Follows the same pattern as vscode-copilot-chat's _getWebviewContent().
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
      style-src 'unsafe-inline' ${webview.cspSource};
      font-src ${webview.cspSource};
      script-src 'nonce-${nonce}';">
  <title>ContextRelay</title>
  <style>
    :root {
      --cr-border-radius: 6px;
      --cr-spacing-xs: 4px;
      --cr-spacing-sm: 8px;
      --cr-spacing-md: 12px;
      --cr-spacing-lg: 16px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }

    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    #chatArea {
      flex: 1;
      overflow-y: auto;
      padding: var(--cr-spacing-md);
      display: flex;
      flex-direction: column;
      gap: var(--cr-spacing-sm);
    }

    #chatArea::after {
      content: '';
      display: block;
    }

    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      text-align: center;
      opacity: 0.7;
      gap: var(--cr-spacing-sm);
    }

    .welcome h2 {
      font-size: 1.1em;
      font-weight: 600;
    }

    .welcome p {
      font-size: 0.9em;
    }

    .message {
      max-width: 90%;
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      border-radius: var(--cr-border-radius);
      word-wrap: break-word;
      line-height: 1.5;
      animation: fadeIn 0.2s ease-in;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-bottom-right-radius: 2px;
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--vscode-editorWidget-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent));
      border-bottom-left-radius: 2px;
    }

    .message .timestamp {
      font-size: 0.75em;
      opacity: 0.6;
      margin-top: var(--cr-spacing-xs);
    }

    .result-card {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent));
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      margin-top: var(--cr-spacing-xs);
    }

    .result-card .title {
      font-weight: 600;
      font-size: 0.95em;
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-xs);
    }

    .result-card .snippet {
      font-size: 0.85em;
      margin-top: var(--cr-spacing-xs);
      opacity: 0.9;
    }

    .result-card .actions {
      display: flex;
      gap: var(--cr-spacing-sm);
      margin-top: var(--cr-spacing-sm);
    }

    .result-card .actions button {
      background: none;
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-input-border, #555));
      color: var(--vscode-foreground);
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.8em;
      cursor: pointer;
    }

    .result-card .actions button:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .source-badge {
      display: inline-block;
      font-size: 0.7em;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      text-transform: uppercase;
      font-weight: 600;
    }

    .source-header {
      font-weight: 600;
      font-size: 0.9em;
      margin-top: var(--cr-spacing-sm);
      margin-bottom: var(--cr-spacing-xs);
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-xs);
    }

    .loading {
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-sm);
      padding: var(--cr-spacing-sm);
      font-size: 0.85em;
      opacity: 0.7;
    }

    .loading .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--vscode-foreground);
      border-top: 2px solid transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-banner {
      background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      font-size: 0.85em;
      color: var(--vscode-errorForeground, var(--vscode-foreground));
    }

    .slash-help {
      background: var(--vscode-editorWidget-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent));
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-md);
      font-size: 0.85em;
    }

    .slash-help code {
      background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.15));
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }

    #inputArea {
      border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      display: flex;
      flex-direction: column;
      gap: var(--cr-spacing-xs);
      position: relative;
    }

    #inputWrapper {
      display: flex;
      align-items: flex-end;
      gap: var(--cr-spacing-sm);
    }

    #promptInput {
      flex: 1;
      min-height: 36px;
      max-height: 120px;
      resize: none;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
      outline: none;
    }

    #promptInput:focus {
      border-color: var(--vscode-focusBorder);
    }

    #promptInput::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    #sendButton {
      width: 32px;
      height: 32px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: var(--cr-border-radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    #sendButton:hover {
      background: var(--vscode-button-hoverBackground);
    }

    #sendButton:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #inputHint {
      font-size: 0.75em;
      opacity: 0.5;
    }

    #slashMenu {
      display: none;
      position: absolute;
      bottom: 100%;
      left: var(--cr-spacing-md);
      right: var(--cr-spacing-md);
      background: var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-editorWidget-border, transparent));
      border-radius: var(--cr-border-radius);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      max-height: 220px;
      overflow-y: auto;
      z-index: 100;
    }

    #slashMenu.visible {
      display: block;
    }

    .slash-item {
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-sm);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      cursor: pointer;
      font-size: 0.9em;
    }

    .slash-item:hover,
    .slash-item.selected {
      background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground));
    }

    .slash-item .slash-icon {
      width: 20px;
      text-align: center;
    }

    .slash-item .slash-label {
      font-weight: 600;
      font-family: var(--vscode-editor-font-family);
    }

    .slash-item .slash-desc {
      opacity: 0.7;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="chatArea" role="log" aria-live="polite" aria-label="Chat messages">
      <div class="welcome" id="welcome">
        <h2>ContextRelay</h2>
        <p>Search Microsoft 365 context with slash commands.</p>
        <p style="font-size: 0.8em;">Type <code>/</code> for available commands, or enter a keyword to search all sources.</p>
      </div>
    </div>

    <div id="inputArea">
      <div id="slashMenu" role="listbox" aria-label="Slash commands"></div>

      <div id="inputWrapper">
        <textarea
          id="promptInput"
          rows="1"
          placeholder="Search M365 context... (type / for commands)"
          aria-label="Search query input"
          aria-haspopup="listbox"
          aria-controls="slashMenu"
        ></textarea>
        <button id="sendButton" aria-label="Send query" title="Send">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1.91L7.2 8 1 14.09 1.91 15 9 8 1.91 1z"/>
            <path d="M7 1.91L13.2 8 7 14.09 7.91 15 15 8 7.91 1z"/>
          </svg>
        </button>
      </div>
      <div id="inputHint">Press Enter to send • Shift+Enter for new line • Type / for commands</div>
    </div>
  </div>

  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
