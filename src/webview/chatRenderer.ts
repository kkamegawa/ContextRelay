/**
 * Chat renderer for the ContextRelay webview.
 * Renders messages, results, loading indicators, and errors.
 * Uses safe DOM APIs (createElement/textContent) instead of innerHTML
 * to prevent XSS from untrusted result data.
 */

interface ContextItem {
  source: 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'connectors';
  title: string;
  snippet: string;
  url?: string;
  timestamp?: string;
  relevance?: number;
  cache: { hit: boolean; storedAt?: string; ttlSeconds?: number };
  raw?: unknown;
}

type VsCodeApi = {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const SOURCE_ICONS: Record<string, string> = {
  mail: '📧',
  teams: '💬',
  sharepoint: '📄',
  onedrive: '☁️',
  connectors: '🔗',
  all: '🔍',
};

const SOURCE_LABELS: Record<string, string> = {
  mail: 'Exchange Mail',
  teams: 'Teams',
  sharepoint: 'SharePoint',
  onedrive: 'OneDrive',
  connectors: 'Connectors',
  all: 'All Sources',
};

export class ChatRenderer {
  private chatArea: HTMLElement;
  private welcomeEl: HTMLElement | null;
  private vscode: VsCodeApi;
  private loadingElements: Map<string, HTMLElement> = new Map();

  constructor(chatArea: HTMLElement, vscode: VsCodeApi) {
    this.chatArea = chatArea;
    this.welcomeEl = chatArea.querySelector('#welcome');
    this.vscode = vscode;
  }

  /**
   * Remove the welcome message on first interaction.
   */
  private hideWelcome(): void {
    if (this.welcomeEl) {
      this.welcomeEl.remove();
      this.welcomeEl = null;
    }
  }

  /**
   * Scroll chat to bottom.
   */
  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    });
  }

  /**
   * Render a user message bubble.
   */
  renderUserMessage(text: string, timestamp: string): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'message user';
    el.setAttribute('role', 'article');

    const timeStr = this.formatTime(timestamp);

    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    el.appendChild(textDiv);

    const tsDiv = document.createElement('div');
    tsDiv.className = 'timestamp';
    tsDiv.textContent = timeStr;
    el.appendChild(tsDiv);

    this.chatArea.appendChild(el);
    this.scrollToBottom();
  }

  /**
   * Render query results as an assistant message with result cards.
   */
  renderQueryResult(
    items: ContextItem[],
    source: string,
    _query: string,
    timestamp: string
  ): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'message assistant';
    el.setAttribute('role', 'article');

    const icon = SOURCE_ICONS[source] || '🔍';
    const label = SOURCE_LABELS[source] || source;
    const timeStr = this.formatTime(timestamp);

    const header = document.createElement('div');
    header.className = 'source-header';
    header.textContent = `${icon} ${label} — ${items.length} result(s)`;
    el.appendChild(header);

    // Build result cards using DOM APIs to avoid innerHTML injection
    for (const item of items) {
      const card = this.buildResultCard(item);
      el.appendChild(card);
    }

    const tsDiv = document.createElement('div');
    tsDiv.className = 'timestamp';
    tsDiv.textContent = timeStr;
    el.appendChild(tsDiv);

    this.chatArea.appendChild(el);
    this.scrollToBottom();
  }

  /**
   * Render an error banner.
   */
  renderError(source: string, message: string, timestamp: string): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'error-banner';

    const icon = SOURCE_ICONS[source] || '⚠️';
    const label = SOURCE_LABELS[source] || source;
    const timeStr = this.formatTime(timestamp);

    el.appendChild(document.createTextNode(`${icon} `));

    const strong = document.createElement('strong');
    strong.textContent = label;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(`: ${message}`));

    if (timeStr) {
      const tsSpan = document.createElement('span');
      tsSpan.className = 'timestamp';
      tsSpan.textContent = ` (${timeStr})`;
      el.appendChild(tsSpan);
    }

    this.chatArea.appendChild(el);
    this.scrollToBottom();
  }

  /**
   * Show or hide a loading indicator for a source.
   */
  setLoading(source: string, isLoading: boolean): void {
    if (isLoading) {
      this.hideWelcome();

      const el = document.createElement('div');
      el.className = 'loading';
      el.setAttribute('aria-label', `Loading ${SOURCE_LABELS[source] || source} results`);

      const label = SOURCE_LABELS[source] || source;
      const icon = SOURCE_ICONS[source] || '🔍';

      el.innerHTML = `
        <div class="spinner" aria-hidden="true"></div>
        <span>${icon} Searching ${label}...</span>
      `;

      this.loadingElements.set(source, el);
      this.chatArea.appendChild(el);
      this.scrollToBottom();
    } else {
      const existing = this.loadingElements.get(source);
      if (existing) {
        existing.remove();
        this.loadingElements.delete(source);
      }
    }
  }

  /**
   * Render inline help for a slash command (safe — command names are hardcoded).
   */
  renderSlashHelp(commandName: string, examples: string[]): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'slash-help';

    const strong = document.createElement('strong');
    strong.textContent = commandName;
    el.appendChild(strong);
    el.appendChild(document.createTextNode(' — Usage examples:'));

    const ul = document.createElement('ul');
    ul.style.marginTop = '4px';
    ul.style.paddingLeft = '20px';
    for (const ex of examples) {
      const li = document.createElement('li');
      const code = document.createElement('code');
      code.textContent = ex;
      li.appendChild(code);
      ul.appendChild(li);
    }
    el.appendChild(ul);

    this.chatArea.appendChild(el);
    this.scrollToBottom();
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.chatArea.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'welcome';
    welcome.id = 'welcome';
    welcome.innerHTML = `
      <h2>ContextRelay</h2>
      <p>Search Microsoft 365 context with slash commands.</p>
      <p style="font-size: 0.8em;">Type <code>/</code> for available commands, or enter a keyword to search all sources.</p>
    `;
    this.chatArea.appendChild(welcome);
    this.welcomeEl = welcome;
    this.loadingElements.clear();
  }

  /**
   * Build a result card using safe DOM APIs (no innerHTML with untrusted data).
   */
  private buildResultCard(item: ContextItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'result-card';

    // Store data safely via dataset (auto-escapes)
    if (item.url) { card.dataset.url = item.url; }
    card.dataset.snippet = item.snippet;

    // Title row
    const titleDiv = document.createElement('div');
    titleDiv.className = 'title';

    const sourceIcon = SOURCE_ICONS[item.source] || '📎';
    const sourceLabel = SOURCE_LABELS[item.source] || item.source;

    const iconSpan = document.createElement('span');
    iconSpan.textContent = sourceIcon;
    titleDiv.appendChild(iconSpan);

    const titleText = document.createElement('span');
    titleText.textContent = item.title;
    titleDiv.appendChild(titleText);

    const badge = document.createElement('span');
    badge.className = 'source-badge';
    badge.textContent = sourceLabel;
    titleDiv.appendChild(badge);

    if (item.cache.hit) {
      const cacheBadge = document.createElement('span');
      cacheBadge.className = 'source-badge';
      cacheBadge.style.marginLeft = '4px';
      cacheBadge.textContent = 'Cached';
      titleDiv.appendChild(cacheBadge);
    }

    card.appendChild(titleDiv);

    // Snippet
    const snippetDiv = document.createElement('div');
    snippetDiv.className = 'snippet';
    snippetDiv.textContent = item.snippet;
    card.appendChild(snippetDiv);

    // Actions
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'actions';

    if (item.url) {
      const openBtn = document.createElement('button');
      openBtn.className = 'action-open';
      openBtn.title = 'Open in browser';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => {
        this.vscode.postMessage({ command: 'openLink', url: item.url });
      });
      actionsDiv.appendChild(openBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-copy';
    copyBtn.title = 'Copy snippet';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      this.vscode.postMessage({ command: 'copySnippet', text: item.snippet });
    });
    actionsDiv.appendChild(copyBtn);

    const pinBtn = document.createElement('button');
    pinBtn.className = 'action-pin';
    pinBtn.title = 'Pin snippet';
    pinBtn.textContent = 'Pin';
    pinBtn.addEventListener('click', () => {
      this.vscode.postMessage({
        command: 'pinSnippet',
        item,
      });
    });
    actionsDiv.appendChild(pinBtn);

    card.appendChild(actionsDiv);
    return card;
  }

  private formatTime(isoString: string): string {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }
}
