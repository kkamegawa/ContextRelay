/**
 * Slash menu UI for the ContextRelay webview.
 * Shows a floating menu when the user types "/" in the input.
 */

import { getSourceInlineSvg, getSourceTextIcon } from '../sourcePresentation';

interface SlashMenuItem {
  command: string;
  label: string;
  description: string;
  icon: string;
  sourceIcon?: 'mail' | 'teams' | 'sharepoint' | 'onedrive' | 'onenote' | 'planner' | 'todo' | 'all';
}

const SLASH_ITEMS: SlashMenuItem[] = [
  { command: '/mail', label: '/mail', description: 'Search Exchange mail', icon: getSourceTextIcon('mail'), sourceIcon: 'mail' },
  { command: '/teams', label: '/teams', description: 'Search Teams messages', icon: getSourceTextIcon('teams'), sourceIcon: 'teams' },
  { command: '/sharepoint', label: '/sharepoint', description: 'Search SharePoint', icon: getSourceTextIcon('sharepoint'), sourceIcon: 'sharepoint' },
  { command: '/onedrive', label: '/onedrive', description: 'Search OneDrive', icon: getSourceTextIcon('onedrive'), sourceIcon: 'onedrive' },
  { command: '/onenote', label: '/onenote', description: 'Search OneNote pages', icon: getSourceTextIcon('onenote'), sourceIcon: 'onenote' },
  { command: '/task', label: '/task', description: 'Search Planner and Microsoft To Do tasks', icon: getSourceTextIcon('todo'), sourceIcon: 'todo' },
  { command: '/all', label: '/all', description: 'Search all sources explicitly', icon: getSourceTextIcon('all'), sourceIcon: 'all' },
  { command: '/ask', label: '/ask', description: 'Ask Microsoft 365 Copilot using pinned snippets in the panel', icon: '🤖' },
  { command: '/workiq', label: '/workiq', description: 'Ask Work IQ using Microsoft 365 work intelligence', icon: '🧠' },
  { command: '/clear', label: '/clear', description: 'Clear chat and discard pinned snippets', icon: '🧹' },
];

export class SlashMenu {
  private menu: HTMLElement;
  private input: HTMLTextAreaElement;
  private selectedIndex = -1;
  private filteredItems: SlashMenuItem[] = [];
  private onSelect: (nextValue: string) => void;
  private selectionContext?: SlashSelectionContext;

  constructor(
    menuEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    onSelect: (nextValue: string) => void
  ) {
    this.menu = menuEl;
    this.input = inputEl;
    this.onSelect = onSelect;

    this._renderItems(SLASH_ITEMS);
  }

  /**
   * Update the menu based on current input text.
   * Returns true if the menu is visible.
   */
  update(text: string): boolean {
    const context = this._getSelectionContext(text);
    if (!context) {
      this.hide();
      return false;
    }

    this.selectionContext = context;
    this.filteredItems = SLASH_ITEMS.filter(item => this._matchesContext(item, context));

    if (this.filteredItems.length === 0) {
      this.hide();
      return false;
    }

    this.selectedIndex = 0;
    this._renderItems(this.filteredItems);
    this.show();
    return true;
  }

