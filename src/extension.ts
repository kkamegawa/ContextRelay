import * as vscode from 'vscode';
import * as fs from 'fs';
import { PanelProvider } from './panel/panelProvider';
import { AuthProvider } from './auth/authProvider';

export function activate(context: vscode.ExtensionContext): void {
  const authProvider = new AuthProvider(context);
  const panelProvider = new PanelProvider(context, authProvider, context.extensionUri);
  const focusPanel = async (): Promise<void> => {
    await vscode.commands.executeCommand(`${PanelProvider.viewType}.focus`);
  };

  const generateHandoffDocs = async (): Promise<string[]> => {
    const docGenerator = panelProvider.getDocGenerator();
    const handoffContext = panelProvider.getHandoffContext();

    try {
      const files = await docGenerator.generateAll(handoffContext);
      vscode.window.showInformationMessage(
        `ContextRelay: Handoff docs updated (${files.length} files).`
      );
      return files;
    } catch (err) {
      vscode.window.showErrorMessage(
        `ContextRelay: Failed to generate docs: ${err instanceof Error ? err.message : String(err)}`
      );
      throw err;
    }
  };

  const ensureHandoffDocExists = async (): Promise<string> => {
    const docGenerator = panelProvider.getDocGenerator();
    const handoffPath = docGenerator.getHandoffPath();

    if (!fs.existsSync(handoffPath)) {
      await generateHandoffDocs();
    }

    return handoffPath;
  };

  const openCopilotChat = async (): Promise<void> => {
    try {
      const handoffPath = await ensureHandoffDocExists();
      const prompt = buildHandoffPrompt(handoffPath);

      await vscode.commands.executeCommand('workbench.action.chat.open', prompt);
    } catch (err) {
      vscode.window.showErrorMessage(
        `ContextRelay: Failed to open Copilot Chat: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const copyHandoffPrompt = async (): Promise<void> => {
    try {
      const handoffPath = await ensureHandoffDocExists();
      const prompt = buildHandoffPrompt(handoffPath);

      await vscode.env.clipboard.writeText(prompt);
      vscode.window.showInformationMessage('ContextRelay: Handoff prompt copied to clipboard.');
    } catch (err) {
      vscode.window.showErrorMessage(
        `ContextRelay: Failed to prepare handoff prompt: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // Register the WebviewView provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PanelProvider.viewType, panelProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  // Listen for session changes
  context.subscriptions.push(
    authProvider.onSessionChange(async () => {
      await panelProvider.refreshAuthState();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration('contextRelay.enableChatPreview')) {
        await panelProvider.refreshUiState();
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openPanel', async () => {
      await focusPanel();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search Microsoft 365 content',
        placeHolder: 'e.g. architecture decisions or /mail from:alice'
      });
      if (query) {
        await focusPanel();
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
    vscode.commands.registerCommand('contextRelay.generateHandoffDocs', generateHandoffDocs)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openCopilotChat', openCopilotChat)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.copyHandoffPrompt', copyHandoffPrompt)
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
