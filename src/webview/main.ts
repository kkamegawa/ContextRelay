/**
 * Webview entry point for the ContextRelay chat panel.
 *
 * Follows the same pattern as vscode-copilot-chat's suggestionsPanelWebview.ts:
 * - acquireVsCodeApi() for message passing
 * - DOMContentLoaded for initialization
 * - window.addEventListener('message') for host→webview messages
 */

import { SlashMenu } from './slashMenu';
import { ChatRenderer } from './chatRenderer';

// Acquire the VS Code API (available in webview context)
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// --- DOM elements ---
const chatArea = document.getElementById('chatArea')!;
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
const slashMenuEl = document.getElementById('slashMenu')!;

// --- Modules ---
const renderer = new ChatRenderer(chatArea, vscode);
const activeLoadingKeys = new Set<string>();
let hasPendingSubmission = false;

const slashMenu = new SlashMenu(slashMenuEl, promptInput, (nextValue: string) => {
  promptInput.value = nextValue;
  promptInput.focus();
  slashMenu.hide();
});

// --- Input handling ---

function submitQuery(): void {
  if (sendButton.disabled || promptInput.disabled) {
    return;
  }

  const text = promptInput.value.trim();
  if (!text) {
    return;
  }

  hasPendingSubmission = true;
  syncPromptBusy();
  vscode.postMessage({ command: 'submitQuery', text });
  promptInput.value = '';
  autoResizeInput();
  slashMenu.hide();
}

function autoResizeInput(): void {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
}

function setPromptBusy(isBusy: boolean): void {
  promptInput.disabled = isBusy;
  sendButton.disabled = isBusy;
  promptInput.setAttribute('aria-disabled', String(isBusy));
  sendButton.setAttribute('aria-disabled', String(isBusy));
}

function syncPromptBusy(): void {
  setPromptBusy(hasPendingSubmission || activeLoadingKeys.size > 0);
}

function clearPendingSubmission(): void {
  hasPendingSubmission = false;
  syncPromptBusy();
}

// --- Event listeners ---

// Send button click
sendButton.addEventListener('click', submitQuery);

// Keyboard handling
promptInput.addEventListener('keydown', (e) => {
  // Guard against IME composition (Japanese/Chinese/Korean input)
  if (e.isComposing || e.keyCode === 229) {
    return;
  }

  // Let slash menu handle navigation keys first
  if (slashMenu.handleKeyDown(e)) {
    return;
  }

  // Enter to send (without Shift)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitQuery();
    return;
  }
});

// Input changes — update slash menu and auto-resize
promptInput.addEventListener('input', () => {
  autoResizeInput();
  slashMenu.update(promptInput.value);
});

// Close slash menu when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!slashMenuEl.contains(target) && target !== promptInput) {
    slashMenu.hide();
  }
});

// --- Handle messages from extension host ---

interface HostMessage {
  command: string;
  [key: string]: unknown;
}

interface ContextItem {
  source: 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'onenote' | 'planner' | 'todo' | 'connectors';
  title: string;
  snippet: string;
  url?: string;
  timestamp?: string;
  relevance?: number;
  cache: { hit: boolean; storedAt?: string; ttlSeconds?: number };
  raw?: unknown;
}

window.addEventListener('message', (event) => {
  const message = event.data as HostMessage;

  switch (message.command) {
    case 'userMessage':
      renderer.renderUserMessage(
        message.text as string,
        message.timestamp as string
      );
      break;

    case 'queryResult':
      renderer.renderQueryResult(
        message.items as ContextItem[],
        message.source as string,
        message.query as string,
        message.timestamp as string
      );
      break;

    case 'queryError':
      clearPendingSubmission();
      renderer.renderError(
        message.source as string,
        message.message as string,
        message.timestamp as string
      );
      break;

    case 'loading':
      if (message.isLoading) {
        hasPendingSubmission = false;
        activeLoadingKeys.add(message.source as string);
      } else {
        activeLoadingKeys.delete(message.source as string);
      }
      syncPromptBusy();
      renderer.setLoading(
        message.source as string,
        message.isLoading as boolean,
        message.text as string | undefined,
        message.icon as string | undefined
      );
      break;

    case 'slashHelp':
      clearPendingSubmission();
      renderer.renderSlashHelp(
        message.commandName as string,
        message.examples as string[]
      );
      break;

    case 'clearChat':
      clearPendingSubmission();
      renderer.clear();
      break;

    case 'assistantMessage':
      clearPendingSubmission();
      renderer.renderAssistantMessage(
        message.text as string,
        message.timestamp as string,
        message.kind as 'info' | 'ask' | 'chat' | undefined,
        message.contextLabels as string[] | undefined
      );
      break;

    case 'pinnedItems':
      renderer.setPinnedItems((message.keys as string[]) ?? []);
      break;
  }
});

// Notify the extension only after all webview handlers are registered.
// With `defer` the DOM is already parsed when this runs; the readyState guard is a fallback for non-defer execution.
function initWebview(): void {
  vscode.postMessage({ command: 'webviewReady' });
  promptInput.focus();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initWebview);
} else {
  initWebview();
}
