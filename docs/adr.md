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
  - Adopt PR #209's local file fix: attached local files are read and inlined into `additionalContext` (capped at 12,000 characters per file within the shared 60,000-character budget) instead of being sent as `file://` URIs in `contextualResources.files`, which the Chat API documents as OneDrive/SharePoint URIs only. An attachment counts as grounding context only when its content was actually added, so an unreadable file does not ground the turn.
  - Adopt PR #209's attachment UX (drag and drop, 📎 picker, opt-in active-editor auto-attach, `contextRelay.chat.maxAttachedFiles`) and treat every attachment source like a `#file` mention, including for the `/ask` guard.
  - Adopt PR #209's `chatOverStream` streaming (`contextRelay.chat.streamResponses`), falling back to the synchronous endpoint only when the streamed request was never accepted and never after user cancellation. The grounded prompt is sent on both paths.
- Reason: The user chose the #232 grounding model as the baseline and asked to keep the parts of #209 that do not change it. Without the inline file fix, `#file` grounding from 2026-09-07 never delivered file content to Copilot.
- Compatibility: With `contextRelay.chat.attachActiveEditor` enabled, every Copilot message sent while a workspace file is open is grounded on that file; the setting is off by default. Consistent with the 2026-09-07 entry, which this entry extends rather than reverses.
