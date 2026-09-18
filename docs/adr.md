# Architecture Decision Records

## 2026-08-10 - Expand the Dependabot grouping task to remediate npm audit findings

- Task: Issue #199 and Sub-issue #200.
- Decision: Update direct and transitive npm dependency baselines together with the Dependabot security grouping configuration.
- Reason: Validation of the configuration-only change found existing moderate, high, and critical vulnerabilities, which prevented the required compile and security checks from passing.
- Compatibility: Keep all dependency updates within their existing major-version ranges and add regression tests for the safe version floors.

## 2026-09-07 - Raise the minimum supported VS Code version with the consolidated Dependabot update

- Task: Issue #230.
- Decision: Adopt `@types/vscode` 1.136.0 and raise `engines.vscode` to `^1.136.0`, and land every pending Dependabot npm update in a single consolidated pull request instead of merging pull requests #222-#229 individually.
- Reason: The repository policy adopts the newest stable release that has been public for more than 24 hours, and `dependencyVersions.test.ts` requires `@types/vscode` to stay at or below `engines.vscode`, so the type definitions cannot move forward without the engine declaration. Merging the Dependabot pull requests one at a time would break the exact-match version baselines in that test on every merge, which already required the repair in #221.
- Compatibility: The extension now requires VS Code 1.136.0 or later. All other updates stay within their existing major versions. `browserslist` and `fast-uri` were also advanced to clear GHSA-c83g-rgw3-j3cx and GHSA-5jgf-p345-68v8, and both now have version floors in `dependencyVersions.test.ts`.

## 2026-09-07 - Ground plain chat and /ask on pinned context, not just /ask

- Task: Bug report — plain chat (no `/ask`) ignored pinned snippets even though `docs/plan.md` §4.3 only described `/all`/no-prefix search rendering, not chat grounding.
- Decision:
  - Both `/ask` and no-prefix chat now build the same Copilot `additionalContext` / `contextualResources.files` payload from pinned snippets and `#file` mentions (they already shared `handleCopilotChat`; the gap was that neither path told Copilot to prefer that context).
  - Whenever that context is non-empty, prefix the prompt with an explicit grounding instruction and set `contextualResources.webContext = { isWebEnabled: false }` for that turn, per the Chat API's Example 3 (learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/copilotconversation-chat).
  - Stop re-sending the previous Copilot reply as `additionalContext` ("Latest visible ContextRelay result"); the Chat API already keeps conversation history server-side via the conversation id, and re-sending it consumed budget that should go to pinned context.
  - Remove the unused parallel prompt-builder `src/panel/askPrompt.ts` (dead since the Chat API migration) to avoid a second, inconsistent 60,000-character budget.
- Reason: The Chat API documents `additionalContext` as *extra* grounding only — Copilot keeps consulting web/enterprise search unless told otherwise — so attaching pinned content without an instruction let Copilot answer from unrelated sources. This was not a routing bug (`/ask` and plain chat always shared the same context-building code); it was a missing grounding instruction that `/ask`'s own wording ("Translate the pinned document...") happened to work around some of the time.
- Compatibility: `/ask` keeps its existing guard (aborts when no pinned snippet or `#file` mention is present); plain chat gains automatic grounding without a new required step. No settings were added. Does not conflict with the 2026-08-10 or 2026-09-07 (VS Code baseline) entries above, which only cover dependency/tooling decisions.

## 2026-09-13 - Inline local file content, add attachment UX and streaming on top of the #232 grounding model

