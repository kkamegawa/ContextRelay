# SharePoint Embedded Retrieval

ContextRelay's `/embedded <query>` command retrieves text extracts from a named, explicitly configured SharePoint Embedded container type. The query is ordinary natural language; users do not need to know or type a GUID. If one source is enabled, ContextRelay uses it directly. If several sources are enabled, the user chooses a friendly source name before the query runs.

This source is opt-in and remains disabled until `contextRelay.embedded.enabled` is set to `true`. Configure each source with a display `name`, the opaque `containerTypeId`, and `enabled`:

```jsonc
{
  "contextRelay.embedded.enabled": true,
  "contextRelay.embedded.sources": [
    {
      "name": "Engineering knowledge",
      "containerTypeId": "<CONTAINER_TYPE_ID>",
      "enabled": true
    }
  ]
}
```

The `<CONTAINER_TYPE_ID>` placeholder must be replaced with the actual ID supplied by the SharePoint Embedded container-type owner. Do not put the ID in the user's query. If the placeholder is copied into an actual settings file, replace it there before running a search.

## Access model and prerequisites

Retrieval calls `POST /v1.0/copilot/retrieval` with `dataSource: "sharePointEmbedded"` and the selected `containerTypeId`. The service returns permission-trimmed extracts and source links. ContextRelay uses extract text for pinning, chat `additionalContext`, and HANDOFF content. The returned `webUrl` is opaque; ContextRelay does not interpret it as a regular SharePoint or OneDrive file attachment.

Access has separate permission layers. All are required:

1. The ContextRelay Entra application requests delegated Microsoft Graph `FileStorageContainer.Selected`. ContextRelay requests it in a separate sign-in session the first time `/embedded` runs, so missing consent affects only `/embedded`, not the other sources.
2. The container-type owner registers a delegated content-read grant for the ContextRelay app on that container type. The least-privilege grant for retrieval is `readContent` in the registration API.
3. The signed-in user must have permission to access the matching container(s). Effective delegated access is bounded by the app's container-type grant and the user's container permissions.
4. The container type must have SharePoint Embedded pay-as-you-go billing configured. Retrieval requests using this source bill according to the container type's billing configuration.
5. The tenant needs at least one Microsoft 365 Copilot licensed user to initialize the semantic index. Each user who queries this SharePoint Embedded Retrieval source does not need an individual Copilot license.

The Retrieval API's `sharePointEmbedded` data source is in preview. Search covers containers of the configured type that the signed-in user can access; it is not an arbitrary Loop-wide search. Only the owning application can register permissions for its container type. ContextRelay settings cannot authorize ContextRelay against a Microsoft-owned Loop container type or another app's type. Loop content stored in a type not owned by the customer/ContextRelay integration remains out of reach unless that type's owner explicitly supports and grants the integration.

For setup details, see Microsoft's [SharePoint Embedded Retrieval guide](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/agent-experiences), [authentication and permissions guide](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/plan/authentication-permissions), and [container-type registration guide](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions).

## Register the container-type grant

The owner of the target container type performs registration. Microsoft Graph's container type registration API requires the owner app's `FileStorageContainerTypeReg.Selected` permission and a token for the consuming tenant. A delegated registration call must be made by a SharePoint Embedded Administrator or Global Administrator. The owner can grant the ContextRelay application only the required read permission.

Registration is a full replacement of the grant set: the latest successful registration call becomes authoritative. Before updating, read the complete current registration, preserve every existing application grant that should remain, then add/update the ContextRelay entry. Do not send a partial grant list. If you do not own the container type, ask its owner to perform this step; do not attempt to make the registration call using the ContextRelay app.

The commands below are examples for an owner-approved change. They first read the current registration, verify that its `owningAppId` is the expected owner app, preserve grants for every other app, and prepare a complete grant collection. The ContextRelay grant is set to delegated `readContent` and application `none`; if it already has broader rights, review the preview and consider the impact of removing them before applying. Add `read` only if the implementation actually needs container metadata; the current Retrieval path does not fetch that metadata.

