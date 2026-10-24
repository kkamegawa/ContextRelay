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

### 2026-09-21 — Consolidate the Mocha 12 and VS Code type updates

- Issue: [kkamegawa/ContextRelay#253](https://github.com/kkamegawa/ContextRelay/issues/253). Supersedes Dependabot pull requests [#251](https://github.com/kkamegawa/ContextRelay/pull/251) and [#252](https://github.com/kkamegawa/ContextRelay/pull/252).
- Pull request: [kkamegawa/ContextRelay#254](https://github.com/kkamegawa/ContextRelay/pull/254).
- Summary: Updated Mocha from 11.8.0 to 12.0.2 and `@types/vscode` from 1.136.0 to 1.138.0. Raised `engines.vscode` to `^1.138.0`, kept `engines.node` at `>=22.12.0`, and moved the Mocha-compatible overrides to `serialize-javascript` 7.1.1, `glob` 13.0.6, `diff` 9.0.0, and `js-yaml` 5.4.2. Regenerated `package-lock.json` with npm. No application or CI workflow code changed.
- Tests: Extended `src/test/suite/dependencyVersions.test.ts` with exact declaration and lockfile baselines, updated safe-version floors, and a regression that constructs and runs Mocha through the compiled CommonJS default import. `npm ci` completed with 0 vulnerabilities and no deprecated-package or dependency-conflict warning; `npm ls` resolved the four Mocha transitive dependencies to the reviewed versions. `npm run compile`, `npm run lint`, `npm test` (403 passing), the compiled `src/test/suite/index.ts` programmatic runner (403 passing), `npm run security:check` (0 vulnerabilities), `npm run package`, and `git diff --check` all passed.

### 2026-10-24 — SharePoint Embedded retrieval and standalone API setup

- Tracking: [parent #287](https://github.com/kkamegawa/ContextRelay/issues/287), [search/UI #288](https://github.com/kkamegawa/ContextRelay/issues/288), [MCP #289](https://github.com/kkamegawa/ContextRelay/issues/289), [documentation/API evaluation #290](https://github.com/kkamegawa/ContextRelay/issues/290). Branch: `codex/287-sharepoint-embedded`.
- Approved plan: [English Wiki](https://github.com/kkamegawa/ContextRelay/wiki/sharepoint-embedded-retrieval) / [Japanese Wiki](https://github.com/kkamegawa/ContextRelay/wiki/sharepoint-embedded-retrieval_ja). Wiki commit `48eddcf` was pushed and both plan pages, both Home pages and all Home-linked plan/language pages returned HTTP 200 (12 distinct public wiki routes).
- Implementation: Added opt-in natural-language `/embedded`, friendly selection of exactly one configured source, delegated Embedded scope, shared Retrieval transport, extract-preserving preview/pin/handoff/text grounding, identity/source-isolated in-memory cache and request-generation guards. Saved pins retain text plus only the source name/container identity, so reload/unpin keeps stable keys. Existing Graph file searches remain in place.
- Development setup: Added pinned read-only SPE MCP configurations for VS Code, Claude Code/Copilot CLI and Codex. JSON/TOML and the pinned package's MCP initialize/tools-list succeeded with 17 read-only tools. `codex mcp get spe --json` and `copilot mcp get spe --json` recognize the repository configuration. `claude mcp get spe` recognizes it but reports initial project approval pending; that interactive client trust step was not bypassed. No tenant authentication or content operations were performed by the MCP smoke check.
- Documentation: Corrected the current API description, added English/Japanese owner-grant setup examples, and evaluated direct Work IQ REST/A2A while excluding Work IQ MCP. The setup examples preserve all paged existing grants, reject unexpected pagination endpoints, omit read-only grant fields and default to preview. Loop-owned container access remains unverified. See [ADR 0001](adr/0001-sharepoint-embedded-retrieval.md).
- Build prerequisite: The initial mandatory audit failed. Updated development dependency `happy-dom` to 21.0.4 and transitive overrides `serialize-javascript` to 7.1.3 and `fast-uri` to 3.1.9; refreshed the lockfile and raised security regression floors. The original node_modules tree was stale relative to the existing lockfile; npm installation also synchronized those already-declared versions. No new extension runtime dependency was added.
- Local validation passed: `npm run compile`, `npm run compile:types`, `npm run compile:webview`, `npm run lint`, `npm test` (**437 passing, 0 failing**), `npm run vsce:package -- --out <TEMP_VSIX_PATH>` (21 entries), `npm run security:check` (**0 vulnerabilities**) and `git diff --check`. VSIX inspection confirmed Embedded settings/runtime code and excluded MCP, editor and local APM metadata. npm still reports pre-existing configuration warnings about http-proxy and allow-scripts; they did not fail validation.
- UI validation passed with local synthetic responses: ran the built extension in an isolated VS Code Insiders 1.144.0 development host, selected a friendly source name without entering a GUID, inspected both extracts in the internal preview and confirmed a saved pin appears as Unpin after reload. Actual screenshots exposed and led to fixes for unreachable preview, host/webview pin-key mismatch and badge overflow. After the final layout change, displayed the same production Webview bundle and production HTML at 320 px in a local browser harness; its card width was 238.59 px within a 318 px panel, with no card overflow. This is visual fixture evidence, not a live tenant test.
- Live verification not run: user-managed/Microsoft-owned Loop retrieval, actual container-type grants, user permission trimming, billing/index initialization and tenant Work IQ answers. No tenant resources, application grants or billing settings were changed. No application commit, branch push, pull request or Marketplace publication was performed.

### 2026-10-24 — Review fixes for SharePoint Embedded and Work IQ setup

- Tracking: [parent #287](https://github.com/kkamegawa/ContextRelay/issues/287), [search/UI #288](https://github.com/kkamegawa/ContextRelay/issues/288), [MCP #289](https://github.com/kkamegawa/ContextRelay/issues/289), [documentation/API evaluation #290](https://github.com/kkamegawa/ContextRelay/issues/290). Scope: the five highest-severity code review findings, approved by the user. Design changes are recorded in [ADR 0001](adr/0001-sharepoint-embedded-retrieval.md) and the plan's change history.
- Embedded session: `FileStorageContainer.Selected` was removed from the shared session. `AuthProvider.getEmbeddedAccessToken()` acquires a dedicated session, and `/embedded` and its preview use it, so missing Embedded consent no longer blocks the other adapters.
- Discarded searches: when Embedded, result-limit or cache settings change during `/embedded`, the panel now shows an error and the search summary records it, instead of ending silently. A Microsoft session event (for example `/workiq` or the new Embedded session signing in) now clears cached results only, so it no longer discards the search in flight.
- README (English/Japanese): added the Work IQ service principal to the `/workiq` prerequisites.
- MCP state: `.mcp.json` starts `scripts/spe-mcp.cjs`, which gives Claude Code and Copilot CLI separate absolute state directories under the home directory. The launcher is excluded from the VSIX by the existing `scripts/*spe-mcp*` rule. The VS Code and Codex configurations are unchanged.
- Work IQ documentation (English/Japanese): restored the Work IQ service principal step required by Microsoft's tenant setup, added Bash/PowerShell 7 Azure CLI examples, renumbered the steps, and added the WIQ-01 to WIQ-07 Loop verification items.
- Tests added or updated: `authProvider.test.ts`, `chatViewProvider.test.ts` and the new `speMcpLauncher.test.ts`.
- Local validation passed (run by the user, because the agent's sandbox could not run Node.js): `npm run compile` (including the precompile audit, **0 vulnerabilities**), `npm run lint` (no errors or warnings) and `npm test` (**443 passing, 0 failing**).
- Not run: live launches of the MCP launcher from Claude Code and Copilot CLI, and the Work IQ verification items WIQ-01 to WIQ-07.

### 2026-10-24 — PR review fixes for SharePoint Embedded UI state

- Pull request: [kkamegawa/ContextRelay#291](https://github.com/kkamegawa/ContextRelay/pull/291) review comments.
- Clearing the chat now supersedes an in-flight `/embedded` request and releases its loader, so a late response cannot repopulate the cleared transcript or search summary.
- Cancelling the Embedded source picker sends `submissionCancelled`, which re-enables the panel input.
- Result cards remember whether an Embedded hit has extracts, so a saved pin without extracts keeps an enabled Unpin button when pin state arrives after the results.
- Tests added: `chatViewProvider.test.ts` (clear during search, picker cancellation) and `chatRenderer.test.ts` (late pin state for an extract-less hit).
- Local validation passed (run by the user): `npm test` (**445 passing, 0 failing**).
