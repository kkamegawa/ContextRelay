import { strict as assert } from 'assert';
import { buildProviderScopes, getBuiltInAuthConfigurationMessage, qualifyGraphScope } from '../../auth/authScopes';

suite('Auth scopes', () => {
  test('qualifies Graph scopes with resource URI', () => {
    assert.equal(qualifyGraphScope('Mail.Read'), 'https://graph.microsoft.com/Mail.Read');
    assert.equal(qualifyGraphScope('openid'), 'openid');
    assert.equal(
      qualifyGraphScope('https://graph.microsoft.com/User.Read'),
      'https://graph.microsoft.com/User.Read'
    );
  });

  test('buildProviderScopes includes oidc and baseline graph scopes', () => {
    const scopes = buildProviderScopes(['Mail.Read', 'Sites.Read.All']);

    assert.ok(scopes.includes('offline_access'));
    assert.ok(scopes.includes('openid'));
    assert.ok(scopes.includes('profile'));
    assert.ok(scopes.includes('https://graph.microsoft.com/User.Read'));
    assert.ok(scopes.includes('https://graph.microsoft.com/Mail.Read'));
    assert.ok(scopes.includes('https://graph.microsoft.com/Sites.Read.All'));
  });

  test('buildProviderScopes injects built-in provider overrides', () => {
    const scopes = buildProviderScopes(['Mail.Read'], {
      clientId: 'client-id',
      tenantId: 'contoso.onmicrosoft.com'
    });

    assert.ok(scopes.includes('VSCODE_CLIENT_ID:client-id'));
    assert.ok(scopes.includes('VSCODE_TENANT:contoso.onmicrosoft.com'));
  });

  test('built-in auth configuration message is actionable', () => {
    const message = getBuiltInAuthConfigurationMessage();
    assert.ok(message.includes('contextRelay.auth.clientId'));
    assert.ok(message.includes('built-in VS Code Microsoft authentication provider'));
    assert.ok(message.includes('VSCODE_CLIENT_ID'));
  });
});