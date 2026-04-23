import * as vscode from 'vscode';
import { buildProviderScopes, getBuiltInAuthConfigurationMessage } from './authScopes';

const MAIL_SCOPES = ['Mail.Read'];
const TEAMS_SCOPES = ['Chat.Read', 'ChannelMessage.Read.All'];
const RETRIEVAL_SCOPES = ['Files.Read.All', 'Sites.Read.All'];
const ONENOTE_SCOPES = ['Notes.Read'];
const PLANNER_SCOPES = ['Tasks.Read'];
const CONNECTORS_SCOPES = ['ExternalItem.Read.All'];
const CHAT_SCOPES = [
  'Sites.Read.All',
  'Mail.Read',
  'People.Read.All',
  'OnlineMeetingTranscript.Read.All',
  'Chat.Read',
  'ChannelMessage.Read.All',
  'ExternalItem.Read.All'
];

export class AuthProvider {
  private session: vscode.AuthenticationSession | undefined;

  constructor(_context: vscode.ExtensionContext) {}

  getRequiredScopes(): string[] {
    const config = vscode.workspace.getConfiguration('contextRelay');
    const featureScopes = new Set<string>();

    if (config.get<boolean>('adapters.mail', true)) {
      MAIL_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (config.get<boolean>('adapters.teams', true)) {
      TEAMS_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (
      config.get<boolean>('adapters.sharepoint', true) ||
      config.get<boolean>('adapters.onedrive', true)
    ) {
      RETRIEVAL_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (config.get<boolean>('adapters.onenote', true)) {
      ONENOTE_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (
      config.get<boolean>('adapters.planner', true) ||
      config.get<boolean>('adapters.todo', true)
    ) {
      PLANNER_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (config.get<boolean>('adapters.connectors', false)) {
      CONNECTORS_SCOPES.forEach(s => featureScopes.add(s));
    }
    if (config.get<boolean>('enableChatPreview', true)) {
      CHAT_SCOPES.forEach(s => featureScopes.add(s));
    }

    return buildProviderScopes(Array.from(featureScopes), {
      clientId: config.get<string>('auth.clientId')?.trim(),
      tenantId: config.get<string>('auth.tenantId', 'organizations')?.trim()
    });
  }

  async getSession(silent = false): Promise<vscode.AuthenticationSession | undefined> {
    const config = vscode.workspace.getConfiguration('contextRelay');
    const clientId = config.get<string>('auth.clientId')?.trim();
    if (!clientId) {
      if (silent) {
        return undefined;
      }

      throw new Error(getBuiltInAuthConfigurationMessage());
    }

    const scopes = this.getRequiredScopes();
    try {
      this.session = await vscode.authentication.getSession('microsoft', scopes, {
        createIfNone: !silent,
        silent
      });
      return this.session;
    } catch (err) {
      this.session = undefined;

      if (!silent) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('AADSTS65002')) {
          throw new Error(
            `${getBuiltInAuthConfigurationMessage()} Current sign-in is still using VS Code's default client and was rejected by Microsoft Graph preauthorization.`
          );
        }
      }

      return undefined;
    }
  }

  async getAccessToken(): Promise<string> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('Not authenticated. Please sign in to use ContextRelay.');
    }
    return session.accessToken;
  }

  async getAccountLabel(): Promise<string | undefined> {
    const session = await this.getSession(true);
    return session?.account?.label;
  }

  clearSession(): void {
    this.session = undefined;
  }

  onSessionChange(handler: () => void): vscode.Disposable {
    return vscode.authentication.onDidChangeSessions(e => {
      if (e.provider.id === 'microsoft') {
        this.clearSession();
        handler();
      }
    });
  }
}

export {
  MAIL_SCOPES,
  TEAMS_SCOPES,
  RETRIEVAL_SCOPES,
  ONENOTE_SCOPES,
  PLANNER_SCOPES,
  CONNECTORS_SCOPES,
  CHAT_SCOPES
};
