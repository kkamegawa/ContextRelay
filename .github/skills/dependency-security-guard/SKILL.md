---
name: dependency-security-guard
description: "Use when updating npm dependencies, adding packages, fixing npm audit vulnerabilities, or preparing build/PR for dependency changes. Enforces zero vulnerabilities at moderate/high/critical and requires regression tests for vulnerability-driven upgrades."
argument-hint: "Run dependency security workflow for this change"
user-invocable: true
---

# Dependency Security Guard

## Purpose
This skill standardizes dependency maintenance for this repository.

## Mandatory Rules
1. Build-related work MUST end with `npm audit --audit-level=moderate` reporting **0 vulnerabilities**.
2. The same rule applies when **adding new npm packages**.
3. If package versions are changed to fix vulnerabilities, you MUST add or update tests that prevent regression of that security baseline.

## Required Workflow
1. Install/update dependencies.
2. Run `npm run security:check`.
3. If vulnerabilities exist, upgrade/replace packages until the result is zero (moderate/high/critical).
4. Add or update tests to validate the new security baseline (for example: dependency version floor checks or security script assertions).
5. Run full validation:
   - `npm run compile`
   - `npm run lint`
   - `npm test`
   - `npm run security:check`
6. In the final summary, include:
   - changed packages
   - added/updated tests
   - exact output status for security/build/test commands

## Notes
- Do not suppress audit output or lower the threshold.
- Do not finish with unresolved moderate/high/critical vulnerabilities.
- Prefer the smallest safe update set that passes all tests.
