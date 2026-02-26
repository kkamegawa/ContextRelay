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

export interface SavedSnippet {
  id: string;
  item: ContextItem;
  name: string;
  savedAt: string;
}
