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
}

function truncateToBudget(value: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }

  if (value.length <= budget) {
    return value;
  }

  const suffix = `\n[truncated ${value.length - budget} chars]`;
  if (suffix.length >= budget) {
    return suffix.slice(0, budget);
  }

  return `${value.slice(0, budget - suffix.length)}${suffix}`;
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
  const labels: string[] = [];
  const remainingBudget = { value: MAX_CHAT_CONTEXT_CHARS };

  for (const snippet of options.snippets) {
    if (isFileContextSnippet(snippet) && snippet.item.url) {
      files.push({ uri: snippet.item.url });
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
