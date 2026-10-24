# SharePoint Embedded verification

Reviewed and executed locally on 2026-10-24 for [Issue #287](https://github.com/kkamegawa/ContextRelay/issues/287). Scope approval is the user conversation on this date.

## Scenarios

| ID | Scenario | Evidence and outcome |
|---|---|---|
| SPE-01 | Natural-language query, zero/one/multiple named sources, cancellation and invalid configuration | Automated provider/router/config tests passed; built native UI source picker inspected. |
| SPE-02 | Request payload, result limits, optional metadata, all extracts, auth scope | Adapter/auth tests passed. No live Graph request was made. |
| SPE-03 | Extract preview, pin persistence, per-container identity, handoff and additionalContext | Automated tests passed; native built UI preview and persisted Unpin state inspected with synthetic data. |
| SPE-04 | Identity/config changes and overlapping delayed searches | Provider tests passed; older requests cannot replace current results or complete the current spinner. |
| SPE-05 | Narrow panel layout | Final production Webview bundle/HTML visually inspected at 320 px; metadata wraps without card overflow. |
| SPE-06 | Read-only development MCP | Initialize/tools-list passed (17 tools). Codex and Copilot CLI found repo configuration; Claude found it with initial project approval pending. This evidence predates the `.mcp.json` launcher (see SPE-11). |
| SPE-07 | Complete permission grant registration examples | Local Bash/PowerShell synthetic paging/error and dry-run/apply checks passed; no tenant was contacted. |
| SPE-08 | Live container/Loop, effective permissions, billing and indexing | Not run: no approved test container/owner grant/billing fixture was provided. |
| SPE-09 | Dedicated Embedded session | Tests added: the shared session never includes `FileStorageContainer.Selected`, the Embedded session requests only its scope, and missing Embedded consent leaves the shared token available. Tests passed. |
| SPE-10 | Settings or sign-in change during a search | Tests passed: a search discarded by a settings change leaves an error message and search summary and stops the spinner; a Microsoft session event shows the in-flight result and drops cached results. |
| SPE-11 | Per-client MCP state directory | Tests passed for launcher client detection, absolute state paths and matching pinned version. Live launch logs from Claude Code and Copilot CLI are not verified. |

## Run results

The full unit suite passed with 437 tests. Type checks, lint, compilation, VSIX packaging and diff checks passed. The final dependency audit reported 0 vulnerabilities. Package inspection found 21 entries and no developer MCP/APM configuration. See [task evidence](../tasks.md) for exact commands and limitations.

SPE-09 to SPE-11 were added on 2026-10-24 for review fixes. After those fixes, `npm run compile` (0 vulnerabilities in the precompile audit), `npm run lint` and `npm test` (443 passing, 0 failing) passed.

Native UI fixture and local Webview harness results do not establish Microsoft-owned Loop access, live tenant search completeness, server billing or actual permission trimming. Do not mark SPE-08 passed based on local results.
