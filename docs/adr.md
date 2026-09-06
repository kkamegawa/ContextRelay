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
