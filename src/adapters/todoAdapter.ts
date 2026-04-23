import * as vscode from 'vscode';
import { ContextItem, GRAPH_BASE, graphFetchWithRetry, handleGraphResponse } from './graphClient';
import { normalizePreviewText } from '../panel/itemPreview';
import { parseQueryIntent, scoreMatches } from './queryIntent';

interface TodoTaskList {
  id?: string;
  displayName?: string;
  wellknownListName?: string;
}

interface TodoTaskListResponse {
  value?: TodoTaskList[];
}

interface TodoTaskBody {
  content?: string;
  contentType?: string;
}

interface TodoDateTimeTimeZone {
  dateTime?: string;
  timeZone?: string;
}

interface TodoTask {
  id?: string;
  title?: string;
  status?: string;
  importance?: string;
  categories?: string[];
  body?: TodoTaskBody;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  dueDateTime?: TodoDateTimeTimeZone;
}

interface TodoTaskResponse {
  value?: TodoTask[];
}

interface TodoCandidate {
  task: TodoTask;
  body: string;
  listName: string;
  wellknownListName?: string;
  score: number;
}

const MAX_CONCURRENT_LIST_REQUESTS = 4;
const MAX_LISTS_PER_QUERY = 8;
const MAX_TOTAL_TASKS_PER_QUERY = 80;
export async function searchTodo(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const scanLimit = Math.min(Math.max(maxResults * 4, maxResults), 40);
  const intent = parseQueryIntent(query);
  const taskLists = await listTaskLists(token);
  const taskListsWithTasks = await listTasksByList(token, taskLists, scanLimit);

  const candidates = taskListsWithTasks.flatMap(({ list, tasks }) =>
    tasks.map(task => {
      const body = normalizeTodoBody(task.body);
      const listName = list.displayName?.trim() || getFallbackListName(list);
      const wellknownListName = list.wellknownListName?.trim() || undefined;
      const score = computeTodoScore(task, body, listName, intent.includePlannerMetadata, intent.searchTerms);
      return { task, body, listName, wellknownListName, score };
    })
  );

  return candidates
    .filter(candidate => intent.searchTerms.length === 0 || candidate.score > 0)
    .sort(compareTodoCandidates)
    .slice(0, maxResults)
    .map(candidate => mapTodoCandidate(candidate, intent.includePlannerMetadata));
}

async function listTaskLists(token: string): Promise<TodoTaskList[]> {
  const response = await graphFetchWithRetry(`${GRAPH_BASE}/v1.0/me/todo/lists`, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as TodoTaskListResponse;
  return data.value?.filter(list => list.id) ?? [];
}

async function listTasksByList(
  token: string,
  lists: TodoTaskList[],
  scanLimit: number
): Promise<Array<{ list: TodoTaskList; tasks: TodoTask[] }>> {
  const listsToScan = lists.slice(0, MAX_LISTS_PER_QUERY);
  if (listsToScan.length === 0) {
    return [];
  }

  const perListScanLimit = Math.max(
    1,
    Math.min(scanLimit, Math.ceil(MAX_TOTAL_TASKS_PER_QUERY / listsToScan.length))
  );
  const results: Array<{ list: TodoTaskList; tasks: TodoTask[] }> = [];

  for (let index = 0; index < listsToScan.length; index += MAX_CONCURRENT_LIST_REQUESTS) {
    const chunk = listsToScan.slice(index, index + MAX_CONCURRENT_LIST_REQUESTS);
    const chunkResults = await Promise.all(chunk.map(async list => ({
      list,
      tasks: await listTasks(token, list.id as string, perListScanLimit)
    })));
    results.push(...chunkResults);
  }

  return results;
}

async function listTasks(token: string, listId: string, scanLimit: number): Promise<TodoTask[]> {
  const url = `${GRAPH_BASE}/v1.0/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=${scanLimit}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as TodoTaskResponse;
  return data.value?.filter(task => task.id) ?? [];
}

function computeTodoScore(
  task: TodoTask,
  body: string,
  listName: string,
  includeMetadata: boolean,
  searchTerms: string[]
): number {
  if (searchTerms.length === 0) {
    return 0;
  }

  const titleScore = scoreMatches(task.title ?? '', searchTerms) * 4;
  const bodyScore = scoreMatches(body, searchTerms) * 3;
  const metadataScore = includeMetadata
    ? (
      scoreMatches(listName, searchTerms) +
      scoreMatches(task.status ?? '', searchTerms) +
      scoreMatches(task.importance ?? '', searchTerms) +
      scoreMatches((task.categories ?? []).join(' '), searchTerms)
    ) * 2
    : 0;

  return titleScore + bodyScore + metadataScore;
}

function compareTodoCandidates(left: TodoCandidate, right: TodoCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return compareIsoTimestamps(
    left.task.dueDateTime?.dateTime ?? left.task.lastModifiedDateTime ?? left.task.createdDateTime,
    right.task.dueDateTime?.dateTime ?? right.task.lastModifiedDateTime ?? right.task.createdDateTime
  );
}

function mapTodoCandidate(candidate: TodoCandidate, includeMetadata: boolean): ContextItem {
  const { task, body, listName, wellknownListName } = candidate;
  const snippetParts = [body || 'No task notes available.'];

  if (includeMetadata) {
    const metadataParts = [
      listName ? `List: ${listName}` : undefined,
      task.status ? `Status: ${task.status}` : undefined,
      task.importance ? `Importance: ${task.importance}` : undefined,
      formatDueDate(task.dueDateTime) ? `Due: ${formatDueDate(task.dueDateTime)}` : undefined
    ].filter(Boolean);

    if (metadataParts.length > 0) {
      snippetParts.push(metadataParts.join(' · '));
    }

    if ((task.categories ?? []).length > 0) {
      snippetParts.push(`Categories: ${task.categories?.join('; ')}`);
    }
  }

  return {
    source: 'todo',
    title: task.title?.trim() || 'Untitled task',
    snippet: snippetParts.join('\n'),
    timestamp: task.dueDateTime?.dateTime ?? task.lastModifiedDateTime ?? task.createdDateTime,
    cache: { hit: false },
    raw: {
      body,
      listName,
      ...(wellknownListName ? { wellknownListName } : {}),
      status: task.status,
      importance: task.importance,
      categories: task.categories ?? []
    }
  };
}

function getFallbackListName(list: TodoTaskList): string {
  return list.wellknownListName?.trim() || 'Task list';
}

function normalizeTodoBody(body?: TodoTaskBody): string {
  const content = body?.content?.trim() ?? '';
  if (!content) {
    return '';
  }

  return normalizePreviewText(content, body?.contentType === 'html');
}

function formatDueDate(value?: TodoDateTimeTimeZone): string | undefined {
  const iso = value?.dateTime?.trim();
  if (!iso) {
    return undefined;
  }

  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleDateString();
}

function compareIsoTimestamps(left?: string, right?: string): number {
  return (Date.parse(right ?? '') || 0) - (Date.parse(left ?? '') || 0);
}
