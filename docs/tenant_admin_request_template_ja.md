# ContextRelay tenant admin 申請テンプレート（日本語）

ContextRelay を tenant 内で利用開始する際に、そのまま貼り付けて使える申請文テンプレートです。

---

## 短い版

件名: ContextRelay 利用のための Microsoft Entra App Registration 作成・権限承認のお願い

管理者各位

VS Code 拡張 **ContextRelay** の pilot 利用を開始したく、tenant 管理の Microsoft Entra App Registration 作成または既存アプリの設定をお願いしたいです。

この拡張は VS Code の built-in Microsoft authentication provider を利用しますが、既定の VS Code first-party client では必要な Microsoft Graph 権限に対して事前承認が不足するため、tenant 管理の App Registration を利用したいです。

### お願いしたい設定

1. ContextRelay 用の Microsoft Entra App Registration を作成または再利用
2. **Allow public client flows** を **Yes** に設定
3. 以下の redirect URI を追加
   - `http://localhost`
   - `https://vscode.dev/redirect`
   - `ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`
   - `msauth.com.microsoft.VSCode.helper://auth`
   - `msauth.com.microsoft.VSCodeInsiders.helper://auth`
   - `msauth.com.microsoft.VSCodeExploration.helper://auth`
4. Microsoft Graph の delegated permissions を pilot 範囲で追加

### 初回 pilot の最小権限

- `User.Read`
- `Mail.Read`

### 必要に応じて後から追加したい権限

**Teams 検索**

- `Chat.Read`
- `ChannelMessage.Read.All`

**SharePoint / OneDrive retrieval**

- `Files.Read.All`
- `Sites.Read.All`

**Chat / transcript / people context**

- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`

**Connectors**

- `ExternalItem.Read.All`

### 背景

tenant 管理の App Registration を使わない場合、Microsoft Entra 側で `AADSTS65002` が発生し、必要な Graph scope の consent が成立しないことがあります。

### 利用者側で必要な情報

設定完了後、以下の値をご共有いただければ利用者側で VS Code に設定します。

- **Application (client) ID**
- **Directory (tenant) ID** または tenant domain

よろしくお願いいたします。

---

## 丁寧な版

件名: ContextRelay pilot 展開のための Microsoft Entra App Registration / Graph 権限承認のお願い

管理者各位

VS Code 拡張 **ContextRelay** の pilot 展開を予定しており、Microsoft Entra App Registration および Microsoft Graph delegated permissions の設定をご相談したくご連絡しました。

### 技術的な前提

ContextRelay は VS Code の built-in Microsoft authentication provider を利用しますが、必要な Graph scope を tenant 側で明示的に管理するため、tenant 専用の Microsoft Entra App Registration を指定して利用します。

これにより、以下を tenant 側で制御できます。

- サインインに使う App Registration
- 付与する Microsoft Graph delegated permissions
- admin consent の対象範囲
- pilot の段階的な展開

### App Registration にお願いしたい設定

1. **Public client flow を有効化**
2. 以下の redirect URI を登録
   - `http://localhost`
   - `https://vscode.dev/redirect`
   - `ms-appx-web://Microsoft.AAD.BrokerPlugin/<client-id>`
   - `msauth.com.microsoft.VSCode.helper://auth`
   - `msauth.com.microsoft.VSCodeInsiders.helper://auth`
   - `msauth.com.microsoft.VSCodeExploration.helper://auth`
3. rollout 段階に応じた delegated permissions を追加

### 段階的な権限追加案

**Phase 1 — Mail-only pilot**

- `User.Read`
- `Mail.Read`

**Phase 2 — Teams search を追加**

- `Chat.Read`
- `ChannelMessage.Read.All`

**Phase 3 — SharePoint / OneDrive retrieval を追加**

- `Files.Read.All`
- `Sites.Read.All`

**Phase 4 — 高度機能を追加**

- `People.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`

### admin consent が必要になりやすい権限

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- tenant ポリシーによっては `Sites.Read.All`

### 利用者側の設定

App Registration 作成後、利用者は VS Code に以下を設定します。

```jsonc
{
  "contextRelay.auth.clientId": "<application-client-id>",
  "contextRelay.auth.tenantId": "<tenant-id-or-domain>"
}
```

### お願い

まずは最小権限 (`User.Read` + `Mail.Read`) で pilot を開始し、必要に応じて段階的に権限を追加したいと考えています。

設定後、以下の値をご共有いただけると助かります。

- Application (client) ID
- Directory (tenant) ID または tenant domain

ご検討よろしくお願いいたします。
