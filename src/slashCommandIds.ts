/**
 * Canonical list of slash command IDs available in the ContextRelay slash menu.
 * Kept as a pure data constant (no DOM dependencies) so it can be imported in
 * both the webview (slashMenu.ts) and Node-based tests.
 */
export const SLASH_COMMAND_IDS: readonly string[] = [
  '/mail',
  '/teams',
  '/sharepoint',
  '/onedrive',
  '/onenote',
  '/task',
  '/all',
  '/ask',
  '/workiq',
  '/clear',
];
