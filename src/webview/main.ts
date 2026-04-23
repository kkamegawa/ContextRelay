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

const slashMenu = new SlashMenu(slashMenuEl, promptInput, (command: string) => {
  promptInput.value = command + ' ';
  promptInput.focus();
  slashMenu.hide();
});

// --- Input handling ---

function submitQuery(): void {
  const text = promptInput.value.trim();
  if (!text) {
    return;
  }

  vscode.postMessage({ command: 'submitQuery', text });
  promptInput.value = '';
  autoResizeInput();
  slashMenu.hide();
}

function autoResizeInput(): void {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
}

// --- Event listeners ---

// Notify extension that webview is ready
window.addEventListener('DOMContentLoaded', () => {
  vscode.postMessage({ command: 'webviewReady' });
  promptInput.focus();
});

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
      renderer.renderError(
        message.source as string,
        message.message as string,
        message.timestamp as string
      );
      break;

    case 'loading':
      renderer.setLoading(
        message.source as string,
        message.isLoading as boolean
      );
      break;

    case 'slashHelp':
      renderer.renderSlashHelp(
        message.commandName as string,
        message.examples as string[]
      );
      break;

    case 'clearChat':
      renderer.clear();
      break;

    case 'assistantMessage':
      renderer.renderAssistantMessage(
        message.text as string,
        message.timestamp as string
      );
      break;

    case 'pinnedItems':
      renderer.setPinnedItems((message.keys as string[]) ?? []);
      break;
  }
});
