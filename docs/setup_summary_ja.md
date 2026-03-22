# ContextRelay セットアップ要約（日本語）

ContextRelay は、VS Code のサイドパネルから Microsoft 365 の情報を検索するための拡張です。

このリポジトリでは、認証に **VS Code の built-in Microsoft authentication provider** を使いながら、**tenant 側で管理する Microsoft Entra App Registration** を指定できるようにしています。

---

## なぜ App Registration が必要か

既定の VS Code first-party client は、ContextRelay が必要とする Microsoft Graph のすべての delegated permissions に対して事前承認されていません。

そのため、以下のようなエラーが起きることがあります。

```text
AADSTS65002
```

この問題を避けるために、ContextRelay では built-in provider をそのまま使いながら、設定値で以下を差し替えます。

- `contextRelay.auth.clientId`
- `contextRelay.auth.tenantId`

---

## 最小構成のおすすめ

まずは **Mail-only pilot** から始めるのがおすすめです。

### 必要な delegated permissions

- `User.Read`
- `Mail.Read`

### 推奨設定例

```jsonc
{
  "contextRelay.auth.clientId": "11111111-2222-3333-4444-555555555555",
  "contextRelay.auth.tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "contextRelay.enableChatPreview": false,
  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": false,
  "contextRelay.adapters.sharepoint": false,
  "contextRelay.adapters.onedrive": false,
  "contextRelay.adapters.connectors": false
}
```

---

## tenant admin にお願いする内容

tenant admin には、次を依頼します。

1. Microsoft Entra App Registration を作成または再利用
2. **Allow public client flows = Yes** を設定
3. 必要な redirect URI を追加
4. pilot に必要な delegated permissions を追加
5. 必要なら admin consent を実施

詳しい英語版 1 ページ手順書:

- [tenant_admin_quickstart.md](./tenant_admin_quickstart.md)

そのまま使える申請文面:

- [tenant_admin_request_template.md](./tenant_admin_request_template.md)

---

## 代表的な権限セット

### Mail search のみ

- `User.Read`
- `Mail.Read`

### Mail + Teams search

- `User.Read`
- `Mail.Read`
- `Chat.Read`
- `ChannelMessage.Read.All`

### SharePoint / OneDrive retrieval

- `User.Read`
- `Files.Read.All`
- `Sites.Read.All`

### フル構成（connectors 以外）

- `User.Read`
- `Mail.Read`
- `Chat.Read`
- `ChannelMessage.Read.All`
- `Files.Read.All`
- `Sites.Read.All`
- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`

### connectors を含むフル構成

- 上記に加えて `ExternalItem.Read.All`

---

## よくある失敗

### `AADSTS65002`

主な原因:

- `contextRelay.auth.clientId` が未設定
- App Registration に必要な Graph 権限がない
- admin consent が未実施
- redirect URI が不足

### Redirect URI mismatch

主な原因:

- `http://localhost`
- `https://vscode.dev/redirect`
- `ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`

などの URI が登録されていない

### License missing

主な原因:

- SharePoint / OneDrive retrieval や Chat 関連機能に必要な Microsoft 365 Copilot ライセンスがユーザーに付与されていない

---

## 推奨 rollout 順序

1. `User.Read` + `Mail.Read`
2. `Chat.Read` + `ChannelMessage.Read.All`
3. `Files.Read.All` + `Sites.Read.All`
4. 必要な場合のみ transcript / connectors 系を追加

この順番にすると、権限審査と pilot の切り分けがしやすくなります。