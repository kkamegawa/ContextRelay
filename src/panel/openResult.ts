import { ContextItem, ResolvedPreview } from '../models/contextItem';
import { getSourceLabel } from '../sourcePresentation';

const INTERNAL_PREVIEW_SOURCES = new Set<ContextItem['source']>(['planner', 'todo']);

export function canOpenResult(item: Pick<ContextItem, 'source' | 'url'>): boolean {
  return Boolean(item.url?.trim()) || INTERNAL_PREVIEW_SOURCES.has(item.source);
}

export function buildPreviewDocument(preview: ResolvedPreview): string {
  const lines = [`# ${preview.title}`, ''];
  const metadata: string[] = [
    `- Source: ${getSourceLabel(preview.source)}`,
    preview.subtitle ? `- Context: ${preview.subtitle}` : undefined,
    preview.timestamp ? `- Timestamp: ${preview.timestamp}` : undefined,
    preview.url ? `- Link: ${preview.url}` : undefined
  ].filter((value): value is string => Boolean(value));

  lines.push(...metadata);

  if (metadata.length > 0) {
    lines.push('');
  }

  lines.push(preview.body || 'No preview text is available for this item yet.');
  return lines.join('\n');
}
