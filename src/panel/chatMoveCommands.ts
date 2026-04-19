import {
  CHAT_VIEW_ID,
  PRIMARY_SIDEBAR_CONTAINER_ID,
  SECONDARY_SIDEBAR_CONTAINER_ID
} from './chatViewConstants';

export interface ChatMoveRuntime {
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  focusView(): Promise<void>;
  openInEditorArea(): Promise<void>;
}

export async function moveChatToPrimarySideBar(runtime: ChatMoveRuntime): Promise<void> {
  await runtime.executeCommand('vscode.moveViews', {
    viewIds: [CHAT_VIEW_ID],
    destinationId: PRIMARY_SIDEBAR_CONTAINER_ID
  });
  await runtime.focusView();
}

export async function moveChatToSecondarySideBar(runtime: ChatMoveRuntime): Promise<void> {
  await runtime.executeCommand('vscode.moveViews', {
    viewIds: [CHAT_VIEW_ID],
    destinationId: SECONDARY_SIDEBAR_CONTAINER_ID
  });
  await runtime.focusView();
}

export async function openChatInEditorArea(runtime: ChatMoveRuntime): Promise<void> {
  await runtime.openInEditorArea();
}

export async function openChatInNewWindow(runtime: ChatMoveRuntime): Promise<void> {
  await runtime.openInEditorArea();
  await runtime.executeCommand('workbench.action.moveEditorToNewWindow');
}
