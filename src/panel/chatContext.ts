import * as fs from 'fs/promises';
import { normalizeExtractedText } from '../textExtraction';
import type { CopilotContextMessage, CopilotContextualResources, SendMessageOptions } from '../adapters/chatAdapter';
import type { SavedSnippet } from '../models/contextItem';
import type { ResolvedAttachment } from './attachments';

export const MAX_CHAT_CONTEXT_CHARS = 60_000;
export const MAX_LOCAL_FILE_CHARS = 12_000;

export interface ChatContextPayload extends SendMessageOptions {
  labels: string[];
}

export interface ChatContextOptions {
  snippets: SavedSnippet[];
  searchSummary?: string;
  visibleResult?: string;
  /** Explicitly attached local files — # mentions, drag-and-drop, the attach picker, or the active editor. */
  attachments?: readonly ResolvedAttachment[];
  /**
   * Whether to include ContextRelay's own accumulated context (pinned
   * snippets, the latest visible result, the latest search summary) in
   * addition to explicit attachments. `/ask` sets this to `true`; plain
   * chat sets it to `false` so a bare message doesn't silently drag in
   * unrelated panel state.
   */
  includeContextRelayContext: boolean;
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
 * message budget).
 */
function pushContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  description: string,
  text: string,
  cap: number,
  remainingBudget: { value: number }
): void {
  const trimmed = text.trim();
  if (!trimmed || cap <= 0) {
    return;
  }

  const truncated = truncateToBudget(trimmed, cap);
  if (!truncated.trim()) {
    return;
  }

  additionalContext.push({ description, text: truncated });
  labels.push(description);
  remainingBudget.value -= truncated.length;
}

function addTextContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  description: string,
  text: string,
  remainingBudget: { value: number }
): void {
  pushContext(additionalContext, labels, description, text, remainingBudget.value, remainingBudget);
}

function sliceSelectedLines(content: string, selection: { startLine: number; endLine: number }): string {
  const lines = content.split(/\r\n|\n/);
  const start = Math.max(0, selection.startLine - 1);
  const end = Math.min(lines.length, selection.endLine);
  return lines.slice(start, end).join('\n');
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
 * and inlined as text here instead.
 */
async function addLocalFileContext(
  additionalContext: CopilotContextMessage[],
  labels: string[],
  attachment: ResolvedAttachment,
  remainingBudget: { value: number }
): Promise<void> {
  if (remainingBudget.value <= 0) {
    return;
  }

  let raw: string;
  try {
    raw = await fs.readFile(attachment.absolutePath, 'utf8');
  } catch {
    // The file may have been moved or deleted between attachment and send; skip it rather than fail the whole request.
    return;
  }

  const selected = attachment.selection ? sliceSelectedLines(raw, attachment.selection) : raw;
  const normalized = normalizeExtractedText(selected || '(empty file)');
  const cap = Math.min(MAX_LOCAL_FILE_CHARS, remainingBudget.value);
  pushContext(additionalContext, labels, describeAttachment(attachment), normalized, cap, remainingBudget);
}

export async function buildChatContextPayload(options: ChatContextOptions): Promise<ChatContextPayload> {
  const additionalContext: CopilotContextMessage[] = [];
  const contextualResources: CopilotContextualResources = {};
  const files: { uri: string }[] = [];
  const seenFileUris = new Set<string>();
  const labels: string[] = [];
  const remainingBudget = { value: MAX_CHAT_CONTEXT_CHARS };

  // Explicit attachments come first regardless of includeContextRelayContext —
  // attaching a file is always an explicit user action, not implicit panel state.
  for (const attachment of options.attachments ?? []) {
    await addLocalFileContext(additionalContext, labels, attachment, remainingBudget);
  }

  if (options.includeContextRelayContext) {
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
  }

  if (files.length > 0) {
    contextualResources.files = files;
  }

  return {
    ...(additionalContext.length > 0 ? { additionalContext } : {}),
    ...(contextualResources.files && contextualResources.files.length > 0 ? { contextualResources } : {}),
    labels
  };
}
