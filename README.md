# ContextRelay

ContextRelay is a VS Code extension that surfaces relevant Microsoft 365 context directly in a side panel while you design and code. Plain text starts a Microsoft 365 Copilot chat without automatically attaching ContextRelay search context, while slash commands search Exchange mail, Teams messages, SharePoint sites, OneDrive, OneNote, and Planner tasks. Pin key snippets and generate timestamped handoff documents (PLAN / TASKS / TEST_PLAN / HANDOFF) so GitHub Copilot can pick up the work fast.

---

## Features

- **Plain Copilot chat** -- Type without a slash command to chat directly with Microsoft 365 Copilot in the panel.
- **Local file mentions with `#`** -- Attach local workspace files (Copilot-supported extensions only) to plain Copilot chat, `/ask`, and `/workiq` prompts.
- **Explicit source search** -- Search across connected Microsoft 365 sources with slash commands.
- **Source targeting via slash commands** -- Narrow results to a specific source instantly.

| Command | Source |
|---------|--------|
| `/mail <query>` | Exchange Online mail |
| `/teams <query>` | Microsoft Teams messages |
| `/sharepoint <query>` | SharePoint sites & pages |
| `/onedrive <query>` | OneDrive files |
| `/onenote <query>` | OneNote pages |
| `/task <query>` | Planner and Microsoft To Do tasks |
| `/all <query>` | All enabled sources |
| `/ask <instruction>` | Send pinned snippets to Microsoft 365 Copilot and show the reply in the panel |
| `/workiq <query>` | Send a natural language query to Work IQ (A2A protocol) for Microsoft 365 work intelligence |
| `/clear` | Clear the chat transcript and discard all pinned snippets |

`#` mention examples (local workspace files):

```text
Summarize #docs/plan.md
/ask Create release notes from #"docs/Release Plan.md"
/workiq Draft a status update using #notes/today.md
```

> **Note**: If a `#` mention is invalid (missing file, outside workspace, unsupported extension), ContextRelay blocks the request and shows an error.

- **Snippet pinning** -- Save any search result as a named snippet, visible across sessions.
- **Timestamped handoff docs** -- Generate Markdown documents that capture current context.

| Document | Purpose |
|----------|---------|
| `PLAN.md` | High-level goals and decisions |
| `TASKS.md` | Actionable to-do items |
| `TEST_PLAN.md` | Test cases and acceptance criteria |
| `HANDOFF.md` (optional) | Full context summary for the next engineer or Copilot session |

- **GitHub Copilot ready** -- Generated docs follow a structured format that Copilot can parse for continuity.

---

## Requirements

