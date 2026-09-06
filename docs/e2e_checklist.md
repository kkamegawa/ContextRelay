# ContextRelay — E2E Manual Checklist

This checklist is intended for manual verification in a VS Code Extension Development Host or a packaged extension install.

Use the following status markers while executing the checklist:

- `[ ]` Not run
- `[x]` Passed
- `[~]` Passed with notes
- `[!]` Failed / needs investigation

Recommended execution metadata to capture with each run:

- Date / time
- Tester name
- VS Code version
- OS
- Tenant/account used
- Whether Microsoft 365 Copilot license was available
- Evidence links or screenshots, if applicable

---

## 0. Execution log

| Field | Value |
|---|---|
| Run date | |
| Tester | |
| VS Code version | |
| OS | |
| Account / tenant | |
| Copilot license available | |
| Notes | |

---

## 1. Environment setup

- VS Code 1.85+
- Windows or macOS test machine
- Microsoft 365 work/school account
- A tenant with:
  - Exchange mail data
  - Teams messages
  - SharePoint / OneDrive data
  - Optional: Microsoft 365 Copilot license for Retrieval and Chat scenarios
- Fresh workspace with write access for `.contextrelay/`

Recommended pre-run settings:

```jsonc
{
  "contextRelay.maxResults": 5,
  "contextRelay.cache.ttlSeconds": 300,
  "contextRelay.cache.maxEntries": 50,
  "contextRelay.cache.persistWorkspaceState": true,
  "contextRelay.enableChatPreview": true,
  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": true,
  "contextRelay.adapters.sharepoint": true,
  "contextRelay.adapters.onedrive": true,
  "contextRelay.adapters.connectors": false
}
```

---

## 2. Pre-flight smoke checks

### E2E-00 Activity Bar entry
- Status: [ ]
- Steps:
  1. Launch the extension host.
  2. Look for the **ContextRelay** icon in the Activity Bar.
- Expected:
  - The icon renders correctly.
  - The view opens without a blank/error panel.

### E2E-01 Command availability
- Status: [ ]
- Steps:
  1. Open Command Palette.
  2. Search for `ContextRelay:`.
- Expected:
  - `ContextRelay: Open Panel`
  - `ContextRelay: Search`
  - `ContextRelay: Clear Cache`
  - `ContextRelay: Clear All Snippets`
  - `ContextRelay: Generate Handoff Docs`
  - `ContextRelay: Open Copilot Chat with Handoff Prompt`
  - `ContextRelay: Copy Handoff Prompt to Clipboard`
  are all listed.

---

## 3. Authentication flow

### E2E-10 First-use unauthenticated state
- Status: [ ]
- Steps:
  1. Open the panel in a fresh window.
  2. Do not sign in yet.
- Expected:
  - Header does not show an account label.
  - Sign-in button is visible.

### E2E-11 Sign in from panel
- Status: [ ]
- Steps:
  1. Set `contextRelay.auth.clientId`.
  1. Click **Sign in**.
  2. Complete VS Code Microsoft authentication.
- Expected:
  - Built-in VS Code Microsoft authentication flow starts.
  - Header shows `Signed in: <account>`.
  - Sign-in button disappears.

### E2E-12 Auth required during search
- Status: [ ]
- Steps:
  1. Sign out from VS Code Accounts.
  2. Run a search from the panel.
- Expected:
  - Search does not crash.
  - An auth-required panel message is shown.
  - Clicking the inline **Sign in** button starts authentication.

### E2E-13 Session change refresh
- Status: [ ]
- Steps:
  1. Sign in.
  2. Sign out via VS Code Accounts menu.
  3. Return to the panel.
- Expected:
  - Header reflects the signed-out state.
  - Search/chat actions require re-authentication.

### E2E-14 Missing app-registration configuration
- Status: [ ]
- Steps:
  1. Clear `contextRelay.auth.clientId`.
  2. Click **Sign in**.
- Expected:
  - The panel shows an actionable error explaining that the built-in VS Code auth provider needs a custom client id override for these Graph scopes.