- Task: Issue #208 (originally PR #209, superseded).
- Decision:
  - Keep the 2026-09-07 grounding model unchanged: `/ask` keeps its guard, plain chat attaches pinned snippets automatically, the grounding instruction and `webContext.isWebEnabled = false` apply only when pinned snippets or attached files are actually included, and a plain message with neither is sent ungrounded (the latest search summary is still sent as plain `additionalContext`).
  - Reject PR #209's redefinition of `/ask` (no guard, "strict format" wrapper via `askPrompt.ts`) and of plain chat (never attaching pinned snippets), because it contradicts the 2026-09-07 decision and reintroduces the "pins are ignored without `/ask`" behavior reported in #232. `askPrompt.ts` stays deleted and the previous reply is still not re-sent.
  - Adopt PR #209's local file fix: attached local files are read and inlined into `additionalContext` (capped at 12,000 characters per file within the shared 60,000-character budget) instead of being sent as `file://` URIs in `contextualResources.files`, which the Chat API documents as OneDrive/SharePoint URIs only. An attachment counts as grounding context only when its content was actually added, so an unreadable file does not ground the turn. Files are re-validated when read (real path and file identity through an open handle) and read with a bounded read, so a path swapped for a symlink after it was attached is not read.
  - Adopt PR #209's attachment UX (drag and drop, 📎 picker, opt-in active-editor auto-attach, `contextRelay.chat.maxAttachedFiles`) and treat every attachment source like a `#file` mention, including for the `/ask` guard. `maxAttachedFiles` applies to all sources combined (`#` mentions first, then 📎/drag-and-drop, then the active editor). The `/ask` guard is evaluated on the built payload, so an attachment that can no longer be read does not satisfy it.
  - Adopt PR #209's `chatOverStream` streaming (`contextRelay.chat.streamResponses`), falling back to the synchronous endpoint only when the service reports the streamed endpoint as unavailable (HTTP 404, 405, or 501). This is narrower than PR #209, which fell back on any failure before a response: after review of PR #237, a network error or timeout is surfaced instead, because the service may already have processed the POST. The grounded prompt is sent on both paths.
- Reason: The user chose the #232 grounding model as the baseline and asked to keep the parts of #209 that do not change it. Without the inline file fix, `#file` grounding from 2026-09-07 never delivered file content to Copilot.
- Compatibility: With `contextRelay.chat.attachActiveEditor` enabled, every Copilot message sent while a workspace file is open is grounded on that file; the setting is off by default. Consistent with the 2026-09-07 entry, which this entry extends rather than reverses.

## 2026-09-14 - Raise the js-yaml override to 4.3.2 to clear GHSA-2883-xcg3-v3hh

- Task: Issue #236 (supersedes PR #238, which conflicts with `main` after #237).
- Decision: Raise `overrides.js-yaml` from 4.3.1 to 4.3.2, refresh `package-lock.json`, and raise the js-yaml override baseline, version floor, and installed-version baseline in `dependencyVersions.test.ts` to 4.3.2.
- Reason: `npm audit --audit-level=moderate` reports three high-severity findings with a single root cause: js-yaml 4.0.0-4.3.1 is affected by GHSA-2883-xcg3-v3hh (`maxTotalMergeKeys` does not limit CPU use for empty merge sources). `mocha` and `webpack-cli` appear only as transitive paths to js-yaml. Because `precompile` and `prepackage` run `npm run security:check`, `npm run compile` and `npm run package` fail until the finding is cleared. 4.3.2 is the newest js-yaml 4.x release, is past the 24-hour publication policy, is not deprecated, and is the first release outside the affected range.
- Compatibility: Patch update within the existing 4.x major version, which satisfies both `mocha` (dependency range `^4.1.0`) and `webpack-cli` (optional peer range `^4.0.0 || ^5.0.0`), so no direct dependency changes are required. js-yaml 5.x is not adopted because it is outside the range `mocha` declares. Consistent with the 2026-08-10 and 2026-09-07 (VS Code baseline) entries, which keep security remediations within existing major versions and guard them with version floors.

## 2026-09-14 - Unit-test the webview DOM classes with happy-dom

