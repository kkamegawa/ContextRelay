# Design: Resolve npm audit findings and prevent recurrence

Tracking issue: #264

## 1. Current state

`npm run security:check` fails on main with 5 findings (2 low, 1 moderate, 2 high). The repository rule (dependency-security-guard) requires 0 findings at moderate or above, and `precompile` / `prepackage` run the audit, so build and package are blocked.

The findings come from three advisories published after the last baseline update:

| Package | Installed | Vulnerable range | Fixed in | Introduced by | Reported as consequence |
|---|---|---|---|---|---|
| brace-expansion | 5.0.9 | >=4.0.0 <5.0.12 | 5.0.12 | exact override in `package.json` | minimatch (high) |
| serialize-javascript | 7.1.1 | >=7.1.1 <7.1.2 | 7.1.2 | exact override in `package.json` | mocha (low) |
| fast-uri | 3.1.7 | >=3.0.0 <3.1.8 | 3.1.8 | lockfile only, transitive via webpack -> schema-utils -> ajv | none |

None of the three is a direct dependency, and none is caused by the Dependabot batch merged earlier. Main was already failing before those merges.

## 2. Root cause

The `overrides` block pins patched versions exactly (for example `"brace-expansion": "5.0.9"`). An exact pin freezes the package at a version that was safe on the day it was written, so every later advisory against that version needs a manual edit. Dependabot proposes direct dependencies only, so these transitive pins are never refreshed automatically.

fast-uri has no override, so `npm update` (a lockfile refresh within the existing range) is enough.

## 3. Options

| Option | Description | Verdict |
|---|---|---|
| A. Bump the exact pins | Raise the two overrides to the fixed versions and refresh fast-uri in the lockfile. Smallest change, same policy as today. | **Chosen for this fix** |
| B. Caret overrides | Use `^5.0.12` and `^7.1.2` so patch releases are picked up on the next lockfile refresh. | Follow-up, see section 6 |
| C. `npm audit fix` | Lets npm rewrite the lockfile broadly. Larger diff, harder to review, and it does not touch exact overrides. | Rejected |
| D. Lower the audit threshold or add an audit exception | Violates the repository rule. | Rejected |

## 4. Change set (Option A)

1. `package.json` overrides
   - `brace-expansion`: `5.0.9` -> `5.0.12`
   - `serialize-javascript`: `7.1.1` -> `7.1.2`
2. `package-lock.json`
   - Regenerate with `npm install --package-lock-only`.
   - Update `fast-uri` to `3.1.8` with `npm update fast-uri --package-lock-only`.
   - Review the diff: only the three packages (and integrity fields) may change.
3. `src/test/suite/dependencyVersions.test.ts` (security baseline, required by the skill when versions change for vulnerabilities)
   - Override floor and exact-match entries: `brace-expansion` 5.0.12, `serialize-javascript` 7.1.2.
   - Installed (lockfile) floors: add `brace-expansion` >= 5.0.12; raise `serialize-javascript` to 7.1.2; raise `fast-uri` to 3.1.8.
   - New test: `scripts/run-audit-safe.cjs` must still call `npm audit` with `--audit-level=moderate` (guards against the threshold being lowered).
4. Documentation
   - Add a short "Dependency baseline policy" section to `docs/release.md` and `docs/release_ja.md`, covering: where overrides live, the rule that every override has a matching floor test, and the refresh procedure in section 5.

No source code under `src/` other than the test file changes. No runtime dependency changes, because all three packages are dev-only transitive dependencies.

## 5. Procedure (bash and PowerShell 7)

Run from the repository root.

bash (macOS/Linux):

```bash
npm install --package-lock-only
npm update fast-uri --package-lock-only
npm ci
npm run security:check
npm run compile
npm run lint
npm test
```

PowerShell 7:

```powershell
npm install --package-lock-only
npm update fast-uri --package-lock-only
npm ci
npm run security:check
npm run compile
npm run lint
npm test
```

## 6. Preventing recurrence

- **Scheduled audit workflow (follow-up issue).** Add a weekly GitHub Actions job that runs `npm ci` and `npm run security:check` on main and fails visibly. Today nothing runs the audit on pull requests or on main, which is why the failure went unnoticed: the only workflows are `push-protection.yml` and `release-vsix.yml`.
- **Audit on pull requests (follow-up issue).** Run the same check on pull requests that touch `package.json` or `package-lock.json`, so Dependabot PRs show the gate result before merge.
- **Caret overrides (follow-up, needs a decision).** Moving overrides from exact pins to carets removes manual edits for patch advisories, at the cost of less reproducible installs. The lockfile still pins the resolved version, so the practical risk is low. Decide separately from this fix.

## 7. Verification

- `npm run security:check` prints `found 0 vulnerabilities`.
- `npm run compile`, `npm run lint`, `npm test` pass.
- Temporarily setting an override or lockfile entry below its floor makes the new tests fail (spot check, not committed).
- `git diff` of the lockfile contains only brace-expansion, serialize-javascript, fast-uri.

## 8. Risks

| Risk | Mitigation |
|---|---|
| A fixed version is not in the registry or breaks minimatch/mocha | Both are patch releases within the same minor; run lint and the full test suite. |
| `npm update fast-uri` pulls a 4.x release | The dependent range (`^3`) keeps it on 3.x; confirm in the lockfile diff. |
| New advisories appear again | Scheduled audit (section 6) turns this into a visible alert. |
