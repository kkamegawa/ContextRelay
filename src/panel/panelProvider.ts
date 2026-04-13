import * as vscode from 'vscode';
import * as fs from 'fs';
import { AuthProvider } from '../auth/authProvider';
import { CacheStore } from '../cache/cacheStore';
import { HandoffContext } from '../docs/docGenerator';
import { SnippetStore } from '../snippets/snippetStore';
import { DocGenerator } from '../docs/docGenerator';
import { parseCommand, getHelpText } from '../router/commandRouter';
import { searchMail } from '../adapters/mailAdapter';
import { searchTeams } from '../adapters/teamsAdapter';
import { searchRetrieval } from '../adapters/retrievalAdapter';
import { createConversation, sendMessage } from '../adapters/chatAdapter';
import { ContextItem } from '../models/contextItem';
import { hydrateItemForHandoff } from '../adapters/handoffContentAdapter';
import { buildSearchSummary } from './searchSummary';
import { createFallbackPreview, createMailPreview, getMailMessageId } from './itemPreview';
import { buildHandoffSnippetDraft } from './handoffSelection';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from '../adapters/graphClient';

interface SearchResult {
  source: string;
  items: ContextItem[];
  error?: string;
  cached?: boolean;
}

interface PanelMessage {
  type: string;
  [key: string]: unknown;
}

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contextRelay.panel';

  private view?: vscode.WebviewView;
  private cache: CacheStore<ContextItem[]>;
  private snippetStore: SnippetStore;
  private docGenerator: DocGenerator;
  private currentConversationId?: string;
  private webviewReady = false;
  private pendingMessages: unknown[] = [];
  private latestSearchSummary?: string;

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
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: PanelMessage) => this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );
  }

  private async handleMessage(message: PanelMessage): Promise<void> {
    switch (message.type) {
      case 'search':
        await this.handleSearch(message.query as string);
        break;
      case 'chat':
        await this.handleChat(message.message as string);
        break;
      case 'newConversation':
        this.currentConversationId = undefined;
        this.postMessage({ type: 'conversationReset' });
        break;
      case 'pinSnippet':
        await this.handlePinSnippet(message.item as ContextItem, message.name as string | undefined);
        break;
      case 'savePreviewSnippet':
        this.handleSavePreviewSnippet(
          message.item as ContextItem,
          message.selectedText as string | undefined,
          message.previewBody as string | undefined
        );
        break;
      case 'removeSnippet':
        this.handleRemoveSnippet(message.id as string);
        break;
      case 'getSnippets':
        this.sendSnippets();
        break;
      case 'signIn':
        await this.handleSignIn();
        break;
      case 'ready':
        this.webviewReady = true;
        await this.sendAuthState();
        await this.sendUiState();
        this.sendSnippets();
        this.flushPendingMessages();
        break;
      case 'clearCache':
        await vscode.commands.executeCommand('contextRelay.clearCache');
        break;
      case 'clearSnippets':
        await vscode.commands.executeCommand('contextRelay.clearSnippets');
        break;
      case 'generateDocs':
        await vscode.commands.executeCommand('contextRelay.generateHandoffDocs');
        break;
      case 'openHandoffDoc':
        await vscode.commands.executeCommand('contextRelay.openHandoffDoc');
        break;
      case 'openCopilotChat':
        await vscode.commands.executeCommand('contextRelay.openCopilotChat');
        break;
      case 'copyPrompt':
        await vscode.commands.executeCommand('contextRelay.copyHandoffPrompt');
        break;
      case 'openUrl':
        await this.handleOpenUrl(message.url as string);
        break;
      case 'copyText':
        await this.handleCopyText(message.text as string);
        break;
      case 'previewItem':
        await this.handlePreviewItem(message.item as ContextItem);
        break;
    }
  }

  public async refreshAuthState(): Promise<void> {
    await this.sendAuthState();
  }

  public async refreshUiState(): Promise<void> {
    await this.sendUiState();
  }

  private async handleSignIn(): Promise<void> {
    try {
      await this.authProvider.getSession(false);
      await this.sendAuthState();
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  private async sendAuthState(): Promise<void> {
    const label = await this.authProvider.getAccountLabel();
    this.postMessage({
      type: 'authState',
      signedIn: !!label,
      accountLabel: label ?? null
    });
  }

  private async sendUiState(): Promise<void> {
    const config = vscode.workspace.getConfiguration('contextRelay');
    this.postMessage({
      type: 'uiState',
      chatEnabled: config.get<boolean>('enableChatPreview', true)
    });
  }

  private async handleSearch(query: string): Promise<void> {
    if (!query?.trim()) {
      return;
    }

    const parsed = parseCommand(query);
    if (parsed.isEmpty) {
      this.postMessage({
        type: 'help',
        text: getHelpText(parsed.target)
      });
      return;
    }

    let token: string;
    try {
      token = await this.authProvider.getAccessToken();
    } catch (err) {
      this.postMessage({
        type: 'authRequired',
        message: err instanceof Error ? err.message : 'Authentication required'
      });
      return;
    }

    this.postMessage({ type: 'searchStart', query });

    const config = vscode.workspace.getConfiguration('contextRelay');
    const results: SearchResult[] = [];

    const runAdapter = async (
      source: string,
      enabled: boolean,
      cacheKey: string,
      fetchFn: () => Promise<ContextItem[]>
    ): Promise<SearchResult> => {
      if (!enabled) {
        return { source, items: [], error: 'Adapter disabled' };
      }

      const cached = this.cache.get(cacheKey);
      if (cached) {
        const storedAt = this.cache.getStoredAt(cacheKey);
        const items = cached.map(item => ({
          ...item,
          cache: { hit: true, storedAt: storedAt ? new Date(storedAt).toISOString() : undefined }
        }));

        // Background refresh
        fetchFn().then(fresh => {
          this.cache.set(cacheKey, fresh);
          this.postMessage({
            type: 'searchUpdate',
            source,
            items: fresh.map(i => ({ ...i, cache: { hit: false } })),
            badge: 'Updated just now'
          });
        }).catch(() => { /* ignore background refresh errors */ });

        return { source, items, cached: true };
      }

      try {
        const items = await fetchFn();
        this.cache.set(cacheKey, items);
        return { source, items };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return { source, items: [], error: errMsg };
      }
    };

    const { target, query: q } = parsed;

    const runAll = target === 'all';
    const promises: Promise<SearchResult>[] = [];

    if (runAll || target === 'mail') {
      const enabled = config.get<boolean>('adapters.mail', true);
      promises.push(runAdapter('mail', enabled, `mail:${q}`, () => searchMail(token, q)));
    }
    if (runAll || target === 'teams') {
      const enabled = config.get<boolean>('adapters.teams', true);
      promises.push(runAdapter('teams', enabled, `teams:${q}`, () => searchTeams(token, q)));
    }
    if (runAll || target === 'sharepoint') {
      const enabled = config.get<boolean>('adapters.sharepoint', true);
      promises.push(runAdapter('sharepoint', enabled, `sharepoint:${q}`, () =>
        searchRetrieval(token, q, 'sharePoint')));
    }
    if (runAll || target === 'onedrive') {
      const enabled = config.get<boolean>('adapters.onedrive', true);
      promises.push(runAdapter('onedrive', enabled, `onedrive:${q}`, () =>
        searchRetrieval(token, q, 'oneDriveBusiness')));
    }
    if (runAll && config.get<boolean>('adapters.connectors', false)) {
      promises.push(runAdapter('connectors', true, `connectors:${q}`, () =>
        searchRetrieval(token, q, 'externalItem')));
    }

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }

    this.latestSearchSummary = buildSearchSummary(query, results);

    this.postMessage({ type: 'searchResults', results });
  }

  private async handleOpenUrl(url: string): Promise<void> {
    if (!url?.trim()) {
      return;
    }

    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: `Failed to open link: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  private async handleCopyText(text: string): Promise<void> {
    if (!text?.trim()) {
      return;
    }

    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('ContextRelay: Text copied to clipboard.');
  }

  private async handlePreviewItem(item: ContextItem): Promise<void> {
    if (!item) {
      return;
    }

    this.postMessage({ type: 'previewStart', item });

    try {
      let preview = createFallbackPreview(item);

      if (item.source === 'mail') {
        let token: string;
        try {
          token = await this.authProvider.getAccessToken();
        } catch (err) {
          this.postMessage({
            type: 'previewError',
            message: err instanceof Error ? err.message : 'Authentication required for preview.'
          });
          return;
        }

        const messageId = getMailMessageId(item);
        if (messageId) {
          const url = `${GRAPH_BASE}/v1.0/me/messages/${encodeURIComponent(messageId)}?$select=body`;
          const response = await graphFetchWithRetry(url, token, { method: 'GET' });
          const data = await handleGraphResponse(response) as { body?: { contentType?: string; content?: string } };
          preview = createMailPreview(item, data);
        }
      }

      this.postMessage({ type: 'previewContent', preview });
    } catch (err) {
      this.postMessage({
        type: 'previewError',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private async handleChat(message: string): Promise<void> {
    if (!message?.trim()) {
      return;
    }

    const config = vscode.workspace.getConfiguration('contextRelay');
    if (!config.get<boolean>('enableChatPreview', true)) {
      this.postMessage({ type: 'chatError', message: 'Chat preview is disabled in settings.' });
      return;
    }

    let token: string;
    try {
      token = await this.authProvider.getAccessToken();
    } catch {
      this.postMessage({ type: 'authRequired', message: 'Authentication required for chat.' });
      return;
    }

    this.postMessage({ type: 'chatStart' });

    try {
      if (!this.currentConversationId) {
        this.currentConversationId = await createConversation(token);
      }

      const reply = await sendMessage(token, this.currentConversationId, message);
      this.postMessage({ type: 'chatReply', message: reply });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'chatError', message: errMsg });
    }
  }

  private async handlePinSnippet(item: ContextItem, name?: string): Promise<void> {
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

    const snippet = this.snippetStore.save(handoffItem, name);
    this.postMessage({ type: 'snippetSaved', snippet });
    this.sendSnippets();
    vscode.window.showInformationMessage(`Snippet "${snippet.name}" saved.`);
  }

  private handleSavePreviewSnippet(
    item: ContextItem,
    selectedText?: string,
    previewBody?: string
  ): void {
    const draft = buildHandoffSnippetDraft(item, { selectedText, previewBody });
    if (!draft) {
      this.postMessage({ type: 'error', message: 'No preview text selected. Select text or save the full preview.' });
      return;
    }

    const snippet = this.snippetStore.save(draft.item, draft.name);
    this.postMessage({ type: 'snippetSaved', snippet });
    this.sendSnippets();
    vscode.window.showInformationMessage(`Snippet "${snippet.name}" saved.`);
  }

  private handleRemoveSnippet(id: string): void {
    this.snippetStore.remove(id);
    this.sendSnippets();
  }

  private sendSnippets(): void {
    const snippets = this.snippetStore.getAll();
    this.postMessage({ type: 'snippets', snippets });
  }

  postMessage(message: unknown): void {
    if (this.view && this.webviewReady) {
      this.view.webview.postMessage(message);
      return;
    }

    this.pendingMessages.push(message);
  }

  private flushPendingMessages(): void {
    if (!this.view || !this.webviewReady || this.pendingMessages.length === 0) {
      return;
    }

    const queued = [...this.pendingMessages];
    this.pendingMessages = [];
    queued.forEach(message => {
      this.view?.webview.postMessage(message);
    });
  }

  clearCache(): void {
    this.cache.clear();
    this.postMessage({ type: 'cacheCleared' });
  }

  clearSnippets(): void {
    this.snippetStore.clear();
    this.postMessage({ type: 'snippetsCleared' });
  }

  getSnippetStore(): SnippetStore {
    return this.snippetStore;
  }

  getDocGenerator(): DocGenerator {
    return this.docGenerator;
  }

  getHandoffContext(): HandoffContext {
    return {
      snippets: this.snippetStore.getAll(),
      searchSummary: this.latestSearchSummary
    };
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const mediaPath = vscode.Uri.joinPath(this.extensionUri, 'media');
    const htmlUri = vscode.Uri.joinPath(mediaPath, 'panel.html');

    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'panel.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, 'panel.js'));

    let html: string;
    try {
      html = fs.readFileSync(htmlUri.fsPath, 'utf8');
    } catch {
      html = this.getFallbackHtml();
    }

    const nonce = getNonce();
    html = html
      .replace(/\{\{cspNonce\}\}/g, nonce)
      .replace(/\{\{cssUri\}\}/g, cssUri.toString())
      .replace(/\{\{jsUri\}\}/g, jsUri.toString());

    return html;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html><html><body><p>ContextRelay panel loading...</p></body></html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
