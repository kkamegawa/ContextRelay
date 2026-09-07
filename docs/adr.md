# ContextRelay — Architecture Decision Record

Records specification changes made during implementation that were not part of the original `docs/plan.md` / `docs/tasks.md` design, along with the reason. Consult this file before changing `/ask`, chat context, attachment behavior, or dependency baselines again, to avoid re-introducing a decision that was already reversed here.

---

## 2026-08-10 - Expand the Dependabot grouping task to remediate npm audit findings

- Task: Issue #199 and Sub-issue #200.
- Decision: Update direct and transitive npm dependency baselines together with the Dependabot security grouping configuration.
- Reason: Validation of the configuration-only change found existing moderate, high, and critical vulnerabilities, which prevented the required compile and security checks from passing.
- Compatibility: Keep all dependency updates within their existing major-version ranges and add regression tests for the safe version floors.

---

## 2026-08-15 — Issue #208: `/ask` without pinned context, real attachments, streaming

**Task**: [issue #208](https://github.com/kkamegawa/ContextRelay/issues/208) — `/ask` required a pinned snippet or a valid `#` mention before it would run at all, which is stricter than the Microsoft 365 Copilot Chat API actually requires (`additionalContext`/`contextualResources` are optional parameters). Fixing that surfaced two further issues addressed in the same change; see the failure scenarios below.

- **Removed the pinned-context guard entirely.** `docs/tasks.md` §E never specified this guard — it was an implementation choice, not a documented requirement. Removing it means `/ask` and plain chat now differ only in whether ContextRelay's own accumulated context (pinned snippets, latest visible result, latest search summary) is auto-attached, not in whether the command runs at all.
  - **Why**: The original guard's user-facing goal — "don't send Copilot a request that means nothing without context" — is real, but blocking the request was the wrong mechanism. It also made `/ask` and plain chat functionally identical once a user found a workaround (any `#` mention bypassed the guard), which defeats the purpose of having two separate commands.

- **Local `#` mention files were sent as `file://` URIs inside `contextualResources.files`.** Per the [copilotContextualResources reference](https://learn.microsoft.com/microsoft-365/copilot/extensibility/api/ai-services/chat/resources/copilotcontextualresources), that field accepts OneDrive/SharePoint URIs only — a remote Graph service cannot resolve a local `file://` URI. This meant `/ask #file.md` and `Summarize #file.md` never actually sent file content to Copilot; only `/workiq` (which reads and inlines file content separately) did.
  - **Why**: Not a deliberate design choice, a defect. Fixed by reading attached file content (or the selected line range) into `additionalContext` instead, consistent with how `/workiq` already worked. `contextualResources.files` is now used only for pinned SharePoint/OneDrive snippets with an `https://` URL, which is the field's documented use.

- **`/ask` redefined as the "strict format" mode; plain chat redefined to never auto-attach ContextRelay context.** Neither `docs/plan.md` nor `docs/tasks.md` distinguished `/ask` from plain chat this way — both previously built the same context payload (`buildChatContextPayload`), differing only in the now-removed guard. The README already documented plain chat as not auto-attaching ContextRelay search context; the implementation did not match that description.
  - **Why**: Once the guard is gone, `/ask` needs its own reason to exist. User-facing distinction: `/ask` always includes everything ContextRelay knows (pinned snippets, attached files, the latest visible result, the latest search summary) and wraps the instruction with a preamble that tells Copilot to follow it exactly and, if a specific output format is requested, to emit only that format. Plain chat sends the message as-is and only includes context the user explicitly attached in that turn — matching the README.

- **Added three attachment origins beyond `#` mentions: drag-and-drop, an attach-file picker button, and an opt-in active-editor auto-attach.** None of these are in `docs/tasks.md`.
  - **Why**: Requested directly by the repository owner during planning for this issue, to bring ContextRelay's attachment UX in line with GitHub Copilot Chat's own affordances (drag-and-drop, an attach button, and editor-context). Active-editor auto-attach defaults to **off**, mirroring GitHub Copilot's own default, per the owner's explicit instruction.

- **Migrated response rendering to the Chat API's `chatOverStream` (SSE) endpoint**, with a one-shot fallback to the synchronous `/chat` endpoint. `docs/tasks.md` §E explicitly deferred streaming ("Implement sync response first; streaming response as a follow-up").
  - **Why**: Requested directly by the repository owner during planning for this issue — "sync first" from the original task list was the deferral, not a decision against streaming, and the follow-up work is this change.
  - **Correctness constraint recorded here for future reference**: the fallback to the synchronous endpoint is only safe when the streamed request was **never accepted** by the service (i.e. failure happened before or during the initial POST, before a 200 response with a body was received). A failure that happens *after* acceptance — including user cancellation — must never fall back, because resending the same prompt via `/chat` would create a **duplicate conversation turn** server-side. This is enforced by `StreamAcceptedError` in `src/adapters/chatAdapter.ts`; do not remove that distinction when touching this code.

**Contradiction check**: no conflict with the 2026-08-10 entry — that entry concerns dependency baselines and the security-check gate, unrelated to `/ask` or chat context behavior.

---

## 2026-09-07 - Raise the minimum supported VS Code version with the consolidated Dependabot update

- Task: Issue #230.
- Decision: Adopt `@types/vscode` 1.136.0 and raise `engines.vscode` to `^1.136.0`, and land every pending Dependabot npm update in a single consolidated pull request instead of merging pull requests #222-#229 individually.
- Reason: The repository policy adopts the newest stable release that has been public for more than 24 hours, and `dependencyVersions.test.ts` requires `@types/vscode` to stay at or below `engines.vscode`, so the type definitions cannot move forward without the engine declaration. Merging the Dependabot pull requests one at a time would break the exact-match version baselines in that test on every merge, which already required the repair in #221.
- Compatibility: The extension now requires VS Code 1.136.0 or later. All other updates stay within their existing major versions. `browserslist` and `fast-uri` were also advanced to clear GHSA-c83g-rgw3-j3cx and GHSA-5jgf-p345-68v8, and both now have version floors in `dependencyVersions.test.ts`.

**Contradiction check**: no conflict with the 2026-08-15 entry — that entry concerns `/ask` behavior and attachments, unrelated to the VS Code engine version or dependency baselines.
