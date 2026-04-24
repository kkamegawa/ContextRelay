export type ContextSource =
  | 'sharepoint'
  | 'onedrive'
  | 'mail'
  | 'teams'
  | 'onenote'
  | 'planner'
  | 'todo'
  | 'connectors';

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

export type PreviewContent =
  | { kind: 'text'; text: string }
  | { kind: 'html'; text: string; html: string }
  | { kind: 'image'; text: string; src: string; alt?: string };

export interface ResolvedPreview {
  source: ContextSource;
  title: string;
  content: PreviewContent;
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

const INTERNAL_PREVIEW_SOURCES = new Set<ContextSource>(['planner', 'todo']);

export function canOpenResult(item: Pick<ContextItem, 'source' | 'url'>): boolean {
  return Boolean(item.url?.trim()) || INTERNAL_PREVIEW_SOURCES.has(item.source);
}

export function getPreviewText(preview: Pick<ResolvedPreview, 'content'>): string {
  return preview.content.text;
}

/**
 * Build a stable key for a context item so the UI and the snippet store
 * agree on whether two items are "the same" for pin toggling.
 */
export function getContextItemKey(
  item: Pick<ContextItem, 'source' | 'title' | 'url' | 'timestamp' | 'snippet'>
): string {
  const discriminator =
    item.url?.trim() ||
    item.timestamp?.trim() ||
    item.snippet.trim() ||
    '';

  return `${item.source}::${discriminator}::${item.title}`;
}
