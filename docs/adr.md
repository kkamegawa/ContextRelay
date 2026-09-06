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
