/**
 * Chat renderer for the ContextRelay webview.
 * Renders messages, results, loading indicators, and errors.
 * Dynamic result content is built with DOM APIs, except for assistant messages
 * where limited HTML is generated from escaped markdown-like text.
 */

import { getSourceInlineSvg, getSourceLabel, getSourceTextIcon } from '../sourcePresentation';
import { canOpenResult } from '../models/contextItem';
import { formatAssistantMessageAsHtml, hasRichTextFormatting } from './assistantMessageFormatting';

interface ContextItem {
  source: 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'onenote' | 'planner' | 'todo' | 'connectors';
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
  private streamingElements: Map<string, { container: HTMLElement; textEl: HTMLElement }> = new Map();

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
  renderAssistantMessage(
    text: string,
    timestamp: string,
    kind?: 'info' | 'ask' | 'chat',
    contextLabels: string[] = []
  ): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'message assistant';
    el.setAttribute('role', 'article');

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    if (hasRichTextFormatting(text)) {
      textDiv.classList.add('message-text-rich');
      textDiv.innerHTML = formatAssistantMessageAsHtml(text);
    } else {
      textDiv.textContent = text;
    }
    el.appendChild(textDiv);

    if (contextLabels.length > 0) {
      const contextDiv = document.createElement('div');
      contextDiv.className = 'context-used';
      contextDiv.textContent = `Context: ${contextLabels.join(', ')}`;
      el.appendChild(contextDiv);
    }

    if (kind === 'chat' || kind === 'ask') {
      el.appendChild(this.buildAssistantActions(text));
    }

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
   * Start a streaming assistant bubble. Content is filled in incrementally
   * via updateAssistantStream() and made final via finalizeAssistantMessage().
   */
  beginAssistantStream(id: string): void {
    this.hideWelcome();

    const el = document.createElement('div');
    el.className = 'message assistant streaming';
    el.setAttribute('role', 'article');
    el.setAttribute('aria-live', 'polite');

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    el.appendChild(textDiv);

    this.chatArea.appendChild(el);
    this.streamingElements.set(id, { container: el, textEl: textDiv });
    this.scrollToBottom();
  }

  /**
   * Update a streaming bubble with the cumulative reply text so far. The
   * Chat API's streamed frames each carry the full reply-so-far rather than
   * a delta, so this replaces the bubble's content rather than appending.
   */
  updateAssistantStream(id: string, text: string): void {
    const entry = this.streamingElements.get(id);
    if (!entry) {
      return;
    }

    entry.textEl.textContent = text;
    this.scrollToBottom();
  }

  /**
   * Render the final assistant reply, replacing a streaming bubble in place
   * if one exists for `id` (normal path), or creating a fresh bubble if not
   * (e.g. streaming was disabled and the reply arrived via the synchronous
   * endpoint with no preceding assistantMessageStart/Progress).
   */
  finalizeAssistantMessage(
    id: string,
    text: string,
    timestamp: string,
    kind?: 'info' | 'ask' | 'chat',
    contextLabels: string[] = []
  ): void {
    const entry = this.streamingElements.get(id);
    this.streamingElements.delete(id);

    let el = entry?.container;
    if (!el) {
      this.hideWelcome();
      el = document.createElement('div');
      el.className = 'message assistant';
      el.setAttribute('role', 'article');
      this.chatArea.appendChild(el);
    }

    el.classList.remove('streaming');
    el.replaceChildren();

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    if (hasRichTextFormatting(text)) {
      textDiv.classList.add('message-text-rich');
      textDiv.innerHTML = formatAssistantMessageAsHtml(text);
    } else {
      textDiv.textContent = text;
    }
    el.appendChild(textDiv);

    if (contextLabels.length > 0) {
      const contextDiv = document.createElement('div');
      contextDiv.className = 'context-used';
      contextDiv.textContent = `Context: ${contextLabels.join(', ')}`;
      el.appendChild(contextDiv);
    }

    if (kind === 'chat' || kind === 'ask') {
      el.appendChild(this.buildAssistantActions(text));
    }

    const timeStr = this.formatTime(timestamp);
    if (timeStr) {
      const tsDiv = document.createElement('div');
      tsDiv.className = 'timestamp';
      tsDiv.textContent = timeStr;
      el.appendChild(tsDiv);
    }

    this.scrollToBottom();
  }

