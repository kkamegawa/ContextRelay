/**
 * Slash menu UI for the ContextRelay webview.
 * Shows a floating menu when the user types "/" in the input.
 */

interface SlashMenuItem {
  command: string;
  label: string;
  description: string;
  icon: string;
}

const SLASH_ITEMS: SlashMenuItem[] = [
  { command: '/mail', label: '/mail', description: 'Search Exchange mail', icon: '📧' },
  { command: '/teams', label: '/teams', description: 'Search Teams messages', icon: '💬' },
  { command: '/sharepoint', label: '/sharepoint', description: 'Search SharePoint', icon: '📄' },
  { command: '/onedrive', label: '/onedrive', description: 'Search OneDrive', icon: '☁️' },
  { command: '/all', label: '/all', description: 'Search all sources', icon: '🔍' },
  { command: '/ask', label: '/ask', description: 'Ask Microsoft 365 Copilot using pinned snippets', icon: '🤖' },
  { command: '/clear', label: '/clear', description: 'Clear chat and discard pinned snippets', icon: '🧹' },
];

export class SlashMenu {
  private menu: HTMLElement;
  private input: HTMLTextAreaElement;
  private selectedIndex = -1;
  private filteredItems: SlashMenuItem[] = [];
  private onSelect: (command: string) => void;

  constructor(
    menuEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    onSelect: (command: string) => void
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
    const trimmed = text.trim();

    // Show menu only when input starts with "/" and has no space (still typing command)
    if (!trimmed.startsWith('/') || trimmed.includes(' ')) {
      this.hide();
      return false;
    }

    const partial = trimmed.toLowerCase();
    this.filteredItems = SLASH_ITEMS.filter((item) =>
      item.command.startsWith(partial)
    );

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
          this.onSelect(selected.command);
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
    this.input.removeAttribute('aria-activedescendant');
  }

  isVisible(): boolean {
    return this.menu.classList.contains('visible');
  }

  private _renderItems(items: SlashMenuItem[]): void {
    this.menu.innerHTML = items
      .map(
        (item, index) => `
      <div class="slash-item${index === this.selectedIndex ? ' selected' : ''}"
           role="option"
           id="slash-option-${index}"
           data-command="${item.command}"
           aria-selected="${index === this.selectedIndex}">
        <span class="slash-icon">${item.icon}</span>
        <span class="slash-label">${item.label}</span>
        <span class="slash-desc">${item.description}</span>
      </div>
    `
      )
      .join('');

    // Update aria-activedescendant on the input
    this._updateAriaActiveDescendant();

    // Add click handlers
    this.menu.querySelectorAll<HTMLElement>('.slash-item').forEach((el) => {
      el.addEventListener('click', () => {
        const cmd = el.dataset.command;
        if (cmd) {
          this.onSelect(cmd);
          this.hide();
        }
      });
    });
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
}
