---
name: code-scanning-security-guard
description: "Use when fixing GitHub Advanced Security / CodeQL findings, especially URL validation, webview rendering, preview extraction, and sanitizer regressions."
argument-hint: "Run code scanning remediation workflow for this change"
user-invocable: true
---

# Code Scanning Security Guard

## Purpose
This skill standardizes how ContextRelay fixes GitHub Advanced Security and CodeQL findings without creating new false confidence or compatibility regressions.

## Mandatory Rules
1. Fix the **production sink or shared helper**, not only a test or a local reimplementation.
2. Do **not** rely on substring checks for trust decisions about hosts, resources, URLs, or schemes.
3. Do **not** rely on ad-hoc regex sanitizers for HTML/XML security boundaries when a safer shared parsing or extraction path is available.
4. Regression tests must exercise the **real production helper/module** used by the product code; avoid tautological tests or test-only clones of security logic.
5. Finish only when the targeted GitHub Advanced Security findings are gone for the PR branch.

## Required Workflow
1. Create an **English GitHub issue** before starting implementation and work on a linked branch.
2. Triage the active CodeQL findings and group them by root cause (for example: URL validation, HTML rendering, entity decoding, webview sinks).
3. Prefer these remediation patterns:
   - **URL/resource validation**: parse and validate exact protocol/host/path structure instead of `includes(...)`.
   - **Webview rendering**: prefer DOM APIs, strict allowlists, safe preview fallbacks, and vetted blob/data URL handling.
   - **Text extraction / entity handling**: use shared one-pass decoding or structured extraction helpers instead of duplicated decode chains.
4. Add regression tests that would fail if the fix is removed or weakened.
5. Run full validation:
   - `npm run compile`
   - `npm run lint`
   - `npm test`
   - `npm run security:check`
6. Open a PR in English that links the tracking issue and summarizes:
   - the exact findings addressed
   - the production helpers or sinks changed
   - the regression tests added
7. Re-check GitHub Advanced Security / Code Scanning for the PR branch and continue until the targeted findings are closed.

## Repository-specific lessons from earlier fixes
- Prefer a **shared production helper** over fixing the same decoding/sanitization logic in multiple files independently.
- If a test was flagged by CodeQL, rewrite the assertion to use a stricter production-like check instead of suppressing the alert.
- For preview/webview paths, safer plain-text fallback behavior is preferable to reparsing risky content in the browser context.

## Final response checklist
- Tracking issue and PR are linked
- Targeted findings are closed
- Validation command results are included
- New or updated regression tests are identified
