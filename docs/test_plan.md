# ContextRelay — Test Plan

> Cross-reference: [plan.md](plan.md) for design rationale, [tasks.md](tasks.md) for implementation tasks, and [e2e_checklist.md](e2e_checklist.md) for a step-by-step manual verification runbook.

---

## 1. Test scope

Authentication, slash routing, Retrieval API, Chat API (beta), Exchange Mail adapter, Teams adapter, cache, saved snippets, timestamped doc generation, error handling, and security.

## 2. Environment

- VS Code 1.85+ (stable channel)
- Work/school account (Microsoft Entra ID)
- Microsoft 365 Copilot license assigned to the test account (required for Retrieval and Chat APIs)
- Standard Microsoft 365 license (sufficient for Exchange Mail and Teams adapters)

---

## 3. Authentication

**T-AUTH-01 Sign in**
- Steps: Configure `contextRelay.auth.clientId` → Open ContextRelay panel → Click "Sign in" or trigger first query
- Expected: VS Code built-in Microsoft authentication starts, and the signed-in account name is displayed in the panel header.

**T-AUTH-02 Session change / sign out**
- Steps: Sign out via VS Code Accounts menu
- Expected: Panel updates to show "Sign in" prompt; all queries are blocked until re-authentication.

**T-AUTH-03 Consent not granted**
- Steps: Attempt a query with an account that has not consented to required permissions
- Expected: Actionable error message listing the missing permissions, with instructions to contact tenant admin if admin consent is needed.

**T-AUTH-04 Missing client ID configuration**
- Steps: Remove `contextRelay.auth.clientId` and click "Sign in"
- Expected: Actionable error explains that the built-in VS Code Microsoft auth provider needs `contextRelay.auth.clientId` so it can override the default first-party client registration.

**T-AUTH-05 Default client preauthorization error is avoided**
- Steps: Configure `contextRelay.auth.clientId` and retry sign-in for Graph scopes that previously failed with `AADSTS65002`
- Expected: Sign-in no longer attempts to use VS Code's default client id `aebc6443-996d-45c2-90f0-388ff96faa56` for those scopes.

---

## 4. Slash command routing

**T-ROUTE-01 Default (no prefix)**
- Input: `architecture decisions`
- Expected: All enabled adapters are queried; results are rendered as separate source sections.

**T-ROUTE-02 Mail only**
- Input: `/mail incident review`
- Expected: Only Exchange Mail adapter runs; only Mail section is rendered.

**T-ROUTE-03 Teams only**
- Input: `/teams sprint review`
- Expected: Only Teams adapter runs; only Teams section is rendered.

**T-ROUTE-04 SharePoint only**
- Input: `/sharepoint VPN setup`
- Expected: Only Retrieval adapter (sharePoint) runs; only SharePoint section is rendered.

**T-ROUTE-05 OneDrive only**
- Input: `/onedrive architecture diagram`
- Expected: Only Retrieval adapter (oneDriveBusiness) runs; only OneDrive section is rendered.

**T-ROUTE-06 Explicit /all prefix**
- Input: `/all architecture decisions`
- Expected: All enabled adapters are queried; results are identical to a bare query.

**T-ROUTE-07 Empty query after slash command**
- Input: `/mail` (no query text)
- Expected: Inline help is shown with examples.

---

## 5. Retrieval API (SharePoint / OneDrive)

**T-RET-01 SharePoint retrieval**
- Call: `POST /v1.0/copilot/retrieval` with `dataSource=sharePoint`
- Expected: Response contains `webUrl` and `extracts[].text`; results are displayed as ContextItems in the SharePoint section.

**T-RET-02 OneDrive retrieval**
- Call: `POST /v1.0/copilot/retrieval` with `dataSource=oneDriveBusiness`
- Expected: Results are returned (if content exists); displayed in OneDrive section.

**T-RET-03 Permission missing**
- Setup: Use an account without `Sites.Read.All` consent
- Expected: Actionable error describing the needed permission.

