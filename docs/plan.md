# ContextRelay — VS Code Extension Design Plan

## 0. Product intent

ContextRelay is a VS Code extension that uses the signed-in organizational account (Microsoft Entra ID work/school) to call Microsoft Graph and Microsoft 365 Copilot APIs, surfacing SharePoint, OneDrive, Teams, and Exchange information in a side panel while the developer designs and codes. Results can be pinned as snippets and exported as structured handoff documents for GitHub Copilot.

---

## 1. Supported identity

- **Work/school accounts only** (Microsoft Entra ID). Personal Microsoft accounts are not supported.
- Reason: The Copilot Retrieval API does not support personal Microsoft accounts. [ref: Retrieval API docs](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval)

---

## 2. Key scenarios (user stories)

1. **Design-time context lookup** — Search Microsoft 365 content from a side panel using keyword queries, optionally narrowed by slash commands (e.g., `/mail`, `/teams`).
2. **Grounded chat** — Multi-turn Q&A using the Microsoft 365 Copilot Chat API (beta), grounded in organizational data.
3. **Snippet pinning** — Save any search result as a named snippet for later reference across sessions.
4. **Copilot handoff artifacts** — Generate and append timestamped sections to `PLAN.md`, `TASKS.md`, `TEST_PLAN.md`, and optionally `HANDOFF.md` for GitHub Copilot.

---

## 3. UX constraints

- Side panel only (no inline editor UI, no CodeLens).
- A single input box supports both natural-language queries and slash commands.

---

## 4. Source routing (slash commands)

### 4.1 Command grammar

| Command | Target |
|---|---|
| `/mail <query>` | Exchange Mail adapter |
| `/teams <query>` | Teams adapter (chat + channel messages) |
| `/sharepoint <query>` | Retrieval adapter (SharePoint) |
| `/onedrive <query>` | Retrieval adapter (OneDrive for Business) |
| `/all <query>` | Fan-out to all enabled adapters |
| `<query>` (no prefix) | Same as `/all` |

### 4.2 Router rules

- **With slash command**: run only the specified adapter.
- **Without slash command**: run all enabled adapters in parallel, merge results by source section.
- **Empty query after slash command**: show inline help and examples.

### 4.3 Result rendering

- Results are rendered as **source sections** (Mail / Teams / SharePoint / OneDrive / Connectors), not a single mixed list.
- In `/all` or no-prefix mode, cached results are included in the merge (see Section 9 — Cache policy).

---

## 5. API strategy

### 5.1 Microsoft 365 Copilot Retrieval API (v1.0)

Used when the target source is SharePoint, OneDrive, or Connectors. Returns permission-trimmed text extracts.

- **Endpoint**: `POST https://graph.microsoft.com/v1.0/copilot/retrieval`
- **dataSource values**: `sharePoint`, `oneDriveBusiness`, `externalItem`
- **Delegated permissions** (least privileged):
  - `Files.Read.All` + `Sites.Read.All` — for SharePoint/OneDrive
  - `ExternalItem.Read.All` — for connectors (optional)
- **Requires**: Microsoft 365 Copilot license assigned to the user.
- [Retrieval API overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/overview) | [API reference](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval)

### 5.2 Microsoft 365 Copilot Chat API (beta)

Used for multi-turn conversation grounded in organizational data and optional web search. Backs both `/ask` and plain chat — see §7.6 for how ContextRelay context is attached.

- **Create conversation**: `POST https://graph.microsoft.com/beta/copilot/conversations`
- **Continue conversation (synchronous)**: `POST https://graph.microsoft.com/beta/copilot/conversations/{id}/chat` — request body: `{ message: { text }, locationHint: { timeZone }, additionalContext?, contextualResources? }`
- **Continue conversation (streamed)**: `POST https://graph.microsoft.com/beta/copilot/conversations/{id}/chatOverStream` — same request body, `Accept: text/event-stream`; each SSE frame carries a full `copilotConversation` snapshot (not a delta). ContextRelay renders replies incrementally from this endpoint by default (`contextRelay.chat.streamResponses`), falling back to the synchronous endpoint once if the streamed request is never accepted by the service. A failure *after* acceptance is never retried via the synchronous endpoint, since that would resend the prompt and create a duplicate conversation turn.
- `contextualResources.files` accepts **OneDrive/SharePoint URIs only** — local files are never passed by reference there. ContextRelay reads local file content and sends it via `additionalContext` instead.
- **Note**: `/beta` APIs may change without notice and are not recommended for production use.
- **Delegated permissions**: `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`
- **Requires**: Microsoft 365 Copilot license assigned to the user.
- [Chat API overview](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/overview) | [Continue conversation (chat)](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat) | [Continue conversation (chatOverStream)](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chatoverstream)

