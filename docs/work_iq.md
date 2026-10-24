# Work IQ Integration

ContextRelay supports querying Work IQ through `/workiq` using A2A v1.0. The command calls Work IQ directly from ContextRelay with the signed-in user's delegated identity; it does not require GitHub Copilot, Claude, Codex, another external agent, or a Work IQ MCP client.

## Prerequisites

- The **Work IQ service principal** provisioned in your organization
- Work IQ enabled in the tenant and a usage-based billing policy that includes Work IQ API for the calling user
- An [Entra app registration](../README.md#microsoft-entra-app-registration-setup-for-the-built-in-provider) configured in `contextRelay.auth.clientId`
- The **`WorkIQAgent.Ask`** delegated permission added to your app registration with admin consent

## Enable Work IQ in your organization

> ⏱️ ~5 minutes, one-time per organization.

### Step 1: Create the Work IQ service principal

The Work IQ service principal provisions the Work IQ resource in your tenant so applications can request tokens for it. Without it, **Work IQ** does not appear when you search for API permissions in Step 3. A tenant administrator (or Global Administrator) completes this step once.

**Graph Explorer**

1. Go to [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) and sign in with a **tenant admin** account.
2. Set the method to **POST** and the URL to `https://graph.microsoft.com/v1.0/servicePrincipals`. Enter the URL before consenting so Graph Explorer offers the relevant scopes.
3. Select **Modify permissions** and consent to `Application.ReadWrite.All`. This consent applies only to your Graph Explorer session.
4. Enter the following in the **Request body**:

   ```json
   {
     "appId": "fdcc1f02-fc51-4226-8753-f668596af7f7"
   }
   ```

5. Select **Run query**. A **201 Created** response confirms success. A conflict error means the service principal already exists — proceed to the next step.

**Azure CLI** (signed in with `az login` as a tenant admin). The commands create the service principal only when it does not exist yet.

Bash:

```bash
work_iq_app_id='fdcc1f02-fc51-4226-8753-f668596af7f7'
az ad sp show --id "$work_iq_app_id" >/dev/null 2>&1 || az ad sp create --id "$work_iq_app_id"
```

PowerShell 7:

```powershell
$workIqAppId = 'fdcc1f02-fc51-4226-8753-f668596af7f7'
az ad sp show --id $workIqAppId *> $null
if ($LASTEXITCODE -ne 0) {
    az ad sp create --id $workIqAppId
}
```

### Step 2: Enable Work IQ and usage-based billing

Follow Microsoft's [Work IQ tenant setup](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq) guidance. Configure usage-based billing and assign calling users to a spending policy that includes Work IQ API. A Microsoft 365 Copilot license does not automatically configure this billing policy.

### Step 3: Add the WorkIQAgent.Ask permission to your app registration

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Navigate to **Entra ID** → **App registrations** → select your ContextRelay app registration (the one configured in `contextRelay.auth.clientId`).
3. Select **API permissions** → **Add a permission** → **APIs my organization uses**.
4. Search for **Work IQ** and select it. If it does not appear, complete Step 1 first.
5. Select **Delegated permissions** → check **WorkIQAgent.Ask** → **Add permissions**.
6. Select **Grant admin consent for [your tenant]** → confirm **Yes**.

### Step 4: Verify

After granting admin consent, the `WorkIQAgent.Ask` permission should appear with a green checkmark under **API permissions** in your app registration. Confirm that the test user is covered by the Work IQ API spending policy before querying.

> **Note**: Search availability can lag behind licensing or tenant configuration changes. Work IQ calls incur Copilot Credits usage-based charges; review spending limits and policy coverage before rollout.

## Usage

### Basic queries

Type `/workiq` followed by your question in the ContextRelay chat panel:

```
/workiq Summarize my recent emails from Alice
/workiq What meetings do I have today?
/workiq Find documents about the Q3 budget review
```

### Multi-turn conversations

Consecutive `/workiq` queries maintain conversation context via the A2A `contextId`. Follow-up questions work naturally:

```
/workiq What meetings do I have today?
/workiq Tell me more about the 2 PM customer call
```

Use `/clear` to reset the conversation context and start fresh.

### Add local workspace file context with `#`

You can attach local workspace files to `/workiq` using `#` file mentions:

```
/workiq Summarize key decisions from #docs/plan.md
/workiq Create a status email from #"notes/Release Plan.md"
```

Rules:
- Only Copilot-supported file extensions are accepted.
- File paths must resolve inside the opened workspace.
- Invalid `#` mentions block the request with an error message.

### Slash command behavior

When `/workiq` is specified, all other slash commands in the input are treated as part of the query text. For example:

```
/workiq /mail project update
```

This sends the entire text `/mail project update` as the query to Work IQ, rather than routing to the mail adapter.

## Work IQ API assessment

The Work IQ REST API is technically usable by a direct application: Microsoft documents multi-turn conversational requests that return synthesized answers with Microsoft 365 enterprise-search and web grounding. It supports delegated user identity, user permission trimming, and optional SharePoint/OneDrive files as context. This is an answer-generation API, not a drop-in replacement for Copilot Retrieval's extract DTO. It can add a separate answer path, but it does not currently supply a documented REST equivalent of Work IQ MCP's extract-oriented `retrieve` tool for ContextRelay's pin/search-result workflow.

Microsoft's migration guide says the Work IQ MCP `retrieve` tool returns model-friendly cited Markdown and structured `retrievalHits`, while REST extraction access is planned for November 2026. As of this document's review on 2026-10-24, that future REST availability is not a current capability. This project therefore keeps its direct A2A `/workiq` integration and does not add Work IQ REST or Work IQ MCP in the SharePoint Embedded implementation. The user explicitly excluded Work IQ MCP from this scope to avoid adding an external-agent setup burden; this is a project-scope decision, not a limitation of MCP's technical integration model.

The REST API is worth revisiting when the user experience calls for a synthesized Work IQ answer, or when the documented REST retrieval capability is released. Before adoption, compare its answer and citation contract, user consent and Copilot Credits costs, grounding controls, latency, and error behavior against the existing A2A route.

### Verification items for Loop content

Work IQ API search across Loop content is not a supported ContextRelay feature until a live tenant confirms every item below. `/embedded` never falls back to Work IQ, because Embedded search requires original retrieval extracts and Work IQ returns generated answers.

| ID | Verify | How to confirm |
|---|---|---|
| WIQ-01 | Known information in the user's own Loop components and pages can be found through A2A and REST. | Ask about a fact that exists only in a Loop workspace the test user created, and compare A2A and REST answers. |
| WIQ-02 | Known information in Loop content shared with the user can be found through A2A and REST. | Repeat WIQ-01 with Loop content another user owns and shared with the test user. |
| WIQ-03 | Each answer carries verifiable sources. | Every source opens the Loop item that contains the stated fact. |
| WIQ-04 | Generated answer text can be told apart from quoted original text. | Check whether the response marks quoted text separately from synthesized text, and whether any original excerpt can be retrieved verbatim. |
| WIQ-05 | The search scope can be limited explicitly. | Check whether the request can restrict the answer to Loop content or a specific workspace, and whether out-of-scope sources still appear. |
| WIQ-06 | Content the user cannot access never appears. | Ask about a fact that exists only in Loop content the test user cannot access; the answer must not reveal it or cite it. |
| WIQ-07 | Tenant prerequisites are met. | The Work IQ service principal exists, `WorkIQAgent.Ask` has admin consent, and the test user is covered by a spending policy for Work IQ API with Copilot Credits available. |

Record live tenant results separately from local test results, with the date, the API used (A2A or REST), and each item's outcome.

## How it works

The `/workiq` command uses the [A2A (Agent-to-Agent) v1.0 protocol](https://a2a-protocol.org), an open standard for agent communication:

- **Endpoint**: `https://workiq.svc.cloud.microsoft/a2a/`
- **Protocol**: JSON-RPC 2.0 with `SendMessage` method
- **Token audience**: `api://workiq.svc.cloud.microsoft`
- **Version header**: `A2A-Version: 1.0`

Work IQ uses the signed-in user's identity to access their Microsoft 365 data. The `Location` metadata (time zone) is included automatically so time-sensitive queries ("today", "this week") are grounded in the user's local time.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | Token audience mismatch. Ensure your app registration has the `WorkIQAgent.Ask` permission. |
| `403 Forbidden` — no scope error | The user may not be covered by a spending policy that includes Work IQ API, or a usage limit may have been reached. Check policy assignment and Copilot Credits cost management. |
| `403 Forbidden` with scope error | Admin consent for `WorkIQAgent.Ask` was not granted. Ask your tenant admin to grant consent (Step 3 above). |
| Empty response | Confirm the user has access to matching content and that the relevant tenant indexing is ready. |
| `AADSTS65001: consent required` | Admin consent has not been granted. Complete Step 3 above. |
| **Work IQ** is not listed under **APIs my organization uses** | The Work IQ service principal does not exist in the tenant. Complete Step 1 above. |

## References

- [Work IQ API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/api-overview)
- [Work IQ REST API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/overview)
- [Work IQ MCP retrieval migration guide](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/migrate-retrieval-api)
- [Work IQ A2A quickstart](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/a2a/quickstart)
- [Work IQ Samples on GitHub](https://github.com/microsoft/work-iq-samples)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