### E2E-15 AADSTS65002 regression check
- Status: [ ]
- Steps:
  1. Configure `contextRelay.auth.clientId` and the required redirect URIs.
  2. Trigger sign-in again.
- Expected:
  - The previous `AADSTS65002` preauthorization error does not occur.

---

## 4. Search flow

### E2E-20 Command Palette search on first open
- Status: [ ]
- Steps:
  1. Reload the window.
  2. Before manually opening the panel, run `ContextRelay: Search`.
  3. Enter `architecture decisions`.
- Expected:
  - Panel opens/focuses.
  - The query appears in the search box.
  - Search runs automatically.
  - No query is lost on the first attempt.

### E2E-21 Bare query fan-out
- Status: [ ]
- Steps:
  1. Search for `architecture decisions`.
- Expected:
  - All enabled adapters run.
  - Results are grouped by source.
  - Partial failures do not block successful sources.

### E2E-22 Slash command routing
- Status: [ ]
- Steps:
  1. Run `/mail project kickoff`.
  2. Run `/teams sprint review`.
  3. Run `/sharepoint vpn guide`.
  4. Run `/onedrive architecture diagram`.
- Expected:
  - Each query only renders the targeted source.

### E2E-23 Empty slash command help
- Status: [ ]
- Steps:
  1. Run `/mail`.
- Expected:
  - Inline help text is shown with examples.

### E2E-24 Search result actions
- Status: [ ]
- Steps:
  1. Run any successful search.
  2. Use **Open**, **Pin**, and **Copy** on at least one result.
- Expected:
  - **Open** launches the external browser/target URL.
  - **Pin** saves the result as a snippet.
  - **Copy** places a Markdown citation on the clipboard.

---

## 5. Chat flow

### E2E-30 Chat enabled
- Status: [ ]
- Steps:
  1. Set `contextRelay.enableChatPreview` to `true`.
  2. Open the panel.
- Expected:
  - Chat tab is visible.
  - Beta API warning is visible.

### E2E-31 Chat disabled
- Status: [ ]
- Steps:
  1. Set `contextRelay.enableChatPreview` to `false`.
  2. Re-open or refresh the panel.
- Expected:
  - Chat tab is hidden.
  - If Chat was active, UI falls back to Search.

### E2E-32 Multi-turn chat
- Status: [ ]
- Steps:
  1. Enable Chat.
  2. Ask a first question.
  3. Ask a follow-up question.
  4. Click **New Conversation**.
- Expected:
  - User and assistant bubbles render correctly.
  - Follow-up uses the same conversation.
  - New Conversation clears the visible conversation.

### E2E-33 Plain chat grounds on pinned snippets without `/ask`
- Status: [ ]
- Steps:
  1. Run a search and pin a result with the 📌 button.
  2. Without typing `/ask`, send a plain chat message asking about the pinned content.
  3. Unpin the item and send the same message again.
- Expected:
  - Step 2: the response reflects the pinned content, and the message shows `Context: 📌 <title>` beneath it.
  - Step 3: no `Context:` line is shown, and the response is a normal ungrounded chat reply (no error).
  - `/ask` sent with no pinned snippet and no `#file` mention still aborts with the existing warning.

---

## 6. Snippets flow

### E2E-40 Save and list snippets
- Status: [ ]
- Steps:
  1. Pin one or more search results.
  2. Open the **Snippets** tab.
- Expected:
  - Saved snippets are listed with title, source, and timestamp.

### E2E-41 Remove snippet
- Status: [ ]
- Steps:
  1. Remove one snippet from the Snippets tab.
- Expected:
  - The snippet disappears immediately.

### E2E-42 Clear all snippets
- Status: [ ]
- Steps:
  1. Click **Clear All** in the Snippets tab.
- Expected:
  - The list becomes empty.
  - Empty state text is shown.

### E2E-43 Persistence across reload
- Status: [ ]
- Steps:
  1. Save a snippet.
  2. Reload the VS Code window.
  3. Open Snippets.
- Expected:
  - The snippet persists across reload.

---

## 7. Cache flow

