/**
 * Chat renderer for the ContextRelay webview.
 * Renders messages, results, loading indicators, and errors.
 * Dynamic result content is built with DOM APIs so untrusted data never flows
 * through HTML injection paths.
 */

import { getSourceInlineSvg, getSourceLabel, getSourceTextIcon } from '../sourcePresentation';

interface ContextItem {
  source: 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'onenote' | 'planner' | 'connectors';
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

export class ChatRenderer {
  private chatArea: HTMLElement;
  private welcomeEl: HTMLElement | null;
  private vscode: VsCodeApi;
  private loadingElements: Map<string, HTMLElement> = new Map();
  private pinnedKeys: Set<string> = new Set();

  constructor(chatArea: HTMLElement, vscode: VsCodeApi) {
    this.chatArea = chatArea;
    this.welcomeEl = chatArea.querySelector('#welcome');
    this.vscode = vscode;
  }

  /**
   * Build the same stable item key the extension host uses.
   * Must stay in sync with getContextItemKey() in src/models/contextItem.ts.
   */
  private getItemKey(item: ContextItem): string {
    const discriminator =
      item.url?.trim() ||
      item.timestamp?.trim() ||
      item.snippet.trim() ||
      '';

    return `${item.source}::${discriminator}::${item.title}`;
  }

  /**
   * Update the set of currently pinned items and refresh every rendered card
   * so the 📌 indicator and Pin/Unpin button reflect the latest state.
   */
  setPinnedItems(keys: string[]): void {
    this.pinnedKeys = new Set(keys);
    const cards = this.chatArea.querySelectorAll<HTMLElement>('.result-card[data-item-key]');
    cards.forEach(card => {
      const key = card.dataset.itemKey;
      if (key) {
        this.applyPinState(card, this.pinnedKeys.has(key));
      }
    });
  }

  private applyPinState(card: HTMLElement, isPinned: boolean): void {
    card.classList.toggle('pinned', isPinned);

    const indicator = card.querySelector<HTMLElement>('.pin-indicator');
    if (indicator) {
      indicator.style.display = isPinned ? '' : 'none';
    }

    const pinBtn = card.querySelector<HTMLButtonElement>('.action-pin');
    if (pinBtn) {
      pinBtn.textContent = isPinned ? 'Unpin' : 'Pin';
      pinBtn.title = isPinned ? 'Unpin snippet' : 'Pin snippet';
      pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    }
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
   * Render a plain assistant text message (used by /ask for status updates).
   */
  renderAssistantMessage(text: string, timestamp: string): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'message assistant';
    el.setAttribute('role', 'article');

    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    el.appendChild(textDiv);

    const timeStr = this.formatTime(timestamp);
    if (timeStr) {
      const tsDiv = document.createElement('div');
      tsDiv.className = 'timestamp';
      tsDiv.textContent = timeStr;
      el.appendChild(tsDiv);
    }

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

    const label = getSourceLabel(source);
    const timeStr = this.formatTime(timestamp);

    const header = document.createElement('div');
    header.className = 'source-header';
    header.appendChild(this.createSourceIcon(source, '🔍'));
    header.appendChild(document.createTextNode(` ${label} — ${items.length} result(s)`));
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

    const label = getSourceLabel(source);
    const timeStr = this.formatTime(timestamp);

    el.appendChild(this.createSourceIcon(source, '⚠️'));
    el.appendChild(document.createTextNode(' '));

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
      el.setAttribute('aria-label', `Loading ${getSourceLabel(source)} results`);

      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      el.appendChild(spinner);

      const label = getSourceLabel(source);
      const text = document.createElement('span');
      text.appendChild(this.createSourceIcon(source, '🔍'));
      text.appendChild(document.createTextNode(` Searching ${label}...`));
      el.appendChild(text);

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
    const heading = document.createElement('h2');
    heading.textContent = 'ContextRelay';
    welcome.appendChild(heading);

    const intro = document.createElement('p');
    intro.textContent = 'Search Microsoft 365 context with slash commands.';
    welcome.appendChild(intro);

    const commandsHint = document.createElement('p');
    commandsHint.style.fontSize = '0.8em';
    commandsHint.appendChild(document.createTextNode('Type '));
    const slashCode = document.createElement('code');
    slashCode.textContent = '/';
    commandsHint.appendChild(slashCode);
    commandsHint.appendChild(document.createTextNode(' for available commands, or enter a keyword to search all sources.'));
    welcome.appendChild(commandsHint);

    const askHint = document.createElement('p');
    askHint.style.fontSize = '0.8em';
    askHint.appendChild(document.createTextNode('Pin snippets and run '));
    const askCode = document.createElement('code');
    askCode.textContent = '/ask';
    askHint.appendChild(askCode);
    askHint.appendChild(document.createTextNode(' to process them with Microsoft 365 Copilot.'));
    welcome.appendChild(askHint);

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
    const itemKey = this.getItemKey(item);
    card.dataset.itemKey = itemKey;

    // Title row
    const titleDiv = document.createElement('div');
    titleDiv.className = 'title';

    const sourceLabel = getSourceLabel(item.source);

    titleDiv.appendChild(this.createSourceIcon(item.source, '📎'));

    const titleText = document.createElement('span');
    titleText.textContent = item.title;
    titleDiv.appendChild(titleText);

    // Visible 📌 indicator that toggles with the pin state.
    const pinIndicator = document.createElement('span');
    pinIndicator.className = 'pin-indicator';
    pinIndicator.textContent = '📌';
    pinIndicator.title = 'Pinned snippet';
    pinIndicator.setAttribute('aria-label', 'Pinned');
    pinIndicator.style.marginLeft = '4px';
    pinIndicator.style.display = 'none';
    titleDiv.appendChild(pinIndicator);

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
    pinBtn.setAttribute('aria-pressed', 'false');
    pinBtn.addEventListener('click', () => {
      this.vscode.postMessage({
        command: 'pinSnippet',
        item,
      });
    });
    actionsDiv.appendChild(pinBtn);

    card.appendChild(actionsDiv);

    // Apply current pin state so a card built after a previous pin shows 📌 immediately.
    this.applyPinState(card, this.pinnedKeys.has(itemKey));

    return card;
  }

  private createSourceIcon(source: string, fallback: string): HTMLElement {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'source-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.style.display = 'inline-flex';
    iconSpan.style.alignItems = 'center';
    iconSpan.style.justifyContent = 'center';
    iconSpan.style.width = '1em';
    iconSpan.style.height = '1em';
    iconSpan.style.marginRight = '6px';
    iconSpan.style.verticalAlign = 'text-bottom';

    const svg = getSourceInlineSvg(source);
    if (svg) {
      iconSpan.appendChild(this.buildSvgIcon(svg));
      return iconSpan;
    }

    iconSpan.textContent = getSourceTextIcon(source) || fallback;
    return iconSpan;
  }

  private buildSvgIcon(icon: NonNullable<ReturnType<typeof getSourceInlineSvg>>): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNs, 'svg');
    svgEl.setAttribute('viewBox', icon.viewBox);
    svgEl.setAttribute('fill', 'none');
    svgEl.setAttribute('aria-hidden', 'true');
    svgEl.setAttribute('focusable', 'false');
    svgEl.style.width = '1em';
    svgEl.style.height = '1em';

    for (const shape of icon.shapes) {
      const child = document.createElementNS(svgNs, shape.tag);
      for (const [name, value] of Object.entries(shape.attrs)) {
        child.setAttribute(name, value);
      }
      svgEl.appendChild(child);
    }

    return svgEl;
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
