import * as vscode from 'vscode';
import { ChatViewProvider } from './panel/chatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const chatViewProvider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatViewProvider
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openPanel', () => {
      vscode.commands.executeCommand('contextRelay.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearChat', () => {
      chatViewProvider.clearChat();
    })
  );
}

export function deactivate() {}
