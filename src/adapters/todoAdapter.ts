import * as vscode from 'vscode';
import { ContextItem, GRAPH_BASE, graphFetchWithRetry, handleGraphResponse } from './graphClient';
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
  listName: string;
  score: number;
}

export async function searchTodo(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const scanLimit = Math.min(Math.max(maxResults * 4, maxResults), 40);
  const intent = parseQueryIntent(query);
  const taskLists = await listTaskLists(token);
  const taskListsWithTasks = await listTasksByList(token, taskLists, scanLimit);

  const candidates = taskListsWithTasks.flatMap(({ list, tasks }) =>
    tasks.map(task => {
      const listName = list.displayName?.trim() || getFallbackListName(list);
      const score = computeTodoScore(task, listName, intent.includePlannerMetadata, intent.searchTerms);
      return { task, listName, score };
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
  return Promise.all(lists.map(async list => ({
    list,
    tasks: await listTasks(token, list.id as string, scanLimit)
  })));
}

async function listTasks(token: string, listId: string, scanLimit: number): Promise<TodoTask[]> {
  const url = `${GRAPH_BASE}/v1.0/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=${scanLimit}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as TodoTaskResponse;
  return data.value?.filter(task => task.id) ?? [];
}

function computeTodoScore(
  task: TodoTask,
  listName: string,
  includeMetadata: boolean,
  searchTerms: string[]
): number {
  if (searchTerms.length === 0) {
    return 0;
  }

  const titleScore = scoreMatches(task.title ?? '', searchTerms) * 4;
  const bodyScore = scoreMatches(task.body?.content ?? '', searchTerms) * 3;
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
  const { task, listName } = candidate;
  const body = task.body?.content?.trim() ?? '';
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
      wellknownListName: undefined,
      status: task.status,
      importance: task.importance,
      categories: task.categories ?? []
    }
  };
}

function getFallbackListName(list: TodoTaskList): string {
  return list.wellknownListName?.trim() || 'Task list';
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
