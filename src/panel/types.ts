/**
 * Message protocol between Extension host and Webview.
 * Follows the same pattern as vscode-copilot-chat's baseSuggestionsPanel.ts.
 */

// --- Context sources ---

export type ContextSource = 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'connectors';

// --- Slash commands ---

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: string;
  source?: ContextSource | 'all';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/mail', label: '/mail', description: 'Search Exchange mail', icon: '📧', source: 'mail' },
  { command: '/teams', label: '/teams', description: 'Search Teams messages', icon: '💬', source: 'teams' },
  { command: '/sharepoint', label: '/sharepoint', description: 'Search SharePoint', icon: '📄', source: 'sharepoint' },
  { command: '/onedrive', label: '/onedrive', description: 'Search OneDrive', icon: '☁️', source: 'onedrive' },
  { command: '/all', label: '/all', description: 'Search all sources', icon: '🔍', source: 'all' },
];

// --- Unified result model (from plan.md Section 8) ---

export interface ContextItem {
  source: ContextSource;
  title: string;
  snippet: string;
  url?: string;
  timestamp?: string;
  relevance?: number;
  cache: {
    hit: boolean;
    storedAt?: string;
    ttlSeconds?: number;
  };
}

// --- Messages: Webview → Extension host ---

export interface SubmitQueryMessage {
  command: 'submitQuery';
  text: string;
}

export interface WebviewReadyMessage {
  command: 'webviewReady';
}

export interface PinSnippetMessage {
  command: 'pinSnippet';
  item: ContextItem;
}

export interface OpenLinkMessage {
  command: 'openLink';
  url: string;
}

export interface CopySnippetMessage {
  command: 'copySnippet';
  text: string;
}

export type WebviewToHostMessage =
  | SubmitQueryMessage
  | WebviewReadyMessage
  | PinSnippetMessage
  | OpenLinkMessage
  | CopySnippetMessage;

// --- Messages: Extension host → Webview ---

export interface UserMessageDisplay {
  command: 'userMessage';
  text: string;
  timestamp: string;
}

export interface QueryResultMessage {
  command: 'queryResult';
  items: ContextItem[];
  source: ContextSource | 'all';
  query: string;
  timestamp: string;
}

export interface QueryErrorMessage {
  command: 'queryError';
  source: ContextSource | 'all';
  message: string;
  timestamp: string;
}

export interface LoadingMessage {
  command: 'loading';
  source: ContextSource | 'all';
  isLoading: boolean;
}

export interface SlashHelpMessage {
  command: 'slashHelp';
  commandName: string;
  examples: string[];
}

export interface ClearChatMessage {
  command: 'clearChat';
}

export type HostToWebviewMessage =
  | UserMessageDisplay
  | QueryResultMessage
  | QueryErrorMessage
  | LoadingMessage
  | SlashHelpMessage
  | ClearChatMessage;
