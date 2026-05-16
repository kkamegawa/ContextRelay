---
name: fix-dependabot-pullrequest
description: "Use when multiple open Dependabot pull requests should be consolidated into one issue and one pull request, with superseded Dependabot PRs closed."
argument-hint: "Consolidate open Dependabot PRs into one tracked fix PR"
user-invocable: true
---

# Fix Dependabot Pull Requests

## Purpose
This skill defines a repeatable workflow to consolidate multiple Dependabot pull requests into a single tracked fix.

## Required Workflow
1. Detect open Dependabot pull requests only.
2. If two or more Dependabot pull requests are open, create exactly one tracking issue.
3. Create/use branch `fix-dependabot-pullrequest`.
4. Apply all required dependency updates in that single branch.
5. Collect and address all review comments/findings on the targeted Dependabot pull requests.
6. Run required validation:
   - `npm run compile`
   - `npm run lint`
   - `npm test`
   - `npm run security:check`
7. Create one replacement pull request linked to the issue.
8. Comment on and close each superseded Dependabot pull request, referencing the replacement pull request.

## Rules
- Detect and process Dependabot-authored pull requests only.
- When consolidating multiple Dependabot pull requests, use one issue and one replacement pull request.
- Do not include unrelated feature/version-scope changes unless explicitly requested.
- Keep dependency security baseline at zero vulnerabilities (moderate/high/critical).

## Completion Criteria
- A single issue tracks the aggregate work.
- A single pull request contains all Dependabot updates.
- Superseded Dependabot pull requests are commented and closed.
- Validation commands succeed and security check reports zero vulnerabilities.
