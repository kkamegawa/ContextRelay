import type { CopilotContextMessage, CopilotContextualResources, SendMessageOptions } from '../adapters/chatAdapter';
import type { SavedSnippet } from '../models/contextItem';
import { normalizeExtractedText } from '../textExtraction';
import type { ResolvedAttachment } from './attachments';
import { readValidatedWorkspaceFile } from './workspacePath';

export const MAX_CHAT_CONTEXT_CHARS = 60_000;
export const MAX_LOCAL_FILE_CHARS = 12_000;

/** Prefix that marks a context label as coming from a pinned snippet. */
export const PINNED_LABEL_PREFIX = '📌 ';

/**
 * Instruction prepended to the prompt whenever the request carries explicit
 * ContextRelay grounding (pinned snippets or attached local files). The Copilot
 * Chat API treats `additionalContext` as *extra* grounding and keeps using web
 * and enterprise search, so without this instruction the attached context can
 * be ignored in favor of unrelated sources.
 */
export const GROUNDING_INSTRUCTION = [
  '[ContextRelay grounding]',
  'Use the attached context (pinned ContextRelay snippets and attached local files) as the',
  'primary and authoritative source. Prefer it over web results and enterprise search. If the',
  'attached context does not answer the request, say so explicitly before using other sources.'
].join('\n');

export interface ChatContextPayload extends SendMessageOptions {
  labels: string[];
  /** True when pinned snippets or attached local files were actually included. */
  hasGroundingContext: boolean;
}

export interface ChatContextOptions {
  snippets: SavedSnippet[];
  searchSummary?: string;
  /** Explicitly attached local files — # mentions, drag-and-drop, the attach picker, or the active editor. */
  attachments?: readonly ResolvedAttachment[];
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

/**
 * Push a description/text pair onto `additionalContext`, truncating to `cap`
 * and spending from the shared `remainingBudget`. `cap` may be smaller than
 * `remainingBudget.value` (e.g. a per-file cap on top of the overall
 * message budget). Returns whether anything was added.
 */
function pushContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  description: string,
  text: string,
  cap: number,
  remainingBudget: { value: number }
): boolean {
  const trimmed = text.trim();
  if (!trimmed || cap <= 0) {
    return false;
  }

  const truncated = truncateToBudget(trimmed, cap);
  if (!truncated.trim()) {
    return false;
  }

  additionalContext.push({ description, text: truncated });
  labels.push(description);
  remainingBudget.value -= truncated.length;
  return true;
}

function addTextContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  description: string,
  text: string,
  remainingBudget: { value: number }
): boolean {
  return pushContext(additionalContext, labels, description, text, remainingBudget.value, remainingBudget);
}

function describeAttachment(attachment: ResolvedAttachment): string {
  return attachment.selection
    ? `Local file: ${attachment.relativePath} (L${attachment.selection.startLine}-L${attachment.selection.endLine})`
    : `Local file: ${attachment.relativePath}`;
}

/**
 * Read an attached local file's content (or the selected line range) and add
 * it to `additionalContext`. Unlike SharePoint/OneDrive files, local files
 * cannot be passed by reference in `contextualResources.files` — that field
 * is documented as OneDrive/SharePoint URIs only — so the content is read
 * and inlined as text here instead. Returns whether anything was added.
 */
async function addLocalFileContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  attachment: ResolvedAttachment,
  remainingBudget: { value: number }
): Promise<boolean> {
  if (remainingBudget.value <= 0) {
    return false;
  }

  // Re-validate at read time and read at most the per-file cap: the path was
  // checked when the file was attached, but it may since have been moved,
  // deleted, or swapped for a symlink that points outside the workspace.
  // Such a file is skipped rather than failing the whole request.
  const read = await readValidatedWorkspaceFile(
    attachment.absolutePath,
    attachment.workspaceRoot,
    MAX_LOCAL_FILE_CHARS,
    attachment.selection
  );
  if (!read) {
    return false;
  }

  const normalized = normalizeExtractedText(read.text || '(empty file)');
  const cap = Math.min(MAX_LOCAL_FILE_CHARS, remainingBudget.value);
  const body = read.truncated && normalized.length <= cap ? `${normalized}\n[truncated]` : normalized;
  return pushContext(additionalContext, labels, describeAttachment(attachment), body, cap, remainingBudget);
}

export async function buildChatContextPayload(options: ChatContextOptions): Promise<ChatContextPayload> {
  const additionalContext: CopilotContextMessage[] = [];
  const contextualResources: CopilotContextualResources = {};
  const files: { uri: string }[] = [];
  const seenFileUris = new Set<string>();
  const labels: string[] = [];
  const remainingBudget = { value: MAX_CHAT_CONTEXT_CHARS };
  let hasGroundingContext = false;

  // Explicit attachments come first — attaching a file is always a deliberate
  // user action, so it gets the budget before pinned snippets.
  for (const attachment of options.attachments ?? []) {
    if (await addLocalFileContext(additionalContext, labels, attachment, remainingBudget)) {
      hasGroundingContext = true;
    }
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
    // attached ContextRelay context (pins / attached files) plus enterprise
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
 * request carries pinned snippets or attached local files. Leaves the prompt
 * untouched otherwise, and never affects the raw prompt used for the
 * user-facing transcript or output-language detection.
 */
export function buildGroundedPrompt(prompt: string, payload: Pick<ChatContextPayload, 'hasGroundingContext'>): string {
  if (!payload.hasGroundingContext) {
    return prompt;
  }

  return `${GROUNDING_INSTRUCTION}\n\n[User request]\n${prompt}`;
}
