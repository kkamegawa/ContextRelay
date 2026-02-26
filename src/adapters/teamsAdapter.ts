import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

interface SearchHitResource {
  webUrl?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  from?: { emailAddress?: { name?: string } };
  channelIdentity?: { channelDisplayName?: string };
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

export async function searchTeams(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);

  const url = `${GRAPH_BASE}/v1.0/search/query`;
  const body = JSON.stringify({
    requests: [
      {
        entityTypes: ['chatMessage'],
        query: { queryString: query },
        size: maxResults,
        enableTopResults: true
      }
    ]
  });

  const response = await graphFetchWithRetry(url, token, { method: 'POST', body });
  const data = await handleGraphResponse(response) as SearchResponse;

  const items: ContextItem[] = [];
  const results = data?.value ?? [];

  for (const result of results) {
    for (const container of result?.hitsContainers ?? []) {
      for (const hit of container?.hits ?? []) {
        const resource = hit.resource ?? {};
        const senderName = resource.from?.emailAddress?.name;
        const channelName = resource.channelIdentity?.channelDisplayName;
        const titleParts = [senderName, channelName].filter(Boolean);
        const title = titleParts.length > 0 ? titleParts.join(' — ') : 'Teams message';

        items.push({
          source: 'teams',
          title,
          snippet: hit.summary ?? '',
          url: resource.webUrl,
          timestamp: resource.createdDateTime ?? resource.lastModifiedDateTime,
          cache: { hit: false }
        });
      }
    }
  }

  return items;
}
