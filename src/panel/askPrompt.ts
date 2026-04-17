import type { SavedSnippet } from '../models/contextItem';

// Upper bound on the combined pinned context we send to Microsoft 365 Copilot.
// Prevents a runaway prompt when many large documents are pinned.
export const MAX_ASK_CONTEXT_CHARS = 60_000;

function truncateToBudget(body: string, budget: number): string {
  if (budget <= 0) {
    return '';
  }

  if (body.length <= budget) {
    return body;
  }

  for (let prefixLength = Math.min(body.length, budget); prefixLength > 0; prefixLength--) {
    const omittedChars = body.length - prefixLength;
    const suffix = `\n…[truncated ${omittedChars} chars]`;
    if (prefixLength + suffix.length <= budget) {
      return `${body.slice(0, prefixLength)}${suffix}`;
    }
  }

  // Budget is too small to fit both a prefix and the truncation suffix.
  // Return the marker (possibly itself truncated) so the caller always knows
  // content was omitted rather than silently returning raw untagged content.
  const markerOnly = `\n…[truncated ${body.length} chars]`;
  if (markerOnly.length <= budget) {
    return markerOnly;
  }

  return markerOnly.slice(0, budget);
}

/**
 * Build the full prompt sent to Microsoft 365 Copilot for /ask.
 *
 * Combines the user's instruction with the pinned snippets (already hydrated
 * with full document content where possible). The combined pinned context is
 * capped by MAX_ASK_CONTEXT_CHARS so a large number of snippets cannot cause
 * the prompt to grow without bound.
 */
export function buildAskPrompt(userPrompt: string, snippets: SavedSnippet[]): string {
  const contextBlocks: string[] = [];
  let remainingContextBudget = MAX_ASK_CONTEXT_CHARS;

  for (let i = 0; i < snippets.length && remainingContextBudget > 0; i++) {
    const snippet = snippets[i];
    const item = snippet.item;
    const body = (item.snippet ?? '').trim();
    const header = [
      `### Pinned document ${i + 1}: ${snippet.name || item.title}`,
      `Source: ${item.source}${item.url ? ` — ${item.url}` : ''}`
    ].join('\n');

    const separator = contextBlocks.length > 0 ? '\n\n' : '';
    const blockPrefix = `${header}\n\n`;
    const fixedCost = separator.length + blockPrefix.length;

    if (fixedCost >= remainingContextBudget) {
      break;
    }

    const truncated = truncateToBudget(body, remainingContextBudget - fixedCost);
    const block = `${separator}${blockPrefix}${truncated}`;
    contextBlocks.push(block);
    remainingContextBudget -= block.length;
  }

  return [
    'You are Microsoft 365 Copilot responding inside the VS Code ContextRelay extension.',
    'Use the pinned documents below as the primary context. Follow the user instruction exactly.',
    'If the user asks for a specific output format (markdown, JSON, HTML, etc.), produce only that format with no additional commentary.',
    '',
    '--- Pinned context ---',
    contextBlocks.join(''),
    '--- End of pinned context ---',
    '',
    'User instruction:',
    userPrompt.trim()
  ].join('\n');
}
