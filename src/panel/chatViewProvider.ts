import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  SLASH_COMMANDS,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
  type ContextItem,
  type ContextSource,
} from './types';
import { parseSlashCommand, getSlashHelp } from './slashCommandRouter';

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

  private _view?: vscode.WebviewView;
  private _currentQueryId = 0;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: WebviewToHostMessage) => this._handleMessage(message)
    );
  }

  /**
   * Post a message to the webview.
   */
  public postMessage(message: HostToWebviewMessage): void {
    this._view?.webview.postMessage(message);
  }

  /**
   * Clear the chat history.
   */
  public clearChat(): void {
    this.postMessage({ command: 'clearChat' });
  }

  /**
   * Handle messages from the webview.
   */
  private async _handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.command) {
      case 'webviewReady':
        // Webview is initialized — send slash command list
        // (handled in webview via hardcoded list for now)
        break;

      case 'submitQuery':
        await this._handleQuery(message.text);
        break;

      case 'openLink':
        if (message.url) {
          try {
            const uri = vscode.Uri.parse(message.url);
            // Only allow http/https schemes to prevent command: / file: injection
            if (uri.scheme === 'http' || uri.scheme === 'https') {
              await vscode.env.openExternal(uri);
            }
          } catch {
            vscode.window.showWarningMessage('Unable to open link: invalid URL format.');
          }
        }
        break;

      case 'copySnippet':
        if (message.text) {
          await vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage('Snippet copied to clipboard.');
        }
        break;

      case 'pinSnippet':
        vscode.window.showInformationMessage(
          `Pinned: ${message.item.title}`
        );
        break;
    }
  }

  /**
   * Handle a user query — parse slash commands and dispatch.
   */
  private async _handleQuery(text: string): Promise<void> {
    const queryId = ++this._currentQueryId;
    const parsed = parseSlashCommand(text);
    const timestamp = new Date().toISOString();

    // Display the user message
    this.postMessage({
      command: 'userMessage',
      text,
      timestamp,
    });

    // Empty query after slash command → show help
    if (parsed.slashCommand && !parsed.query) {
      const examples = getSlashHelp(parsed.slashCommand.command);
      this.postMessage({
        command: 'slashHelp',
        commandName: parsed.slashCommand.command,
        examples,
      });
      return;
    }

    // Show loading state for each target source
    for (const source of parsed.targetSources) {
      this.postMessage({
        command: 'loading',
        source,
        isLoading: true,
      });
    }

    // Dispatch to all adapters in parallel
    const results = await Promise.allSettled(
      parsed.targetSources.map((source) => this._fetchResults(source, parsed.query))
    );

    // Ignore stale results if a newer query has already been submitted
    if (queryId !== this._currentQueryId) {
      for (const source of parsed.targetSources) {
        this.postMessage({ command: 'loading', source, isLoading: false });
      }
      return;
    }

    for (let i = 0; i < parsed.targetSources.length; i++) {
      const source = parsed.targetSources[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        this.postMessage({
          command: 'queryResult',
          items: result.value,
          source,
          query: parsed.query,
          timestamp: new Date().toISOString(),
        });
      } else {
        const err = result.reason;
        this.postMessage({
          command: 'queryError',
          source,
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      }
      this.postMessage({ command: 'loading', source, isLoading: false });
    }
  }

  /**
   * Stub adapter — returns mock results.
   * Will be replaced with real Graph API / Retrieval API calls.
   */
  private async _fetchResults(
    source: ContextSource,
    query: string
  ): Promise<ContextItem[]> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 500));

    const sourceLabels: Record<ContextSource, string> = {
      mail: 'Exchange Mail',
      teams: 'Teams',
      sharepoint: 'SharePoint',
      onedrive: 'OneDrive',
      connectors: 'Connectors',
    };

    return [
      {
        source,
        title: `${sourceLabels[source]} result for "${query}"`,
        snippet: `This is a sample result from ${sourceLabels[source]} matching your query "${query}". In production, this will be replaced with actual API results.`,
        url: `https://example.com/${source}/${encodeURIComponent(query)}`,
        timestamp: new Date().toISOString(),
        relevance: 0.95,
        cache: { hit: false },
      },
      {
        source,
        title: `Another ${sourceLabels[source]} result`,
        snippet: `Additional context from ${sourceLabels[source]} about "${query}".`,
        url: `https://example.com/${source}/${encodeURIComponent(query)}/2`,
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        relevance: 0.82,
        cache: { hit: false },
      },
    ];
  }

  /**
   * Generate the HTML for the webview with CSP and nonce.
   * Follows the same pattern as vscode-copilot-chat's _getWebviewContent().
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'main.js')
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
    /* ========================================
     * Copilot Chat-style layout
     * ======================================== */

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

    /* --- Main container: flex column, full height --- */
    #app {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    /* --- Chat messages area: scrollable, grows to fill space --- */
    #chatArea {
      flex: 1;
      overflow-y: auto;
      padding: var(--cr-spacing-md);
      display: flex;
      flex-direction: column;
      gap: var(--cr-spacing-sm);
    }

    /* Auto-scroll anchor — keeps scroll at bottom */
    #chatArea::after {
      content: '';
      display: block;
    }

    /* --- Welcome message --- */
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

    /* --- Message bubbles --- */
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

    /* --- Result cards --- */
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

    /* --- Source section header --- */
    .source-header {
      font-weight: 600;
      font-size: 0.9em;
      margin-top: var(--cr-spacing-sm);
      margin-bottom: var(--cr-spacing-xs);
      display: flex;
      align-items: center;
      gap: var(--cr-spacing-xs);
    }

    /* --- Loading indicator --- */
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

    /* --- Error banner --- */
    .error-banner {
      background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.1));
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-sm) var(--cr-spacing-md);
      font-size: 0.85em;
      color: var(--vscode-errorForeground, var(--vscode-foreground));
    }

    /* --- Slash help --- */
    .slash-help {
      background: var(--vscode-editorWidget-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-editorWidget-border, var(--vscode-input-border, transparent));
      border-radius: var(--cr-border-radius);
      padding: var(--cr-spacing-md);
      font-size: 0.85em;
    }

    .slash-help code {
      background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }

    /* ========================================
     * Input area — fixed at bottom
     * ======================================== */
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

    /* ========================================
     * Slash menu — floating above input
     * ======================================== */
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
    <!-- Chat messages area -->
    <div id="chatArea" role="log" aria-live="polite" aria-label="Chat messages">
      <div class="welcome" id="welcome">
        <h2>ContextRelay</h2>
        <p>Search Microsoft 365 context with slash commands.</p>
        <p style="font-size: 0.8em;">Type <code>/</code> for available commands, or enter a keyword to search all sources.</p>
      </div>
    </div>

    <!-- Input area — fixed at bottom -->
    <div id="inputArea">
      <!-- Slash menu (floating above input) -->
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
