/**
 * Welcome block text for the ContextRelay chat panel.
 *
 * The welcome block is produced twice: the extension host renders it as static
 * HTML in the initial webview document, and the webview rebuilds it as DOM
 * nodes after `/clear`. Both read the text from here so the two renderings
 * cannot drift apart.
 *
 * This module must stay free of `vscode` imports so the webview bundle can use
 * it, following the same pattern as `sourcePresentation.ts`.
 */

/**
 * One piece of a welcome paragraph. `code: true` is rendered as inline code
 * (`<code>`) by both renderers.
 */
export interface WelcomeTextSegment {
  text: string;
  code?: boolean;
}

/** Heading shown at the top of the welcome block. */
export const CHAT_WELCOME_HEADING = 'ContextRelay';

/** Lead paragraph describing what the panel does. */
export const CHAT_WELCOME_INTRO: WelcomeTextSegment[] = [
  { text: 'Chat with Microsoft 365 Copilot, or search Microsoft 365 context with slash commands.' }
];

/** Hint about slash commands and `#` file mentions. */
export const CHAT_WELCOME_COMMANDS_HINT: WelcomeTextSegment[] = [
  { text: 'Type ' },
  { text: '/', code: true },
  { text: ' for source search commands, and combine them like ' },
  { text: '/mail /onedrive', code: true },
  { text: '. Use ' },
  { text: '#path/to/file', code: true },
  { text: ' (or ' },
  { text: '#"path with spaces"', code: true },
  { text: ') to attach local workspace files to Copilot and /workiq prompts.' }
];

/**
 * Hint about grounding. Plain chat attaches pinned snippets and attached files
 * automatically; `/ask` only adds the guard that requires them.
 */
export const CHAT_WELCOME_GROUNDING_HINT: WelcomeTextSegment[] = [
  { text: 'Pinned snippets and attached files (' },
  { text: '#file', code: true },
  { text: ', \u{1F4CE}, or drag & drop) are sent to Microsoft 365 Copilot as grounding context automatically. Use ' },
  { text: '/ask', code: true },
  { text: ' to require that context before sending.' }
];

/** Font size applied to both hint paragraphs. */
export const CHAT_WELCOME_HINT_FONT_SIZE = '0.8em';
