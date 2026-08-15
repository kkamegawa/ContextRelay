import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { createConversation, sendMessageAuto } from '../adapters/chatAdapter';
import { hydrateItemForHandoff } from '../adapters/handoffContentAdapter';
import { searchMail } from '../adapters/mailAdapter';
import { searchOneNote } from '../adapters/onenoteAdapter';
import { searchPlanner } from '../adapters/plannerAdapter';
import { searchRetrieval } from '../adapters/retrievalAdapter';
import { searchTeams } from '../adapters/teamsAdapter';
import { searchTodo } from '../adapters/todoAdapter';
import { sendWorkIqMessage } from '../adapters/workIqAdapter';
import { AuthProvider } from '../auth/authProvider';
import { CacheStore } from '../cache/cacheStore';
import { DocGenerator, type HandoffContext } from '../docs/docGenerator';
import { type ContextItem, type ContextSource, type ResolvedPreview, getContextItemKey } from '../models/contextItem';
import { getHelpText, parseCommand } from '../router/commandRouter';
import { SnippetStore } from '../snippets/snippetStore';
import { buildAskInstruction } from './askPrompt';
import {
  DEFAULT_MAX_ATTACHMENTS,
  mergeAttachments,
  resolveAttachmentPath,
  type AttachmentSelection,
  type ResolvedAttachment
} from './attachments';
import { buildChatContextPayload } from './chatContext';
import { isCopilotSupportedFileExtension } from './copilotSupportedExtensions';
import { buildWorkIqPromptWithFiles, resolveFileMentions } from './fileMentions';
import { buildPreviewWebviewHtml } from './openResult';
import { detectOutputLanguage } from './outputLanguage';
import { resolvePreview } from './previewResolver';
import { normalizeSafeExternalUrl } from './safeExternalUrl';
import { buildSearchSummary, type SearchSummaryResult } from './searchSummary';
import { type HostToWebviewMessage, type WebviewToHostMessage } from './types';
import { CHAT_EDITOR_PANEL_ID, CHAT_VIEW_ID } from './chatViewConstants';

type ChatHostKind = 'sidebar' | 'editor';

interface ChatHostSession {
  webview: vscode.Webview;
  ready: boolean;
}

