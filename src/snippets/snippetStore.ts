import * as vscode from 'vscode';
import { SavedSnippet, ContextItem } from '../models/contextItem';

const WORKSPACE_STATE_KEY = 'contextRelay.snippets';

export class SnippetStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getAll(): SavedSnippet[] {
    return this.context.workspaceState.get<SavedSnippet[]>(WORKSPACE_STATE_KEY) ?? [];
  }

  save(item: ContextItem, name?: string): SavedSnippet {
    const snippets = this.getAll();
    const id = `snippet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const snippet: SavedSnippet = {
      id,
      item: { ...item, raw: undefined },
      name: name ?? item.title,
      savedAt: new Date().toISOString()
    };
    snippets.push(snippet);
    this.context.workspaceState.update(WORKSPACE_STATE_KEY, snippets);
    return snippet;
  }

  remove(id: string): void {
    const snippets = this.getAll().filter(s => s.id !== id);
    this.context.workspaceState.update(WORKSPACE_STATE_KEY, snippets);
  }

  clear(): void {
    this.context.workspaceState.update(WORKSPACE_STATE_KEY, []);
  }
}
