# ContextRelay — Implementation Tasks

> Cross-reference: [plan.md](plan.md) for design rationale, [test_plan.md](test_plan.md) for acceptance testing.

---

## A. Scaffolding

- [ ] Create TypeScript extension scaffold (`yo code` or manual)
- [ ] Register view container **"ContextRelay"** in the Activity Bar (`package.json` → `contributes.viewsContainers`)
- [ ] Implement `WebviewViewProvider` for the side panel
- [ ] Render tab navigation: **Search | Chat | Snippets | Settings**
- [ ] Respect VS Code theme variables (`--vscode-*` CSS custom properties) for light, dark, and high-contrast themes
- [ ] Set `activationEvents`: `onView:contextRelay.panel`

**Acceptance**
- View container appears in the Activity Bar and renders the tabbed WebviewView UI.

---

## B. Authentication

- [ ] Implement sign-in using `vscode.authentication.getSession('microsoft', ...)` with custom client/tenant override scopes
- [ ] Build scope set dynamically based on enabled adapters (see permission matrix in plan.md Section 6)
- [ ] Listen for `onDidChangeSessions` to react to sign-out / account changes
- [ ] Show signed-in account name in the panel header
- [ ] Block all queries when not authenticated; show "Sign in" prompt

**Scope sets by adapter**:

| Adapter | Scopes |
|---|---|
| Retrieval (SharePoint/OneDrive) | `Files.Read.All`, `Sites.Read.All` |
| Retrieval (Connectors) | `ExternalItem.Read.All` |
| Chat (preview/beta) | `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All` |
| Exchange Mail | `Mail.Read` |
| Teams | `Chat.Read`, `ChannelMessage.Read.All` |

**Acceptance**
- Signed-in account shows in panel header.
- Token acquisition succeeds and is reused across adapter calls.

---

## C. Slash command router

- [ ] Parse input grammar: `/mail`, `/teams`, `/sharepoint`, `/onedrive`, `/all`, or bare query
- [ ] Route to the appropriate adapter(s)
- [ ] Default route when no prefix: `/all` (fan-out to all enabled adapters in parallel)
- [ ] Empty query after slash command: show inline help with examples

**Acceptance**
- `/mail foo` runs only Exchange Mail adapter.
- `foo` (no prefix) runs all enabled adapters.
- `/teams` (no query) shows inline help.

---

## D. Retrieval adapter (Copilot Retrieval API v1.0)

- [ ] Implement client for `POST https://graph.microsoft.com/v1.0/copilot/retrieval`
- [ ] Support `dataSource` values: `sharePoint`, `oneDriveBusiness`, `externalItem`
- [ ] Limit results via `maxResults` setting (`contextRelay.maxResults`)
- [ ] Map response to `ContextItem`:
  - `title` = document title or file name
  - `snippet` = `extracts[].text`
  - `url` = `webUrl`
  - `relevance` = relevance score when available
  - `source` = `sharepoint` | `onedrive` | `connectors`
- [ ] Result actions: Open link, Pin snippet, Copy as Markdown citation

**Acceptance**
- `/sharepoint <query>` returns extract list with citations.
- `/onedrive <query>` returns OneDrive results.

---

## E. Chat adapter (Copilot Chat API preview/beta)

- [ ] Gate behind `contextRelay.enableChatPreview` setting (default: `true`)
- [ ] Create conversation: `POST https://graph.microsoft.com/beta/copilot/conversations`
- [ ] Continue conversation: `POST https://graph.microsoft.com/beta/copilot/conversations/{id}/messages`
- [ ] Implement sync response first; streaming response as a follow-up
- [ ] Chat tab UI:
  - "New conversation" button
  - Messages view with user/assistant bubbles
  - "Preview/Beta API" warning banner
  - Conversation list (optional, if multiple conversations are supported)

**Acceptance**
- Multi-turn chat works in the Chat tab.
- UI displays a visible "Preview/Beta API" warning.

---

## F. Exchange Mail adapter (Graph `$search`)