- Node.js 22 or later for local development and validation from source
- [Visual Studio Code](https://code.visualstudio.com/) 1.85 or later
- A Microsoft 365 work/school account (Microsoft Entra ID). Personal Microsoft accounts are not supported.
- **For Exchange Mail, Teams, SharePoint, OneDrive, OneNote, Planner, and Microsoft To Do search**: Standard Microsoft 365 license plus the required Microsoft Graph delegated permissions
- **For Copilot-grounded chat features**: Microsoft 365 Copilot license might still be required depending on tenant rollout and API availability

### Required permissions

ContextRelay uses the **built-in VS Code Microsoft authentication provider** (`providerId = microsoft`).

However, the default VS Code first-party client ID is only preauthorized for a limited set of scopes. When this extension requested Microsoft Graph scopes such as `Mail.Read`, `Sites.Read.All`, or `ChannelMessage.Read.All`, Microsoft Entra returned:

```text
AADSTS65002: Consent between first party application 'aebc6443-996d-45c2-90f0-388ff96faa56'
and first party resource '00000003-0000-0000-c000-000000000000' must be configured via preauthorization
```

That means **the built-in provider itself is fine**, but **VS Code's default client registration is not preauthorized for the Graph scopes this extension needs**.

The fix is to keep using the built-in provider while overriding its client/tenant using the provider's existing scope-based escape hatches:

- `VSCODE_CLIENT_ID:<your-client-id>`
- `VSCODE_TENANT:<your-tenant-or-organizations>`

ContextRelay now injects those automatically from settings.

The following delegated Microsoft Graph permissions are required by feature:

| Permission | Used by |
|---|---|
| `Files.Read.All` | SharePoint / OneDrive search |
| `Sites.Read.All` | SharePoint / OneDrive search, Chat |
| `Mail.Read` | Exchange Mail search, Chat |
| `Chat.Read` | Teams search, Chat |
| `ChannelMessage.Read.All` | Teams search, Chat |
| `Notes.Read` | OneNote search |
| `Tasks.Read` | Planner and Microsoft To Do task search |
| `People.Read.All` | Chat |
| `OnlineMeetingTranscript.Read.All` | Chat |
| `ExternalItem.Read.All` | Connectors search, Chat (optional) |

> **Important**:
>
> - Some permissions (for example `ChannelMessage.Read.All`, `OnlineMeetingTranscript.Read.All`, and `ExternalItem.Read.All`) require **tenant admin consent**.
> - This extension still uses the built-in VS Code auth provider; it just avoids VS Code's default first-party client ID for Graph consent.

#### Work IQ (non-Graph) permissions

`WorkIQAgent.Ask` is **not** a Microsoft Graph permission. It is a delegated permission on a separate resource endpoint used only by the `/workiq` command:

| Permission | Resource endpoint | Used by |
|---|---|---|
| `WorkIQAgent.Ask` | `api://workiq.svc.cloud.microsoft` | `/workiq` command — Work IQ API (optional, requires Microsoft 365 Copilot license) |

> **Important**: This permission requires **tenant admin consent** and is only useful for users with a **Microsoft 365 Copilot license**. See [docs/work_iq.md](docs/work_iq.md) for setup instructions.

---

## Installation

### From the VS Code Marketplace

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **ContextRelay**.
3. Click **Install**.

### From Source

1. Clone this repository.
2. Use Node.js 22 or later. If you use `nvm`, run:

   ```bash
   nvm use
   ```

3. Install dependencies:

  ```bash
  npm install
  ```

  > **Caution (npm allow-scripts policy)**: In environments that enforce npm allow-scripts policies, `npm run vsce:package` can fail with `EALLOWSCRIPTS` because `npx` may propagate allow-scripts runtime flags into nested npm executions. This project avoids that with `scripts/run-audit-safe.cjs` (used by `security:check` and build hooks), which runs `npm audit --audit-level=moderate` after clearing inherited `npm_config_allow_scripts` from the child process environment.

4. Build the extension once from the terminal:

   ```bash
   npm run compile
   ```

   ```powershell
   npm run compile
   ```

5. Press `F5` in VS Code to launch the Extension Development Host. The checked-in `.vscode/launch.json` now runs `npm: compile` automatically before the debugger starts, so a clean checkout no longer fails with a missing `dist/extension.js`.

Before submitting changes, run:

```bash
npm run compile
npm run lint
npm test
npm run security:check
```

```powershell
npm run compile
npm run lint
npm test
npm run security:check
```

Additional project docs:

- [Design plan](docs/plan.md)
- [Implementation tasks](docs/tasks.md)
- [Test plan](docs/test_plan.md)
- [Tenant admin quickstart](docs/tenant_admin_quickstart.md)
- [Tenant admin request template](docs/tenant_admin_request_template.md)
- [Tenant admin request template (JA)](docs/tenant_admin_request_template_ja.md)
- [Japanese setup summary](docs/setup_summary_ja.md)
- [PR body draft](docs/pr_body_draft.md)
- [Release notes draft](docs/release_notes_draft.md)
- [E2E manual checklist](docs/e2e_checklist.md)
- [E2E review summary](docs/e2e_report.md)

---

## Configuration

Add the following settings to your `settings.json` (all optional):

```jsonc
{
  // Microsoft Entra application (client) ID used by the built-in VS Code auth provider
  "contextRelay.auth.clientId": "00000000-0000-0000-0000-000000000000",

  // Tenant ID or domain passed to the built-in VS Code auth provider.
  // Default "organizations" works for work/school accounts across tenants.
  "contextRelay.auth.tenantId": "organizations",

  // Number of search results returned per source (default: 10)
  "contextRelay.maxResults": 10,

  // Directory where handoff documents are saved (default: ".contextrelay")
  "contextRelay.outputDir": ".contextrelay",

  // Cache TTL in seconds (default: 300)
  "contextRelay.cache.ttlSeconds": 300,

  // Maximum number of cached entries, LRU eviction (default: 200)
  "contextRelay.cache.maxEntries": 200,

  // Persist cache in workspace state (default: true)
  "contextRelay.cache.persistWorkspaceState": true,

  // Enable the Chat tab — Copilot Chat API is in beta (default: true)
  "contextRelay.enableChatPreview": true,

  // Per-adapter enable/disable toggles (all default to true except connectors)
  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": true,
  "contextRelay.adapters.sharepoint": true,
  "contextRelay.adapters.onedrive": true,
  "contextRelay.adapters.onenote": true,
  "contextRelay.adapters.planner": true,
  "contextRelay.adapters.connectors": false
}
```

### Recommended first-run settings example

If a tenant admin wants the lowest-friction starting point, begin with a **mail-only pilot** and keep the other adapters off until consent and licensing are ready.

```jsonc
{
  // Use the tenant's own Entra app registration
  "contextRelay.auth.clientId": "11111111-2222-3333-4444-555555555555",

  // Pin sign-in to one tenant to avoid cross-tenant confusion
  "contextRelay.auth.tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",

  // Keep the initial rollout narrow and predictable
  "contextRelay.maxResults": 10,
  "contextRelay.enableChatPreview": false,

  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": false,
  "contextRelay.adapters.sharepoint": false,
  "contextRelay.adapters.onedrive": false,
  "contextRelay.adapters.onenote": false,
  "contextRelay.adapters.planner": false,
  "contextRelay.adapters.connectors": false
}
```

This starter profile maps cleanly to the smallest recommended permission set:

- `User.Read`
- `Mail.Read`

After the first pilot succeeds, enable additional adapters step by step and grant only the corresponding delegated permissions.

### Microsoft Entra app registration setup for the built-in provider

Before the first sign-in, create or reuse a Microsoft Entra application registration that the built-in VS Code auth provider can use:

1. Open **Microsoft Entra admin center**.
2. Go to **Applications** → **App registrations** → **New registration**.
3. Set:
   - **Name**: `ContextRelay` (or any name you prefer)
   - **Supported account types**: usually **Accounts in this organizational directory only** if you only use one tenant
4. Click **Register**.
5. Open the new app registration and copy:
   - **Application (client) ID** → set this as `contextRelay.auth.clientId`
   - **Directory (tenant) ID** (optional) → use this for `contextRelay.auth.tenantId` if you want to pin the tenant instead of `organizations`

#### Step A — Enable public client flow

1. Open **Authentication**.
2. Under **Advanced settings**, set **Allow public client flows** to **Yes**.
3. Save.

#### Step B — Add redirect URIs required by the built-in VS Code auth provider

In **Authentication** → **Platform configurations**, add the following redirect URIs.

**Public client / mobile & desktop**

- `http://localhost`
- `https://vscode.dev/redirect`
- `ms-appx-web://Microsoft.AAD.BrokerPlugin/<your-client-id>`
- `msauth.com.microsoft.VSCode.helper://auth`
- `msauth.com.microsoft.VSCodeInsiders.helper://auth`
- `msauth.com.microsoft.VSCodeExploration.helper://auth`

Replace `<your-client-id>` with the app registration's **Application (client) ID**.

> If you only test on a subset of environments, some URIs may never be used, but keeping the full set avoids platform-specific sign-in failures with the built-in provider.

#### Step C — Add Microsoft Graph delegated permissions

1. Open **API permissions**.
2. Click **Add a permission** → **Microsoft Graph** → **Delegated permissions**.
3. Add only the permissions you need.

Recommended minimum sets:

| Scenario | Minimum delegated permissions |
|---|---|
| Mail search only | `User.Read`, `Mail.Read` |
| Mail + Teams search | `User.Read`, `Mail.Read`, `Chat.Read`, `ChannelMessage.Read.All` |
| SharePoint / OneDrive search | `User.Read`, `Files.Read.All`, `Sites.Read.All` |
| OneNote search | `User.Read`, `Notes.Read` |
| Planner search | `User.Read`, `Tasks.Read` |
| Chat tab enabled | `User.Read`, `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All` |
| Connectors enabled | `User.Read`, `ExternalItem.Read.All` |

> `User.Read` is always recommended because the built-in Microsoft auth provider relies on a Graph user-profile baseline and ContextRelay always requests it.

#### Minimal app registration recipes

If you want the smallest possible setup, use one of these patterns.

**Pattern 1 — Mail search only**

- Delegated permissions:
  - `User.Read`
  - `Mail.Read`
- Admin consent:
  - usually **not required**
- Suitable for:
  - `/mail ...`

**Pattern 2 — Mail + Teams search**

- Delegated permissions:
  - `User.Read`
  - `Mail.Read`
  - `Chat.Read`
  - `ChannelMessage.Read.All`
- Admin consent:
  - typically required for `ChannelMessage.Read.All`
- Suitable for:
  - `/mail ...`
  - `/teams ...`
  - `/all ...` across Mail + Teams

**Pattern 3 — SharePoint / OneDrive search**

- Delegated permissions:
  - `User.Read`
  - `Files.Read.All`
  - `Sites.Read.All`
- Admin consent:
  - often required depending on tenant policy
- Suitable for:
  - `/sharepoint ...`
  - `/onedrive ...`

**Pattern 4 — Full extension experience except connectors**

- Delegated permissions:
  - `User.Read`
  - `Mail.Read`
  - `Chat.Read`
  - `ChannelMessage.Read.All`
  - `Files.Read.All`
  - `Sites.Read.All`
  - `Notes.Read`
  - `Tasks.Read`
  - `People.Read.All`
  - `OnlineMeetingTranscript.Read.All`
- Admin consent:
  - usually required for several of the above
- Additional requirement:
  - Copilot-grounded chat features can still require Microsoft 365 Copilot licensing depending on tenant rollout

**Pattern 5 — Full extension including connectors**

- Delegated permissions:
  - all permissions from Pattern 4
  - `ExternalItem.Read.All`
- Admin consent:
  - typically required
- Additional requirement:
  - connector data source must already be configured in Microsoft 365 / Graph

#### Recommended rollout strategy for tenant admins

To reduce approval friction, start with the smallest viable permission set:

1. **Pilot 1**: `User.Read` + `Mail.Read`
2. **Pilot 2**: add `Chat.Read` + `ChannelMessage.Read.All`
3. **Pilot 3**: add `Files.Read.All` + `Sites.Read.All`
4. **Pilot 4**: add Chat and connector scopes only if those features are actually needed

This makes it easier to validate business need before granting broader delegated permissions.

For a short tenant-admin handout, see [Tenant admin quickstart](docs/tenant_admin_quickstart.md).

#### Step D — Grant admin consent if needed

Some delegated permissions are **admin-restricted**.

Typical examples in this project:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- often `Sites.Read.All` depending on tenant policy

If your tenant requires admin approval:

1. Stay on **API permissions**.
2. Click **Grant admin consent for <Tenant>**.
3. Confirm.

If you do not have admin rights, ask a tenant administrator to grant consent.

#### Step E — Configure the extension

Add the values to VS Code settings:

```jsonc
{
  "contextRelay.auth.clientId": "<application-client-id>",
  "contextRelay.auth.tenantId": "organizations"
}
```

Use a fixed tenant GUID or verified domain instead of `organizations` when:

- you want to ensure users only sign in to one tenant
- your consent is granted only in one tenant
- you want to avoid cross-tenant account selection confusion

At sign-in time, ContextRelay still calls `vscode.authentication.getSession('microsoft', scopes, ...)`, but the requested scope list now includes your configured `VSCODE_CLIENT_ID` and `VSCODE_TENANT` overrides.

### Troubleshooting sign-in

#### `AADSTS65002`

If you still see:

```text
AADSTS65002: Consent between first party application 'aebc6443-996d-45c2-90f0-388ff96faa56' ...
```

then one of the following is true:

1. `contextRelay.auth.clientId` is not set or not loaded in the active window.
2. The configured app registration is missing one or more required Graph delegated permissions.
3. Admin consent is still missing for an admin-restricted permission.
4. Required redirect URIs were not added to the app registration.

Checklist:

- Confirm `contextRelay.auth.clientId` is present in **effective** settings.
- Reload the VS Code window after changing auth settings.
- Re-run sign-in from a fresh window if needed.
- Verify **API permissions** on the app registration.
- Verify **Grant admin consent** status.

#### Sign-in opens but token acquisition still fails

Check:

- The signed-in account belongs to the tenant that granted consent.
- `contextRelay.auth.tenantId` is correct.
- The account has the necessary Microsoft 365 license and Graph permissions for the enabled adapters.

#### Teams / Chat permissions fail after sign-in

That usually means sign-in succeeded, but Microsoft Graph rejected one or more API calls because the required delegated permissions were not granted or are blocked by tenant policy. In that case, review the per-feature permission matrix above and ask a tenant admin to grant consent where required.

### Sign-in FAQ

#### Admin consent required / approval needed

If users see an approval-required message, or the app works for sign-in but fails when calling specific Graph APIs, the app registration is likely missing tenant admin consent for one or more delegated permissions.

Most common admin-consent cases in this extension:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- sometimes `Sites.Read.All` depending on tenant policy

What to do:

1. Open **Microsoft Entra admin center** → **App registrations** → your app.
2. Check **API permissions** and confirm the required delegated permissions are present.
3. Click **Grant admin consent for <Tenant>** if your role allows it.
4. Ask the user to reload VS Code and sign in again.

#### Redirect URI mismatch

If Microsoft Entra reports a redirect URI mismatch, the built-in VS Code provider reached your app registration but the current client platform URI is not registered.

Typical causes:

- `http://localhost` was not added
- `https://vscode.dev/redirect` was not added
- the broker/mobile redirect URI with your client ID was not added
- one of the VS Code helper URIs was omitted

What to do:

1. Open **Authentication** on the app registration.
2. Recheck every redirect URI listed in **Step B** above.
3. Make sure `ms-appx-web://Microsoft.AAD.BrokerPlugin/<your-client-id>` uses the exact app client ID.
4. Save changes, reload VS Code, and retry sign-in.

#### License missing

If mail and Teams search work but SharePoint / OneDrive search still fails, first verify `Files.Read.All` and `Sites.Read.All` consent for the signed-in user. If Chat-related experiences fail, Microsoft 365 Copilot licensing may still be required.

Common symptoms:

- SharePoint or OneDrive queries return errors or no usable results
- Chat-related retrieval features are unavailable
- sign-in succeeds, but only retrieval-based features fail

What to check:

1. Confirm the user has the expected Microsoft 365 license.
2. For SharePoint / OneDrive search, confirm `Files.Read.All` and `Sites.Read.All` were granted and consented.
3. For Chat scenarios, confirm the user also has the required Microsoft 365 Copilot license if your tenant requires it.
4. If licenses were assigned recently, wait for propagation and retry.
5. If the pilot does not need retrieval features yet, temporarily keep `contextRelay.adapters.sharepoint`, `contextRelay.adapters.onedrive`, and `contextRelay.enableChatPreview` disabled.

---

## Usage

### Opening the Panel

Click the **ContextRelay** icon in the Activity Bar, or run:

```
ContextRelay: Open Panel
```

from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

On first use, VS Code prompts you to sign in using the built-in Microsoft authentication provider.

### Chatting and Searching

Type a normal message without a slash command and press **Enter** to start or continue a Microsoft 365 Copilot chat. ContextRelay does not automatically search Microsoft 365 sources for plain chat messages, but if you already have **pinned snippets** or **`#` file mentions** in the message, they are attached as explicit context automatically — you don't need `/ask` to use them. When that context is attached, ContextRelay also tells Copilot to prefer it over web search results for that turn. The response stays in the panel and offers explicit actions to **Copy**, **Append** to the active editor, or **Replace** the active selection/document.

To search Microsoft 365 sources, prefix your query with a slash command:

```
/all architecture decisions
/mail project kickoff notes
/teams sprint review decisions
/sharepoint API design document
/onedrive architecture diagram
```

After you pin snippets or run a search, later chat turns can continue in the same Copilot conversation with that explicit ContextRelay context (pinned snippets and the latest search summary). Copilot's own conversation history already keeps track of previous answers, so ContextRelay does not re-send them.

### Building a Handoff from Search Results

1. Run a search and open a result in the details pane.
2. Select the important text in the details body.
3. Click **Add selection** to save just that excerpt, or **Add preview** to save the full details body.
4. Review saved excerpts in the **Handoff** tab.
5. Click **Generate Docs** to write `HANDOFF.md`, `PLAN.md`, `TASKS.md`, and `TEST_PLAN.md`.

You can still pin a result card directly. When the item is a supported document or message, ContextRelay now attempts to fetch the **full content** before saving it into the Handoff workflow. The recommended path is still **details text selection → Handoff tab → document generation** when you only want the relevant excerpt.

### Generating Handoff Documents

Run the command from the Command Palette:

```
ContextRelay: Generate Handoff Docs
```

Each run appends a new timestamped section (UTC) to the corresponding file in the configured output directory:

```
.contextrelay/
  PLAN.md
  TASKS.md
  TEST_PLAN.md
  HANDOFF.md
```

### Copilot Handoff

Use the built-in commands to hand off context to GitHub Copilot:

- **ContextRelay: Open Copilot Chat with Handoff Prompt** -- Opens Copilot Chat with a pre-filled prompt referencing `HANDOFF.md`.
- **ContextRelay: Copy Handoff Prompt to Clipboard** -- Copies a ready-to-paste Copilot prompt.

Attach `HANDOFF.md` in Copilot Chat using VS Code's context mechanisms (#-mentions / Add Context).

### `/ask` — Require pinned snippets before asking Microsoft 365 Copilot

Plain chat (see [Chatting and Searching](#chatting-and-searching)) already attaches pinned snippets and `#` file mentions automatically, so `/ask` is **optional**. Use `/ask` when you want ContextRelay to refuse to send the message unless that context is present — useful as a guardrail before an unattended or scripted prompt.

1. Pin one or more documents (`.docx`, SharePoint / OneDrive files, mail, Teams messages). ContextRelay hydrates full document text where possible.
2. In the chat input, type `/ask` followed by your instruction, for example:

  ```
  /ask Translate the pinned document into Japanese and output as markdown.
  /ask Summarize the pinned documents as a bullet list.
  /ask Extract every action item as JSON with fields owner, due, task.
  ```

3. ContextRelay sends the pinned content plus your instruction to Microsoft 365 Copilot and renders the response in the panel. Use the response actions to copy it, append it at the active editor cursor, or replace the active selection/document.

If no snippets are pinned and no `#` file is mentioned, `/ask` is aborted with a warning instead of falling back to an ungrounded chat. Because this feature relies on the Microsoft 365 Copilot API (beta), you must have a Microsoft 365 Copilot license on the signed-in account and `contextRelay.enableChatPreview` enabled.

To sign out, use the **Accounts** menu in VS Code.

### `/workiq` — Query Work IQ for Microsoft 365 work intelligence

Use `/workiq` to send natural language queries to the [Work IQ Gateway](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq-api-quickstart) via the A2A (Agent-to-Agent) v1.0 protocol. Work IQ provides AI-powered access to emails, meetings, files, and organizational knowledge.

1. In the chat input, type `/workiq` followed by your question:

   ```
   /workiq Summarize my recent emails from Alice
   /workiq What meetings do I have today?
   /workiq Find documents about the Q3 budget review
   ```

2. ContextRelay sends the query to the Work IQ Gateway and displays the response in the panel.

3. Consecutive `/workiq` queries maintain conversation context, so follow-up questions ("Tell me more about the 2 PM call") work naturally.

> **Prerequisites**: The `/workiq` command requires a Microsoft 365 Copilot license and the `WorkIQAgent.Ask` delegated permission on your Entra app registration. See [docs/work_iq.md](docs/work_iq.md) for setup instructions.

> **Note**: When `/workiq` is specified, all other slash commands in the input are ignored and treated as part of the query text.

---

## Contributing

Contributions are welcome! Please review the guidelines below before submitting a pull request.

Please also read [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Commit your changes: `git commit -m "feat: add my feature"`.
4. Push the branch: `git push origin feature/my-feature`.
5. Open a Pull Request.

---

## License

This project is licensed under the [MIT License](LICENSE).
