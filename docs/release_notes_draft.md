# Release notes draft

## ContextRelay documentation improvements

This update improves the Microsoft Entra and sign-in documentation for ContextRelay, especially for environments where tenant admins need to approve Microsoft Graph delegated permissions.

### Added

- Microsoft Entra app registration setup instructions for the built-in VS Code Microsoft auth provider
- minimal delegated-permission recipes for common rollout patterns
- recommended first-run `settings.json` example
- tenant admin quickstart guide
- tenant admin request templates in English and Japanese
- Japanese setup summary
- expanded sign-in FAQ for:
  - `AADSTS65002`
  - admin consent required
  - redirect URI mismatch
  - license missing

### Why this matters

These docs make it easier to:

- avoid `AADSTS65002`
- request the right Graph permissions from tenant admins
- start with a small mail-only pilot
- expand permissions safely as adoption grows

### Upgrade / rollout notes

- No code migration required
- Users should configure:
  - `contextRelay.auth.clientId`
  - `contextRelay.auth.tenantId`
- Tenant admins may need to grant consent for admin-restricted permissions such as:
  - `ChannelMessage.Read.All`
  - `OnlineMeetingTranscript.Read.All`
  - `ExternalItem.Read.All`
  - sometimes `Sites.Read.All`