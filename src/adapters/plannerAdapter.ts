import * as vscode from 'vscode';
import { ContextItem } from '../models/contextItem';
import { graphFetchWithRetry, handleGraphResponse, GRAPH_BASE } from './graphClient';
import { parseQueryIntent, scoreMatches } from './queryIntent';

interface PlannerTask {
  id?: string;
  title?: string;
  planId?: string;
  bucketId?: string;
  conversationThreadId?: string;
  percentComplete?: number;
  hasDescription?: boolean;
  createdDateTime?: string;
  dueDateTime?: string;
}

interface PlannerTaskResponse {
  value?: PlannerTask[];
}

interface PlannerChecklistItem {
  title?: string;
}

interface PlannerTaskDetails {
  description?: string;
  checklist?: Record<string, PlannerChecklistItem>;
}

interface PlannerPlan {
  id?: string;
  title?: string;
}

interface PlannerBucket {
  id?: string;
  name?: string;
}

interface PlannerCandidate {
  task: PlannerTask;
  description: string;
  checklistTitles: string[];
  planTitle?: string;
  bucketName?: string;
  score: number;
}

export async function searchPlanner(token: string, query: string): Promise<ContextItem[]> {
  const config = vscode.workspace.getConfiguration('contextRelay');
  const maxResults = config.get<number>('maxResults', 10);
  const scanLimit = Math.min(Math.max(maxResults * 4, maxResults), 40);
  const intent = parseQueryIntent(query);
  const tasks = await listAssignedTasks(token, scanLimit);
  const detailsMap = await resolveTaskDetails(token, tasks, intent.includePlannerMetadata || intent.includePlannerComments);
  const planTitles = intent.includePlannerMetadata ? await resolvePlanTitles(token, tasks) : new Map<string, string>();
  const bucketNames = intent.includePlannerMetadata ? await resolveBucketNames(token, tasks) : new Map<string, string>();

  const candidates = tasks.map(task => {
    const details = task.id ? detailsMap.get(task.id) : undefined;
    const description = details?.description?.trim() ?? '';
    const checklistTitles = extractChecklistTitles(details);
    const planTitle = task.planId ? planTitles.get(task.planId) : undefined;
    const bucketName = task.bucketId ? bucketNames.get(task.bucketId) : undefined;
    const score = computePlannerScore(task, description, checklistTitles, planTitle, bucketName, intent.searchTerms, intent.includePlannerMetadata);
    return { task, description, checklistTitles, planTitle, bucketName, score };
  });

  return candidates
    .filter(candidate => intent.searchTerms.length === 0 || candidate.score > 0)
    .sort((left, right) => comparePlannerCandidates(left, right))
    .slice(0, maxResults)
    .map(candidate => mapPlannerCandidate(candidate, intent.includePlannerMetadata, intent.includePlannerComments));
}

async function listAssignedTasks(token: string, scanLimit: number): Promise<PlannerTask[]> {
  const url = `${GRAPH_BASE}/v1.0/me/planner/tasks?$top=${scanLimit}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  const data = await handleGraphResponse(response) as PlannerTaskResponse;
  return data.value?.filter(task => task.id) ?? [];
}

async function resolveTaskDetails(
  token: string,
  tasks: PlannerTask[],
  includeChecklist: boolean
): Promise<Map<string, PlannerTaskDetails>> {
  const detailTaskIds = tasks
    .filter(task => task.id && (task.hasDescription || includeChecklist))
    .map(task => task.id as string);

  const settled = await Promise.allSettled(
    detailTaskIds.map(taskId => fetchTaskDetails(token, taskId))
  );

  const detailsMap = new Map<string, PlannerTaskDetails>();
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      detailsMap.set(detailTaskIds[index], result.value);
    }
  });

  return detailsMap;
}

async function fetchTaskDetails(token: string, taskId: string): Promise<PlannerTaskDetails> {
  const url = `${GRAPH_BASE}/v1.0/planner/tasks/${encodeURIComponent(taskId)}/details`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  return await handleGraphResponse(response) as PlannerTaskDetails;
}

async function resolvePlanTitles(token: string, tasks: PlannerTask[]): Promise<Map<string, string>> {
  const planIds = uniqueIds(tasks.map(task => task.planId));
  const settled = await Promise.allSettled(planIds.map(planId => fetchPlannerPlan(token, planId)));
  const plans = new Map<string, string>();

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.title?.trim()) {
      plans.set(planIds[index], result.value.title.trim());
    }
  });

  return plans;
}

async function fetchPlannerPlan(token: string, planId: string): Promise<PlannerPlan> {
  const url = `${GRAPH_BASE}/v1.0/planner/plans/${encodeURIComponent(planId)}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  return await handleGraphResponse(response) as PlannerPlan;
}

