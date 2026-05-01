# Work IQ Integration

ContextRelay supports querying the [Work IQ Gateway](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq-api-quickstart) through the `/workiq` slash command. Work IQ is Microsoft's AI-native interface to Microsoft 365 work intelligence, allowing natural language queries over emails, meetings, files, and organizational knowledge.

## Prerequisites

- A user with a **Microsoft 365 Copilot license**
- An [Entra app registration](../README.md#microsoft-entra-app-registration-setup-for-the-built-in-provider) configured in `contextRelay.auth.clientId`
- The **Work IQ service principal** provisioned in your organization
- The **`WorkIQAgent.Ask`** delegated permission added to your app registration with admin consent

## Enable Work IQ API in your organization

> ⏱️ ~5 minutes, one-time per organization.

### Step 1: Create the Work IQ service principal

The Work IQ service principal provisions the Work IQ resource in your tenant so users can request tokens for it.

1. Go to [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) and sign in with a **tenant admin** account.
2. Set the method to **POST** and the URL to `https://graph.microsoft.com/v1.0/servicePrincipals`.
3. Select **Modify permissions** and consent to `Application.ReadWrite.All`.
4. Enter the following in the **Request body**:

   ```json
   {
     "appId": "fdcc1f02-fc51-4226-8753-f668596af7f7"
   }
   ```

5. Select **Run query**. A **201 Created** response confirms success. A conflict error means the service principal already exists — proceed to the next step.

### Step 2: Add the WorkIQAgent.Ask permission to your app registration

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com).
2. Navigate to **Entra ID** → **App registrations** → select your ContextRelay app registration (the one configured in `contextRelay.auth.clientId`).
3. Select **API permissions** → **Add a permission** → **APIs my organization uses**.
4. Search for **Work IQ** and select it.
5. Select **Delegated permissions** → check **WorkIQAgent.Ask** → **Add permissions**.
6. Select **Grant admin consent for [your tenant]** → confirm **Yes**.

### Step 3: Verify

After granting admin consent, the `WorkIQAgent.Ask` permission should appear with a green checkmark under **API permissions** in your app registration. Users with a Microsoft 365 Copilot license can now use the `/workiq` command in ContextRelay.

> **Note**: If a user's Copilot license was recently assigned, the Work IQ index may take 15–30 minutes to build before queries return results.

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

### Slash command behavior

When `/workiq` is specified, all other slash commands in the input are treated as part of the query text. For example:

```
/workiq /mail project update
```

This sends the entire text `/mail project update` as the query to Work IQ, rather than routing to the mail adapter.

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
| `403 Forbidden` — no scope error | The user is missing a Microsoft 365 Copilot license. Assign the license and wait 15–30 minutes. |
| `403 Forbidden` with scope error | Admin consent for `WorkIQAgent.Ask` was not granted. Ask your tenant admin to grant consent (Step 2 above). |
| Empty response | The user's Copilot license may have been recently assigned. Wait 15–30 minutes for the index to build. |
| `AADSTS65001: consent required` | Admin consent has not been granted. Complete Step 2 above. |

## References

- [Work IQ API Quickstart](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq-api-quickstart)
- [Work IQ Samples on GitHub](https://github.com/microsoft/work-iq-samples)
- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
