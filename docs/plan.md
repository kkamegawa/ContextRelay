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
| `/sharepoint <query>` | Microsoft Graph Search adapter (SharePoint) |
| `/onedrive <query>` | Microsoft Graph Search adapter (OneDrive for Business) |
| `/embedded <query>` | Opt-in Copilot Retrieval adapter for one configured SharePoint Embedded container type |
| `/all <query>` | Fan-out to all enabled adapters |
| `/ask <prompt>` | Microsoft 365 Copilot Chat API; **requires** at least one pinned snippet or attached file (`#file`, 📎, drag and drop, or the opt-in active editor), otherwise aborts with a warning |
| `<prompt>` (no prefix) | Microsoft 365 Copilot Chat API; same context handling as `/ask` but does **not** require pinned snippets or attached files |

### 4.2 Router rules

- **With slash command**: run only the specified adapter.
- **Without slash command**: run all enabled adapters in parallel, merge results by source section.
- **Empty query after slash command**: show inline help and examples.

### 4.3 Result rendering

- Results are rendered as **source sections** (Mail / Teams / SharePoint / OneDrive / SharePoint Embedded / Connectors), not a single mixed list.
- In `/all` or no-prefix mode, cached results are included in the merge (see Section 9 — Cache policy).
- `/ask` and no-prefix chat share one code path: whenever pinned snippets or attached files are present, they are attached as Copilot `additionalContext` (local file content is read and inlined, capped at 12,000 characters per file) or `contextualResources.files` (pinned SharePoint/OneDrive `https://` files), the prompt is prefixed with an explicit grounding instruction, and `contextualResources.webContext.isWebEnabled` is set to `false` for that turn so Copilot prefers the attached context over web search. SharePoint Embedded retrieval extracts are pinned and passed as text in `additionalContext`; their `webUrl` is an opaque source link and is not treated as a fetchable `contextualResources.files` attachment. The only behavioral difference is that `/ask` refuses to send the message when neither pinned snippets nor attached files are present; no-prefix chat sends the message ungrounded instead.
- Local files can be attached with `#` mentions, the 📎 picker (also the **ContextRelay: Attach File to Chat** command), drag and drop onto the input, or the opt-in active editor (`contextRelay.chat.attachActiveEditor`, default `false`). All sources resolve to one `ResolvedAttachment` type with shared workspace-path validation, are de-duplicated by path, and are limited as a whole by `contextRelay.chat.maxAttachedFiles` (default `5`); `#` mentions come first, then 📎/drag-and-drop files, then the active editor, and files left out are reported. Each file is re-validated when it is read (real path and file identity through an open handle, so a path swapped for a symlink is not read) and only a bounded amount is read. Attachments are consumed once the message is submitted; files attached while a reply is in flight stay pending for the next message. The `/ask` guard is evaluated on the built payload, so an attachment that can no longer be read does not satisfy it. Local files are never sent as `file://` URIs, because `contextualResources.files` accepts OneDrive/SharePoint URIs only.
- Replies use the `chatOverStream` endpoint when `contextRelay.chat.streamResponses` is `true` (default) and render incrementally with a Stop button. The synchronous endpoint is used once as a fallback only when the service reports the streamed endpoint as unavailable (HTTP 404, 405, or 501). Network errors, other HTTP errors, failures after the stream was accepted, and cancellation are reported without resending, so a turn is never duplicated. A stream that fails after partial output is closed with the partial reply before the error is shown, and clearing the chat while a reply is in flight cancels it without adding anything to the cleared transcript.

---

## 5. API strategy

### 5.1 Microsoft 365 Copilot Retrieval API (v1.0)

Used for Copilot Connectors and the opt-in SharePoint Embedded source. Existing SharePoint and OneDrive commands use Microsoft Graph Search; they are separate adapters and are not Retrieval API calls. Retrieval returns permission-trimmed text extracts.

- **Endpoint**: `POST https://graph.microsoft.com/v1.0/copilot/retrieval`
- **dataSource values used by ContextRelay**: `externalItem` for Connectors and `sharePointEmbedded` for the configured Embedded source.
- **Delegated permissions** (least privileged):
  - `ExternalItem.Read.All` — for connectors (optional)
- **SharePoint Embedded**: delegated `FileStorageContainer.Selected`, plus an owning-app container-type registration grant for the ContextRelay app with the required content-read permission. Effective access is bounded by both the app grant and the signed-in user's membership/permissions on each container.
- **Entitlement**: Connectors require the applicable Copilot license or supported consumption offer. SharePoint Embedded uses the container-type pay-as-you-go configuration described in §5.1.1.
- [Retrieval API overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/overview) | [API reference](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/retrieval/copilotroot-retrieval)

