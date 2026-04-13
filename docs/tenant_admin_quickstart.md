# ContextRelay tenant admin quickstart

This is the shortest practical setup guide for a tenant admin who wants to enable ContextRelay with the built-in VS Code Microsoft authentication provider.

---

## Goal

Enable users to sign in with your own Microsoft Entra app registration instead of the default VS Code first-party client, so Graph delegated permissions can be consented in your tenant.

---

## 1. Create or reuse an Entra app registration

In **Microsoft Entra admin center**:

1. Go to **Applications** → **App registrations**.
2. Create **New registration**.
3. Recommended values:
   - **Name**: `ContextRelay`
   - **Supported account types**: **Accounts in this organizational directory only**
4. Save the following values:
   - **Application (client) ID**
   - **Directory (tenant) ID**

---

## 2. Enable public client flow

Open **Authentication** and set:

- **Allow public client flows** = **Yes**

Save.

---

## 3. Add redirect URIs

Under **Authentication** → **Platform configurations**, add these redirect URIs:

- `http://localhost`
- `https://vscode.dev/redirect`
- `ms-appx-web://Microsoft.AAD.BrokerPlugin/<your-client-id>`
- `msauth.com.microsoft.VSCode.helper://auth`
- `msauth.com.microsoft.VSCodeInsiders.helper://auth`
- `msauth.com.microsoft.VSCodeExploration.helper://auth`

Replace `<your-client-id>` with the app registration's real client ID.

---

## 4. Add minimum delegated permissions

Open **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**.

### Smallest recommended pilot

Start with:

- `User.Read`
- `Mail.Read`

This supports a safe initial mail-only rollout.

### Add later only if needed

**Teams search**

- `Chat.Read`
- `ChannelMessage.Read.All`

**SharePoint / OneDrive retrieval**

- `Files.Read.All`
- `Sites.Read.All`

**Chat preview / richer people and transcript context**

- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`

**Connectors**

- `ExternalItem.Read.All`

---

## 5. Grant admin consent when required

Permissions commonly requiring tenant admin consent:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- often `Sites.Read.All`

If needed, click **Grant admin consent for <Tenant>**.

---

## 6. Give users the VS Code settings

Ask users to place this in `settings.json`.

### Recommended first deployment

```jsonc
{
  "contextRelay.auth.clientId": "11111111-2222-3333-4444-555555555555",
  "contextRelay.auth.tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "contextRelay.enableChatPreview": false,
  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": false,
  "contextRelay.adapters.sharepoint": false,
  "contextRelay.adapters.onedrive": false,
  "contextRelay.adapters.connectors": false
}
```

After approval and testing, enable Teams, then retrieval, then optional connector features.

---

## 7. Quick troubleshooting

### `AADSTS65002`

Usually means the extension is still effectively using the default VS Code first-party client or the new app registration is missing delegated permissions / consent.

Check:

- `contextRelay.auth.clientId` is set in effective settings
- VS Code window was reloaded after settings change
- required delegated permissions are present
- admin consent was granted where required

### Redirect URI mismatch

Usually means one of the redirect URIs above is missing or the broker URI uses the wrong client ID.

### Sign-in works but SharePoint / OneDrive features fail

Usually means either:

- `Files.Read.All` / `Sites.Read.All` is missing or not consented
- the user does not have the required Microsoft 365 Copilot license

---

## Recommended rollout order

1. **Pilot 1**: `User.Read` + `Mail.Read`
2. **Pilot 2**: add Teams permissions
3. **Pilot 3**: add SharePoint / OneDrive permissions
4. **Pilot 4**: add transcript / connectors permissions only for users who need them

This keeps approval scope small and reduces deployment friction.