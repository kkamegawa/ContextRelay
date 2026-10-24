# SharePoint Embedded Retrieval

ContextRelay の `/embedded <query>` は、名前を付けて明示的に設定した SharePoint Embedded コンテナータイプからテキスト抽出を取得します。クエリは通常の自然言語で入力でき、GUID を知ったり入力したりする必要はありません。有効なソースが1つならそのソースを使い、複数なら検索前に表示名を Quick Pick で選択します。

このソースはオプトインです。`contextRelay.embedded.enabled` を `true` にするまで無効です。各ソースには表示用の `name`、不透明な `containerTypeId`、`enabled` を設定します。

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

`<CONTAINER_TYPE_ID>` は SharePoint Embedded コンテナータイプの所有者から提供された実際の ID に置き換えます。ユーザーが入力する検索クエリには ID を含めません。このプレースホルダーを実際の設定ファイルにコピーした場合は、検索前に置き換えてください。

## アクセスモデルと前提条件

Retrieval API に `dataSource: "sharePointEmbedded"` と選択した `containerTypeId` を渡して `POST /v1.0/copilot/retrieval` を呼び出します。サービスはアクセス権で絞り込んだ抽出テキストとソースリンクを返します。ContextRelay は抽出テキストをピン留め、チャットの `additionalContext`、HANDOFF に使用します。返される `webUrl` は不透明なリンクとして扱い、通常の SharePoint / OneDrive 添付ファイルとして解釈しません。

アクセスには複数の権限層があり、すべて必要です。

1. ContextRelay の Entra アプリに Microsoft Graph の委任アクセス許可 `FileStorageContainer.Selected` を要求します。ContextRelay は `/embedded` の初回実行時に、他のソースとは別のサインインセッションでこの権限を要求します。同意がない場合に失敗するのは `/embedded` だけで、他のソースには影響しません。
2. コンテナータイプの所有者が、そのコンテナータイプに対して ContextRelay アプリへ委任されたコンテンツ読み取り権限を登録します。Retrieval に必要な最小権限は、登録 API の `readContent` です。
3. サインインユーザー自身も対象コンテナーにアクセスできる必要があります。委任アクセスの実効範囲は、アプリのコンテナータイプ権限とユーザーのコンテナー権限の両方で制限されます。
4. 対象のコンテナータイプに SharePoint Embedded の従量課金が設定されている必要があります。このデータソースを使う Retrieval の呼び出しは、コンテナータイプの課金設定に従って課金されます。
5. セマンティックインデックスの初期化には、テナントに Microsoft 365 Copilot ライセンスを持つユーザーが少なくとも1人必要です。この SharePoint Embedded Retrieval を使うユーザー全員に個別の Copilot ライセンスが必要なわけではありません。

Retrieval API の `sharePointEmbedded` データソースはプレビューです。検索対象は、設定したコンテナータイプのうち、サインインユーザーがアクセスできるコンテナーです。Loop 全体を任意に検索する機能ではありません。コンテナータイプの権限を登録できるのは、その所有アプリだけです。ContextRelay の設定に ID を記述しても、Microsoft Loop 所有や他アプリ所有のコンテナータイプに ContextRelay がアクセス許可を付与することはできません。顧客または ContextRelay 連携が所有しないタイプに保存された Loop コンテンツは、その所有者が連携を認めて権限を付与しない限り対象外です。

詳細は Microsoft の [SharePoint Embedded Retrieval ガイド](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/agent-experiences)、[認証と権限ガイド](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/plan/authentication-permissions)、[コンテナータイプ登録ガイド](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions) を参照してください。

## コンテナータイプ権限の登録

対象コンテナータイプの所有者が登録します。Microsoft Graph のコンテナータイプ登録 API には、所有アプリの `FileStorageContainerTypeReg.Selected` アクセス許可と、コンシューマーテナント用のトークンが必要です。委任登録は SharePoint Embedded 管理者またはグローバル管理者が実行します。所有者は ContextRelay アプリに必要な読み取り権限だけを付与できます。

