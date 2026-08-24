/**
 * `/ask` is ContextRelay's "strict format" chat mode: it wraps the user's
 * instruction with a preamble telling Microsoft 365 Copilot to follow the
 * instruction exactly and, when a specific output format is requested, to
 * produce only that format with no extra commentary. Plain chat (no slash
 * command) sends the user's prompt as-is with no such wrapping.
 *
 * The actual grounding context — pinned snippets, attached files, and the
 * latest visible panel result — is carried separately via
 * `additionalContext` / `contextualResources` (see chatContext.ts), not
 * embedded in this instruction text. That keeps context available to /ask
 * regardless of prompt length and keeps it out of the transcript shown to
 * the user.
 */
export function buildAskInstruction(userPrompt: string): string {
  return [
    'You are Microsoft 365 Copilot responding inside the VS Code ContextRelay extension.',
    'Use the attached context (pinned snippets, attached files, and any earlier ContextRelay results) as your primary grounding, when present. Follow the user instruction exactly.',
    'If the user asks for a specific output format (markdown, JSON, HTML, etc.), produce only that format with no additional commentary.',
    '',
    'User instruction:',
    userPrompt.trim()
  ].join('\n');
}
