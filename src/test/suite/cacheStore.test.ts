import { strict as assert } from 'assert';

// Minimal in-memory CacheStore for unit testing (no vscode dependency)
interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

class InMemoryCacheStore<T> {
  private map = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = [];

  constructor(
    private ttl: number,
    private maxEntries: number
  ) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) { return undefined; }
    if (Date.now() - entry.storedAt > this.ttl * 1000) {
      this.map.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return undefined;
    }
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.accessOrder.shift();
      if (oldest) { this.map.delete(oldest); }
    }
    this.map.set(key, { value, storedAt: Date.now() });
    this.accessOrder.push(key);
  }

  isStale(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) { return true; }
    return Date.now() - entry.storedAt > this.ttl * 1000;
  }

  clear(): void {
    this.map.clear();
    this.accessOrder = [];
  }

  size(): number { return this.map.size; }
}

suite('CacheStore', () => {
  test('returns undefined for missing key', () => {
    const cache = new InMemoryCacheStore<string>(300, 200);
    assert.equal(cache.get('missing'), undefined);
  });

  test('stores and retrieves a value', () => {
    const cache = new InMemoryCacheStore<string>(300, 200);
    cache.set('key1', 'value1');
    assert.equal(cache.get('key1'), 'value1');
  });

  test('returns undefined after TTL expiry', async () => {
    const cache = new InMemoryCacheStore<string>(0, 200); // 0s TTL
    cache.set('key1', 'value1');
    // With 0s TTL, the entry should be stale immediately
    await new Promise(r => setTimeout(r, 10));
    assert.equal(cache.get('key1'), undefined);
  });

  test('evicts LRU entry when max entries exceeded', () => {
    const cache = new InMemoryCacheStore<string>(300, 3);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    // Access 'a' to make it recently used
    cache.get('a');
    // Add 'd' - should evict 'b' (LRU)
    cache.set('d', '4');
    assert.equal(cache.size(), 3);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), '1');
    assert.equal(cache.get('c'), '3');
    assert.equal(cache.get('d'), '4');
  });

  test('clear removes all entries', () => {
    const cache = new InMemoryCacheStore<string>(300, 200);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');
    cache.clear();
    assert.equal(cache.size(), 0);
    assert.equal(cache.get('k1'), undefined);
  });

  test('isStale returns true for expired entry', async () => {
    const cache = new InMemoryCacheStore<string>(0, 200);
    cache.set('key', 'value');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(cache.isStale('key'), true);
  });

  test('isStale returns true for missing key', () => {
    const cache = new InMemoryCacheStore<string>(300, 200);
    assert.equal(cache.isStale('nonexistent'), true);
  });

  test('overwriting key updates value', () => {
    const cache = new InMemoryCacheStore<string>(300, 200);
    cache.set('key', 'original');
    cache.set('key', 'updated');
    assert.equal(cache.get('key'), 'updated');
    assert.equal(cache.size(), 1);
  });
});
