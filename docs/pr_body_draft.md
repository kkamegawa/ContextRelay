# PR body draft

## Summary

This PR completes the Microsoft Entra / built-in VS Code auth documentation for ContextRelay and adds rollout materials that tenant admins and users can apply directly.

## What changed

- documented the built-in VS Code auth provider override approach using:
  - `contextRelay.auth.clientId`
  - `contextRelay.auth.tenantId`
- added Microsoft Entra app registration setup guidance
- added minimal delegated-permission recipes by scenario
- added a recommended tenant-admin rollout order
- added a recommended first-run `settings.json` example
- expanded sign-in troubleshooting and FAQ:
  - `AADSTS65002`
  - admin consent required
  - redirect URI mismatch
  - license missing
- added supporting docs:
  - tenant admin quickstart
  - tenant admin request template
  - tenant admin request template (Japanese)
  - Japanese setup summary
  - release notes draft

## Why

The extension uses the built-in VS Code Microsoft authentication provider, but the default VS Code first-party client is not preauthorized for all Microsoft Graph scopes needed by ContextRelay.

Without tenant-managed app registration guidance, users can hit `AADSTS65002` and tenant admins do not have a straightforward rollout path.

This PR makes the deployment story practical by giving:

- exact app registration steps
- feature-based permission recipes
- a low-friction pilot configuration
- copy/paste tenant-admin request text
- FAQ coverage for the most common sign-in failures

## Scope

Documentation only. No runtime behavior changes in this final step.

## Validation

- `npm run compile`
- `npm run lint`
- `npm test`
- `npm run security:check`

All passed.