- [ ] Implement keyword search: `GET https://graph.microsoft.com/v1.0/me/messages?$search="{kqlOrKeyword}"&$top={maxResults}`
- [ ] Support default keyword search (`from`, `subject`, `body` searched by default)
- [ ] Support advanced KQL (e.g., `from:alice subject:budget`)
- [ ] Map response to `ContextItem`:
  - `title` = `subject`
  - `snippet` = `bodyPreview` (or trimmed body excerpt)
  - `timestamp` = `receivedDateTime`
  - `url` = `webLink`
  - `source` = `mail`
- [ ] Result actions: Open link, Pin snippet, Copy as Markdown citation
- [ ] **v1 scope lock**: Do not fetch full message bodies beyond what the search response returns

**Acceptance**
- `/mail <keyword>` returns mail results matching the keyword.
- KQL patterns like `from:alice subject:budget` work correctly.
- No secondary Graph calls for full message bodies.

---

## G. Teams adapter (Microsoft Search API)

- [ ] Implement keyword search via Microsoft Search API:
  - `POST https://graph.microsoft.com/v1.0/search/query`
  - Body: `{ "entityTypes": ["chatMessage"], "query": { "queryString": "<kqlOrKeyword>" }, "size": <maxResults>, "enableTopResults": true }`
- [ ] Support KQL scope terms (e.g., `from:`, `hasAttachment:`, `sent>`, `mentions:`)
- [ ] Map search hits to `ContextItem`:
  - `title` = derive from sender + channel/chat name, or "Teams message"
  - `snippet` = `summary` from search hit + short body excerpt
  - `timestamp` = `createdDateTime` or `lastModifiedDateTime`
  - `url` = `webLink` / `webUrl` from resource
  - `source` = `teams`
- [ ] Handle known limitations:
  - Only messages the signed-in user is included in
  - Not all `chatMessage` properties are returned
  - Sorting is not supported
- [ ] Result actions: Open link, Pin snippet, Copy as Markdown citation
- [ ] **v1 scope lock**: Render only fields returned by search. No follow-up fetch for full message details.

**Acceptance**
- `/teams <keyword>` returns results from chat and channel contexts, grouped under Teams section.
- KQL scoping (e.g., `from:bob sent>2022-07-14`) works.
- No additional Graph calls beyond the search request.

---

## H. Cache (LRU + stale-while-revalidate)

- [ ] Add user settings (`package.json` → `contributes.configuration`):
  - `contextRelay.cache.ttlSeconds` (number, default `300`)
  - `contextRelay.cache.maxEntries` (number, default `200`)
  - `contextRelay.cache.persistWorkspaceState` (boolean, default `true`)
- [ ] Implement `CacheStore`:
  - In-memory LRU map (max entries)
  - Persist snapshot to `workspaceState` on update (if enabled)
  - Restore from `workspaceState` on activation
- [ ] Implement `getCachedOrFetch(source, query, fetchFn)`:
  - Return cached result immediately if within TTL
  - Trigger background refresh; emit event when fresh data arrives
- [ ] UI badges:
  - "Cached" badge when result is served from cache
  - "Updated just now" badge when background refresh completes
- [ ] Add "Clear cache" command

**Acceptance**
- Repeat a query within 5 minutes: cached results render immediately with "Cached" badge.
- Background refresh updates the section with "Updated just now" badge.
- After TTL expiry, cache miss triggers a full fetch.

---

## I. Saved snippets

