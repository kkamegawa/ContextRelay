import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';
import { parseQueryIntent, scoreMatches } from './queryIntent';

interface OneNotePageParent {
  id?: string;
  name?: string;
}

interface OneNotePageLinks {
  oneNoteWebUrl?: {
    href?: string;
  };
}

interface OneNotePage {
  id?: string;
  title?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  contentUrl?: string;
  links?: OneNotePageLinks;
  parentSection?: OneNotePageParent;
  parentNotebook?: OneNotePageParent;
}

interface OneNotePageResponse {
  value?: OneNotePage[];
}

interface OneNotePagePreview {
  previewText?: string;
}

interface PageCandidate {
  page: OneNotePage;
  previewText: string;
  score: number;
}

export async function searchOneNote(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const scanLimit = Math.min(Math.max(maxResults * 3, maxResults), 30);
  const intent = parseQueryIntent(query);
  const pages = await listRecentPages(token, scanLimit);
  const previews = await fetchPagePreviews(token, pages);

  const candidates = pages.map((page, index) => {
    const previewText = previews[index] ?? '';
    const score = computePageScore(page, previewText, intent.searchTerms, intent.includeOneNoteHierarchy);
    return { page, previewText, score };
  });

  const filtered = candidates
    .filter(candidate => intent.searchTerms.length === 0 || candidate.score > 0)
    .sort((left, right) => compareCandidates(left, right))
    .slice(0, maxResults);

  return filtered.map(candidate => mapCandidate(candidate, intent.includeOneNoteHierarchy));
}

async function listRecentPages(token: string, scanLimit: number): Promise<OneNotePage[]> {
  const url = `${GRAPH_BASE}/v1.0/me/onenote/pages?$top=${scanLimit}&$select=id,title,createdDateTime,lastModifiedDateTime,contentUrl,links&$expand=parentSection($select=id,name),parentNotebook($select=id,name)`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as OneNotePageResponse;
  return data.value?.filter(page => page.id) ?? [];
}

async function fetchPagePreviews(token: string, pages: OneNotePage[]): Promise<string[]> {
  const settled = await Promise.allSettled(
    pages.map(page => fetchPagePreview(token, page.id ?? ''))
  );

  return settled.map(result => result.status === 'fulfilled' ? result.value : '');
}

async function fetchPagePreview(token: string, pageId: string): Promise<string> {
  const url = `${GRAPH_BASE}/v1.0/me/onenote/pages/${encodeURIComponent(pageId)}/preview`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as OneNotePagePreview;
  return data.previewText?.trim() ?? '';
}

function computePageScore(
  page: OneNotePage,
  previewText: string,
  searchTerms: string[],
  includeHierarchy: boolean
): number {
  if (searchTerms.length === 0) {
    return 0;
  }

  const titleScore = scoreMatches(page.title ?? '', searchTerms) * 4;
  const previewScore = scoreMatches(previewText, searchTerms) * 3;
  const hierarchyScore = includeHierarchy
    ? (scoreMatches(page.parentSection?.name ?? '', searchTerms) + scoreMatches(page.parentNotebook?.name ?? '', searchTerms)) * 2
    : 0;

  return titleScore + previewScore + hierarchyScore;
}

function compareCandidates(left: PageCandidate, right: PageCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return compareIsoTimestamps(
    left.page.lastModifiedDateTime ?? left.page.createdDateTime,
    right.page.lastModifiedDateTime ?? right.page.createdDateTime
  );
}

function mapCandidate(candidate: PageCandidate, includeHierarchy: boolean): ContextItem {
  const { page, previewText } = candidate;
  const sectionName = page.parentSection?.name?.trim();
  const notebookName = page.parentNotebook?.name?.trim();
  const hierarchy = [sectionName, notebookName].filter(Boolean).join(' · ');
  const body = previewText || 'No preview text is available for this page yet.';

  return {
    source: 'onenote',
    title: page.title?.trim() || 'Untitled page',
    snippet: includeHierarchy && hierarchy ? `${hierarchy}\n${body}` : body,
    url: page.links?.oneNoteWebUrl?.href,
    timestamp: page.lastModifiedDateTime ?? page.createdDateTime,
    cache: { hit: false },
    raw: {
      pageId: page.id,
      contentUrl: page.contentUrl,
      sectionName,
      notebookName,
      previewText,
      extracts: previewText ? [previewText] : []
    }
  };
}

function compareIsoTimestamps(left?: string, right?: string): number {
  return (Date.parse(right ?? '') || 0) - (Date.parse(left ?? '') || 0);
}
