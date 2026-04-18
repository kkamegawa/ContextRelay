import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';
import {
  buildSearchSnippet,
  getTitleFromUrl,
  isOneDriveUrl,
  stripSearchMarkup
} from './retrievalSearchUtils';

interface RetrievalExtract {
  text?: string;
}

interface RetrievalResourceMetadata {
  title?: string;
  name?: string;
  [key: string]: unknown;
}

interface RetrievalHit {
  webUrl?: string;
  extracts?: RetrievalExtract[];
  resourceMetadata?: RetrievalResourceMetadata;
  resourceType?: string;
  sensitivityLabel?: unknown;
}

interface RetrievalResponse {
  retrievalHits?: RetrievalHit[];
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
  // The Copilot retrieval API caps queryString at 1,500 characters and works best with a
  // single natural-language sentence. Trim excessively long input rather than letting the
  // service reject the request with HTTP 400.
  const queryString = query.length > 1500 ? query.slice(0, 1500) : query;
  const url = `${GRAPH_BASE}/v1.0/copilot/retrieval`;
  // Request body shape per Microsoft Graph retrieval API:
  //   queryString (top-level string), dataSource, resourceMetadata, maximumNumberOfResults.
  // The previous shape ({ query: { queryString }, size }) triggered a Graph API 400
  // "BadRequest" response.
  const body = JSON.stringify({
    queryString,
    dataSource: 'externalItem',
    resourceMetadata: ['title'],
    maximumNumberOfResults: Math.min(Math.max(maxResults, 1), 25)
  });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as RetrievalResponse;

  return (data?.retrievalHits ?? []).map(hit => {
    const extracts = hit.extracts?.map(e => e.text ?? '').filter(Boolean) ?? [];
    const title =
      (typeof hit.resourceMetadata?.title === 'string' && hit.resourceMetadata.title) ||
      (typeof hit.resourceMetadata?.name === 'string' && hit.resourceMetadata.name) ||
      getTitleFromUrl(hit.webUrl ?? '') ||
      'Untitled';

    return {
      source: 'connectors',
      title,
      snippet: extracts.join(' '),
      url: hit.webUrl,
      cache: { hit: false },
      raw: {
        extracts,
        resourceType: hit.resourceType
      }
    };
  });
}