/**
 * WebviewViewProvider for the ContextRelay chat panel.
 *
 * Follows the same pattern as vscode-copilot-chat's BaseSuggestionsPanel:
 * - CSP with nonce-based script restriction
 * - postMessage/onDidReceiveMessage for host↔webview communication
 * - VS Code theme variables for styling
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = CHAT_VIEW_ID;

  private latestSearchSummary?: string;
  private latestVisibleResult?: string;
  private readonly cache: CacheStore<ContextItem[]>;
  private readonly snippetStore: SnippetStore;
  private readonly docGenerator: DocGenerator;
  private readonly hosts = new Map<ChatHostKind, ChatHostSession>();
  private static readonly MAX_TRANSCRIPT_LENGTH = 200;
  private transcript: HostToWebviewMessage[] = [];
  private currentConversationId?: string;
  private currentWorkIqContextId?: string;
  private editorPanel?: vscode.WebviewPanel;
  private previewPanel?: vscode.WebviewPanel;
  /** Files attached via drag-and-drop or the attach-file picker, pending the next Copilot message. */
  private pendingAttachments: ResolvedAttachment[] = [];
  /** Lets the Stop button cancel an in-flight streamed Copilot reply. */
  private activeStreamController?: AbortController;

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
    this.attachHost('sidebar', webviewView.webview, this.context.subscriptions);
  }

  public async openInEditorArea(): Promise<void> {
    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      CHAT_EDITOR_PANEL_ID,
      'ContextRelay',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')]
      }
    );

    this.editorPanel = panel;
    this.attachHost('editor', panel.webview, this.context.subscriptions);
    panel.onDidDispose(
      () => {
        if (this.editorPanel === panel) {
          this.editorPanel = undefined;
        }
        this.hosts.delete('editor');
      },
      undefined,
      this.context.subscriptions
    );
  }

  public async submitQuery(text: string): Promise<void> {
    await this.handleQuery(text);
  }

  public postMessage(message: HostToWebviewMessage): void {
    // Live/ephemeral UI state (pinned items, workspace files, attachment
    // chips, and in-flight streaming progress) is re-sent to newly-attached
    // hosts explicitly (see markHostReady) rather than replayed from the
    // transcript, since only the latest value matters.
    const isTranscriptExempt =
      message.command === 'pinnedItems' ||
      message.command === 'workspaceFiles' ||
      message.command === 'attachmentsChanged' ||
      message.command === 'assistantMessageStart' ||
      message.command === 'assistantMessageProgress';

    if (message.command === 'clearChat') {
      this.transcript = [message];
    } else if (!isTranscriptExempt) {
      this.transcript.push(message);
      if (this.transcript.length > ChatViewProvider.MAX_TRANSCRIPT_LENGTH) {
        this.transcript = this.transcript.slice(-ChatViewProvider.MAX_TRANSCRIPT_LENGTH);
      }
    }

    this.broadcastMessage(message);
  }

  public clearChat(): void {
    this.resetChatState();
  }

  private resetChatState(): void {
    this.snippetStore.clear();
    this.latestSearchSummary = undefined;
    this.latestVisibleResult = undefined;
    this.currentConversationId = undefined;
    this.currentWorkIqContextId = undefined;
    this.activeStreamController?.abort();
    this.activeStreamController = undefined;
    this.pendingAttachments = [];
    this.postMessage({ command: 'clearChat' });
    this.sendPinnedItems();
    this.sendAttachments();
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public clearSnippets(): void {
    this.snippetStore.clear();
    this.sendPinnedItems();
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

  private attachHost(
    kind: ChatHostKind,
    webview: vscode.Webview,
    subscriptions: vscode.Disposable[]
  ): void {
    this.hosts.set(kind, { webview, ready: false });
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')]
    };
    webview.html = this.getHtmlForWebview(webview);
    subscriptions.push(
      webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        void this.handleMessage(kind, message);
      })
    );
  }

  private broadcastMessage(message: HostToWebviewMessage): void {
    for (const host of this.hosts.values()) {
      if (!host.ready) {
        continue;
      }

      void host.webview.postMessage(message);
    }
  }

  private postMessageToHost(kind: ChatHostKind, message: HostToWebviewMessage): void {
    const host = this.hosts.get(kind);
    if (!host?.ready) {
      return;
    }

    void host.webview.postMessage(message);
  }

  private markHostReady(kind: ChatHostKind): void {
    const host = this.hosts.get(kind);
    if (!host || host.ready) {
      return;
    }

    host.ready = true;
    for (const message of this.transcript) {
      void host.webview.postMessage(message);
    }
    this.sendPinnedItems(kind);
    this.sendAttachments(kind);
    void this.sendWorkspaceFiles(kind);
  }

  private async handleMessage(kind: ChatHostKind, message: WebviewToHostMessage): Promise<void> {
    switch (message.command) {
      case 'webviewReady':
        this.markHostReady(kind);
        break;
      case 'submitQuery':
        await this.handleQuery(message.text);
        break;
      case 'openLink':
        await this.handleOpenLink(message.url);
        break;
      case 'openItem':
        await this.handleOpenItemRequest(kind, message.item);
        break;
      case 'copySnippet':
        await this.handleCopySnippet(message.text);
        break;
      case 'applyAssistantResult':
        await this.handleApplyAssistantResult(message.action, message.text);
        break;
      case 'pinSnippet':
        await this.handlePinSnippet(message.item);
        break;
      case 'attachFiles':
        await this.handleAttachFiles(message.uris);
        break;
      case 'attachFilePicker':
        await this.handleAttachFilePicker();
        break;
      case 'removeAttachment':
        this.handleRemoveAttachment(message.absolutePath);
        break;
      case 'cancelAssistantMessage':
        this.activeStreamController?.abort();
        break;
    }
  }

  private async handleOpenLink(url: string): Promise<void> {
    const safeUrl = normalizeSafeExternalUrl(url);
    if (!safeUrl) {
      return;
    }

    await vscode.env.openExternal(vscode.Uri.parse(safeUrl));
  }

  private async handleCopySnippet(text: string): Promise<void> {
    if (!text?.trim()) {
      return;
    }

    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('ContextRelay: Text copied to clipboard.');
  }

  private async handleApplyAssistantResult(action: 'copy' | 'append' | 'replace', text: string): Promise<void> {
    if (!text?.trim()) {
      vscode.window.showWarningMessage('ContextRelay: There is no assistant result to apply.');
      return;
    }

    if (action === 'copy') {
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage('ContextRelay: Copilot response copied to clipboard.');
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('ContextRelay: Open an editor before appending or replacing content.');
      return;
    }

    const editApplied = await editor.edit(editBuilder => {
      if (action === 'append') {
        editBuilder.insert(editor.selection.active, text);
        return;
      }

      const range = editor.selection.isEmpty
        ? this.getWholeDocumentRange(editor.document)
        : editor.selection;
      editBuilder.replace(range, text);
    });

    if (!editApplied) {
      vscode.window.showErrorMessage('ContextRelay: Failed to update the active editor.');
      return;
    }

    vscode.window.showInformationMessage(
      action === 'append'
        ? 'ContextRelay: Copilot response appended to the active editor.'
        : 'ContextRelay: Copilot response replaced the active editor content.'
    );
  }

  private getWholeDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
    return new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
  }

  private async handlePinSnippet(item: ContextItem): Promise<void> {
    const key = getContextItemKey(item);

    // Toggle: if this item is already pinned, unpin it instead of saving again.
    if (this.snippetStore.removeByItemKey(key)) {
      this.sendPinnedItems();
      vscode.window.showInformationMessage(`Snippet "${item.title}" unpinned.`);
      return;
    }

    let handoffItem = item;

    if (item.source === 'mail' || item.source === 'sharepoint' || item.source === 'onedrive' || item.source === 'onenote') {
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
    this.sendPinnedItems();
    vscode.window.showInformationMessage(`Snippet "${snippet.name}" saved.`);
  }

  private sendPinnedItems(kind?: ChatHostKind): void {
    const message: HostToWebviewMessage = {
      command: 'pinnedItems',
      keys: this.snippetStore.getPinnedKeys()
    };

    if (kind) {
      this.postMessageToHost(kind, message);
      return;
    }

    this.broadcastMessage(message);
  }

  private sendAttachments(kind?: ChatHostKind): void {
    const message: HostToWebviewMessage = {
      command: 'attachmentsChanged',
      attachments: this.pendingAttachments.map(attachment => ({
        absolutePath: attachment.absolutePath,
        relativePath: attachment.relativePath,
        origin: attachment.origin
      }))
    };

    if (kind) {
      this.postMessageToHost(kind, message);
      return;
    }

    this.broadcastMessage(message);
  }

  private getMaxAttachments(): number {
    return vscode.workspace
      .getConfiguration('contextRelay')
      .get<number>('chat.maxAttachedFiles', DEFAULT_MAX_ATTACHMENTS);
  }

  private getWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
  }

  /** Invoked from the ContextRelay: Attach File to Chat command as well as the webview's attach button. */
  public async attachFileViaPicker(): Promise<void> {
    await this.handleAttachFilePicker();
  }

  private async handleAttachFiles(uris: string[]): Promise<void> {
    const workspaceRoots = this.getWorkspaceRoots();
    const maxAttachments = this.getMaxAttachments();
    const resolved: ResolvedAttachment[] = [];
    let firstError: string | undefined;

    for (const rawUri of uris) {
      if (this.pendingAttachments.length + resolved.length >= maxAttachments) {
        firstError ??= `You can attach up to ${maxAttachments} files per message.`;
        break;
      }

      let fsPath: string;
      try {
        const uri = vscode.Uri.parse(rawUri, true);
        if (uri.scheme !== 'file') {
          firstError ??= `Only local files can be attached (dropped: ${rawUri}).`;
          continue;
        }
        fsPath = uri.fsPath;
      } catch {
        firstError ??= `Could not read the dropped item: ${rawUri}`;
        continue;
      }

      const attachment = await resolveAttachmentPath(fsPath, workspaceRoots, 'drop');
      if (typeof attachment === 'string') {
        firstError ??= attachment;
        continue;
      }
      resolved.push(attachment);
    }

    if (resolved.length > 0) {
      this.pendingAttachments = mergeAttachments(this.pendingAttachments, resolved);
      this.sendAttachments();
    }

    if (firstError) {
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message: firstError,
        timestamp: new Date().toISOString()
      });
    }
  }

  private async handleAttachFilePicker(): Promise<void> {
    const workspaceRoots = this.getWorkspaceRoots();
    if (workspaceRoots.length === 0) {
      vscode.window.showWarningMessage('ContextRelay: Open a workspace folder to attach files.');
      return;
    }

    const candidates = await this.collectWorkspaceFiles();
    const picked = await vscode.window.showQuickPick(candidates, {
      canPickMany: true,
      placeHolder: 'Select files to attach to the next Copilot message'
    });
    if (!picked || picked.length === 0) {
      return;
    }

    const maxAttachments = this.getMaxAttachments();
    const resolved: ResolvedAttachment[] = [];
    let firstError: string | undefined;

    for (const candidate of picked) {
      if (this.pendingAttachments.length + resolved.length >= maxAttachments) {
        firstError ??= `You can attach up to ${maxAttachments} files per message.`;
        break;
      }

      const attachment = path.isAbsolute(candidate)
        ? await resolveAttachmentPath(candidate, workspaceRoots, 'picker')
        : await this.resolveRelativePickerCandidate(candidate, workspaceRoots);
      if (typeof attachment === 'string') {
        firstError ??= attachment;
        continue;
      }
      resolved.push(attachment);
    }

    if (resolved.length > 0) {
      this.pendingAttachments = mergeAttachments(this.pendingAttachments, resolved);
      this.sendAttachments();
    }

    if (firstError) {
      vscode.window.showWarningMessage(`ContextRelay: ${firstError}`);
    }
  }

  /**
   * collectWorkspaceFiles() returns a bare relative path only when that
   * relative path is unique across every workspace folder combined, but it
   * doesn't say which root the file actually lives under. In a multi-root
   * workspace that root isn't necessarily workspaceRoots[0], so try each
   * root in order and use the first one that actually resolves.
   */
  private async resolveRelativePickerCandidate(
    relativePath: string,
    workspaceRoots: readonly string[]
  ): Promise<ResolvedAttachment | string> {
    let lastError = `File not found for ${relativePath}.`;
    for (const root of workspaceRoots) {
      const attempt = await resolveAttachmentPath(path.join(root, relativePath), workspaceRoots, 'picker');
      if (typeof attempt !== 'string') {
        return attempt;
      }
      lastError = attempt;
    }
    return lastError;
  }

  private handleRemoveAttachment(absolutePath: string): void {
    const next = this.pendingAttachments.filter(attachment => attachment.absolutePath !== absolutePath);
    if (next.length === this.pendingAttachments.length) {
      return;
    }

    this.pendingAttachments = next;
    this.sendAttachments();
  }

  /**
   * Resolve the active editor (and its selection, if any) into an
   * attachment when contextRelay.chat.attachActiveEditor is enabled. Off by
   * default, matching GitHub Copilot's opt-in behavior for implicit
   * editor context. Resolution failures (e.g. an unsaved/untitled editor,
   * or a file outside the workspace) are swallowed since this is an
   * implicit convenience, not an explicit user action.
   */
  private async resolveActiveEditorAttachment(workspaceRoots: readonly string[]): Promise<ResolvedAttachment | undefined> {
    const enabled = vscode.workspace
      .getConfiguration('contextRelay')
      .get<boolean>('chat.attachActiveEditor', false);
    if (!enabled) {
      return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }

    const selection: AttachmentSelection | undefined = editor.selection.isEmpty
      ? undefined
      : { startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1 };

    const attachment = await resolveAttachmentPath(
      editor.document.uri.fsPath,
      workspaceRoots,
      'activeEditor',
      selection
    );
    return typeof attachment === 'string' ? undefined : attachment;
  }

  private async sendWorkspaceFiles(kind?: ChatHostKind): Promise<void> {
    let files: string[] = [];
    try {
      files = await this.collectWorkspaceFiles();
    } catch {
      files = [];
    }

    const message: HostToWebviewMessage = {
      command: 'workspaceFiles',
      files
    };

    if (kind) {
      this.postMessageToHost(kind, message);
      return;
    }

    this.broadcastMessage(message);
  }

  private async handleOpenItemRequest(kind: ChatHostKind, item: ContextItem): Promise<void> {
    try {
      await this.handleOpenItem(item);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const message = `Could not open "${item.title}". ${detail}`;
      vscode.window.showErrorMessage(`ContextRelay: ${message}`);
      this.postMessageToHost(kind, {
        command: 'queryError',
        source: item.source,
        message,
        timestamp: new Date().toISOString()
      });
    }
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
        const requestedCommand = parsed.commandText ?? (trimmed.split(/\s+/, 1)[0] || `/${parsed.target}`);
        this.postMessage({
          command: 'slashHelp',
          commandName: requestedCommand,
          examples: getHelpText(parsed.sourceCommands.length > 0 ? parsed.sourceCommands : parsed.target)
            .split('\n')
            .map(example => example.trim())
            .filter(Boolean)
        });
      }
      return;
    }

    if (parsed.target === 'ask') {
      const mentionResolution = await this.resolveMentionsForPrompt(parsed.query);
      if (!mentionResolution) {
        return;
      }

      if (!mentionResolution.prompt.trim()) {
        this.postMessage({
          command: 'queryError',
          source: 'all',
          message: 'Prompt is empty after removing # file mentions.',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.handleAskCommand(mentionResolution.prompt, mentionResolution.files);
      return;
    }

    if (parsed.target === 'workiq') {
      const mentionResolution = await this.resolveMentionsForPrompt(parsed.query);
      if (!mentionResolution) {
        return;
      }

      if (!mentionResolution.prompt.trim()) {
        this.postMessage({
          command: 'queryError',
          source: 'all',
          message: 'Prompt is empty after removing # file mentions.',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.handleWorkIqCommand(mentionResolution.prompt, mentionResolution.files);
      return;
    }

    if (parsed.target === 'chat') {
      const mentionResolution = await this.resolveMentionsForPrompt(trimmed);
      if (!mentionResolution) {
        return;
      }

      if (!mentionResolution.prompt.trim()) {
        this.postMessage({
          command: 'queryError',
          source: 'all',
          message: 'Prompt is empty after removing # file mentions.',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.handlePlainChat(mentionResolution.prompt, mentionResolution.files);
      return;
    }

    if (parsed.target === 'clear') {
      this.handleClearCommand();
      return;
    }

    const targetSources = this.getEnabledTargetSources(parsed.targetSources, parsed.searchScope === 'all');
    if (targetSources.length === 0) {
      const message = 'No ContextRelay adapters are enabled.';
      this.latestSearchSummary = buildSearchSummary(parsed.query, [], parsed.targetSources);
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
      ], parsed.targetSources);
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
    this.latestSearchSummary = buildSearchSummary(parsed.query, results, targetSources);
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

  private handleClearCommand(): void {
    const hadSnippets = this.snippetStore.getAll().length > 0;
    this.resetChatState();
    const text = hadSnippets
      ? 'Chat cleared. All pinned snippets discarded.'
      : 'Chat cleared.';
    this.postMessage({
      command: 'assistantMessage',
      kind: 'info',
      text,
      timestamp: new Date().toISOString()
    });
  }

  private async handleAskCommand(prompt: string, mentionFiles: readonly ResolvedAttachment[] = []): Promise<void> {
    // /ask is the "strict format" mode: it always includes ContextRelay's
    // accumulated context (pinned snippets, latest visible result, latest
    // search summary) plus any attachments, and wraps the instruction with
    // a format-following preamble. See askPrompt.ts.
    await this.handleCopilotChat(buildAskInstruction(prompt), 'ask', true, mentionFiles);
  }

  private async handlePlainChat(prompt: string, mentionFiles: readonly ResolvedAttachment[] = []): Promise<void> {
    // Plain chat sends the prompt as-is and does not auto-attach
    // ContextRelay's own accumulated context — only explicit attachments
    // (# mentions, drag-and-drop, the attach picker, or the opt-in active
    // editor) are included. This matches the extension's documented
    // behavior for un-prefixed messages.
    await this.handleCopilotChat(prompt, 'chat', false, mentionFiles);
  }

  private async handleWorkIqCommand(query: string, mentionFiles: readonly ResolvedAttachment[]): Promise<void> {
    this.postMessage({
      command: 'loading',
      source: 'all',
      isLoading: true,
      text: 'Asking Work IQ...',
      icon: '🤖'
    });

    let token: string;
    try {
      token = await this.authProvider.getWorkIqAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Work IQ authentication required.';
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message,
        timestamp: new Date().toISOString()
      });
      this.postMessage({ command: 'loading', source: 'all', isLoading: false });
      return;
    }

    try {
      const workIqQuery = await buildWorkIqPromptWithFiles(query, mentionFiles);
      const response = await sendWorkIqMessage(token, workIqQuery, this.currentWorkIqContextId);

      if (response.contextId) {
        this.currentWorkIqContextId = response.contextId;
      }

      const text = response.text.trim();
      if (!text) {
        throw new Error('Work IQ returned an empty response.');
      }

      this.postMessage({
        command: 'assistantMessage',
        kind: 'chat',
        text,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`ContextRelay: Work IQ failed — ${message}`);
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message,
        timestamp: new Date().toISOString()
      });
    } finally {
      this.postMessage({ command: 'loading', source: 'all', isLoading: false });
    }
  }

  private async handleCopilotChat(
    copilotPrompt: string,
    kind: 'chat' | 'ask',
    includeContextRelayContext: boolean,
    mentionFiles: readonly ResolvedAttachment[] = []
  ): Promise<void> {
    const snippets = this.snippetStore.getAll();
    const workspaceRoots = this.getWorkspaceRoots();
    const activeEditorAttachment = await this.resolveActiveEditorAttachment(workspaceRoots);
    const attachments = mergeAttachments(
      this.pendingAttachments,
      mentionFiles,
      activeEditorAttachment ? [activeEditorAttachment] : []
    );

    let token: string;
    try {
      token = await this.authProvider.getAccessToken();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication required.';
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // /ask has no hard requirement on pinned snippets or attachments — the
    // Chat API's additionalContext/contextualResources are optional. Let it
    // through with a non-blocking notice instead of refusing to run.
    if (includeContextRelayContext && snippets.length === 0 && attachments.length === 0) {
      this.postMessage({
        command: 'assistantMessage',
        kind: 'info',
        text: 'No pinned snippets or attached files this time — sending /ask to Microsoft 365 Copilot without extra ContextRelay context.',
        timestamp: new Date().toISOString()
      });
    }

    this.postMessage({
      command: 'loading',
      source: 'all',
      isLoading: true,
      text: 'Thinking...',
      icon: '🧠'
    });

    const streamingEnabled = vscode.workspace
      .getConfiguration('contextRelay')
      .get<boolean>('chat.streamResponses', true);
    const controller = new AbortController();
    this.activeStreamController = controller;
    const streamId = `stream-${crypto.randomUUID()}`;
    let streamStarted = false;

    try {
      if (!this.currentConversationId) {
        this.currentConversationId = await createConversation(token);
      }

      // Conversation history is preserved by the Copilot Chat API via the
      // conversation id, so we only forward explicit ContextRelay context:
      // pinned snippets, the latest visible generated result, and the latest
      // search summary (only for /ask — see includeContextRelayContext) plus
      // any explicitly attached local files (always, for both /ask and plain chat).
      const contextPayload = await buildChatContextPayload({
        snippets,
        searchSummary: this.latestSearchSummary,
        visibleResult: this.latestVisibleResult,
        attachments,
        includeContextRelayContext
      });

      const reply = await sendMessageAuto(
        token,
        this.currentConversationId,
        copilotPrompt,
        contextPayload,
        streamingEnabled,
        fullTextSoFar => {
          if (!streamStarted) {
            streamStarted = true;
            this.postMessage({ command: 'assistantMessageStart', id: streamId, timestamp: new Date().toISOString() });
          }
          this.postMessage({ command: 'assistantMessageProgress', id: streamId, text: fullTextSoFar });
        },
        controller.signal
      );

      if (!reply.trim()) {
        throw new Error('Microsoft 365 Copilot returned an empty response.');
      }

      const { content } = detectOutputLanguage(copilotPrompt, reply);
      this.latestVisibleResult = content;
      this.postMessage({
        command: 'assistantMessageEnd',
        id: streamId,
        kind,
        text: content,
        contextLabels: contextPayload.labels,
        timestamp: new Date().toISOString()
      });

      if (this.pendingAttachments.length > 0) {
        this.pendingAttachments = [];
        this.sendAttachments();
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.postMessage({
          command: 'assistantMessageEnd',
          id: streamId,
          kind: 'info',
          text: 'Cancelled.',
          timestamp: new Date().toISOString()
        });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`ContextRelay: Copilot chat failed — ${message}`);
        this.postMessage({
          command: 'queryError',
          source: 'all',
          message,
          timestamp: new Date().toISOString()
        });
      }
    } finally {
      this.activeStreamController = undefined;
      this.postMessage({ command: 'loading', source: 'all', isLoading: false });
    }
  }

  private async resolveMentionsForPrompt(
    prompt: string
  ): Promise<{ prompt: string; files: ResolvedAttachment[] } | undefined> {
    const workspaceRoots = this.getWorkspaceRoots();
    const mentionResolution = await resolveFileMentions(prompt, workspaceRoots);
    if (mentionResolution.errors.length > 0) {
      this.postMessage({
        command: 'queryError',
        source: 'all',
        message: mentionResolution.errors[0],
        timestamp: new Date().toISOString()
      });
      return undefined;
    }

    return {
      prompt: mentionResolution.cleanedPrompt,
      files: mentionResolution.files
    };
  }

  private async collectWorkspaceFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      return [];
    }

    const fileUris = await vscode.workspace.findFiles(
      '**/*',
      '**/{.git,node_modules,dist,out,out-test,.contextrelay,coverage}/**',
      4000
    );
    const groupedPaths = new Map<string, string[]>();

    for (const fileUri of fileUris) {
      if (fileUri.scheme !== 'file') {
        continue;
      }

      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      if (!workspaceFolder) {
        continue;
      }

      const relativePath = path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        continue;
      }

      if (!isCopilotSupportedFileExtension(relativePath)) {
        continue;
      }

      const normalizedRelativePath = relativePath.split(path.sep).join('/');
      const normalizedAbsolutePath = fileUri.fsPath.split(path.sep).join('/');
      const paths = groupedPaths.get(normalizedRelativePath) ?? [];
      paths.push(normalizedAbsolutePath);
      groupedPaths.set(normalizedRelativePath, paths);
    }

    const candidates: string[] = [];
    for (const [relativePath, absolutePaths] of groupedPaths.entries()) {
      if (absolutePaths.length === 1) {
        candidates.push(relativePath);
      } else {
        candidates.push(...absolutePaths);
      }
    }

    return candidates
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 1500);
  }

  private getEnabledTargetSources(
    requestedSources: readonly ContextSource[],
    includeConnectors: boolean
  ): ContextSource[] {
    const sources = requestedSources.filter(source => this.isSourceEnabled(source));
    if (includeConnectors && this.isSourceEnabled('connectors')) {
      sources.push('connectors');
    }
    return sources;
  }

  private isSourceEnabled(source: ContextSource): boolean {
    const config = vscode.workspace.getConfiguration('contextRelay');
    switch (source) {
      case 'mail':
        return config.get<boolean>('adapters.mail', true);
      case 'teams':
        return config.get<boolean>('adapters.teams', true);
      case 'sharepoint':
        return config.get<boolean>('adapters.sharepoint', true);
      case 'onedrive':
        return config.get<boolean>('adapters.onedrive', true);
      case 'onenote':
        return config.get<boolean>('adapters.onenote', true);
      case 'planner':
        return config.get<boolean>('adapters.planner', true);
      case 'todo':
        return config.get<boolean>('adapters.todo', true);
      case 'connectors':
        return config.get<boolean>('adapters.connectors', false);
    }
  }

  private async handleOpenItem(item: ContextItem): Promise<void> {
    if (!item) {
      return;
    }

    if (item.url?.trim()) {
      await this.handleOpenLink(item.url);
      return;
    }

    const preview = await resolvePreview(item, async () => this.authProvider.getAccessToken());
    this.showPreviewPanel(preview);
  }

  private showPreviewPanel(preview: ResolvedPreview): void {
    const existingPanel = this.previewPanel;
    if (existingPanel) {
      existingPanel.title = `ContextRelay Preview: ${preview.title}`;
      existingPanel.webview.html = buildPreviewWebviewHtml(preview, existingPanel.webview.cspSource);
      existingPanel.reveal(vscode.ViewColumn.Active);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'contextRelay.preview',
      `ContextRelay Preview: ${preview.title}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: false,
        retainContextWhenHidden: false
      }
    );

    this.previewPanel = panel;
    panel.webview.html = buildPreviewWebviewHtml(preview, panel.webview.cspSource);
    panel.onDidDispose(
      () => {
        if (this.previewPanel === panel) {
          this.previewPanel = undefined;
        }
      },
      undefined,
      this.context.subscriptions
    );
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
      case 'onenote':
        return runCachedSearch(
          `onenote:${query}`,
          config.get<boolean>('adapters.onenote', true),
          () => searchOneNote(token, query)
        );
      case 'planner':
        return runCachedSearch(
          `planner:${query}`,
          config.get<boolean>('adapters.planner', true),
          () => searchPlanner(token, query)
        );
      case 'todo':
        return runCachedSearch(
          `todo:${query}`,
          config.get<boolean>('adapters.todo', true),
          () => searchTodo(token, query)
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
      script-src 'nonce-${nonce}' ${webview.cspSource};">
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

    .message-text {
      white-space: pre-wrap;
    }

    .message.streaming .message-text::after {
      content: '▍';
      display: inline-block;
      margin-left: 1px;
      opacity: 0.6;
      animation: blink 1s steps(1) infinite;
    }

    @keyframes blink {
      50% { opacity: 0; }
    }

    .message-text-rich {
      white-space: normal;
    }

    .message-text-rich :first-child {
      margin-top: 0;
    }

    .message-text-rich :last-child {
      margin-bottom: 0;
    }

    .message-text-rich h1,
    .message-text-rich h2,
    .message-text-rich h3 {
      line-height: 1.35;
      margin: 0.9em 0 0.45em;
    }

    .message-text-rich p {
      margin: 0.6em 0;
    }

    .message-text-rich ul,
    .message-text-rich ol {
      margin: 0.6em 0;
      padding-left: 1.4em;
    }

    .message-text-rich li + li {
      margin-top: 0.25em;
    }

    .message-text-rich a {
      color: var(--vscode-textLink-foreground);
    }

    .message-text-rich hr {
      border: 0;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 0.9em 0;
    }

    .context-used {
      margin-top: var(--cr-spacing-xs);
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
    }

    .message .timestamp {
      font-size: 0.75em;
      opacity: 0.6;
      margin-top: var(--cr-spacing-xs);
    }

    .assistant-actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cr-spacing-xs);
      margin-top: var(--cr-spacing-sm);
    }

    .assistant-actions button {
      background: none;
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-input-border, #555));
      color: var(--vscode-foreground);
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.8em;
      cursor: pointer;
    }

    .assistant-actions button:hover {
      background: var(--vscode-list-hoverBackground);
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

    #attachmentChips {
      display: none;
      flex-wrap: wrap;
      gap: var(--cr-spacing-xs);
    }

    #attachmentChips.visible {
      display: flex;
    }

    .attachment-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 999px;
      padding: 2px 8px 2px 10px;
      font-size: 0.75em;
      max-width: 100%;
    }

    .attachment-chip .attachment-chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 220px;
    }

    .attachment-chip .attachment-chip-remove {
      cursor: pointer;
      opacity: 0.75;
      border: none;
      background: none;
      color: inherit;
      font-size: 1em;
      line-height: 1;
      padding: 0 0 0 2px;
    }

    .attachment-chip .attachment-chip-remove:hover {
      opacity: 1;
    }

    #inputArea.drag-active {
      outline: 2px dashed var(--vscode-focusBorder);
      outline-offset: -2px;
    }

    #attachButton {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      background: none;
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-input-border, #555));
      color: var(--vscode-foreground);
      border-radius: var(--cr-border-radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1em;
    }

    #attachButton:hover {
      background: var(--vscode-list-hoverBackground);
    }

    #attachButton:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    #sendButton.stop-mode {
      background: var(--vscode-inputValidation-errorBorder, #be1100);
    }

    #sendButton.stop-mode:hover {
      opacity: 0.85;
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

    #promptInput:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      background: var(--vscode-input-background);
      color: var(--vscode-disabledForeground, var(--vscode-input-placeholderForeground));
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
      background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
      color: var(--vscode-disabledForeground, var(--vscode-button-secondaryForeground));
      border: 1px solid var(--vscode-button-border, var(--vscode-input-border, transparent));
      opacity: 0.65;
      cursor: not-allowed;
    }

    #sendButton:disabled:hover {
      background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
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

    #hashMenu {
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

    #hashMenu.visible {
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

    .hash-item {
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-sm);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      cursor: pointer;
      font-size: 0.9em;
    }

    .hash-item:hover,
    .hash-item.selected {
      background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground));
      color: var(--vscode-editorSuggestWidget-selectedForeground, var(--vscode-list-activeSelectionForeground));
    }

    .hash-item .hash-icon {
      width: 20px;
      text-align: center;
      font-weight: 700;
    }

    .hash-item .hash-label {
      font-family: var(--vscode-editor-font-family);
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="chatArea" role="log" aria-live="polite" aria-label="Chat messages">
      <div class="welcome" id="welcome">
        <h2>ContextRelay</h2>
        <p>Chat with Microsoft 365 Copilot, or search Microsoft 365 context with slash commands.</p>
        <p style="font-size: 0.8em;">Type <code>/</code> for source search commands. Use <code>#path/to/file</code> (or <code>#"path with spaces"</code>) to attach local workspace files to Copilot and /workiq prompts.</p>
        <p style="font-size: 0.8em;">Pin snippets or mention <code>#files</code>, then run <code>/ask</code> to process that context with Microsoft 365 Copilot in the panel.</p>
      </div>
    </div>

    <div id="inputArea">
      <div id="slashMenu" role="listbox" aria-label="Slash commands"></div>
      <div id="hashMenu" role="listbox" aria-label="Workspace files"></div>
      <div id="attachmentChips" role="list" aria-label="Attached files"></div>

      <div id="inputWrapper">
        <button id="attachButton" aria-label="Attach files" title="Attach local files to the next message">📎</button>
        <textarea
          id="promptInput"
          rows="1"
          placeholder="Ask Copilot, or type / for source search"
          aria-label="Copilot chat or source search input"
          aria-haspopup="listbox"
          aria-controls="slashMenu hashMenu"
        ></textarea>
        <button id="sendButton" aria-label="Send message" title="Send">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1.91L7.2 8 1 14.09 1.91 15 9 8 1.91 1z"/>
            <path d="M7 1.91L13.2 8 7 14.09 7.91 15 15 8 7.91 1z"/>
          </svg>
        </button>
      </div>
      <div id="inputHint">Press Enter to send • Shift+Enter for new line • Type / for source search commands • Use #file, 📎, or drag &amp; drop to attach local context</div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}" defer></script>
</body>
</html>`;
  }
}
