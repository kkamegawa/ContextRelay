import { ContextItem } from '../models/contextItem';

export interface HandoffSnippetDraft {
  item: ContextItem;
  name: string;
}

export function normalizeHandoffExcerpt(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildHandoffSnippetDraft(
  item: ContextItem,
  options: { selectedText?: string; previewBody?: string }
): HandoffSnippetDraft | undefined {
  const excerpt = normalizeHandoffExcerpt(
    options.selectedText?.trim() || options.previewBody?.trim() || item.snippet || ''
  );

  if (!excerpt) {
    return undefined;
  }

  const isSelection = normalizeHandoffExcerpt(options.selectedText ?? '').length > 0;

  return {
    name: isSelection ? `${item.title} — excerpt` : `${item.title} — full preview`,
    item: {
      ...item,
      snippet: excerpt,
      cache: { hit: false }
    }
  };
}