/**
 * Webview entry point for the ContextRelay chat panel.
 *
 * Follows the same pattern as vscode-copilot-chat's suggestionsPanelWebview.ts:
 * - acquireVsCodeApi() for message passing
 * - DOMContentLoaded for initialization
 * - window.addEventListener('message') for host→webview messages
 */

import { SlashMenu } from './slashMenu';
import { HashMenu } from './hashMenu';
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
const attachButton = document.getElementById('attachButton') as HTMLButtonElement;
const attachmentChipsEl = document.getElementById('attachmentChips')!;
const inputAreaEl = document.getElementById('inputArea')!;
const slashMenuEl = document.getElementById('slashMenu')!;
const hashMenuEl = document.getElementById('hashMenu')!;

const SEND_ICON_HTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
  <path d="M1 1.91L7.2 8 1 14.09 1.91 15 9 8 1.91 1z"/>
  <path d="M7 1.91L13.2 8 7 14.09 7.91 15 15 8 7.91 1z"/>
</svg>`;
const STOP_ICON_HTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
  <rect x="3" y="3" width="10" height="10" rx="1.5"/>
</svg>`;

// --- Modules ---
const renderer = new ChatRenderer(chatArea, vscode);
const activeLoadingKeys = new Set<string>();
let hasPendingSubmission = false;
let activeStreamId: string | null = null;

const slashMenu = new SlashMenu(slashMenuEl, promptInput, (nextValue: string) => {
  promptInput.value = nextValue;
  promptInput.focus();
  autoResizeInput();
  slashMenu.hide();
});

const hashMenu = new HashMenu(hashMenuEl, promptInput, (nextValue: string) => {
  promptInput.value = nextValue;
  promptInput.focus();
  autoResizeInput();
  hashMenu.hide();
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
  hashMenu.hide();
}

function autoResizeInput(): void {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
}

function setPromptBusy(isBusy: boolean): void {
  promptInput.disabled = isBusy;
  promptInput.setAttribute('aria-disabled', String(isBusy));
  attachButton.disabled = isBusy;

  // While a Copilot reply is streaming, keep the send button enabled so it
  // can act as a Stop button; otherwise disable it like the rest of the
  // input while busy.
  const sendDisabled = isBusy && !activeStreamId;
  sendButton.disabled = sendDisabled;
  sendButton.setAttribute('aria-disabled', String(sendDisabled));
}

function syncPromptBusy(): void {
  setPromptBusy(hasPendingSubmission || activeLoadingKeys.size > 0);
}

function clearPendingSubmission(): void {
  hasPendingSubmission = false;
  syncPromptBusy();
}

function setSendButtonMode(mode: 'send' | 'stop'): void {
  if (mode === 'stop') {
    sendButton.innerHTML = STOP_ICON_HTML;
    sendButton.classList.add('stop-mode');
    sendButton.title = 'Stop';
    sendButton.setAttribute('aria-label', 'Stop generating');
  } else {
    sendButton.innerHTML = SEND_ICON_HTML;
    sendButton.classList.remove('stop-mode');
    sendButton.title = 'Send';
    sendButton.setAttribute('aria-label', 'Send message');
  }
}

interface AttachmentSummary {
  absolutePath: string;
  relativePath: string;
  origin: string;
}

function renderAttachmentChips(attachments: AttachmentSummary[]): void {
  attachmentChipsEl.replaceChildren();
  attachmentChipsEl.classList.toggle('visible', attachments.length > 0);

  for (const attachment of attachments) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.setAttribute('role', 'listitem');

    const label = document.createElement('span');
    label.className = 'attachment-chip-label';
    label.textContent = attachment.relativePath;
    label.title = attachment.relativePath;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'attachment-chip-remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Remove ${attachment.relativePath}`);
    removeBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'removeAttachment', absolutePath: attachment.absolutePath });
    });
    chip.appendChild(removeBtn);

    attachmentChipsEl.appendChild(chip);
  }
}

// --- Event listeners ---

// Send button click (doubles as Stop while a reply is streaming)
sendButton.addEventListener('click', () => {
  if (activeStreamId) {
    vscode.postMessage({ command: 'cancelAssistantMessage' });
    return;
  }
  submitQuery();
});

// Attach-file picker button
attachButton.addEventListener('click', () => {
  if (attachButton.disabled) {
    return;
  }
  vscode.postMessage({ command: 'attachFilePicker' });
});

// Drag-and-drop attachment: VS Code webviews receive dropped Explorer/editor
// items as a text/uri-list DataTransfer entry (file:// URIs). Files dragged
// in from an OS file manager don't carry a usable path in a browser context,
// so those are rejected with an explanatory error from the host.
inputAreaEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
  inputAreaEl.classList.add('drag-active');
});

inputAreaEl.addEventListener('dragleave', (e) => {
  // dragleave fires whenever the pointer crosses into a child element (the
  // textarea, attach button, etc.), not just when it leaves inputAreaEl
  // entirely. Only clear the outline once relatedTarget (where the pointer
  // is headed) is outside inputAreaEl — relatedTarget is null when the drag
  // left the window/webview altogether, which also counts as "left".
  const related = e.relatedTarget as Node | null;
  if (!related || !inputAreaEl.contains(related)) {
    inputAreaEl.classList.remove('drag-active');
  }
});

inputAreaEl.addEventListener('drop', (e) => {
  e.preventDefault();
  inputAreaEl.classList.remove('drag-active');

  const uriList = e.dataTransfer?.getData('text/uri-list');
  if (!uriList) {
    return;
  }

  const uris = uriList
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  if (uris.length > 0) {
    vscode.postMessage({ command: 'attachFiles', uris });
  }
});

// Keyboard handling
promptInput.addEventListener('keydown', (e) => {
  // Guard against IME composition (Japanese/Chinese/Korean input)
  if (e.isComposing || e.keyCode === 229) {
    return;
  }

  // Let hash/slash menus handle navigation keys first
  if (hashMenu.handleKeyDown(e)) {
    return;
  }

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
  const hashVisible = hashMenu.update(promptInput.value);
  if (hashVisible) {
    slashMenu.hide();
    return;
  }

  slashMenu.update(promptInput.value);
});

// Close menus when clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!slashMenuEl.contains(target) && !hashMenuEl.contains(target) && target !== promptInput) {
    slashMenu.hide();
    hashMenu.hide();
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

    case 'assistantMessageStart':
      activeStreamId = message.id as string;
      setSendButtonMode('stop');
      syncPromptBusy();
      renderer.beginAssistantStream(message.id as string);
      break;

    case 'assistantMessageProgress':
      renderer.updateAssistantStream(message.id as string, message.text as string);
      break;

    case 'assistantMessageEnd':
      activeStreamId = null;
      setSendButtonMode('send');
      clearPendingSubmission();
      renderer.finalizeAssistantMessage(
        message.id as string,
        message.text as string,
        message.timestamp as string,
        message.kind as 'info' | 'ask' | 'chat' | undefined,
        message.contextLabels as string[] | undefined
      );
      break;

    case 'pinnedItems':
      renderer.setPinnedItems((message.keys as string[]) ?? []);
      break;

    case 'workspaceFiles':
      hashMenu.setFiles((message.files as string[]) ?? []);
      break;

    case 'attachmentsChanged':
      renderAttachmentChips((message.attachments as AttachmentSummary[]) ?? []);
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
