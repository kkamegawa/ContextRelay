# ContextRelay

ContextRelay is a VS Code extension that surfaces relevant Microsoft 365 context directly in a side panel while you design and code. It provides keyword-first search across Exchange mail, Teams messages, SharePoint sites, and OneDrive — with optional source targeting via slash commands. Pin key snippets and generate timestamped handoff documents (PLAN / TASKS / TEST_PLAN / HANDOFF) so GitHub Copilot can pick up the work fast.

---

## Features

- **Keyword-first search** -- Search across all connected Microsoft 365 sources with a single query.
- **Source targeting via slash commands** -- Narrow results to a specific source instantly.

| Command | Source |
|---------|--------|
| `/mail <query>` | Exchange Online mail |
| `/teams <query>` | Microsoft Teams messages |
| `/sharepoint <query>` | SharePoint sites & pages |
| `/onedrive <query>` | OneDrive files |
| `/all <query>` | All enabled sources (same as no prefix) |

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

- [Visual Studio Code](https://code.visualstudio.com/) 1.85 or later
- A Microsoft 365 work/school account (Microsoft Entra ID). Personal Microsoft accounts are not supported.
- **For SharePoint/OneDrive search and Chat features**: Microsoft 365 Copilot license assigned to the user
- **For Exchange Mail and Teams search**: Standard Microsoft 365 license (no Copilot license needed)

### Required permissions

ContextRelay uses the VS Code built-in Microsoft authentication provider. No Azure AD app registration is needed. The following delegated permissions are requested via `vscode.authentication.getSession`:

| Permission | Used by |
|---|---|
| `Files.Read.All` | SharePoint / OneDrive search |
| `Sites.Read.All` | SharePoint / OneDrive search, Chat |
| `Mail.Read` | Exchange Mail search, Chat |
| `Chat.Read` | Teams search, Chat |
| `ChannelMessage.Read.All` | Teams search, Chat |
| `People.Read.All` | Chat |
| `OnlineMeetingTranscript.Read.All` | Chat |
| `ExternalItem.Read.All` | Connectors search, Chat (optional) |

> **Note**: Some permissions (e.g., `ChannelMessage.Read.All`) may require tenant admin consent.

---

## Installation

### From the VS Code Marketplace

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **ContextRelay**.
3. Click **Install**.

### From Source

1. Clone this repository.
2. Install dependencies:

  ```bash
  npm install
  ```

3. Build the extension:

  ```bash
  npm run compile
  ```

4. Press `F5` in VS Code to launch the Extension Development Host.

Before submitting changes, run:

```bash
npm run compile
npm run lint
npm test
npm run security:check
```

Additional project docs:

- [Design plan](docs/plan.md)
- [Implementation tasks](docs/tasks.md)
- [Test plan](docs/test_plan.md)
- [E2E manual checklist](docs/e2e_checklist.md)
- [E2E review summary](docs/e2e_report.md)

---

## Configuration

Add the following settings to your `settings.json` (all optional):

```jsonc
{
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
  "contextRelay.adapters.connectors": false
}
```

---

## Usage

### Opening the Panel

Click the **ContextRelay** icon in the Activity Bar, or run:

```
ContextRelay: Open Panel
```

from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

On first use, VS Code will prompt you to sign in with your Microsoft work/school account.

### Searching

Type a keyword in the search box and press **Enter** to search all enabled sources simultaneously. Results are grouped by source section (Mail / Teams / SharePoint / OneDrive).

To target a specific source, prefix your query with a slash command:

```
/mail project kickoff notes
/teams sprint review decisions
/sharepoint API design document
/onedrive architecture diagram
```

### Pinning Snippets

1. Hover over any search result.
2. Click the **pin** icon to save it as a snippet.
3. View all pinned snippets in the **Snippets** tab of the panel.

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

---

## Contributing

Contributions are welcome! Please review the guidelines below before submitting a pull request.

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`.
3. Commit your changes: `git commit -m "feat: add my feature"`.
4. Push the branch: `git push origin feature/my-feature`.
5. Open a Pull Request.

---

## License

This project is licensed under the [MIT License](LICENSE).
