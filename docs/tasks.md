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
| Chat (beta) | `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All` |
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

## E. Chat adapter (Copilot Chat API beta)

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

## Milestone mapping

| Milestone | Tasks |
|---|---|
| M0 | A (Scaffolding), B (Authentication) |
| M1 | D (Retrieval adapter), I (Saved snippets) |
| M2 | C (Slash router), F (Exchange Mail adapter), G (Teams adapter) |
| M3 | E (Chat adapter) |
| M4 | J (Doc generation), K (Copilot handoff helpers) |
| M5 | H (Cache), L (Error handling and hardening) |

---

## Work log

### 2026-09-07 — Ground plain chat and `/ask` on pinned context automatically

- Issue: [kkamegawa/ContextRelay#232](https://github.com/kkamegawa/ContextRelay/issues/232)
- Summary: `/ask` and no-prefix plain chat already shared the same Copilot context-building code, but neither told Copilot to prefer pinned/`#file` context over web and enterprise search. Added an explicit grounding instruction and `contextualResources.webContext.isWebEnabled = false` whenever pinned snippets or `#file` mentions are attached, for both paths. Stopped re-sending the previous Copilot reply as context each turn. Removed the unused `src/panel/askPrompt.ts` prompt builder.
- Design record: [docs/adr.md](adr.md) — 2026-09-07 entry.
- Tests: `src/test/suite/chatContext.test.ts`, `src/test/suite/chatViewProvider.test.ts`, `src/test/suite/commandRouter.test.ts`.

### 2026-09-13 — Inline local file content, attachment UX, and streaming (supersedes PR #209)

- Issue: [kkamegawa/ContextRelay#208](https://github.com/kkamegawa/ContextRelay/issues/208)
- Summary: Rebuilt the design-independent parts of PR #209 on top of the #232 grounding model. Attached local files are now read and inlined into `additionalContext` instead of being sent as unsupported `file://` URIs. Added drag and drop, the 📎 picker, opt-in active-editor auto-attach, and `chatOverStream` streaming with a safe fallback. Every attachment source grounds the turn and satisfies the `/ask` guard. PR #209's `/ask` redefinition was not adopted.
- Design record: [docs/adr.md](adr.md) — 2026-09-13 entry.
- Tests: `src/test/suite/chatContext.test.ts`, `src/test/suite/chatViewProvider.test.ts`, `src/test/suite/attachments.test.ts`, `src/test/suite/sseParser.test.ts`, `src/test/suite/chatAdapter.test.ts`.

### 2026-09-14 — Raise the js-yaml override to 4.3.2 (GHSA-2883-xcg3-v3hh)

- Issue: [kkamegawa/ContextRelay#236](https://github.com/kkamegawa/ContextRelay/issues/236)
- Summary: `npm audit --audit-level=moderate` reported three high-severity findings, all from js-yaml 4.3.1 (GHSA-2883-xcg3-v3hh), reached directly and through `mocha` and `webpack-cli`. Raised `overrides.js-yaml` to 4.3.2, the newest 24h-eligible 4.x release, and refreshed `package-lock.json`, which clears all three and unblocks `npm run compile` and `npm run package` (both run `npm run security:check` first). Supersedes PR #238, which conflicts with `main`.
- Design record: [docs/adr.md](adr.md) — 2026-09-14 entry.
- Tests: `src/test/suite/dependencyVersions.test.ts` (js-yaml override baseline, version floor, and installed-version baseline raised to 4.3.2).

### 2026-09-14 — DOM/webview unit testing infrastructure

- Issue: [kkamegawa/ContextRelay#210](https://github.com/kkamegawa/ContextRelay/issues/210), with sub-issues [#211](https://github.com/kkamegawa/ContextRelay/issues/211), [#212](https://github.com/kkamegawa/ContextRelay/issues/212), [#213](https://github.com/kkamegawa/ContextRelay/issues/213), [#214](https://github.com/kkamegawa/ContextRelay/issues/214), and [#215](https://github.com/kkamegawa/ContextRelay/issues/215)
- Summary: Added `happy-dom` and a shared DOM test utility that loads the production panel HTML into a locked-down happy-dom window. Added unit tests for `ChatRenderer` (messages, streaming, result cards, pin state, loading, errors, and `clear()`), `HashMenu`, and the `SlashMenu` DOM class. Raised `engines.node` to `>=22.12.0` for `require(esm)`.
- Design record: [docs/adr.md](adr.md) — 2026-09-14 entry "Unit-test the webview DOM classes with happy-dom". Plan: [Wiki — Add DOM/Webview Unit Testing Infrastructure](https://github.com/kkamegawa/ContextRelay/wiki/dom-webview-test-infrastructure).
- Tests: `src/test/suite/domTestUtils.test.ts`, `src/test/suite/chatRenderer.test.ts`, `src/test/suite/hashMenu.test.ts`, `src/test/suite/slashMenu.test.ts`, `src/test/suite/dependencyVersions.test.ts`.

### 2026-09-19 — Merge the open Dependabot updates and restore the version baselines

- Issue: [kkamegawa/ContextRelay#247](https://github.com/kkamegawa/ContextRelay/issues/247)
- Summary: Merged the four open Dependabot pull requests in order — [#244](https://github.com/kkamegawa/ContextRelay/pull/244) `marked` 18.0.13, [#243](https://github.com/kkamegawa/ContextRelay/pull/243) `@typescript-eslint/parser` 8.70.0, [#245](https://github.com/kkamegawa/ContextRelay/pull/245) `@types/node` 26.6.1, and [#246](https://github.com/kkamegawa/ContextRelay/pull/246) `@typescript-eslint/eslint-plugin` 8.70.0. `@types/node` went to 26.6.1 rather than the proposed 26.5.0 because 26.6.1 is the current npm `latest` and is past the 24-hour publication policy; the other three were already at `latest`. Each branch was rebuilt on top of the updated `main` with a regenerated `package-lock.json` instead of a hand-merged one, so no merge conflict was left behind. The exact-match baselines in `dependencyVersions.test.ts` moved with each bump, which also cleared the two assertions that had been failing on `main` since `marked` 18.0.12 landed in [#242](https://github.com/kkamegawa/ContextRelay/pull/242) without a baseline update.
- Design record: [docs/adr.md](adr.md) — 2026-09-19 entry.
- Tests: `src/test/suite/dependencyVersions.test.ts` (baselines raised to `marked` 18.0.13, `@types/node` 26.6.1, and `@typescript-eslint/parser` / `@typescript-eslint/eslint-plugin` 8.70.0). Verified on every branch and on `main` with `npm install && npm run lint && npm run compile && npm test && npm run security:check` — 387 passing, 0 failing.

### 2026-09-19 — Sync the README and the panel welcome text with the `/ask` grounding behavior

- Issue: [kkamegawa/ContextRelay#249](https://github.com/kkamegawa/ContextRelay/issues/249)
- Summary: Audited README and `docs/` against the behavior changed by [#233](https://github.com/kkamegawa/ContextRelay/pull/233) and [#237](https://github.com/kkamegawa/ContextRelay/pull/237). The usage sections, the command table, `docs/plan.md`, `docs/test_plan.md`, `docs/e2e_checklist.md` and the router help text were already correct; four places were not. The README intro and the "Plain Copilot chat" feature bullet still implied that no context is attached without `/ask`; the welcome block rebuilt by `ChatRenderer.clear()` still told users to run `/ask` to use pinned snippets, contradicting the initial HTML; and the slash menu described `/ask` without its guard. The welcome text now lives once in `src/chatWelcomeText.ts` and is rendered by both the extension host and the webview. Added `README_ja.md`, a full Japanese translation with the same structure, cross-linked from `README.md`.
- Design record: [docs/adr.md](adr.md) — 2026-09-19 entry "Define the panel welcome text once, and add a Japanese README". Documentation set: [docs/plan.md](plan.md) Appendix C. Plan: [Wiki — Sync the README and the Panel Welcome Text with the `/ask` Grounding Behavior](https://github.com/kkamegawa/ContextRelay/wiki/ask-behavior-doc-sync).
- Tests: `src/test/suite/chatRenderer.test.ts` — two cases added: the block rebuilt by `clear()` must match the block in the shipped panel HTML (heading, paragraph text, font sizes, inline code), and the welcome text must state that pinned context is attached automatically. Verified with `npm run lint && npm run compile && npm test && npm run security:check` — 389 passing, 0 failing, 0 vulnerabilities.