Requirements: Bash and `curl` plus `jq`, or PowerShell 7. Node.js 22.12+ (or Node 24/26) is required for this repository and its pinned SPE MCP package. Azure CLI is optional for read-only tenant/account discovery, for example `az account show --query '{tenantId:tenantId,user:user.name}' -o json`. Do not use Azure CLI's default Graph access token for registration: `FileStorageContainerTypeReg.Selected` limits the call to registrations owned by the token's client application. The bearer token below must come from a delegated Graph authentication flow for the actual container-type owning app, in the consuming tenant, and the signed-in user must have the SharePoint Embedded Administrator or Global Administrator role. Never place a token in a command argument, file, repository, or shell history. Provide it to the current shell through an approved secure credential flow.

Set these non-secret values for the approved registration first:

```text
GRAPH_BASE_URL=<MICROSOFT_GRAPH_V1_BASE_URL>
CONTAINER_TYPE_ID=<CONTAINER_TYPE_ID>
OWNER_APP_ID=<CONTAINER_TYPE_OWNER_APP_ID>
CONTEXTRELAY_APP_ID=<CONTEXTRELAY_APP_ID>
```

Replace all angle-bracket placeholders with values from the type owner. Keep `OWNER_APP_GRAPH_ACCESS_TOKEN` in process memory only. The examples default to preview-only. A separate explicit `SPE_APPLY=YES` is required to submit the complete grant collection.

### Bash

```bash
set -euo pipefail
: "${GRAPH_BASE_URL:?Set the Microsoft Graph v1.0 base URL}"
: "${CONTAINER_TYPE_ID:?Set the target container type ID}"
: "${OWNER_APP_ID:?Set the owning application ID}"
: "${CONTEXTRELAY_APP_ID:?Set the ContextRelay application ID}"
: "${OWNER_APP_GRAPH_ACCESS_TOKEN:?Acquire an owner-app delegated Graph token securely}"

graph_base="${GRAPH_BASE_URL%/}"
registration_url="${graph_base}/storage/fileStorage/containerTypeRegistrations/${CONTAINER_TYPE_ID}"
grants_url="${registration_url}/applicationPermissionGrants"
curl_graph() {
  curl --silent --show-error --fail-with-body \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$OWNER_APP_GRAPH_ACCESS_TOKEN") \
    "$@"
}
current=$(curl_graph "$registration_url")

jq --exit-status --arg owner "$OWNER_APP_ID" '.owningAppId == $owner' <<<"$current" >/dev/null || {
  echo "The registration is not owned by OWNER_APP_ID; refusing to continue." >&2
  exit 1
}

all_grants='[]'
page_url="$grants_url"
while [[ -n "$page_url" ]]; do
  if [[ "$page_url" != "$grants_url" && "$page_url" != "$grants_url"\?* ]]; then
    echo "The grant-list nextLink is outside the expected Graph collection; refusing to send the bearer token." >&2
    exit 1
  fi
  page=$(curl_graph "$page_url")
  page_grants=$(jq -ce '
    if (.value | type) != "array" then error("Grant-list response is missing its value array") else .value end
  ' <<<"$page")
  all_grants=$(jq -cne --argjson old "$all_grants" --argjson new "$page_grants" '$old + $new')
  page_url=$(jq -r '.["@odata.nextLink"] // empty' <<<"$page")
done

payload=$(jq -cne --arg app "$CONTEXTRELAY_APP_ID" --argjson grants "$all_grants" '
  if any($grants[]; (type != "object") or ((.appId | type) != "string") or ((.delegatedPermissions | type) != "array") or ((.applicationPermissions | type) != "array")) then
    error("A permission grant is incomplete; refusing to submit a partial set")
  else
    [$grants[] | {appId, delegatedPermissions, applicationPermissions}] as $writable
    | {
        applicationPermissionGrants:
          if any($writable[]; .appId == $app) then
            [$writable[] | if .appId == $app
              then .delegatedPermissions = ["readContent"] | .applicationPermissions = ["none"]
              else . end]
          else
            $writable + [{"appId": $app, "delegatedPermissions": ["readContent"], "applicationPermissions": ["none"]}]
          end
      }
  end
')

echo "Preview of the complete grant set (other app grants are preserved):"
jq . <<<"$payload"
if [[ "${SPE_APPLY:-NO}" == "YES" ]]; then
  curl_graph --request PUT \
    --header 'Content-Type: application/json' --data-binary "$payload" \
  "$registration_url" | jq .
else
  echo "Preview only. After owner review, rerun with SPE_APPLY=YES to replace the registration grant set."
fi
```

