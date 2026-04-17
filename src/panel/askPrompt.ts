import type { SavedSnippet } from '../models/contextItem';

// Upper bound on the combined pinned context we send to Microsoft 365 Copilot.
// Prevents a runaway prompt when many large documents are pinned.
export const MAX_ASK_CONTEXT_CHARS = 60_000;

/**
 * Build the full prompt sent to Microsoft 365 Copilot for /ask.
 *
 * Combines the user's instruction with the pinned snippets (already hydrated
 * with full document content where possible). Individual snippets are
 * truncated to an equal share of the budget so a single large document
 * cannot crowd out the others.
 */
export function buildAskPrompt(userPrompt: string, snippets: SavedSnippet[]): string {
  const perSnippetBudget = Math.max(500, Math.floor(MAX_ASK_CONTEXT_CHARS / Math.max(1, snippets.length)));

  const contextBlocks: string[] = [];
  for (let i = 0; i < snippets.length; i++) {
    const snippet = snippets[i];
    const item = snippet.item;
    const body = (item.snippet ?? '').trim();
    const truncated = body.length > perSnippetBudget
      ? `${body.slice(0, perSnippetBudget)}\n…[truncated ${body.length - perSnippetBudget} chars]`
      : body;
    const header = [
      `### Pinned document ${i + 1}: ${snippet.name || item.title}`,
      `Source: ${item.source}${item.url ? ` — ${item.url}` : ''}`
    ].join('\n');
    contextBlocks.push(`${header}\n\n${truncated}`);
  }

  return [
    'You are Microsoft 365 Copilot responding inside the VS Code ContextRelay extension.',
    'Use the pinned documents below as the primary context. Follow the user instruction exactly.',
    'If the user asks for a specific output format (markdown, JSON, HTML, etc.), produce only that format with no additional commentary.',
    '',
    '--- Pinned context ---',
    contextBlocks.join('\n\n'),
    '--- End of pinned context ---',
    '',
    'User instruction:',
    userPrompt.trim()
  ].join('\n');
}