**T-RET-04 Copilot license missing**
- Setup: Use an account without Microsoft 365 Copilot license
- Expected: Clear error message: "Microsoft 365 Copilot license is required for SharePoint/OneDrive search."

---

## 6. Chat API (beta)

**T-CHAT-01 Create conversation**
- Call: `POST /beta/copilot/conversations`
- Expected: 201 Created; conversation ID is stored; Chat tab shows conversation.

**T-CHAT-02 Multi-turn conversation**
- Steps: Send an initial message → receive response → send follow-up
- Expected: Conversation context is maintained; follow-up response is grounded in previous turns.

**T-CHAT-03 Beta warning**
- Steps: Open the Chat tab
- Expected: A visible "Preview/Beta API" warning banner is displayed.

**T-CHAT-04 Feature flag off**
- Setup: Set `contextRelay.enableChatPreview` to `false`
- Expected: Chat tab is hidden or disabled.

**T-CHAT-05 Pinned context grounds plain chat without `/ask`**
- Steps: Pin a search result → send a plain chat message (no `/ask`) referencing it
- Expected: Request body includes `additionalContext` (or `contextualResources.files` for a SharePoint/OneDrive URL) built from the pinned snippet, `contextualResources.webContext.isWebEnabled` is `false`, and the sent message text is prefixed with the ContextRelay grounding instruction. Response reflects the pinned content and the panel shows `Context: 📌 <title>`.

**T-CHAT-06 No pinned context leaves the request ungrounded**
- Steps: With no pinned snippets and no `#file` mention, send a plain chat message
- Expected: Request body has no `additionalContext`/`contextualResources`, and the message text sent to Copilot equals the user's input verbatim (no grounding prefix).

