export type ContextSource = 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'connectors';

export interface ContextItem {
  source: ContextSource;
  title: string;
  snippet: string;
  url?: string;
  timestamp?: string;
  relevance?: number;
  cache: {
    hit: boolean;
    storedAt?: string;
    ttlSeconds?: number;
  };
  raw?: unknown;
}

export interface ResolvedPreview {
  source: ContextSource;
  title: string;
  body: string;
  subtitle?: string;
  timestamp?: string;
  relevance?: number;
  url?: string;
}

export interface SavedSnippet {
  id: string;
  item: ContextItem;
  name: string;
  savedAt: string;
}

/**
 * Build a stable key for a context item so the UI and the snippet store
 * agree on whether two items are "the same" for pin toggling.
 */
export function getContextItemKey(item: Pick<ContextItem, 'source' | 'title' | 'url'>): string {
  return `${item.source}::${item.url ?? ''}::${item.title}`;
}