### PowerShell 7

```powershell
$ErrorActionPreference = 'Stop'
foreach ($name in 'GRAPH_BASE_URL', 'CONTAINER_TYPE_ID', 'OWNER_APP_ID', 'CONTEXTRELAY_APP_ID', 'OWNER_APP_GRAPH_ACCESS_TOKEN') {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {
        throw "Set $name in the current process environment before running this example."
    }
}

$graphBase = $env:GRAPH_BASE_URL.TrimEnd('/')
$registrationUrl = "$graphBase/storage/fileStorage/containerTypeRegistrations/$($env:CONTAINER_TYPE_ID)"
$grantsUrl = "$registrationUrl/applicationPermissionGrants"
$headers = @{ Authorization = "Bearer $env:OWNER_APP_GRAPH_ACCESS_TOKEN" }
$current = Invoke-RestMethod -Method Get -Uri $registrationUrl -Headers $headers
if ($current.owningAppId -ne $env:OWNER_APP_ID) {
    throw 'The registration is not owned by OWNER_APP_ID; refusing to continue.'
}
function Get-AllPermissionGrants {
    param([string] $FirstPageUrl, [string] $ExpectedCollectionUrl, [hashtable] $RequestHeaders)
    $all = [System.Collections.Generic.List[object]]::new()
    $next = $FirstPageUrl
    while ($next) {
        if ($next -ne $ExpectedCollectionUrl -and -not $next.StartsWith($ExpectedCollectionUrl + '?', [StringComparison]::Ordinal)) {
            throw 'The grant-list nextLink is outside the expected Graph collection; refusing to send the bearer token.'
        }
        $page = Invoke-RestMethod -Method Get -Uri $next -Headers $RequestHeaders
        if ($null -eq $page.PSObject.Properties['value'] -or $null -eq $page.value) {
            throw 'Grant-list response is missing its value array; refusing to submit a partial set.'
        }
        foreach ($grant in @($page.value)) {
            if ([string]::IsNullOrWhiteSpace($grant.appId) -or $null -eq $grant.delegatedPermissions -or $null -eq $grant.applicationPermissions) {
                throw 'A permission grant is incomplete; refusing to submit a partial set.'
            }
            $all.Add([pscustomobject]@{
                appId = $grant.appId
                delegatedPermissions = @($grant.delegatedPermissions)
                applicationPermissions = @($grant.applicationPermissions)
            })
        }
        $next = $page.'@odata.nextLink'
    }
    return $all.ToArray()
}

$grants = @(Get-AllPermissionGrants -FirstPageUrl $grantsUrl -ExpectedCollectionUrl $grantsUrl -RequestHeaders $headers | ForEach-Object {
    if ($_.appId -eq $env:CONTEXTRELAY_APP_ID) {
        [pscustomobject]@{
            appId = $_.appId
            delegatedPermissions = @('readContent')
            applicationPermissions = @('none')
        }
    } else {
        $_
    }
})
if (-not ($grants | Where-Object appId -eq $env:CONTEXTRELAY_APP_ID)) {
    $grants += [pscustomobject]@{
        appId = $env:CONTEXTRELAY_APP_ID
        delegatedPermissions = @('readContent')
        applicationPermissions = @('none')
    }
}
$body = @{ applicationPermissionGrants = $grants } | ConvertTo-Json -Depth 20

Write-Output 'Preview of the complete grant set (other app grants are preserved):'
Write-Output $body
if ($env:SPE_APPLY -eq 'YES') {
    Invoke-RestMethod -Method Put -Uri $registrationUrl -Headers $headers `
        -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 20
} else {
    Write-Output 'Preview only. After owner review, rerun with SPE_APPLY=YES to replace the registration grant set.'
}
```

Both examples use the owning app's delegated Graph token; they do not perform `az login`, acquire a token, or make any tenant changes unless `SPE_APPLY=YES` is explicitly set. The complete registration grant set is replaced by the update, so review the preview and confirm with the container-type owner before applying. The registration's `applicationPermissionGrants` is a relationship: first read registration ownership, then enumerate the grant collection and every `@odata.nextLink` page. Consult Microsoft's [registration guide](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions), Graph [Get registration](https://learn.microsoft.com/en-us/graph/api/filestoragecontainertyperegistration-get?view=graph-rest-1.0), and [List applicationPermissionGrants](https://learn.microsoft.com/en-us/graph/api/filestoragecontainertyperegistration-list-applicationpermissiongrants?view=graph-rest-1.0) references for the current API contract.

The same authorization can be managed through the SharePoint Embedded MCP server's `container_type_app_grant_add` tool when connected as the container-type owner. This repository's MCP configuration is deliberately read-only for routine development, so it does not expose that mutating tool. No tenant registration or billing change is performed by checking in these configuration files.

## MCP development configuration

The repository configures Microsoft's SharePoint Embedded MCP server for **read-only development assistance**. It is pinned to `@microsoft/spe-mcp@0.2.0-alpha.4` and starts with both `--read-only` and the `readOnly` tool profile. It can inspect and search SharePoint Embedded resources in a developer's tenant but cannot create, update, delete, grant, or upload content. The server is independent of the ContextRelay extension's `/embedded` implementation.

| Client | Configuration | State directory |
|---|---|---|
| VS Code / GitHub Copilot Chat | `.vscode/mcp.json` | `~/.spe-mcp/contextrelay-vscode` |
| Claude Code | `.mcp.json` through `scripts/spe-mcp.cjs` | `~/.spe-mcp/contextrelay-claude-code` |
| GitHub Copilot CLI | `.mcp.json` through `scripts/spe-mcp.cjs` | `~/.spe-mcp/contextrelay-copilot-cli` |
| Codex | `.codex/config.toml` | `~/.spe-mcp/contextrelay-codex` |

Each client keeps its sign-in and setup state in its own directory, so one client's sign-in or tenant change does not affect another. Claude Code and GitHub Copilot CLI both read `.mcp.json`, and Copilot CLI gives `.mcp.json` precedence over `.github/mcp.json`, so a second configuration file cannot separate them. `.mcp.json` therefore starts `scripts/spe-mcp.cjs`. The launcher identifies the client, sets `SPE_DATA_DIR` to an absolute path under the user's home directory, and starts the same pinned read-only server:

- Claude Code sets `CLAUDE_PROJECT_DIR` in the environment of each MCP server it starts, so the launcher selects the Claude Code directory.
- GitHub Copilot CLI passes an MCP server only `PATH` and the variables configured for it, so the launcher selects the Copilot CLI directory when `CLAUDE_PROJECT_DIR` is absent.

The launcher writes the selected client and state directory to standard error, which appears in each client's MCP server log. The configuration refers to the launcher by a relative path, so start Copilot CLI from the repository root. If a client release changes these environment rules and the log shows the other client's directory, stop that client and update the launcher before using it.

The server's token cache and setup state stay outside the repository. Never commit tokens or tenant-specific state. `npx` downloads the pinned package on first use; inspect `spe-mcp start --help` and package security notes before changing the version or enabling write tools. The server may require its own sign-in/setup before its read tools can access tenant data. Do not put credentials or tenant IDs in any MCP configuration.

See Claude Code's [MCP documentation](https://code.claude.com/docs/en/mcp) and GitHub Copilot CLI's [MCP server documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) for each client's configuration rules.

## Validation

Configuration validation checks JSON/TOML syntax and the MCP launch arguments without making any tenant API calls. Before querying actual content, validate the read-only tool list, tenant sign-in, app grant, delegated permission, user container membership, indexing status, and billing setup with the administrators who own those settings.

The Bash and PowerShell registration examples are checked against a local synthetic Graph mock with a multi-page grant collection, a missing `value` page, an owner mismatch, and an untrusted `@odata.nextLink`. These checks do not contact a tenant or apply a registration.