async function resolveBucketNames(token: string, tasks: PlannerTask[]): Promise<Map<string, string>> {
  const bucketIds = uniqueIds(tasks.map(task => task.bucketId));
  const settled = await Promise.allSettled(bucketIds.map(bucketId => fetchPlannerBucket(token, bucketId)));
  const buckets = new Map<string, string>();

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.name?.trim()) {
      buckets.set(bucketIds[index], result.value.name.trim());
    }
  });

  return buckets;
}

async function fetchPlannerBucket(token: string, bucketId: string): Promise<PlannerBucket> {
  const url = `${GRAPH_BASE}/v1.0/planner/buckets/${encodeURIComponent(bucketId)}`;
  const response = await graphFetchWithRetry(url, token, { method: 'GET' });
  return await handleGraphResponse(response) as PlannerBucket;
}

function uniqueIds(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function extractChecklistTitles(details?: PlannerTaskDetails): string[] {
  return Object.values(details?.checklist ?? {})
    .map(item => item.title?.trim() ?? '')
    .filter(Boolean);
}

function computePlannerScore(
  task: PlannerTask,
  description: string,
  checklistTitles: string[],
  planTitle: string | undefined,
  bucketName: string | undefined,
  searchTerms: string[],
  includeMetadata: boolean
): number {
  if (searchTerms.length === 0) {
    return 0;
  }

  const titleScore = scoreMatches(task.title ?? '', searchTerms) * 4;
  const descriptionScore = scoreMatches(description, searchTerms) * 3;
  const metadataScore = includeMetadata
    ? (
      scoreMatches(planTitle ?? '', searchTerms) +
      scoreMatches(bucketName ?? '', searchTerms) +
      scoreMatches(checklistTitles.join(' '), searchTerms)
    ) * 2
    : 0;

  return titleScore + descriptionScore + metadataScore;
}

function comparePlannerCandidates(left: PlannerCandidate, right: PlannerCandidate): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return compareIsoTimestamps(
    left.task.dueDateTime ?? left.task.createdDateTime,
    right.task.dueDateTime ?? right.task.createdDateTime
  );
}

function mapPlannerCandidate(
  candidate: PlannerCandidate,
  includeMetadata: boolean,
  includeComments: boolean
): ContextItem {
  const { task, description, checklistTitles, planTitle, bucketName } = candidate;
  const snippetParts = [description || 'No task description available.'];

  if (includeMetadata) {
    const metadataParts = [
      planTitle ? `Plan: ${planTitle}` : undefined,
      bucketName ? `Bucket: ${bucketName}` : undefined,
      typeof task.percentComplete === 'number' ? `Progress: ${task.percentComplete}%` : undefined,
      task.dueDateTime ? `Due: ${new Date(task.dueDateTime).toLocaleDateString('en-US')}` : undefined
    ].filter(Boolean);

    if (metadataParts.length > 0) {
      snippetParts.push(metadataParts.join(' · '));
    }

    if (checklistTitles.length > 0) {
      snippetParts.push(`Checklist: ${checklistTitles.join('; ')}`);
    }
  }

  if (includeComments) {
    snippetParts.push(
      task.conversationThreadId
        ? 'Comments were requested, but Planner task comments need additional Microsoft 365 group conversation permissions beyond the current Tasks.Read search path.'
        : 'Comments were requested, but this task does not expose a conversation thread in the current Planner response.'
    );
  }

  return {
    source: 'planner',
    title: task.title?.trim() || 'Untitled task',
    snippet: snippetParts.filter(Boolean).join('\n'),
    timestamp: task.dueDateTime ?? task.createdDateTime,
    cache: { hit: false },
    raw: {
      description,
      checklistTitles,
      planId: task.planId,
      planTitle,
      bucketId: task.bucketId,
      bucketName,
      percentComplete: task.percentComplete,
      conversationThreadId: task.conversationThreadId
    }
  };
}

function compareIsoTimestamps(left?: string, right?: string): number {
  return (Date.parse(right ?? '') || 0) - (Date.parse(left ?? '') || 0);
}
