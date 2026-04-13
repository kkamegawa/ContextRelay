import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';
import {
  buildSearchSnippet,
  getTitleFromUrl,
  isOneDriveUrl,
  stripSearchMarkup
} from './retrievalSearchUtils';

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

interface SearchHitResource {
  '@odata.type'?: string;
  id?: string;
  name?: string;
  webUrl?: string;
  description?: string;
  file?: {
    mimeType?: string;
  };
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  fileSystemInfo?: {
    createdDateTime?: string;
    lastModifiedDateTime?: string;
  };
  parentReference?: {
    driveId?: string;
    siteId?: string;
    path?: string;
  };
}

interface SearchHit {
  summary?: string;
  resource?: SearchHitResource;
}

interface SearchHitsContainer {
  hits?: SearchHit[];
}

interface SearchResponse {
  value?: Array<{ hitsContainers?: SearchHitsContainer[] }>;
}

export type RetrievalDataSource = 'sharePoint' | 'oneDriveBusiness' | 'externalItem';

export async function searchRetrieval(
  token: string,
  query: string,
  dataSource: RetrievalDataSource
): Promise<ContextItem[]> {
  if (dataSource === 'oneDriveBusiness') {
    return searchOneDrive(token, query);
  }

  if (dataSource === 'sharePoint') {
    return searchSharePoint(token, query);
  }

  if (dataSource === 'externalItem') {
    return searchExternalItems(token, query);
  }

  return [];
}

async function searchOneDrive(token: string, query: string): Promise<ContextItem[]> {
  return searchFiles(token, query, 'onedrive');
}

async function searchSharePoint(token: string, query: string): Promise<ContextItem[]> {
  return searchFiles(token, query, 'sharepoint');
}

async function searchFiles(
  token: string,
  query: string,
  target: 'sharepoint' | 'onedrive'
): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const url = `${GRAPH_BASE}/v1.0/search/query`;
  const body = JSON.stringify({
    requests: [
      {
        entityTypes: ['driveItem', 'listItem', 'list', 'site'],
        query: { queryString: query },
        size: Math.min(Math.max(maxResults * 3, maxResults), 50)
      }
    ]
  });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as SearchResponse;

  const items: ContextItem[] = [];
  for (const result of data?.value ?? []) {
    for (const container of result.hitsContainers ?? []) {
      for (const hit of container.hits ?? []) {
        const resource = hit.resource;
        if (!resource?.webUrl) {
          continue;
        }

        const matchesTarget = target === 'onedrive'
          ? isOneDriveUrl(resource.webUrl)
          : !isOneDriveUrl(resource.webUrl);

        if (!matchesTarget) {
          continue;
        }

        const summaryText = stripSearchMarkup(hit.summary ?? '');

        items.push({
          source: target,
          title: resource.name ?? getTitleFromUrl(resource.webUrl) ?? 'Untitled',
          snippet: buildSearchSnippet(hit.summary, resource.description, resource.webUrl),
          url: resource.webUrl,
          timestamp: resource.lastModifiedDateTime ?? resource.fileSystemInfo?.lastModifiedDateTime ?? resource.createdDateTime,
          cache: { hit: false },
          raw: {
            id: resource.id,
            driveId: resource.parentReference?.driveId,
            siteId: resource.parentReference?.siteId,
            path: resource.parentReference?.path,
            mimeType: resource.file?.mimeType,
            extracts: summaryText ? [summaryText] : []
          }
        });

        if (items.length >= maxResults) {
          return items;
        }
      }
    }
  }

  return items;
}

async function searchExternalItems(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const url = `${GRAPH_BASE}/v1.0/copilot/retrieval`;
  const body = JSON.stringify({
    query: { queryString: query },
    dataSource: 'externalItem',
    size: maxResults
  });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as RetrievalResponse;

  return (data?.value ?? []).map(hit => ({
    source: 'connectors',
    title: hit.resource?.name ?? 'Untitled',
    snippet: hit.extracts?.map(e => e.text ?? '').join(' ') ?? '',
    url: hit.resource?.webUrl,
    relevance: hit.relevanceScore,
    cache: { hit: false },
    raw: {
      extracts: hit.extracts?.map(e => e.text ?? '').filter(Boolean) ?? []
    }
  }));
}

