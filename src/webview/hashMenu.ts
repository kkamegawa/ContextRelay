interface HashSelectionContext {
  tokenStart: number;
  tokenEnd: number;
  partialPath: string;
}

export class HashMenu {
  private readonly menu: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly onSelect: (nextValue: string) => void;
  private allFiles: string[] = [];
  private filteredFiles: string[] = [];
  private selectedIndex = -1;
  private selectionContext?: HashSelectionContext;

  constructor(
    menuEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    onSelect: (nextValue: string) => void
  ) {
    this.menu = menuEl;
    this.input = inputEl;
    this.onSelect = onSelect;
  }

  setFiles(files: readonly string[]): void {
    this.allFiles = [...files];
    if (this.selectionContext) {
      this.update(this.input.value);
    }
  }

  update(text: string): boolean {
    const context = this.getSelectionContext(text);
    if (!context) {
      this.hide();
      return false;
    }

    this.selectionContext = context;
    const query = context.partialPath.toLowerCase();
    this.filteredFiles = this.allFiles
      .filter(file => file.toLowerCase().includes(query))
      .slice(0, 50);

    if (this.filteredFiles.length === 0) {
      this.hide();
      return false;
    }

    this.selectedIndex = 0;
    this.renderItems();
    this.show();
    return true;
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.isVisible()) {
      return false;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredFiles.length - 1);
        this.updateSelection();
        return true;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateSelection();
        return true;

      case 'Enter':
      case 'Tab': {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.filteredFiles.length) {
          return false;
        }
        e.preventDefault();
        this.applySelection(this.filteredFiles[this.selectedIndex]);
        this.hide();
        return true;
      }

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

  private renderItems(): void {
    this.menu.replaceChildren();

    for (const [index, file] of this.filteredFiles.entries()) {
      const row = document.createElement('div');
      row.className = `hash-item${index === this.selectedIndex ? ' selected' : ''}`;
      row.setAttribute('role', 'option');
      row.id = `hash-option-${index}`;
      row.dataset.file = file;
      row.setAttribute('aria-selected', String(index === this.selectedIndex));

      const icon = document.createElement('span');
      icon.className = 'hash-icon';
      icon.textContent = '#';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'hash-label';
      label.textContent = file;
      row.appendChild(label);

      this.menu.appendChild(row);
    }

    this.updateAriaActiveDescendant();

    this.menu.querySelectorAll<HTMLElement>('.hash-item').forEach(el => {
      el.addEventListener('click', () => {
        const file = el.dataset.file;
        if (!file) {
          return;
        }

        this.applySelection(file);
        this.hide();
      });
    });
  }

  private updateSelection(): void {
    const items = this.menu.querySelectorAll<HTMLElement>('.hash-item');
    items.forEach((el, index) => {
      el.classList.toggle('selected', index === this.selectedIndex);
      el.setAttribute('aria-selected', String(index === this.selectedIndex));
    });
    this.updateAriaActiveDescendant();
    items[this.selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  private updateAriaActiveDescendant(): void {
    if (this.selectedIndex >= 0) {
      this.input.setAttribute('aria-activedescendant', `hash-option-${this.selectedIndex}`);
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }

  private applySelection(file: string): void {
    if (!this.selectionContext) {
      return;
    }

    const fileToken = file.includes(' ') ? `#\"${file}\"` : `#${file}`;
    const prefix = this.input.value.slice(0, this.selectionContext.tokenStart);
    const suffix = this.input.value.slice(this.selectionContext.tokenEnd);
    const separator = suffix.startsWith(' ') || suffix.length === 0 ? '' : ' ';
    this.onSelect(`${prefix}${fileToken}${separator}${suffix}`);
  }

  private getSelectionContext(text: string): HashSelectionContext | undefined {
    if (/\s$/.test(text)) {
      return undefined;
    }

    const tokenMatch = text.match(/(^|\s)(#(?:"[^"]*|'[^']*|[^\s#]*))$/);
    if (!tokenMatch) {
      return undefined;
    }

    const fullMatch = tokenMatch[0];
    const prefix = tokenMatch[1] ?? '';
    const token = tokenMatch[2] ?? '';
    if (!token.startsWith('#')) {
      return undefined;
    }

    const tokenStart = text.length - fullMatch.length + prefix.length;
    const tokenEnd = text.length;
    const rawPath = token.slice(1);
    const partialPath = rawPath.replace(/^["']/, '');

    return {
      tokenStart,
      tokenEnd,
      partialPath
    };
  }
}