**T-CHAT-07 Previous answer is not re-sent as context**
- Steps: Send a first chat message → receive a response → send a second unrelated message
- Expected: The second request's `additionalContext` does not include the first response's text (conversation history is left to the Chat API's conversation id).

---

## 7. Exchange Mail adapter

**T-MAIL-01 Keyword search (default fields)**
- Input: `/mail pizza`
- API call: `GET /me/messages?$search="pizza"&$top=10`
- Expected: Results match keyword across `from`, `subject`, and `body`; displayed as ContextItems in Mail section.

**T-MAIL-02 KQL search**
- Input: `/mail from:alice subject:budget`
- API call: `GET /me/messages?$search="from:alice subject:budget"&$top=10`
- Expected: Results match KQL constraints.

**T-MAIL-03 Search-only enforcement**
- Steps: Run `/mail <keyword>` → interact with results (open, pin, copy)
- Expected: No secondary Graph calls for full message bodies; UI uses only `subject`, `bodyPreview`, `receivedDateTime`, and `webLink`.

---

## 8. Teams adapter

**T-TEAMS-01 Keyword search**
- Input: `/teams test`
- API call: `POST /search/query` with `entityTypes=["chatMessage"]`, `queryString="test"`
- Expected: Returns Teams message hits from both chat and channel contexts; displayed in Teams section.

**T-TEAMS-02 KQL scope terms**
- Input: `/teams contoso from:bob sent>2022-07-14`
- Expected: KQL scope terms are applied correctly.

**T-TEAMS-03 Known limitations**
- Steps: Run `/teams <keyword>` → check rendered fields
- Expected: UI gracefully shows only available fields (no crash on missing properties); "Open in Teams" link is shown when `webUrl` is present.

**T-TEAMS-04 Search-only enforcement**
- Steps: Run `/teams <keyword>` → interact with results (open, pin, copy)
- Expected: No additional Graph calls for full message details; UI uses only search-returned properties.

---

## 9. Cache

**T-CACHE-01 Cache hit**
- Steps: Run a query → wait for results → run the same query again within 5 minutes
- Expected: Results render immediately with "Cached" badge per source section.

**T-CACHE-02 Stale-while-revalidate**
- Steps: Run a query → run again within TTL → observe
- Expected: Cached results show immediately; background fetch updates the section (badge changes to "Updated just now").

**T-CACHE-03 TTL expiry**
- Steps: Run a query → wait for TTL expiration (5 min) → run again
- Expected: Cache miss; full fetch is triggered (no "Cached" badge).

**T-CACHE-04 Clear cache command**
- Steps: Run "ContextRelay: Clear Cache" command → run a previous query
- Expected: Cache is empty; full fetch is triggered.

---

## 10. Saved snippets

**T-SAVE-01 Persist across reload**
- Steps: Save a snippet from search results → reload VS Code window
- Expected: Saved snippet still appears in the Snippets tab.

**T-SAVE-02 Remove snippet**
- Steps: Remove a saved snippet
- Expected: Snippet is removed from the list; workspace state is updated.

**T-SAVE-03 Clear all**
- Steps: Run "Clear all snippets"
- Expected: All snippets are removed.

---

## 11. Doc generation

**T-DOC-01 Generate handoff docs**
- Steps: Run "ContextRelay: Generate Handoff Docs"
- Expected: Files are created/updated in the configured output directory with an appended `## Update (YYYY-MM-DDTHH:MM:SSZ)` section using UTC timestamps.

**T-DOC-02 Idempotent append**
- Steps: Run "Generate Handoff Docs" twice
- Expected: Two separate timestamped sections are appended; no corruption or duplication.

**T-DOC-03 HANDOFF.md content**
- Steps: Generate HANDOFF.md with search results and saved snippets present
- Expected: HANDOFF.md contains per-source top N items with citations/links and the current saved snippets list.

---

## 12. Copilot handoff helpers

**T-HANDOFF-01 Open Copilot Chat with handoff prompt**
- Steps: Run "ContextRelay: Open Copilot Chat with Handoff Prompt"
- Expected: GitHub Copilot Chat opens with a pre-filled prompt referencing `HANDOFF.md`.

**T-HANDOFF-02 Copy handoff prompt to clipboard**
- Steps: Run "ContextRelay: Copy Handoff Prompt to Clipboard" → paste into a text editor
- Expected: Clipboard contains a ready-to-paste prompt with file references to `HANDOFF.md`.

---

## 13. Error handling

**T-ERR-01 Throttling (429)**
- Setup: Trigger a 429 response (or mock)
- Expected: Automatic retry with exponential backoff; user sees a brief "Retrying..." indicator.

**T-ERR-02 Service unavailable (503)**
- Setup: Trigger a 503 response (or mock)
- Expected: Same retry behavior as 429 (exponential backoff, max 3 retries).

**T-ERR-03 Partial failure in /all mode**
- Setup: One adapter returns an error, others succeed
- Expected: Successful results are displayed; error banner shows for the failed adapter (e.g., "Mail search failed: 403 Forbidden").

**T-ERR-04 Unauthorized (401) mid-session**
- Setup: Trigger a 401 response from a Graph API call (e.g., expired token)
- Expected: Session is cleared; user is prompted to re-authenticate.

**T-ERR-05 Copilot license graceful degradation**
- Setup: Use an account without Microsoft 365 Copilot license → run a bare query (all sources)
- Expected: Retrieval and Chat adapters show license error; Mail and Teams adapters still return results. Extension falls back to offering only Mail and Teams.

**T-ERR-06 Permission missing per adapter**
- Setup: Use an account without `Mail.Read` → run `/mail <query>`
- Expected: Actionable error naming the missing permission (`Mail.Read`).

**T-ERR-07 No tokens in logs**
- Steps: Enable verbose logging → run queries → inspect log output
- Expected: No access tokens, PII, or user content in logs.

---

## 14. Non-functional tests

**T-NF-01 UI responsiveness**
- Steps: Initiate a query → interact with tabs and UI elements during load
- Expected: UI remains responsive; loading indicator is shown; tabs are navigable.

**T-NF-02 Theme compatibility**
- Steps: Switch between light, dark, and high-contrast themes
- Expected: Panel UI renders correctly in all themes.

**T-NF-03 Telemetry setting**
- Setup: Set `telemetry.telemetryLevel` to `off`
- Expected: No telemetry data is sent.
