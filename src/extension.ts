import './suppressPunycodeDeprecation';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChatViewProvider } from './panel/chatViewProvider';
import { AuthProvider } from './auth/authProvider';

export function activate(context: vscode.ExtensionContext): void {
  const authProvider = new AuthProvider(context);
  const chatViewProvider = new ChatViewProvider(context, authProvider, context.extensionUri);
  const focusPanel = async (): Promise<void> => {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  };

  // Track which sidebar the view is in so the title-bar icon can toggle.
  // Restore the last-known location from globalState so the toggle is correct
  // across VS Code sessions (not always reset to primarySideBar on activation).
  const VIEW_LOCATION_KEY = 'contextRelay.viewLocation';
  const savedLocation = context.globalState.get<string>(VIEW_LOCATION_KEY, 'primarySideBar');
  void vscode.commands.executeCommand('setContext', VIEW_LOCATION_KEY, savedLocation);

  const setViewLocation = async (location: string): Promise<void> => {
    await context.globalState.update(VIEW_LOCATION_KEY, location);
    await vscode.commands.executeCommand('setContext', VIEW_LOCATION_KEY, location);
  };

  const moveToSecondarySideBar = async (): Promise<void> => {
    try {
      await vscode.commands.executeCommand('vscode.moveViews', {
        viewIds: [ChatViewProvider.viewType],
        destinationId: '_.auxiliarybar.newcontainer'
      });
      await setViewLocation('secondarySideBar');
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    } catch {
      // Fallback: let the user pick the destination via the built-in quick pick.
      // Update the context key to our intended destination so the menu can recover.
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
      await vscode.commands.executeCommand('workbench.action.moveFocusedView');
      await setViewLocation('secondarySideBar');
    }
  };

  const moveToPrimarySideBar = async (): Promise<void> => {
    try {
      await vscode.commands.executeCommand('vscode.moveViews', {
        viewIds: [ChatViewProvider.viewType],
        destinationId: 'workbench.view.extension.contextRelay'
      });
      await setViewLocation('primarySideBar');
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    } catch {
      // Fallback: update context key to intended destination so the menu can recover.
      await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
      await vscode.commands.executeCommand('workbench.action.moveFocusedView');
      await setViewLocation('primarySideBar');
    }
  };

  const generateHandoffDocs = async (): Promise<string[]> => {
    const docGenerator = chatViewProvider.getDocGenerator();
    const handoffContext = chatViewProvider.getHandoffContext();

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
    const docGenerator = chatViewProvider.getDocGenerator();
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

  const openHandoffDoc = async (): Promise<void> => {
    try {
      const handoffPath = await ensureHandoffDocExists();
      const doc = await vscode.workspace.openTextDocument(handoffPath);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      vscode.window.showErrorMessage(
        `ContextRelay: Failed to open handoff doc: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // Register the WebviewView provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
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
        await chatViewProvider.submitQuery(query);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearCache', () => {
      chatViewProvider.clearCache();
      vscode.window.showInformationMessage('ContextRelay: Cache cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearSnippets', () => {
      chatViewProvider.clearSnippets();
      vscode.window.showInformationMessage('ContextRelay: All snippets cleared.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.clearChat', () => {
      chatViewProvider.clearChat();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.generateHandoffDocs', generateHandoffDocs)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openCopilotChat', openCopilotChat)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openHandoffDoc', openHandoffDoc)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.copyHandoffPrompt', copyHandoffPrompt)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.moveToSecondarySideBar', moveToSecondarySideBar)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.moveToPrimarySideBar', moveToPrimarySideBar)
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
