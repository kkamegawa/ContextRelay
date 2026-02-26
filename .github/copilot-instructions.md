# ContextRelay Copilot Instructions

## Dependency Security (Mandatory)

- For any build/package/dependency change, maintain **zero vulnerabilities at moderate/high/critical** level.
- Use `npm run security:check` as the required gate.
- If you add any new npm package, apply the same zero-vulnerability rule before completion.
- If a dependency is upgraded to remediate vulnerabilities, add or update tests in the same change.

## Required Validation Before Completion

Run and report all of the following:

1. `npm run compile`
2. `npm run lint`
3. `npm test`
4. `npm run security:check`

Do not complete the task if any command fails or if security check is non-zero.
