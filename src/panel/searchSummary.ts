import { ContextItem } from '../models/contextItem';

export interface SearchSummaryResult {
  source: string;
  items: ContextItem[];
  error?: string;
  cached?: boolean;
}

export function buildSearchSummary(query: string, results: SearchSummaryResult[]): string {
  const trimmedQuery = query.trim();
  const lines: string[] = [
    `Latest search query: \`${trimmedQuery}\``,
    ''
  ];

  if (results.length === 0) {
    lines.push('- No sources were queried.');
    return lines.join('\n');
  }

  const totalItems = results.reduce((count, result) => count + result.items.length, 0);
  lines.push(`Total results: ${totalItems}`);
  lines.push('');

  for (const result of results) {
    const sourceName = capitalizeSource(result.source);

    if (result.error && result.items.length === 0) {
      lines.push(`- ${sourceName}: error — ${result.error}`);
      continue;
    }

    const titles = result.items.slice(0, 3).map(item => item.title || 'Untitled');
    const titleSummary = titles.length > 0 ? ` Top items: ${titles.join('; ')}.` : '';
    const cacheSummary = result.cached ? ' (cached)' : '';

    lines.push(`- ${sourceName}: ${result.items.length} item(s)${cacheSummary}.${titleSummary}`);
  }

  return lines.join('\n');
}

function capitalizeSource(source: string): string {
  const labels: Record<string, string> = {
    mail: 'Mail',
    teams: 'Teams',
    sharepoint: 'SharePoint',
    onedrive: 'OneDrive',
    connectors: 'Connectors'
  };

  return labels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}