import type { CopilotContextMessage, CopilotContextualResources, SendMessageOptions } from '../adapters/chatAdapter';
import type { SavedSnippet } from '../models/contextItem';

export const MAX_CHAT_CONTEXT_CHARS = 60_000;

/** Prefix that marks a context label as coming from a pinned snippet. */
export const PINNED_LABEL_PREFIX = '📌 ';

/**
 * Instruction prepended to the prompt whenever the request carries explicit
 * ContextRelay grounding (pinned snippets or `#` file mentions). The Copilot
 * Chat API treats `additionalContext` as *extra* grounding and keeps using web
 * and enterprise search, so without this instruction the attached context can
 * be ignored in favor of unrelated sources.
 */
export const GROUNDING_INSTRUCTION = [
  '[ContextRelay grounding]',
  'Use the attached context (pinned ContextRelay snippets and mentioned local files) as the',
  'primary and authoritative source. Prefer it over web results and enterprise search. If the',
  'attached context does not answer the request, say so explicitly before using other sources.'
].join('\n');

export interface ChatContextPayload extends SendMessageOptions {
  labels: string[];
  /** True when pinned snippets or mentioned local files were attached. */
  hasGroundingContext: boolean;
}

export interface ChatContextOptions {
  snippets: SavedSnippet[];
  searchSummary?: string;
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
): boolean {
  const trimmed = text.trim();
  if (!trimmed || remainingBudget.value <= 0) {
    return false;
  }

  const truncated = truncateToBudget(trimmed, remainingBudget.value);
  if (!truncated.trim()) {
    return false;
  }

  additionalContext.push({ description, text: truncated });
  labels.push(description);
  remainingBudget.value -= truncated.length;
  return true;
}

export function buildChatContextPayload(options: ChatContextOptions): ChatContextPayload {
  const additionalContext: CopilotContextMessage[] = [];
  const contextualResources: CopilotContextualResources = {};
  const files: { uri: string }[] = [];
  const seenFileUris = new Set<string>();
  const labels: string[] = [];
  const remainingBudget = { value: MAX_CHAT_CONTEXT_CHARS };
  let hasGroundingContext = false;

  for (const file of options.localFiles ?? []) {
    const uri = file.uri.trim();
    if (!uri || seenFileUris.has(uri)) {
      continue;
    }

    seenFileUris.add(uri);
    files.push({ uri });
    labels.push(file.label);
    hasGroundingContext = true;
  }

  for (const snippet of options.snippets) {
    if (isFileContextSnippet(snippet) && snippet.item.url) {
      const uri = snippet.item.url.trim();
      if (!uri || seenFileUris.has(uri)) {
        continue;
      }

      seenFileUris.add(uri);
      files.push({ uri });
      labels.push(`${PINNED_LABEL_PREFIX}${snippet.name || snippet.item.title}`);
      hasGroundingContext = true;
      continue;
    }

    const header = [
      `Title: ${snippet.name || snippet.item.title}`,
      `Source: ${snippet.item.source}${snippet.item.url ? ` (${snippet.item.url})` : ''}`
    ].join('\n');
    const added = addTextContext(
      additionalContext,
      labels,
      `${PINNED_LABEL_PREFIX}${snippet.name || snippet.item.title}`,
      `${header}\n\n${snippet.item.snippet}`,
      remainingBudget
    );
    if (added) {
      hasGroundingContext = true;
    }
  }

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

  if (hasGroundingContext) {
    // Turn off web search grounding for this turn so Copilot answers from the
    // attached ContextRelay context (pins / #file mentions) plus enterprise
    // search, instead of drifting to unrelated web results.
    contextualResources.webContext = { isWebEnabled: false };
  }

  return {
    ...(additionalContext.length > 0 ? { additionalContext } : {}),
    ...(Object.keys(contextualResources).length > 0 ? { contextualResources } : {}),
    labels,
    hasGroundingContext
  };
}

/**
 * Prefix the user's prompt with an explicit grounding instruction whenever the
 * request carries pinned snippets or `#` file mentions. Leaves the prompt
 * untouched otherwise, and never affects the raw prompt used for the
 * user-facing transcript or output-language detection.
 */
export function buildGroundedPrompt(prompt: string, payload: Pick<ChatContextPayload, 'hasGroundingContext'>): string {
  if (!payload.hasGroundingContext) {
    return prompt;
  }

  return `${GROUNDING_INSTRUCTION}\n\n[User request]\n${prompt}`;
}
