import * as vscode from 'vscode';

interface CacheEntry<T> {
  value: T;
  storedAt: number;
  key: string;
}

const WORKSPACE_STATE_KEY = 'contextRelay.cache';

export class CacheStore<T> {
  private map = new Map<string, CacheEntry<T>>();
  private accessOrder: string[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getTtl: () => number,
    private readonly getMaxEntries: () => number,
    private readonly shouldPersist: () => boolean
  ) {
    this.restore();
  }

  private restore(): void {
    if (!this.shouldPersist()) {
      return;
    }
    const stored = this.context.workspaceState.get<Array<[string, CacheEntry<T>]>>(WORKSPACE_STATE_KEY);
    if (stored) {
      for (const [key, entry] of stored) {
        this.map.set(key, entry);
        this.accessOrder.push(key);
      }
    }
  }

  private persist(): void {
    if (!this.shouldPersist()) {
      return;
    }
    this.context.workspaceState.update(
      WORKSPACE_STATE_KEY,
      Array.from(this.map.entries())
    );
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }

    const ttlMs = this.getTtl() * 1000;
    if (Date.now() - entry.storedAt > ttlMs) {
      this.map.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return undefined;
    }

    // Update LRU order
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
    return entry.value;
  }

  set(key: string, value: T): void {
    const maxEntries = this.getMaxEntries();

    if (this.map.has(key)) {
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    } else if (this.map.size >= maxEntries) {
      // Evict least recently used
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.map.delete(oldest);
      }
    }

    this.map.set(key, { value, storedAt: Date.now(), key });
    this.accessOrder.push(key);
    this.persist();
  }

  getStoredAt(key: string): number | undefined {
    return this.map.get(key)?.storedAt;
  }

  isStale(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) {
      return true;
    }
    const ttlMs = this.getTtl() * 1000;
    return Date.now() - entry.storedAt > ttlMs;
  }

  clear(): void {
    this.map.clear();
    this.accessOrder = [];
    this.context.workspaceState.update(WORKSPACE_STATE_KEY, undefined);
  }

  size(): number {
    return this.map.size;
  }
}
