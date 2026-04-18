import { strict as assert } from 'assert';
import type * as vscode from 'vscode';
import Module from 'module';
import { type ContextItem, getContextItemKey } from '../../models/contextItem';

type SnippetStoreCtor = typeof import('../../snippets/snippetStore').SnippetStore;
type ModuleLoader = typeof Module & {
  _load: (request: string, parent: object | null | undefined, isMain: boolean) => unknown;
};

const moduleLoader = Module as unknown as ModuleLoader;
const originalLoad = moduleLoader._load;
let SnippetStore: SnippetStoreCtor;

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
}

function createContext(): vscode.ExtensionContext {
  const workspaceState = new InMemoryMemento();

  return {
    workspaceState
  } as unknown as vscode.ExtensionContext;
}

function createItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    source: 'teams',
    title: 'Daily sync',
    snippet: 'Pinned excerpt',
    cache: { hit: false },
    ...overrides
  };
}

suite('SnippetStore', () => {
  suiteSetup(async () => {
    moduleLoader._load = (request: string, parent: object | null | undefined, isMain: boolean): unknown => {
      if (request === 'vscode') {
        return {};
      }

      return originalLoad(request, parent, isMain);
    };

    try {
      ({ SnippetStore } = await import('../../snippets/snippetStore'));
    } finally {
      moduleLoader._load = originalLoad;
    }
  });

  test('getPinnedKeys uses fallback identity when url is missing', () => {
    const store = new SnippetStore(createContext());
    const first = createItem({ timestamp: '2026-04-18T01:00:00.000Z', snippet: 'alpha' });
    const second = createItem({ timestamp: '2026-04-18T01:01:00.000Z', snippet: 'beta' });

    store.save(first);
    store.save(second);

    assert.deepEqual(store.getPinnedKeys(), [
      getContextItemKey(first),
      getContextItemKey(second)
    ]);
  });

  test('removeByItemKey removes all duplicates for the same item key', () => {
    const store = new SnippetStore(createContext());
    const duplicate = createItem({ timestamp: '2026-04-18T01:00:00.000Z', snippet: 'same item' });
    const different = createItem({ timestamp: '2026-04-18T01:00:01.000Z', snippet: 'different item' });

    store.save(duplicate, 'first copy');
    store.save(duplicate, 'second copy');
    store.save(different, 'keep me');

    const removed = store.removeByItemKey(getContextItemKey(duplicate));

    assert.equal(removed, true);
    assert.equal(store.getAll().length, 1);
    assert.deepEqual(store.getPinnedKeys(), [getContextItemKey(different)]);
  });

  test('removeByItemKey returns false when no snippet matches', () => {
    const store = new SnippetStore(createContext());
    store.save(createItem({ timestamp: '2026-04-18T01:00:00.000Z' }));

    const removed = store.removeByItemKey(
      getContextItemKey(createItem({ timestamp: '2026-04-18T01:00:01.000Z' }))
    );

    assert.equal(removed, false);
    assert.equal(store.getAll().length, 1);
  });
});