  private buildAssistantActions(text: string): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'assistant-actions';

    const copyBtn = this.buildAssistantActionButton('Copy', 'Copy response', () => {
      this.vscode.postMessage({ command: 'applyAssistantResult', action: 'copy', text });
    });
    actions.appendChild(copyBtn);

    const appendBtn = this.buildAssistantActionButton('Append', 'Append response to the active editor', () => {
      this.vscode.postMessage({ command: 'applyAssistantResult', action: 'append', text });
    });
    actions.appendChild(appendBtn);

    const replaceBtn = this.buildAssistantActionButton('Replace', 'Replace the active selection, or the whole active document if nothing is selected', () => {
      this.vscode.postMessage({ command: 'applyAssistantResult', action: 'replace', text });
    });
    actions.appendChild(replaceBtn);

    return actions;
  }

  private buildAssistantActionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
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
  setLoading(source: string, isLoading: boolean, message?: string, icon?: string): void {
    if (isLoading) {
      this.hideWelcome();

      const el = document.createElement('div');
      el.className = 'loading';
      const label = getSourceLabel(source);
      const loadingText = message ?? `Searching ${label}...`;
      el.setAttribute('aria-label', loadingText);

      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      el.appendChild(spinner);

      const text = document.createElement('span');
      text.appendChild(icon ? this.createTextIcon(icon) : this.createSourceIcon(source, '🔍'));
      text.appendChild(document.createTextNode(` ${loadingText}`));
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
    intro.textContent = 'Chat with Microsoft 365 Copilot, or search Microsoft 365 context with slash commands.';
    welcome.appendChild(intro);

    const commandsHint = document.createElement('p');
    commandsHint.style.fontSize = '0.8em';
    commandsHint.appendChild(document.createTextNode('Type '));
    const slashCode = document.createElement('code');
    slashCode.textContent = '/';
    commandsHint.appendChild(slashCode);
    commandsHint.appendChild(document.createTextNode(' for available commands, combine source commands like '));
    const comboCode = document.createElement('code');
    comboCode.textContent = '/mail /onedrive';
    commandsHint.appendChild(comboCode);
    commandsHint.appendChild(document.createTextNode(' for source search. Use '));
    const hashCode = document.createElement('code');
    hashCode.textContent = '#file';
    commandsHint.appendChild(hashCode);
    commandsHint.appendChild(document.createTextNode(' (or quoted paths like '));
    const quotedHashCode = document.createElement('code');
    quotedHashCode.textContent = '#"notes/Release Plan.md"';
    commandsHint.appendChild(quotedHashCode);
    commandsHint.appendChild(document.createTextNode(') to attach local workspace files to Copilot and /workiq prompts.'));
    welcome.appendChild(commandsHint);

    const askHint = document.createElement('p');
    askHint.style.fontSize = '0.8em';
    askHint.appendChild(document.createTextNode('Pin snippets and run '));
    const askCode = document.createElement('code');
    askCode.textContent = '/ask';
    askHint.appendChild(askCode);
    askHint.appendChild(document.createTextNode(' to process pinned snippets or '));
    const hashMentionCode = document.createElement('code');
    hashMentionCode.textContent = '#file';
    askHint.appendChild(hashMentionCode);
    askHint.appendChild(document.createTextNode(' mentions with Microsoft 365 Copilot.'));
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

    if (canOpenResult(item)) {
      const openBtn = document.createElement('button');
      openBtn.className = 'action-open';
      openBtn.title = item.url ? 'Open in browser' : 'Open preview';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', () => {
        if (item.url) {
          this.vscode.postMessage({ command: 'openLink', url: item.url });
          return;
        }

        this.vscode.postMessage({ command: 'openItem', item });
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
    const iconSpan = this.createTextIcon('');
    const svg = getSourceInlineSvg(source);
    if (svg) {
      iconSpan.appendChild(this.buildSvgIcon(svg));
      return iconSpan;
    }

    iconSpan.textContent = getSourceTextIcon(source) || fallback;
    return iconSpan;
  }

  private createTextIcon(icon: string): HTMLElement {
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
    iconSpan.textContent = icon;
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