登録は権限一覧全体を置き換えます。最後に成功した登録呼び出しの内容が有効になります。更新前に現在の登録全体を取得し、維持するすべてのアプリ権限を残したうえで ContextRelay の権限を追加または更新してください。一部の権限だけのリストを送信しないでください。コンテナータイプを所有していない場合は、その所有者に登録を依頼します。ContextRelay アプリで登録 API を呼び出してはいけません。

以下のコマンドは所有者が承認した変更を行う場合の例です。まず現在の登録を取得し、`owningAppId` が想定した所有アプリであることを確認してから、他アプリの権限を残した完全な権限一覧を作成します。ContextRelay の権限は委任 `readContent`、アプリケーション `none` に設定します。既により広い権限がある場合は、適用前にプレビューを確認し、縮小したときの影響を検討してください。コンテナーのメタデータを実際に取得する場合のみ `read` を追加します。現在の Retrieval 経路はそのメタデータを取得しません。

必要条件は Bash と `curl` / `jq`、または PowerShell 7 です。このリポジトリと固定された SPE MCP パッケージには Node.js 22.12 以降（または Node 24 / 26）が必要です。Azure CLI は読み取り専用のテナント／アカウント情報確認に任意で使用できます。例: `az account show --query '{tenantId:tenantId,user:user.name}' -o json`。登録には Azure CLI 既定の Graph トークンを使わないでください。`FileStorageContainerTypeReg.Selected` はトークンを発行したクライアントアプリが所有する登録だけに呼び出しを制限します。以下のアクセストークンは、実際のコンテナータイプ所有アプリの委任 Graph 認証フローから、コンシューマーテナントを対象として取得する必要があります。サインインユーザーには SharePoint Embedded 管理者またはグローバル管理者ロールが必要です。トークンをコマンド引数、ファイル、リポジトリ、シェル履歴に保存しないでください。承認済みの安全な認証手段で現在のシェルプロセスに渡してください。

承認された登録操作に対し、次の非シークレット値を設定します。

```text
GRAPH_BASE_URL=<MICROSOFT_GRAPH_V1_BASE_URL>
CONTAINER_TYPE_ID=<CONTAINER_TYPE_ID>
OWNER_APP_ID=<CONTAINER_TYPE_OWNER_APP_ID>
CONTEXTRELAY_APP_ID=<CONTEXTRELAY_APP_ID>
```

山括弧のプレースホルダーを所有者から受け取った値に置き換えます。`OWNER_APP_GRAPH_ACCESS_TOKEN` はプロセスのメモリ内だけに置きます。以下の例は既定でプレビューのみです。完全な権限一覧を書き込むには `SPE_APPLY=YES` を別途明示する必要があります。

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