### 5.3 Exchange Mail adapter (Microsoft Graph)

The Copilot Retrieval API does not cover Exchange mail directly, so this adapter uses Microsoft Graph.

- **Scope**: Messages only (no calendar in v1).
- **Search method**: `$search` query parameter on the message collection (KQL-based).
  - `GET https://graph.microsoft.com/v1.0/me/messages?$search="{kqlOrKeyword}"`
  - Default `$search` targets `from`, `subject`, and `body` when no property is specified.
  - Advanced KQL supported (e.g., `from:alice subject:budget`).
- **Delegated permission**: `Mail.Read`
- **v1 scope lock**: Search results only. No "fetch more details" or full message body retrieval.
- [Graph $search parameter](https://learn.microsoft.com/en-us/graph/search-query-parameter)

### 5.4 Teams adapter (Microsoft Graph — Microsoft Search API)

The Copilot Retrieval API does not cover Teams messages directly, so this adapter uses the Microsoft Search API.

- **Scope**: Both chat messages and channel messages.
- **Search method**: Microsoft Search API with `chatMessage` entity type.
  - `POST https://graph.microsoft.com/v1.0/search/query`
  - Request body: `{ "entityTypes": ["chatMessage"], "query": { "queryString": "<kqlOrKeyword>" }, "size": <N>, "enableTopResults": true }`
  - Supports KQL scope terms (e.g., `from:`, `hasAttachment:`, `sent>`, `mentions:`).
- **Known limitations**:
  - Only messages the signed-in user is included in are accessible.
  - Not all `chatMessage` properties are returned by search.
  - Sorting is not supported for Teams message search.
- **Delegated permissions**: `Chat.Read`, `ChannelMessage.Read.All`
- **v1 scope lock**: Search results only. No follow-up fetch for full message details.
- [Search Teams messages](https://learn.microsoft.com/en-us/graph/search-concept-chat-messages)

---

## 6. Consolidated permission matrix

| Adapter | Permissions required | License required |
|---|---|---|
| Retrieval (SharePoint/OneDrive) | `Files.Read.All`, `Sites.Read.All` | Microsoft 365 Copilot |
| Retrieval (Connectors) | `ExternalItem.Read.All` | Microsoft 365 Copilot |
| Chat (beta) | `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All` | Microsoft 365 Copilot |
| Exchange Mail | `Mail.Read` | Microsoft 365 (standard) |
| Teams | `Chat.Read`, `ChannelMessage.Read.All` | Microsoft 365 (standard) |

**Note**: Some permissions (e.g., `ChannelMessage.Read.All`) may require tenant admin consent.

---

## 7. Architecture

### 7.1 Extension activation

- `activationEvents`: `onView:contextRelay.panel`
- The extension activates when the user opens the ContextRelay side panel.

### 7.2 Side panel (WebviewView)

- **View container**: "ContextRelay" in the Activity Bar.
- **Implementation**: `WebviewViewProvider` for rich HTML-based UI.
- **Tabs**: Search | Chat | Snippets | Settings
- **Theme support**: Must respect VS Code theme variables (`--vscode-*` CSS custom properties) for light, dark, and high-contrast themes.
- **Accessibility**: Standard keyboard navigation; ARIA attributes on interactive elements.

### 7.3 Component overview

```
┌─────────────────────────────────────────────┐
│  ContextRelay Side Panel (WebviewView)      │
│  ┌──────┬──────┬──────────┬────────┐        │
│  │Search│ Chat │ Snippets │Settings│  ← Tabs │
│  └──────┴──────┴──────────┴────────┘        │
│  ┌─────────────────────────────────────┐    │
│  │ [/mail query_________________] [⏎]  │    │
│  └─────────────────────────────────────┘    │
│  ┌─── SharePoint ──────────────────────┐    │
│  │  Result 1  [pin] [copy] [open]      │    │
│  │  Result 2  [pin] [copy] [open]      │    │
│  └─────────────────────────────────────┘    │
│  ┌─── Mail ────────────────────────────┐    │
│  │  Result 3  [pin] [copy] [open]      │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 7.4 Command router

Parses the input text, extracts the optional slash prefix, and dispatches to the appropriate adapter(s):

- `/mail` → Exchange Mail adapter
- `/teams` → Teams adapter
- `/sharepoint` → Retrieval adapter (sharePoint)
- `/onedrive` → Retrieval adapter (oneDriveBusiness)
- `/all` or no prefix → all enabled adapters in parallel

### 7.5 Authentication

Uses the VS Code Authentication API with the built-in Microsoft authentication provider, but injects a custom Entra app registration through provider scope overrides.

```ts
const session = await vscode.authentication.getSession(
  'microsoft',
  [
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Mail.Read',
    'VSCODE_CLIENT_ID:<your-client-id>',
    'VSCODE_TENANT:organizations'
  ],
  { createIfNone: true }
);
```

- A Microsoft Entra app registration is required for the Graph scopes used by this extension.
- `contextRelay.auth.clientId` is required; `contextRelay.auth.tenantId` is optional and defaults to `organizations`.
- The built-in VS Code provider still owns the auth UX, token cache, and refresh behavior.
- The extension requests the union of scopes needed for enabled adapters.
- Root cause of `AADSTS65002`: VS Code's default first-party client ID is not preauthorized for this extension's Graph scopes.
- [VS Code Microsoft auth provider issue #115626](https://github.com/microsoft/vscode/issues/115626) | [Scopes and permissions](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)

### 7.6 Local file attachment pipeline

Four attachment origins — `#file` mentions typed in the prompt, drag-and-drop onto the input, the attach-file picker button, and the (opt-in) active-editor auto-attach — all resolve into a single `ResolvedAttachment` shape (`src/panel/attachments.ts`) so downstream context-building code only has one type to handle:

```
#mention ──┐
drop ──────┼─→ resolveAttachmentPath() ─→ ResolvedAttachment[] ─→ mergeAttachments() ─→ buildChatContextPayload()
picker ────┤        (workspace containment,                    (dedupe by canonical
activeEditor ┘        symlink realpath,                          absolute path,
                       extension allowlist)                      later group wins)
```

- Path validation (workspace containment, symlink realpath resolution) is shared via `src/panel/workspacePath.ts` so every attachment origin gets identical guarantees, including `#` mentions.
- Attached file content (or the selected line range, for the active-editor origin) is read and inlined into `additionalContext` at send time — never passed by reference in `contextualResources.files`, since that field only accepts OneDrive/SharePoint URIs (see §5.2).
- Attachments are always included regardless of `/ask` vs. plain chat — attaching a file is an explicit user action, unlike ContextRelay's own accumulated context (pinned snippets, latest visible result, latest search summary), which only `/ask` includes.

---

## 8. Unified result model

All adapters return a common `ContextItem` shape for consistent rendering and merging:

```ts
type ContextSource = 'sharepoint' | 'onedrive' | 'mail' | 'teams' | 'connectors';

interface ContextItem {
  source: ContextSource;
  title: string;
  snippet: string;
  url?: string;
  timestamp?: string;       // ISO 8601 string (UTC)
  relevance?: number;       // 0..1, when available (e.g., Retrieval relevanceScore)
  cache: {
    hit: boolean;           // true if served from cache
    storedAt?: string;      // ISO 8601 timestamp when cached
    ttlSeconds?: number;
  };
  raw?: unknown;            // original API response; not persisted
}
```

---

## 9. Cache policy

| Parameter | Default | Configurable |
|---|---|---|
| TTL | 300 seconds (5 min) | `contextRelay.cache.ttlSeconds` |
| Max entries | 200 | `contextRelay.cache.maxEntries` |
| Eviction strategy | LRU | — |
| Persistence | Workspace state | `contextRelay.cache.persistWorkspaceState` |

### 9.1 Stale-while-revalidate

In `/all` or no-prefix mode:

1. Render cached results immediately per source section (with "Cached" badge).
2. Fetch fresh results in the background.
3. Replace each source section when fresh results arrive (with "Updated just now" badge).

After TTL expiry, the cache entry is treated as a miss and a full fetch is required.

---

## 10. Output artifacts for GitHub Copilot handoff

### 10.1 Timestamped append strategy

Each time the user runs "Generate Handoff Docs", the extension appends a new section to the target file(s):

```markdown
## Update (YYYY-MM-DDTHH:MM:SSZ)

<generated content>
```

Timestamps use UTC in ISO 8601 format.

### 10.2 Handoff bundle

| File | Content |
|---|---|
| `PLAN.md` | High-level goals and decisions |
| `TASKS.md` | Actionable to-do items |
| `TEST_PLAN.md` | Test cases and acceptance criteria |
| `HANDOFF.md` (optional) | Current decisions, open questions, next tasks, per-source top N items with citations/links, relevant snippets |

### 10.3 GitHub Copilot integration

- Command: "Open Copilot Chat with Handoff Prompt" — opens GitHub Copilot Chat with a pre-filled prompt referencing `HANDOFF.md`.
- Command: "Copy Handoff Prompt to Clipboard" — copies a ready-to-paste prompt.
- `HANDOFF.md` should be attached in Copilot Chat using VS Code's context attachment mechanisms (#-mentions / Add Context).

---

## 11. Extension settings

All settings use the `contextRelay.*` namespace.

| Setting | Type | Default | Description |
|---|---|---|---|
| `contextRelay.maxResults` | number | 10 | Number of search results returned per source |
| `contextRelay.outputDir` | string | `.contextrelay` | Directory where handoff documents are saved |
| `contextRelay.cache.ttlSeconds` | number | 300 | Cache TTL in seconds |
| `contextRelay.cache.maxEntries` | number | 200 | Maximum number of cached entries (LRU eviction) |
| `contextRelay.cache.persistWorkspaceState` | boolean | true | Persist cache snapshot in workspace state |
| `contextRelay.enableChatPreview` | boolean | true | Enable the Chat tab (Copilot Chat API is in beta) |
| `contextRelay.chat.attachActiveEditor` | boolean | false | Automatically include the active editor (or its selection) as chat context, like GitHub Copilot's editor context |
| `contextRelay.chat.streamResponses` | boolean | true | Render Copilot replies incrementally via the Chat API's streamed endpoint; falls back to the synchronous endpoint automatically if unavailable |
| `contextRelay.chat.maxAttachedFiles` | number | 5 | Maximum number of local files attachable to a single chat message |
| `contextRelay.adapters.mail` | boolean | true | Enable Exchange Mail adapter |
| `contextRelay.adapters.teams` | boolean | true | Enable Teams adapter |
| `contextRelay.adapters.sharepoint` | boolean | true | Enable SharePoint adapter |
| `contextRelay.adapters.onedrive` | boolean | true | Enable OneDrive adapter |
| `contextRelay.adapters.connectors` | boolean | false | Enable Copilot connectors adapter |

---

## 12. Error handling

### 12.1 Authentication errors

| Condition | Behavior |
|---|---|
| User not signed in | Show "Sign in" prompt in the panel. Block all queries until authenticated. |
| Session expired / revoked | Detect `AuthenticationSessionAccountChanged` event, clear cached session, prompt re-authentication. |
| Consent not granted | Show actionable error listing the missing permissions and instructions to contact tenant admin if admin consent is needed. |

### 12.2 API errors

| HTTP status | Behavior |
|---|---|
| 401 Unauthorized | Clear session, prompt re-authentication. |
| 403 Forbidden | Show permission error with the specific scope that is missing. |
| 429 Too Many Requests | Retry with exponential backoff (initial delay 1s, max 3 retries, max delay 30s). Respect `Retry-After` header if present. |
| 503 Service Unavailable | Same retry strategy as 429. |
| Other 4xx/5xx | Show user-friendly error message with the status code. |

### 12.3 Partial failure in `/all` mode

- If one adapter fails and others succeed, render successful results and show an error banner for the failed adapter(s) (e.g., "Mail search failed: 403 Forbidden — Mail.Read permission required").
- Do not block the entire query for a single adapter failure.

### 12.4 Copilot license not available

- Retrieval and Chat adapters require a Microsoft 365 Copilot license. If the API returns a license error (403), show a clear message: "Microsoft 365 Copilot license is required for SharePoint/OneDrive search and Chat features."
- Exchange Mail and Teams adapters work without a Copilot license using standard Microsoft Graph.
- The extension should gracefully degrade: if Copilot APIs are unavailable, only Mail and Teams adapters are offered.

---

## 13. Security and compliance

- **Delegated access only**: All API calls use delegated permissions. Results are permission-trimmed by the server—the extension never sees data the user is not authorized to access.
- **No raw tokens on disk**: Tokens are managed by VS Code's credential store. The extension does not persist tokens.
- **Secret storage**: If any extension-specific secrets are needed in the future, use the VS Code `SecretStorage` API.
- **Saved snippets**: User-controlled. Stored in workspace state. A "Clear all snippets" command is provided.
- **Cache**: Cached results are stored in workspace state. A "Clear cache" command is provided.
- **Logging**: No access tokens, user content, or PII in logs. The extension respects VS Code's telemetry settings (`telemetry.telemetryLevel`).

---

## 14. Pagination

### 14.1 Per-adapter behavior

| Adapter | Pagination mechanism | v1 behavior |
|---|---|---|
| Retrieval | Response includes `@odata.nextLink` if more results are available | Return up to `maxResults`; no "load more" in v1 |
| Chat | N/A (streaming conversation) | N/A |
| Exchange Mail | Graph supports `$top` and `$skip` | Return up to `maxResults` via `$top`; no "load more" in v1 |
| Teams | Search API supports `from` and `size` parameters | Return up to `maxResults` via `size`; no "load more" in v1 |

### 14.2 Future (post-v1)

A "Load more" button per source section that fetches the next page of results.

---

## 15. Milestones

| Milestone | Scope |
|---|---|
| M0 | Scaffolding + authentication + WebviewView panel |
| M1 | Retrieval adapter (SharePoint/OneDrive) + snippet pinning |
| M2 | Slash router + Exchange Mail adapter + Teams adapter |
| M3 | Chat tab (beta) + conversation UI |
| M4 | Doc generation (timestamped append) + handoff bundle + Copilot helpers |
| M5 | Cache (LRU + stale-while-revalidate) + error hardening + throttle/backoff |

---

## Appendix A: Minimum VS Code version

**Target**: VS Code 1.125+ (see `package.json` `engines.vscode`)

Key API dependencies:
- `vscode.authentication.getSession` (available since VS Code 1.63)
- `WebviewViewProvider` (available since VS Code 1.51)
- Microsoft authentication provider built-in extension (available since VS Code 1.75)

The minimum version tracks the pinned `@types/vscode` dependency rather than a fixed floor from the original 1.85 baseline, so this section should be kept in sync with `package.json` rather than treated as a separate source of truth.

---

## Appendix B: References

1. [Microsoft 365 Copilot APIs overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/copilot-apis-overview)
2. [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api)
3. [Copilot Retrieval API](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval)
4. [Copilot Chat API overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/overview)
5. [Copilot Chat API reference](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations)
6. [Graph $search parameter](https://learn.microsoft.com/en-us/graph/search-query-parameter)
7. [Search Teams chat messages](https://learn.microsoft.com/en-us/graph/search-concept-chat-messages)
8. [VS Code Microsoft auth provider](https://github.com/microsoft/vscode/blob/main/extensions/microsoft-authentication/README.md)
9. [VS Code Copilot Chat context](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
