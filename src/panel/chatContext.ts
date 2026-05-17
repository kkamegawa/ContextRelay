import type { CopilotContextMessage, CopilotContextualResources, SendMessageOptions } from '../adapters/chatAdapter';
import type { SavedSnippet } from '../models/contextItem';

export const MAX_CHAT_CONTEXT_CHARS = 60_000;

export interface ChatContextPayload extends SendMessageOptions {
  labels: string[];
}

export interface ChatContextOptions {
  snippets: SavedSnippet[];
  searchSummary?: string;
  visibleResult?: string;
  localFiles?: { uri: string; label: string }[];
}

function buildTruncationSuffix(omittedChars: number): string {
  return `\n[truncated ${omittedChars} chars]`;
}

function truncateToBudget(value: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }

  if (value.length <= budget) {
    return value;
  }

  let suffix = buildTruncationSuffix(value.length);
  while (suffix.length < budget) {
    const prefixLength = budget - suffix.length;
    const nextSuffix = buildTruncationSuffix(value.length - prefixLength);
    if (nextSuffix === suffix) {
      return `${value.slice(0, prefixLength)}${suffix}`;
    }
    suffix = nextSuffix;
  }

  return suffix.slice(0, budget);
}

function isFileContextSnippet(snippet: SavedSnippet): boolean {
  return (snippet.item.source === 'sharepoint' || snippet.item.source === 'onedrive') &&
    /^https:\/\//i.test(snippet.item.url?.trim() ?? '');
}

function addTextContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  description: string,
  text: string,
  remainingBudget: { value: number }
): void {
  const trimmed = text.trim();
  if (!trimmed || remainingBudget.value <= 0) {
    return;
  }

  const truncated = truncateToBudget(trimmed, remainingBudget.value);
  if (!truncated.trim()) {
    return;
  }

  additionalContext.push({ description, text: truncated });
  labels.push(description);
  remainingBudget.value -= truncated.length;
}

export function buildChatContextPayload(options: ChatContextOptions): ChatContextPayload {
  const additionalContext: CopilotContextMessage[] = [];
  const contextualResources: CopilotContextualResources = {};
  const files: { uri: string }[] = [];
  const seenFileUris = new Set<string>();
  const labels: string[] = [];
  const remainingBudget = { value: MAX_CHAT_CONTEXT_CHARS };

  for (const file of options.localFiles ?? []) {
    const uri = file.uri.trim();
    if (!uri || seenFileUris.has(uri)) {
      continue;
    }

    seenFileUris.add(uri);
    files.push({ uri });
    labels.push(file.label);
  }

  for (const snippet of options.snippets) {
    if (isFileContextSnippet(snippet) && snippet.item.url) {
      const uri = snippet.item.url.trim();
      if (!uri || seenFileUris.has(uri)) {
        continue;
      }

      seenFileUris.add(uri);
      files.push({ uri });
      labels.push(snippet.name || snippet.item.title);
      continue;
    }

    const header = [
      `Title: ${snippet.name || snippet.item.title}`,
      `Source: ${snippet.item.source}${snippet.item.url ? ` (${snippet.item.url})` : ''}`
    ].join('\n');
    addTextContext(
      additionalContext,
      labels,
      snippet.name || snippet.item.title,
      `${header}\n\n${snippet.item.snippet}`,
      remainingBudget
    );
  }

  addTextContext(
    additionalContext,
    labels,
    'Latest visible ContextRelay result',
    options.visibleResult ?? '',
    remainingBudget
  );

  addTextContext(
    additionalContext,
    labels,
    'Latest ContextRelay search summary',
    options.searchSummary ?? '',
    remainingBudget
  );

  if (files.length > 0) {
    contextualResources.files = files;
  }

  return {
    ...(additionalContext.length > 0 ? { additionalContext } : {}),
    ...(contextualResources.files && contextualResources.files.length > 0 ? { contextualResources } : {}),
    labels
  };
}
