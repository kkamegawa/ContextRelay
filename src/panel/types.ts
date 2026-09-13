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

export interface AttachFilesMessage {
  command: 'attachFiles';
  /** text/uri-list entries from a drag-and-drop onto the input area. */
  uris: string[];
}

export interface AttachFilePickerMessage {
  command: 'attachFilePicker';
}

export interface RemoveAttachmentMessage {
  command: 'removeAttachment';
  absolutePath: string;
}

export interface CancelAssistantMessage {
  command: 'cancelAssistantMessage';
}

export type WebviewToHostMessage =
  | SubmitQueryMessage
  | WebviewReadyMessage
  | PinSnippetMessage
  | OpenLinkMessage
  | OpenItemMessage
  | CopySnippetMessage
  | ApplyAssistantResultMessage
  | AttachFilesMessage
  | AttachFilePickerMessage
  | RemoveAttachmentMessage
  | CancelAssistantMessage;

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

export interface WorkspaceFilesMessage {
  command: 'workspaceFiles';
  files: string[];
}

export interface AttachmentSummary {
  absolutePath: string;
  relativePath: string;
  origin: 'mention' | 'drop' | 'picker' | 'activeEditor';
}

export interface AttachmentsChangedMessage {
  command: 'attachmentsChanged';
  attachments: AttachmentSummary[];
}

/** Sent once when a streamed Copilot reply starts, before any progress text exists. */
export interface AssistantMessageStartMessage {
  command: 'assistantMessageStart';
  id: string;
  timestamp: string;
}

/**
 * Sent as a streamed reply grows. `text` is the cumulative reply so far
 * (not a delta) since the Chat API's streamed frames each carry the full
 * conversation snapshot — renderers should replace, not append.
 */
export interface AssistantMessageProgressMessage {
  command: 'assistantMessageProgress';
  id: string;
  text: string;
}

/** Sent once a streamed reply finishes (or falls back to the synchronous endpoint). */
export interface AssistantMessageEndMessage {
  command: 'assistantMessageEnd';
  id: string;
  text: string;
  timestamp: string;
  kind?: 'info' | 'ask' | 'chat';
  contextLabels?: string[];
}

export type HostToWebviewMessage =
  | UserMessageDisplay
  | QueryResultMessage
  | QueryErrorMessage
  | LoadingMessage
  | SlashHelpMessage
  | ClearChatMessage
  | AssistantMessage
  | PinnedItemsMessage
  | WorkspaceFilesMessage
  | AttachmentsChangedMessage
  | AssistantMessageStartMessage
  | AssistantMessageProgressMessage
  | AssistantMessageEndMessage;