### 5.1.1 SharePoint Embedded source

`/embedded <query>` accepts a natural-language query. `containerTypeId` is configuration, not part of the user's query. When there is one enabled source, ContextRelay uses it directly; when there are several, the user chooses a friendly source name in a Quick Pick. The API request uses `dataSource: "sharePointEmbedded"` and the selected source's `containerTypeId`. Retrieval is limited to containers of that type that the signed-in user can access.

The setting `contextRelay.embedded.enabled` is opt-in and defaults to `false`. Enabled sources are configured as `{ name, containerTypeId, enabled }` entries under `contextRelay.embedded.sources`. A container type ID is an opaque identifier and belongs in settings, not in chat text or slash-command queries.

The container-type owner must register the ContextRelay application's delegated content-read grant for the target container type. Graph's delegated `FileStorageContainer.Selected` permission is also required; it is requested in the dedicated Embedded session described in §7.5.

If the selected source, its settings, or the result-limit or cache settings change while a search is in flight, the response is discarded and the panel reports that the search must be run again. A discarded search never ends without a visible result or message. A Microsoft sign-in event, such as the Work IQ or Embedded session being created, clears cached Embedded results but does not discard a search in flight, because that response was permission-trimmed for the identity that sent it. Cache keys include a fingerprint of the Embedded token, so later searches never reuse results across identities. Clearing the chat supersedes a search in flight, so its response never repopulates the cleared transcript or search summary. Cancelling the source picker re-enables the input without showing an error. Container-type registration is controlled by the owning application; adding a container type ID to ContextRelay settings cannot grant access to a container type owned by Microsoft Loop or another application. Therefore this feature targets explicitly authorized SharePoint Embedded container types and does not promise tenant-wide or cross-owner Loop workspace search. Users still need access to the individual containers.

The `sharePointEmbedded` Retrieval API data source is in preview and uses pay-as-you-go billing configured for the container type. At least one user in the tenant must have a Microsoft 365 Copilot license to initialize the semantic index; each querying user does not need an individual Copilot license for this data source. See [SharePoint Embedded setup](spe-embedded.md) before enabling it.

### 5.1.2 SharePoint and OneDrive search

The existing `/sharepoint` and `/onedrive` commands use the Microsoft Graph Search API (`POST /v1.0/search/query`) with the `driveItem` entity type and their respective source query scopes. They require delegated `Files.Read.All` and `Sites.Read.All` and use the standard Microsoft 365 Graph entitlement. Do not describe these calls as Copilot Retrieval. The Copilot Retrieval API can provide extracts from SharePoint and OneDrive, but that is not the current behavior for these commands.

### 5.2 Microsoft 365 Copilot Chat API (beta)

Used for multi-turn conversation grounded in organizational data and optional web search.

