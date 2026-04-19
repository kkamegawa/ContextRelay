# ContextRelay Copilot Instructions

## Dependency Security (Mandatory)

- For any build/package/dependency change, maintain **zero vulnerabilities at moderate/high/critical** level.
- Use `npm run security:check` as the required gate.
- If you add any new npm package, apply the same zero-vulnerability rule before completion.
- Do not introduce or retain deprecated npm packages; resolve any `npm WARN deprecated` output before completion.
- If a dependency is upgraded to remediate vulnerabilities, add or update tests in the same change.

## Required Validation Before Completion

Run and report all of the following:

1. `npm run compile`
2. `npm run lint`
3. `npm test`
4. `npm run security:check`

Do not complete the task if any command fails or if security check is non-zero.

## Gitub 

### create issue

- create issue before starting work, create branch, and link the PR to the issue.
- If the issue too large, break it break down sub-issues and link them together.