### E2E-50 Cached repeat query
- Status: [ ]
- Steps:
  1. Run a search.
  2. Run the same search again within TTL.
- Expected:
  - Results render immediately.
  - Source sections show a **Cached** badge.

### E2E-51 Background refresh
- Status: [ ]
- Steps:
  1. Repeat the same query within TTL.
  2. Observe the result sections.
- Expected:
  - Cached data renders first.
  - Refreshed data can replace a section with **Updated just now**.

### E2E-52 Clear cache
- Status: [ ]
- Steps:
  1. Use `ContextRelay: Clear Cache` or the Settings button.
  2. Re-run a previous query.
- Expected:
  - No cached badge is shown on the first post-clear run.

---

## 8. Handoff and doc generation

### E2E-60 Generate docs manually
- Status: [ ]
- Steps:
  1. Save at least one snippet.
  2. Run `ContextRelay: Generate Handoff Docs`.
- Expected:
  - `.contextrelay/PLAN.md`
  - `.contextrelay/TASKS.md`
  - `.contextrelay/TEST_PLAN.md`
  - `.contextrelay/HANDOFF.md`
  are created/updated.

### E2E-61 Appended updates
- Status: [ ]
- Steps:
  1. Generate docs twice.
  2. Inspect the generated files.
- Expected:
  - Each file contains multiple `## Update (...)` sections.
  - Existing content is not corrupted.

### E2E-62 Search summary in handoff docs
- Status: [ ]
- Steps:
  1. Run a search that returns results from multiple sources.
  2. Generate handoff docs.
  3. Open `PLAN.md` and `HANDOFF.md`.
- Expected:
  - Files include the latest query summary.
  - Per-source result counts and representative titles are present.

### E2E-63 Copy handoff prompt auto-generates docs
- Status: [ ]
- Steps:
  1. Delete `.contextrelay/HANDOFF.md` if it exists.
  2. Run `ContextRelay: Copy Handoff Prompt to Clipboard`.
- Expected:
  - HANDOFF docs are generated automatically.
  - Clipboard contains a prompt referencing `HANDOFF.md`.

### E2E-64 Open Copilot Chat auto-generates docs
- Status: [ ]
- Steps:
  1. Delete `.contextrelay/HANDOFF.md` if it exists.
  2. Run `ContextRelay: Open Copilot Chat with Handoff Prompt`.
- Expected:
  - HANDOFF docs are generated automatically.
  - Copilot Chat opens with a prompt, or a clear VS Code error message is shown if Chat is unavailable.

---

## 9. Error handling

### E2E-70 Partial failure in /all mode
- Status: [ ]
- Steps:
  1. Disable one permission or otherwise force one adapter to fail.
  2. Run a bare query.
- Expected:
  - Successful source sections still render.
  - Failed source shows an error banner.

### E2E-71 Invalid/open failure handling
- Status: [ ]
- Steps:
  1. Trigger an item whose URL cannot be opened, if possible.
- Expected:
  - The panel shows a clear error banner instead of crashing.

### E2E-72 No sensitive output in docs/logs
- Status: [ ]
- Steps:
  1. Run search, chat, and handoff flows.
  2. Inspect generated docs and visible errors.
- Expected:
  - No access token values are shown.
  - No raw auth headers are exposed.

---

## 10. Completion criteria

The E2E run is considered successful when:

- All core flows complete without panel crashes.
- Search, snippets, docs, and handoff helpers behave consistently on first use and after reload.
- Chat visibility follows the feature flag.
- Handoff docs include both snippets and the latest search summary.
- Validation commands all succeed:

```bash
npm run compile
npm run lint
npm test
npm run security:check
```

---

## 11. Execution result summary

| Area | Status | Notes |
|---|---|---|
| Panel launch | [ ] | |
| Authentication | [ ] | |
| Search | [ ] | |
| Chat | [ ] | |
| Snippets | [ ] | |
| Cache | [ ] | |
| Doc generation | [ ] | |
| Handoff helpers | [ ] | |
| Error handling | [ ] | |
| Final verdict | [ ] | |