- **Create conversation**: `POST https://graph.microsoft.com/beta/copilot/conversations`
- **Continue conversation**: `POST https://graph.microsoft.com/beta/copilot/conversations/{id}/chat`
- **Note**: `/beta` APIs may change without notice and are not recommended for production use.
- **Delegated permissions**: `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All`, `ExternalItem.Read.All`
- **Requires**: Microsoft 365 Copilot license assigned to the user.
- **Grounding**: `additionalContext` is *extra* grounding only — Copilot still consults web and enterprise search unless told otherwise. ContextRelay pairs it with an explicit prompt instruction and `contextualResources.webContext = { isWebEnabled: false }` whenever pinned snippets or attached local files are included (see §4.3). Local file content is inlined as `additionalContext`. Pinned SharePoint/OneDrive files with an `https://` URL are sent as `contextualResources.files` instead, so Copilot fetches them directly.
- **Conversation history**: the Chat API keeps prior turns server-side via the conversation id, so ContextRelay does not re-send previous answers as context.
- [Chat API overview](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/overview) | [API reference](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/api/ai-services/chat/copilotroot-post-conversations)

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
| Graph Search (SharePoint/OneDrive) | `Files.Read.All`, `Sites.Read.All` | Microsoft 365 standard service entitlement |
| Retrieval (Connectors) | `ExternalItem.Read.All` | Microsoft 365 Copilot or supported consumption offer |
| Retrieval (SharePoint Embedded) | `FileStorageContainer.Selected` (delegated) and owner-issued container-type app grant | Container-type pay-as-you-go; one tenant user needs Copilot for index initialization |
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
- `/sharepoint` → Microsoft Graph Search adapter (SharePoint)
- `/onedrive` → Microsoft Graph Search adapter (OneDrive for Business)
- `/embedded` → opt-in Retrieval adapter (sharePointEmbedded); resolves configured source before calling Graph
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
- The extension requests the union of scopes needed for enabled adapters in one shared Microsoft Graph session.
- SharePoint Embedded is excluded from that union. `/embedded` acquires a dedicated session with `User.Read` and `FileStorageContainer.Selected` (plus the same client and tenant overrides) only when it runs. Missing Embedded consent therefore fails `/embedded` alone and never blocks Mail, Teams, SharePoint, OneDrive, OneNote, tasks, Connectors or Chat.
- Work IQ also uses its own session because it targets a different resource.
- Root cause of `AADSTS65002`: VS Code's default first-party client ID is not preauthorized for this extension's Graph scopes.
- [VS Code Microsoft auth provider issue #115626](https://github.com/microsoft/vscode/issues/115626) | [Scopes and permissions](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)

---

## 8. Unified result model

All adapters return a common `ContextItem` shape for consistent rendering and merging:

```ts
type ContextSource = 'sharepoint' | 'onedrive' | 'sharepoint-embedded' | 'mail' | 'teams' | 'connectors';

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
| `contextRelay.adapters.mail` | boolean | true | Enable Exchange Mail adapter |
| `contextRelay.adapters.teams` | boolean | true | Enable Teams adapter |
| `contextRelay.adapters.sharepoint` | boolean | true | Enable SharePoint adapter |
| `contextRelay.adapters.onedrive` | boolean | true | Enable OneDrive adapter |
| `contextRelay.adapters.connectors` | boolean | false | Enable Copilot connectors adapter |
| `contextRelay.embedded.enabled` | boolean | false | Enable the preview SharePoint Embedded Retrieval source |
| `contextRelay.embedded.sources` | array | `[]` | Named sources with `name`, `containerTypeId`, and `enabled` fields |

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

### 12.4 Copilot license or retrieval entitlement not available

- Connector Retrieval and Chat require the applicable Copilot entitlement. SharePoint Embedded Retrieval uses its container-type pay-as-you-go configuration and requires at least one tenant Copilot user for semantic-index initialization; each query user need not have an individual Copilot license. If an API returns an entitlement error (403), show a source-specific message.
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
| M1 | Graph Search adapters (SharePoint/OneDrive), Connectors Retrieval, and snippet pinning |
| M2 | Slash router + Exchange Mail adapter + Teams adapter |
| M3 | Chat tab (beta) + conversation UI |
| M4 | Doc generation (timestamped append) + handoff bundle + Copilot helpers |
| M5 | Cache (LRU + stale-while-revalidate) + error hardening + throttle/backoff |
| M6 | Opt-in SharePoint Embedded Retrieval for explicitly authorized container types |

---

## Appendix A: Minimum VS Code version

**Target**: VS Code 1.140+

Key API dependencies:
- `vscode.authentication.getSession` (available since VS Code 1.63)
- `WebviewViewProvider` (available since VS Code 1.51)
- Microsoft authentication provider built-in extension (available since VS Code 1.75)

VS Code 1.140 is the declared runtime floor so it remains aligned with the `@types/vscode` 1.140 development baseline.

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

---

## Appendix C: Documentation set

| Document | Language | Content |
|---|---|---|
| `README.md` | English | Features, requirements, permissions, installation, configuration, sign-in troubleshooting, and usage. The English README is the source of truth. |
| `README_ja.md` | Japanese | Full translation of `README.md`, with the same heading structure, tables, and code blocks, so both can be reviewed side by side. |
| `SECURITY.md` / `LICENSE` | English only | Never translated. |
| `docs/*.md` | English, with `_ja` variants where a Japanese audience needs them | Design plan, tasks, test plan, ADR, Work IQ setup, and tenant admin material. |
| `docs/spe-embedded.md` / `docs/spe-embedded_ja.md` | English / Japanese | SharePoint Embedded Retrieval setup, access layers, billing, and development MCP configuration. |

## Change history

| Date | Change |
|---|---|
| 2026-10-24 | User-approved design and implementation scope: add opt-in SharePoint Embedded Retrieval by friendly named source, document its owning-app permission and billing prerequisites, configure read-only SPE MCP for supported development clients, and assess Work IQ REST while excluding Work IQ MCP. |
| 2026-10-24 | User-approved review fixes: Embedded uses a dedicated sign-in session, in-flight searches invalidated by setting changes report a message, sign-in events clear cached results without discarding in-flight searches, and each SPE MCP client keeps its own state directory. See [ADR 0001](adr/0001-sharepoint-embedded-retrieval.md). |

The panel's own user-facing text (welcome block, slash menu, help text, guard warnings) is English and lives in the source, not in these documents. The welcome block is defined once in `src/chatWelcomeText.ts` and rendered by both the extension host and the webview.
