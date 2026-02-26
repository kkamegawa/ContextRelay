import * as vscode from 'vscode';
import { PanelProvider } from './panel/panelProvider';
import { AuthProvider } from './auth/authProvider';

export function activate(context: vscode.ExtensionContext): void {
  const authProvider = new AuthProvider(context);
  const panelProvider = new PanelProvider(context, authProvider, context.extensionUri);

  // Register the WebviewView provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Listen for session changes
  context.subscriptions.push(
    authProvider.onSessionChange(async () => {
      authProvider.clearSession();
      panelProvider.postMessage({ type: 'authState', signedIn: false, accountLabel: null });
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search Microsoft 365 content',
        placeHolder: 'e.g. architecture decisions or /mail from:alice'
      });
      if (query) {
        await vscode.commands.executeCommand('contextRelay.panel.focus');
        panelProvider.postMessage({ type: 'setQuery', query });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearCache', () => {
      panelProvider.clearCache();
      vscode.window.showInformationMessage('ContextRelay: Cache cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearSnippets', () => {
      panelProvider.clearSnippets();
      vscode.window.showInformationMessage('ContextRelay: All snippets cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.generateHandoffDocs', async () => {
      const docGenerator = panelProvider.getDocGenerator();
      const snippets = panelProvider.getSnippetStore().getAll();

      try {
        const files = await docGenerator.generateAll({ snippets });
        vscode.window.showInformationMessage(
          `ContextRelay: Handoff docs updated (${files.length} files).`
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `ContextRelay: Failed to generate docs: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openCopilotChat', async () => {
      const docGenerator = panelProvider.getDocGenerator();
      const handoffPath = docGenerator.getHandoffPath();
      const prompt = buildHandoffPrompt(handoffPath);

      await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.copyHandoffPrompt', async () => {
      const docGenerator = panelProvider.getDocGenerator();
      const handoffPath = docGenerator.getHandoffPath();
      const prompt = buildHandoffPrompt(handoffPath);

      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage('ContextRelay: Handoff prompt copied to clipboard.');
    })
  );
}

function buildHandoffPrompt(handoffPath: string): string {
  return [
    'Please review the handoff document at the path below and help me continue development.',
    `Handoff document: ${handoffPath}`,
    '',
    'Use the context in HANDOFF.md to understand current decisions, open questions,',
    'next tasks, and relevant snippets from Microsoft 365. Then help me plan next steps.'
  ].join('\n');
}

export function deactivate(): void {
  // Nothing to clean up
}
