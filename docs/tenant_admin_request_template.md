# ContextRelay tenant admin request template

Use the following text as a copy/paste template when requesting a Microsoft Entra app registration and delegated permission approval for ContextRelay.

---

## Short request version

Subject: Request to enable ContextRelay with tenant-managed Microsoft Entra app registration

Hello,

We would like to enable the VS Code extension **ContextRelay** for a pilot group.

Because the extension uses the built-in VS Code Microsoft authentication provider, we need a **tenant-managed Microsoft Entra app registration** instead of relying on the default VS Code first-party client.

### Requested configuration

1. Create or reuse a Microsoft Entra app registration for ContextRelay.
2. Enable **Allow public client flows**.
3. Add these redirect URIs:
   - `http://localhost`
   - `https://vscode.dev/redirect`
   - `ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`
   - `msauth.com.microsoft.VSCode.helper://auth`
   - `msauth.com.microsoft.VSCodeInsiders.helper://auth`
   - `msauth.com.microsoft.VSCodeExploration.helper://auth`
4. Add delegated Microsoft Graph permissions for the pilot.

### Recommended initial pilot permissions

- `User.Read`
- `Mail.Read`

### Optional later phases

**Teams search**

- `Chat.Read`
- `ChannelMessage.Read.All`

**SharePoint / OneDrive retrieval**

- `Files.Read.All`
- `Sites.Read.All`

**Chat preview / transcript / people context**

- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`

**Connectors**

- `ExternalItem.Read.All`

### Why this is needed

Without a tenant-managed app registration, Microsoft Entra can reject required Graph scopes with `AADSTS65002` because the default VS Code first-party client is not preauthorized for all scopes needed by this extension.

### What we need returned to users

Please share:

- **Application (client) ID**
- **Directory (tenant) ID** or tenant domain to use

Users will place those values in VS Code settings.

Thank you.

---

## Detailed request version

Subject: Approval request for ContextRelay Microsoft Graph delegated permissions

Hello tenant admin team,

I am requesting approval for a **pilot deployment of ContextRelay**, a VS Code extension that surfaces Microsoft 365 context inside the editor.

### Technical approach

The extension uses the built-in VS Code Microsoft authentication provider, but with a **tenant-specific Microsoft Entra application registration** configured through VS Code auth-provider overrides.

This allows our tenant to explicitly control:

- the app registration used for sign-in
- the delegated Microsoft Graph permissions granted
- tenant consent and rollout scope

### App registration requirements

Please configure the app registration with:

1. **Public client flow enabled**
2. Redirect URIs:
   - `http://localhost`
   - `https://vscode.dev/redirect`
   - `ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`
   - `msauth.com.microsoft.VSCode.helper://auth`
   - `msauth.com.microsoft.VSCodeInsiders.helper://auth`
   - `msauth.com.microsoft.VSCodeExploration.helper://auth`
3. Delegated Graph permissions based on rollout phase

### Phase-based permission request

**Phase 1 — Mail-only pilot**

- `User.Read`
- `Mail.Read`

**Phase 2 — Add Teams search**

- `Chat.Read`
- `ChannelMessage.Read.All`

**Phase 3 — Add SharePoint / OneDrive retrieval**

- `Files.Read.All`
- `Sites.Read.All`

**Phase 4 — Optional advanced features**

- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`

### Notes on admin consent

The following permissions commonly require admin consent:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- often `Sites.Read.All`

### User-side configuration

After the app registration is created, users will configure VS Code with:

```jsonc
{
  "contextRelay.auth.clientId": "<application-client-id>",
  "contextRelay.auth.tenantId": "<tenant-id-or-domain>"
}
```

### Rollout recommendation

We recommend starting with the smallest permission set (`User.Read` + `Mail.Read`) and expanding only after pilot validation.

Please let us know the approved client ID and tenant value to distribute to users.

Thank you.