  /**
   * Handle keyboard events for menu navigation.
   * Returns true if the event was consumed.
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.isVisible()) {
      return false;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(
          this.selectedIndex + 1,
          this.filteredItems.length - 1
        );
        this._updateSelection();
        return true;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this._updateSelection();
        return true;

      case 'Enter':
      case 'Tab':
        if (this.selectedIndex >= 0 && this.selectedIndex < this.filteredItems.length) {
          e.preventDefault();
          const selected = this.filteredItems[this.selectedIndex];
          this._applySelection(selected.command);
          this.hide();
          return true;
        }
        return false;

      case 'Escape':
        e.preventDefault();
        this.hide();
        return true;

      default:
        return false;
    }
  }

  show(): void {
    this.menu.classList.add('visible');
  }

  hide(): void {
    this.menu.classList.remove('visible');
    this.selectedIndex = -1;
    this.selectionContext = undefined;
    this.input.removeAttribute('aria-activedescendant');
  }

  isVisible(): boolean {
    return this.menu.classList.contains('visible');
  }

  private _renderItems(items: SlashMenuItem[]): void {
    this.menu.replaceChildren();

    for (const [index, item] of items.entries()) {
      const row = document.createElement('div');
      row.className = `slash-item${index === this.selectedIndex ? ' selected' : ''}`;
      row.setAttribute('role', 'option');
      row.id = `slash-option-${index}`;
      row.dataset.command = item.command;
      row.setAttribute('aria-selected', String(index === this.selectedIndex));

      const icon = document.createElement('span');
      icon.className = 'slash-icon';
      if (item.sourceIcon) {
        icon.appendChild(this._createSourceIcon(item.sourceIcon, item.icon));
      } else {
        icon.textContent = item.icon;
      }
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'slash-label';
      label.textContent = item.label;
      row.appendChild(label);

      const description = document.createElement('span');
      description.className = 'slash-desc';
      description.textContent = item.description;
      row.appendChild(description);

      this.menu.appendChild(row);
    }

    // Update aria-activedescendant on the input
    this._updateAriaActiveDescendant();

    // Add click handlers
    this.menu.querySelectorAll<HTMLElement>('.slash-item').forEach((el) => {
      el.addEventListener('click', () => {
        const cmd = el.dataset.command;
        if (cmd) {
          this._applySelection(cmd);
          this.hide();
        }
      });
    });
  }

  private _createSourceIcon(source: NonNullable<SlashMenuItem['sourceIcon']>, fallback: string): Element {
    const svg = getSourceInlineSvg(source);
    if (!svg) {
      const text = document.createElement('span');
      text.textContent = fallback;
      return text;
    }

    const svgNs = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(svgNs, 'svg');
    svgEl.setAttribute('viewBox', svg.viewBox);
    svgEl.setAttribute('fill', 'none');
    svgEl.setAttribute('aria-hidden', 'true');
    svgEl.setAttribute('focusable', 'false');
    svgEl.style.width = '1em';
    svgEl.style.height = '1em';

    for (const shape of svg.shapes) {
      const child = document.createElementNS(svgNs, shape.tag);
      for (const [name, value] of Object.entries(shape.attrs)) {
        child.setAttribute(name, value);
      }
      svgEl.appendChild(child);
    }

    return svgEl;
  }

  private _updateSelection(): void {
    const items = this.menu.querySelectorAll<HTMLElement>('.slash-item');
    items.forEach((el, i) => {
      el.classList.toggle('selected', i === this.selectedIndex);
      el.setAttribute('aria-selected', String(i === this.selectedIndex));
    });

    this._updateAriaActiveDescendant();

    // Scroll selected item into view
    const selected = items[this.selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  private _updateAriaActiveDescendant(): void {
    if (this.selectedIndex >= 0) {
      this.input.setAttribute('aria-activedescendant', `slash-option-${this.selectedIndex}`);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private _applySelection(command: string): void {
    if (!this.selectionContext) {
      this.onSelect(`${command} `);
      return;
    }

    const nextValue = [...this.selectionContext.previousTokens, command].join(' ') + ' ';
    this.onSelect(nextValue);
  }

  private _matchesContext(item: SlashMenuItem, context: SlashSelectionContext): boolean {
    if (!item.command.startsWith(context.partial)) {
      return false;
    }

    if (!context.combinableOnly) {
      return true;
    }

    if (!COMBINABLE_COMMANDS.has(item.command)) {
      return false;
    }

    return !context.selectedCommands.has(item.command);
  }

  private _getSelectionContext(text: string): SlashSelectionContext | undefined {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/')) {
      return undefined;
    }

    const hasTrailingWhitespace = /\s$/.test(text);
    const tokens = trimmed.split(/\s+/);
    const partial = hasTrailingWhitespace ? '/' : tokens[tokens.length - 1].toLowerCase();
    const previousTokens = (hasTrailingWhitespace ? tokens : tokens.slice(0, -1)).map(token => token.toLowerCase());

    if (!partial.startsWith('/')) {
      return undefined;
    }

    const selectedCommands = new Set<string>();
    for (const token of previousTokens) {
      if (!COMBINABLE_COMMANDS.has(token)) {
        return undefined;
      }
      selectedCommands.add(token);
    }

    return {
      previousTokens,
      partial,
      selectedCommands,
      combinableOnly: previousTokens.length > 0
    };
  }
}

interface SlashSelectionContext {
  previousTokens: string[];
  partial: string;
  selectedCommands: Set<string>;
  combinableOnly: boolean;
}

const COMBINABLE_COMMANDS = new Set(['/mail', '/teams', '/sharepoint', '/onedrive', '/onenote', '/task']);