どちらの例も所有アプリの委任 Graph トークンを使います。`az login` やトークン取得を行わず、`SPE_APPLY=YES` が明示されない限りテナントを変更しません。更新は完全な権限一覧を置き換えるため、適用前にプレビューを確認し、コンテナータイプ所有者の承認を得てください。登録の `applicationPermissionGrants` はリレーションシップです。まず登録情報で所有者を確認し、その後、権限リストとすべての `@odata.nextLink` ページを取得します。最新の API 仕様は Microsoft の[登録ガイド](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions)、Graph の[登録情報取得リファレンス](https://learn.microsoft.com/en-us/graph/api/filestoragecontainertyperegistration-get?view=graph-rest-1.0)、[applicationPermissionGrants 一覧取得](https://learn.microsoft.com/en-us/graph/api/filestoragecontainertyperegistration-list-applicationpermissiongrants?view=graph-rest-1.0)を参照してください。

コンテナータイプ所有者として接続した SharePoint Embedded MCP サーバーの `container_type_app_grant_add` ツールからも同じ権限を管理できます。このリポジトリの MCP 設定は通常の開発用途向けに読み取り専用であり、変更ツールを公開しません。この設定ファイルを追加しても、テナントの登録や課金設定は変更されません。

## MCP 開発用設定

このリポジトリは Microsoft SharePoint Embedded MCP サーバーを**開発補助用の読み取り専用**で設定します。`@microsoft/spe-mcp@0.2.0-alpha.4` に固定し、`--read-only` と `readOnly` ツールプロファイルで起動します。SharePoint Embedded リソースの参照や検索はできますが、作成、更新、削除、権限付与、アップロードはできません。このサーバーは ContextRelay 拡張機能の `/embedded` 実装とは別のものです。

| クライアント | 設定ファイル | 状態ディレクトリ |
|---|---|---|
| VS Code / GitHub Copilot Chat | `.vscode/mcp.json` | `~/.spe-mcp/contextrelay-vscode` |
| Claude Code | `.mcp.json`（`scripts/spe-mcp.cjs` 経由） | `~/.spe-mcp/contextrelay-claude-code` |
| GitHub Copilot CLI | `.mcp.json`（`scripts/spe-mcp.cjs` 経由） | `~/.spe-mcp/contextrelay-copilot-cli` |
| Codex | `.codex/config.toml` | `~/.spe-mcp/contextrelay-codex` |

クライアントごとにサインイン状態とセットアップ状態を別のディレクトリに保存します。あるクライアントでのサインインやテナント切り替えが、他のクライアントに影響することはありません。Claude Code と GitHub Copilot CLI はどちらも `.mcp.json` を読み、Copilot CLI は `.github/mcp.json` より `.mcp.json` を優先します。そのため、設定ファイルを分けても両者は分離できません。そこで `.mcp.json` から `scripts/spe-mcp.cjs` を起動します。この起動スクリプトがクライアントを判定し、ユーザーのホームディレクトリ配下の絶対パスを `SPE_DATA_DIR` に設定してから、同じ固定バージョンの読み取り専用サーバーを起動します。

- Claude Code は、起動する MCP サーバーの環境変数に `CLAUDE_PROJECT_DIR` を設定します。起動スクリプトはこれを見て Claude Code 用のディレクトリを選びます。
- GitHub Copilot CLI が MCP サーバーに渡すのは、`PATH` と設定ファイルで指定した変数だけです。起動スクリプトは `CLAUDE_PROJECT_DIR` がない場合に Copilot CLI 用のディレクトリを選びます。

起動スクリプトは、選んだクライアントと状態ディレクトリを標準エラー出力に書き出します。この内容は各クライアントの MCP サーバーログに表示されます。設定は起動スクリプトを相対パスで指定しているため、Copilot CLI はリポジトリのルートで起動してください。クライアントの更新でこの環境変数の扱いが変わり、ログに別のクライアントのディレクトリが表示された場合は、そのクライアントを停止し、起動スクリプトを修正してから使用してください。

トークンキャッシュとセットアップ状態はリポジトリ外に保存します。トークンやテナント固有の状態をコミットしないでください。初回起動時に `npx` が指定バージョンのパッケージを取得します。バージョン変更や書き込みツールの有効化前に、`spe-mcp start --help` とパッケージのセキュリティ説明を確認してください。テナントデータの参照には、この MCP サーバー側でのサインインやセットアップが必要な場合があります。MCP 設定に認証情報やテナント ID を記述しないでください。

各クライアントの設定ルールは、Claude Code の [MCP ドキュメント](https://code.claude.com/docs/en/mcp)と GitHub Copilot CLI の [MCP サーバードキュメント](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)を参照してください。

## 検証

設定検証では JSON / TOML の構文と MCP 起動引数を確認します。テナント API は呼び出しません。実際のコンテンツを検索する前に、読み取り専用ツール一覧、テナントのサインイン、アプリ権限、委任アクセス許可、ユーザーのコンテナー所属、インデックス状態、課金設定を各設定の管理者と確認してください。

Bash と PowerShell の権限登録例は、複数ページの権限一覧、`value` の欠落、所有者の不一致、信頼できない `@odata.nextLink` を含むローカルの合成 Graph モックで確認します。この確認ではテナントへ接続せず、登録も適用しません。
