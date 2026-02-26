import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';

interface MailMessage {
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  webLink?: string;
}

interface MailResponse {
  value?: MailMessage[];
}

export async function searchMail(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);

  const encoded = encodeURIComponent(`"${query}"`);
  const url = `${GRAPH_BASE}/v1.0/me/messages?$search=${encoded}&$top=${maxResults}`;

  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as MailResponse;

  const messages = data?.value ?? [];
  return messages.map(msg => ({
    source: 'mail' as const,
    title: msg.subject ?? '(No subject)',
    snippet: msg.bodyPreview ?? '',
    url: msg.webLink,
    timestamp: msg.receivedDateTime,
    cache: { hit: false }
  }));
}