- Task: Issue #210 (sub-issues #211-#215).
- Decision:
  - Use `happy-dom` (`^20.14.5`) as the DOM implementation for unit tests instead of `jsdom`, whose `whatwg-encoding` dependency is blocked by `dependencyVersions.test.ts`. The declared and installed versions are checked against a floor of 20.0.0 (GHSA-37j7-fg3j-429f) rather than an exact baseline.
  - Raise `engines.node` from `>=22.0.0` to `>=22.12.0`. `happy-dom` ships only as an ES module, and the CommonJS test build loads it through `require(esm)`, which Node.js enables without a flag from 22.12.
  - Keep a single `tsconfig.test.json`, now with the `DOM` lib and including `src/webview`.
  - Load the production panel HTML from `ChatViewProvider.getHtmlForWebview()` into a happy-dom window with JavaScript evaluation, script, stylesheet, and frame loading, and navigation disabled. The provider is loaded with a minimal `vscode` stub, and the module cache entries added by that load are removed so `chatViewProvider.test.ts` keeps loading the provider with its own stubs.
  - Add no DOM API stubs. happy-dom implements `scrollIntoView`, `requestAnimationFrame`, `KeyboardEvent`, and `click()`.
- Reason: `ChatRenderer`, `HashMenu`, and `SlashMenu` had no automated coverage, so webview regressions such as the `dragleave` bug found on PR #209 could not be covered by a test.
- Compatibility: Local development and `npm test` need Node.js 22.12 or later. `.nvmrc` (`22`) already resolves to a newer 22.x release, and the extension itself runs on the Node.js bundled with VS Code. No production code changed. Consistent with the 2026-08-10 and 2026-09-07 dependency entries: the floor does not add another exact-match baseline for Dependabot updates to break.

## 2026-09-19 - Merge the open Dependabot updates and move the version baselines with them

- Task: Issue #247 (PRs #243, #244, #245, #246).
- Decision:
  - Merge the four open Dependabot pull requests in the order #244, #243, #245, #246. #244 goes first because its baseline update also clears a pre-existing failure; #243 (`@typescript-eslint/parser`) precedes #246 (`@typescript-eslint/eslint-plugin`) because the plugin peer-depends on the parser at the same minor.
  - Raise `@types/node` to 26.6.1 instead of the 26.5.0 Dependabot proposed. For `marked` (18.0.13) and `@typescript-eslint/parser` / `@typescript-eslint/eslint-plugin` (8.70.0) the proposed version is already the current npm `latest`, so those merge as proposed.
  - Rebuild each Dependabot branch on top of the updated `main` and regenerate `package-lock.json` with `npm install <package>@<version>` rather than hand-merging the lockfile, then force-push to the Dependabot branch so each pull request still merges under its own number.
  - Move the two exact-match baseline blocks in `src/test/suite/dependencyVersions.test.ts` (`pins the consolidated Dependabot package.json baselines` and `locks the consolidated Dependabot package versions in package-lock.json`) in the same commit as each bump, so every commit on `main` is green. The floor-style `compareVersions(...) >= 0` assertions are left alone.
- Reason: 26.6.1 is the current npm `latest` for `@types/node`, was published well over 24 hours before the merge and is not deprecated, so it satisfies the 24-hour publication policy set by the 2026-09-14 js-yaml entry; taking 26.5.0 would have meant another Dependabot pull request for the same package immediately. The baselines had to move with the bumps because `dependencyVersions.test.ts` pins exact versions: PRs #241 and #242 raised `marked` to 18.0.12 without updating them, so `npm test` on `main` had been failing two assertions since then. No workflow in `.github/workflows/` runs the test suite on pull requests, so a green pull request check does not cover `npm test` and each branch was verified locally with `npm install && npm run lint && npm run compile && npm test && npm run security:check`.
- Compatibility: All four updates are minor or patch updates inside the existing major versions, so no source change was required. Merging #243 before #246 left the parser on 8.70.0 and the plugin on 8.69.0 for one commit, which duplicated the shared `@typescript-eslint` packages in the lockfile; #246 collapsed them again. Consistent with the 2026-08-10, 2026-09-07 and 2026-09-14 dependency entries, which keep updates within existing major versions and guard them with version floors rather than adding new exact-match baselines.