- [ ] Persist saved snippets in `workspaceState`
- [ ] Commands:
  - Save selected result (from any adapter's search results)
  - Remove individual snippet
  - Clear all snippets
- [ ] Snippets tab: list all saved snippets with source, title, and timestamp

**Acceptance**
- Saved snippets survive VS Code window reload.

---

## J. Doc generation (timestamped append)

- [ ] Generate or update files in the configured output directory (`contextRelay.outputDir`):
  - `PLAN.md`, `TASKS.md`, `TEST_PLAN.md`
- [ ] Append a timestamped section on each generation:
  ```markdown
  ## Update (YYYY-MM-DDTHH:MM:SSZ)

  <generated content>
  ```
- [ ] Optional: generate `HANDOFF.md` including:
  - Current decisions, open questions, next tasks
  - Per-source top N items with citations/links
  - Saved snippets list

**Acceptance**
- Running "Generate Handoff Docs" appends `## Update (...)` sections with UTC timestamps.
- Running twice produces two separate sections without corruption.

---

## K. GitHub Copilot handoff helpers

- [ ] Add command: "ContextRelay: Open Copilot Chat with Handoff Prompt"
  - Opens GitHub Copilot Chat with a pre-filled prompt referencing `HANDOFF.md`
- [ ] Add command: "ContextRelay: Copy Handoff Prompt to Clipboard"
  - Copies a ready-to-paste prompt for Copilot Chat
- [ ] Include instructions to attach `HANDOFF.md` via VS Code context mechanisms (#-mentions / Add Context)

**Acceptance**
- One command produces a ready-to-paste Copilot prompt with file references.

---

## L. Error handling and hardening

- [ ] Implement retry with exponential backoff for 429/503 (initial 1s, max 3 retries, max 30s delay; respect `Retry-After` header)
- [ ] Handle partial failure in `/all` mode: render successful results, show error banner for failed adapter(s)
- [ ] Handle Copilot license errors (403): show message explaining Copilot license requirement; degrade gracefully to Mail + Teams only
- [ ] Handle authentication errors: 401 → clear session and re-prompt; consent errors → show missing permission details
- [ ] Ensure no access tokens, PII, or user content in logs
- [ ] Respect `telemetry.telemetryLevel` setting

**Acceptance**
- 429 responses trigger automatic retry with backoff.
- `/all` query with one failing adapter still shows results from other adapters.
- No tokens or PII appear in output logs.

---

## M. `/ask` without pinned context, real attachments, and streaming

Tracked in [issue #208](https://github.com/kkamegawa/ContextRelay/issues/208).

- [x] Remove the pinned-snippet/attachment guard that blocked `/ask` from running at all (the Chat API's `additionalContext`/`contextualResources` are optional, not required)
- [x] Redefine `/ask` as a strict-format mode (all available context + output-format instructions) vs. plain chat (no auto-attached ContextRelay context), matching the README's existing description of plain chat
- [x] Fix local `#` mention attachments: they were being sent as `file://` URIs inside `contextualResources.files`, a field documented as OneDrive/SharePoint URIs only — so local file content never actually reached Copilot. Local files are now read and inlined via `additionalContext`
- [x] Unify all attachment origins (`#` mention, drag-and-drop, attach-file picker, opt-in active editor) behind one `ResolvedAttachment` type and shared path-validation helpers (`src/panel/attachments.ts`, `src/panel/workspacePath.ts`)
- [x] Add `contextRelay.chat.attachActiveEditor` (default `false`), `contextRelay.chat.streamResponses` (default `true`), `contextRelay.chat.maxAttachedFiles` (default `5`)
- [x] Migrate response rendering to the Chat API's `chatOverStream` endpoint, with a one-shot fallback to the synchronous endpoint only when the streamed request was never accepted (falling back after acceptance would resend the prompt and create a duplicate conversation turn)

**Acceptance**
- `/ask` with no pinned snippets and no attachments still calls Copilot, with a non-blocking notice that no extra context was included.
- `/ask #some-file.md ...` sends the actual file content to Copilot (verified via `contextRelay.enableGraphDebugLogging`, confirming no `file://` URI appears in `contextualResources.files`).
- Plain chat continues to omit pinned snippets, the latest visible result, and the latest search summary; `/ask` includes them.

---

## Milestone mapping

| Milestone | Tasks |
|---|---|
| M0 | A (Scaffolding), B (Authentication) |
| M1 | D (Retrieval adapter), I (Saved snippets) |
| M2 | C (Slash router), F (Exchange Mail adapter), G (Teams adapter) |
| M3 | E (Chat adapter) |
| M4 | J (Doc generation), K (Copilot handoff helpers) |
| M5 | H (Cache), L (Error handling and hardening) |
