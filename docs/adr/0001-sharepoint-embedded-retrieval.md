# ADR 0001: Retrieve configured SharePoint Embedded content directly

- Status: Accepted
- Date: 2026-10-24
- Approval: The user approved the Embedded design and implementation in this conversation, then explicitly requested the branch, issues and bilingual Wiki.
- Tracking: [Issue #287](https://github.com/kkamegawa/ContextRelay/issues/287)

## Context

ContextRelay brings Microsoft 365 evidence into its own panel. SharePoint and OneDrive already use Graph Search, while connectors use Copilot Retrieval. SharePoint Embedded needs an explicit container type and a separate application authorization layer. User ownership of Loop content does not confer container-type application ownership.

## Decision

Add an opt-in `/embedded` route that accepts a natural-language query and selects one configured source by its display name. Call Copilot Retrieval directly with `sharePointEmbedded`, preserve returned extracts for preview, pinning, handoff and chat text grounding, and keep the retrieval cache process-local and isolated by identity and source. Request `FileStorageContainer.Selected` in a dedicated Embedded sign-in session that `/embedded` alone uses, so missing Embedded consent never blocks the shared session of the other adapters.

Require the container-type owning application to register ContextRelay's delegated content-read grant, plus the signed-in user's container access and the service's billing/indexing prerequisites. Settings identify the target; they do not grant permissions. Do not promise arbitrary Microsoft-owned Loop access.

Keep product operation within ContextRelay. Work IQ MCP is outside the approved scope. Record direct Work IQ REST/A2A capabilities and limitations without equating generated answers with retrieved original excerpts. Developer-only SPE MCP is version-pinned and read-only, keeps a separate state directory for each client, and is not the extension's runtime retrieval path.

## Alternatives and consequences

- OneDrive Copilot Search preview adds a different file-discovery contract and is deferred.
- Work IQ REST supports generated answers and citations, but the reviewed documentation does not provide a current raw-extract REST replacement. Existing A2A remains available independently.
- SPE retrieval and developer MCP are preview services; setup and live tenant verification remain explicit requirements.
- Pinning deliberately saves selected text and minimal source identity; automatic Embedded result caches are not persisted.

## Validation

See the [Embedded setup](../spe-embedded.md), implementation regression tests and [task record](../tasks.md). A successful local build or UI fixture does not establish live Loop/tenant success.

## References

Reviewed 2026-10-24:

- [Embedded agent experiences](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/agent-experiences): direct Retrieval payload, preview and billing prerequisites.
- [Register application permissions](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions): only the owning app registers guest-app grants; registration replaces the complete grant set.
- [Work IQ REST overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/overview): synthesized conversational responses.

## Change history

| Date | Previous decision | Current decision | Reason and approval |
|---|---|---|---|
| 2026-10-24 | No Embedded adapter. | Add direct opt-in, named-source retrieval and read-only development tooling. | User-approved implementation scope in this conversation. |
| 2026-10-24 | `FileStorageContainer.Selected` was added to the shared session; Claude Code and Copilot CLI shared one SPE MCP state directory. | Embedded uses its own sign-in session; each MCP client has its own state directory. | Code review found that missing Embedded consent broke every adapter and that client state was not isolated as approved. The user approved the fixes. |
