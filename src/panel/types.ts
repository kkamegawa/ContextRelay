/**
 * Message protocol between Extension host and Webview.
 * Follows the same pattern as vscode-copilot-chat's baseSuggestionsPanel.ts.
 */

import type { ContextItem, ContextSource } from '../models/contextItem';

export type { ContextItem, ContextSource };

// --- Context sources ---

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

export interface OpenItemMessage {
  command: 'openItem';
  item: ContextItem;
}

export interface CopySnippetMessage {
  command: 'copySnippet';
  text: string;
}

export interface ApplyAssistantResultMessage {
  command: 'applyAssistantResult';
  action: 'copy' | 'append' | 'replace';
  text: string;
}

export type WebviewToHostMessage =
  | SubmitQueryMessage
  | WebviewReadyMessage
  | PinSnippetMessage
  | OpenLinkMessage
  | OpenItemMessage
  | CopySnippetMessage
  | ApplyAssistantResultMessage;

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
  text?: string;
  icon?: string;
}

export interface SlashHelpMessage {
  command: 'slashHelp';
  commandName: string;
  examples: string[];
}

export interface ClearChatMessage {
  command: 'clearChat';
}

export interface AssistantMessage {
  command: 'assistantMessage';
  text: string;
  timestamp: string;
  kind?: 'info' | 'ask' | 'chat';
  contextLabels?: string[];
}

export interface PinnedItemsMessage {
  command: 'pinnedItems';
  keys: string[];
}

export type HostToWebviewMessage =
  | UserMessageDisplay
  | QueryResultMessage
  | QueryErrorMessage
  | LoadingMessage
  | SlashHelpMessage
  | ClearChatMessage
  | AssistantMessage
  | PinnedItemsMessage;
