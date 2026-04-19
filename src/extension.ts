import './suppressPunycodeDeprecation.install';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChatViewProvider } from './panel/chatViewProvider';
import { VIEW_LOCATION_CONTEXT_KEY } from './panel/chatViewConstants';
import {
  ChatMoveRuntime,
  ViewLocation,
  moveChatToPrimarySideBar,
  moveChatToSecondarySideBar,
  openChatInEditorArea,
  openChatInNewWindow
} from './panel/chatMoveCommands';
import { AuthProvider } from './auth/authProvider';
import { setGraphLogger } from './adapters/graphClient';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const GRAPH_DEBUG_LOGGING_CONFIG_KEY = 'enableGraphDebugLogging';
  let debugChannel: vscode.OutputChannel | undefined;

  const ensureDebugChannel = (): vscode.OutputChannel => {
    if (!debugChannel) {
      debugChannel = vscode.window.createOutputChannel('ContextRelay Debug');
      context.subscriptions.push(debugChannel);
    }

    return debugChannel;
  };

  const enableGraphDebugLogging = (): vscode.OutputChannel => {
    const channel = ensureDebugChannel();
    setGraphLogger({
      log: (msg: string) => channel.appendLine(`[${new Date().toISOString()}] ${msg}`)
    });
    return channel;
  };

  const syncGraphDebugLogging = (): void => {
    const isEnabled = vscode.workspace
      .getConfiguration('contextRelay')
      .get<boolean>(GRAPH_DEBUG_LOGGING_CONFIG_KEY, false);

    setGraphLogger(isEnabled ? {
      log: (msg: string) => ensureDebugChannel().appendLine(`[${new Date().toISOString()}] ${msg}`)
    } : undefined);
  };

  syncGraphDebugLogging();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`contextRelay.${GRAPH_DEBUG_LOGGING_CONFIG_KEY}`)) {
        syncGraphDebugLogging();
      }
    })
  );

  const authProvider = new AuthProvider(context);
  const chatViewProvider = new ChatViewProvider(context, authProvider, context.extensionUri);
  const focusPanel = async (): Promise<void> => {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  };

  // Set the initial view location context key so only one move button is visible
  await vscode.commands.executeCommand('setContext', VIEW_LOCATION_CONTEXT_KEY, 'sidebar');

  const moveRuntime: ChatMoveRuntime = {
    executeCommand: (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args),
    focusView: focusPanel,
    focusAuxiliaryBar: async () => {
      await vscode.commands.executeCommand('workbench.action.focusAuxiliaryBar');
    },
    setViewLocation: async (location: ViewLocation) => {
      await vscode.commands.executeCommand('setContext', VIEW_LOCATION_CONTEXT_KEY, location);
    },
    openInEditorArea: () => chatViewProvider.openInEditorArea()
  };

  const runMoveCommand = async (
    actionLabel: string,
    action: () => Promise<void>
  ): Promise<void> => {
    try {
      await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`ContextRelay: Failed to ${actionLabel}: ${message}`);
      return;
    }
  };

  const moveToSecondarySideBar = async (): Promise<void> => {
    await runMoveCommand('move chat to the secondary side bar', () =>
      moveChatToSecondarySideBar(moveRuntime)
    );
  };

  const moveToPrimarySideBar = async (): Promise<void> => {
    await runMoveCommand('move chat to the primary side bar', () =>
      moveChatToPrimarySideBar(moveRuntime)
    );
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

  // --- Ellipsis menu commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.moveChatToEditorArea', async () => {
      await runMoveCommand('open chat in the editor area', () =>
        openChatInEditorArea(moveRuntime)
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.moveChatToNewWindow', async () => {
      await runMoveCommand('open chat in a new window', () =>
        openChatInNewWindow(moveRuntime)
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.showDebugLog', () => {
      enableGraphDebugLogging().show(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextRelay.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'contextRelay');
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
