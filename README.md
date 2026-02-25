# ContextRelay

ContextRelay is a VS Code extension that surfaces relevant Microsoft 365 context directly in a side panel while you design and code. It provides keyword-first search across Exchange mail, Teams messages, SharePoint sites, and OneDrive—with optional source targeting via slash commands. Pin key snippets and generate timestamped handoff documents (PLAN / TASKS / TEST / HANDOFF) so GitHub Copilot can pick up the work fast.

---

## Features

- **Keyword-first search** – Search across all connected Microsoft 365 sources with a single query.
- **Source targeting via slash commands** – Narrow results to a specific source instantly.

| Command | Source |
|---------|--------|
| `/mail <query>` | Exchange Online mail |
| `/teams <query>` | Microsoft Teams messages |
| `/sharepoint <query>` | SharePoint sites & pages |
| `/onedrive <query>` | OneDrive files |

- **Snippet pinning** – Save any search result as a named snippet, visible across sessions.
- **Timestamped handoff docs** – Generate Markdown documents that capture current context.

| Document | Purpose |
|----------|---------|
| `PLAN` | High-level goals and decisions |
| `TASKS` | Actionable to-do items |
| `TEST` | Test cases and acceptance criteria |
| `HANDOFF` | Full context summary for the next engineer or Copilot session |

- **GitHub Copilot ready** – Generated docs follow a structured format that Copilot can parse for continuity.

---

## Requirements

- [Visual Studio Code](https://code.visualstudio.com/) 1.85 or later
- A Microsoft 365 account (Exchange, Teams, SharePoint, and/or OneDrive access)
- An Azure AD app registration with the following Microsoft Graph API permissions:
  - `Mail.Read`
  - `ChannelMessage.Read.All`
  - `Sites.Read.All`
  - `Files.Read.All`

---

## Installation

### From the VS Code Marketplace

1. Open **Extensions** (`Ctrl+Shift+X` / `Cmd+Shift+X`).
2. Search for **ContextRelay**.
3. Click **Install**.

### From Source

Building the extension from source is not currently supported from this repository, which only contains documentation and supporting files.

To use ContextRelay, install it from the VS Code Marketplace as described above.

If/when the extension source is published in this repository, this section will be updated with correct build instructions.

---

## Configuration

Add the following settings to your `settings.json`:

```jsonc
{
  // Azure AD application (client) ID
  "contextRelay.clientId": "<your-client-id>",

  // Azure AD tenant ID (use "common" for multi-tenant)
  "contextRelay.tenantId": "<your-tenant-id>",

  // Number of search results returned per source (default: 10)
  "contextRelay.maxResults": 10,

  // Directory where handoff documents are saved (default: ".contextrelay")
  "contextRelay.outputDir": ".contextrelay"
}
```

On first use, ContextRelay will open a browser window for Microsoft authentication (OAuth 2.0 device-code flow).

---

## Usage

### Opening the Panel

Click the **ContextRelay** icon in the Activity Bar, or run:

```
ContextRelay: Open Panel
```

from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

### Searching

Type a keyword in the search box and press **Enter** to search all sources simultaneously.

To target a specific source, prefix your query with a slash command:

```
/mail project kickoff notes
/teams sprint review decisions
/sharepoint API design document
/onedrive architecture diagram
```

### Pinning Snippets

1. Hover over any search result.
2. Click the **pin** icon (📌) to save it as a snippet.
3. View all pinned snippets in the **Snippets** section of the panel.

### Generating Handoff Documents

Run the command from the Command Palette:

```
ContextRelay: Generate Handoff Docs
```

Choose one or more document types (**PLAN**, **TASKS**, **TEST**, **HANDOFF**). Documents are saved as Markdown files with a UTC timestamp in the configured output directory:

```
.contextrelay/
  PLAN-2025-06-01T12-00-00Z.md
  TASKS-2025-06-01T12-00-00Z.md
  TEST-2025-06-01T12-00-00Z.md
  HANDOFF-2025-06-01T12-00-00Z.md
```

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

