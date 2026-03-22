const GRAPH_RESOURCE = 'https://graph.microsoft.com';
const OIDC_SCOPES = ['offline_access', 'openid', 'profile'] as const;
const DEFAULT_GRAPH_SCOPES = ['User.Read'];

export function qualifyGraphScope(scope: string): string {
  if (
    scope.includes('://') ||
    scope.startsWith('VSCODE_CLIENT_ID:') ||
    scope.startsWith('VSCODE_TENANT:') ||
    OIDC_SCOPES.includes(scope as typeof OIDC_SCOPES[number])
  ) {
    return scope;
  }

  return `${GRAPH_RESOURCE}/${scope}`;
}

export function buildProviderScopes(
  featureScopes: string[],
  options?: { clientId?: string; tenantId?: string }
): string[] {
  const scopes = new Set<string>();

  OIDC_SCOPES.forEach(scope => scopes.add(scope));
  DEFAULT_GRAPH_SCOPES.forEach(scope => scopes.add(qualifyGraphScope(scope)));
  featureScopes.forEach(scope => scopes.add(qualifyGraphScope(scope)));

  if (options?.clientId?.trim()) {
    scopes.add(`VSCODE_CLIENT_ID:${options.clientId.trim()}`);
  }

  if (options?.tenantId?.trim()) {
    scopes.add(`VSCODE_TENANT:${options.tenantId.trim()}`);
  }

  return Array.from(scopes);
}

export function getBuiltInAuthConfigurationMessage(): string {
  return [
    'ContextRelay uses the built-in VS Code Microsoft authentication provider,',
    'but Microsoft Graph scopes like Mail.Read / Sites.Read.All are not preauthorized for VS Code\'s default client id.',
    'Configure contextRelay.auth.clientId (and optionally contextRelay.auth.tenantId) so the built-in provider uses your own Entra app registration via VSCODE_CLIENT_ID / VSCODE_TENANT.'
  ].join(' ');
}

export { GRAPH_RESOURCE, OIDC_SCOPES };