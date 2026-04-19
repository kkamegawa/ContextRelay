import { strict as assert } from 'assert';
import type * as vscode from 'vscode';
import { persistViewLocation, readStoredViewLocation } from '../../panel/viewLocationState';

class InMemoryMemento implements vscode.Memento {
  private readonly store = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.store.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }

    return defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  setKeysForSync(_keys: readonly string[]): void {}
}

function createContext(): Pick<vscode.ExtensionContext, 'globalState'> {
  return {
    globalState: new InMemoryMemento()
  };
}

suite('View location state', () => {
  test('defaults to the primary sidebar when no stored location exists', () => {
    const context = createContext();

    assert.equal(readStoredViewLocation(context), 'sidebar');
  });

  test('defaults to the primary sidebar when stored data is invalid', async () => {
    const context = createContext();

    await context.globalState.update('contextRelay.viewLocation', 'editor');

    assert.equal(readStoredViewLocation(context), 'sidebar');
  });

  test('reads the last persisted auxiliary bar location', async () => {
    const context = createContext();

    await persistViewLocation(context, 'auxiliarybar');

    assert.equal(readStoredViewLocation(context), 'auxiliarybar');
  });
});
