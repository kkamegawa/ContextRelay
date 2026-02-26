import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

interface RetrievalResource {
  webUrl?: string;
  name?: string;
}

interface RetrievalExtract {
  text?: string;
}

interface RetrievalHit {
  resource?: RetrievalResource;
  extracts?: RetrievalExtract[];
  relevanceScore?: number;
}

interface RetrievalResponse {
  value?: RetrievalHit[];
}

export type RetrievalDataSource = 'sharePoint' | 'oneDriveBusiness' | 'externalItem';

export async function searchRetrieval(
  token: string,
  query: string,
  dataSource: RetrievalDataSource
): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);

  const url = `${GRAPH_BASE}/v1.0/copilot/retrieval`;
  const body = JSON.stringify({
    query: { queryString: query },
    dataSource,
    size: maxResults
  });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as RetrievalResponse;

  const hits = data?.value ?? [];
  const source = dataSource === 'sharePoint'
    ? 'sharepoint'
    : dataSource === 'oneDriveBusiness'
      ? 'onedrive'
      : 'connectors';

  return hits.map(hit => ({
    source: source as ContextItem['source'],
    title: hit.resource?.name ?? 'Untitled',
    snippet: hit.extracts?.map(e => e.text ?? '').join(' ') ?? '',
    url: hit.resource?.webUrl,
    relevance: hit.relevanceScore,
    cache: { hit: false }
  }));
}
