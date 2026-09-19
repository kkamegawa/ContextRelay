# ContextRelay

[English README](README.md)

ContextRelay は、設計やコーディングをしながらサイドパネルで Microsoft 365 の関連コンテキストを参照できる VS Code 拡張機能です。スラッシュコマンドなしのテキストを入力すると Microsoft 365 Copilot とのチャットが始まります。このとき ContextRelay は Microsoft 365 検索を自動実行しませんが、ピン留めしたスニペットと添付ファイルがあれば、グラウンディングコンテキストとして自動的に送信します。スラッシュコマンドを使うと、Exchange メール、Teams メッセージ、SharePoint サイト、OneDrive、OneNote、Planner タスクを検索できます。重要なスニペットをピン留めし、タイムスタンプ付きの引き継ぎドキュメント（PLAN / TASKS / TEST_PLAN / HANDOFF）を生成すれば、GitHub Copilot がすぐに作業を引き継げます。

---

## 機能

- **Copilot チャット（スラッシュコマンドなし）** -- スラッシュコマンドを付けずに入力すると、パネル内で Microsoft 365 Copilot と直接チャットできます。ピン留めスニペットと添付ファイルは自動的にグラウンディングコンテキストとして付与されます。`/ask` は「コンテキストが無ければ送信を拒否する」任意のガードです。
- **ローカルファイルの添付** -- ワークスペース内のローカルファイル（Copilot がサポートする拡張子のみ）を、`#` メンション、📎 ボタン、ドラッグ＆ドロップ、またはオプトインのアクティブエディタ連携で添付できます。ファイルの内容はスラッシュコマンドなしの Copilot チャットと `/ask` にグラウンディングコンテキストとして送信されます。`#` メンションは `/workiq` でも利用できます。
- **ストリーミング応答** -- Microsoft 365 Copilot の応答は逐次描画され、Stop ボタンで中断できます。
- **明示的なソース検索** -- スラッシュコマンドで、接続済みの Microsoft 365 ソースを横断検索します。
- **スラッシュコマンドによるソース指定** -- 検索結果を特定のソースにすぐ絞り込めます。

| コマンド | ソース |
|---------|--------|
| `/mail <query>` | Exchange Online のメール |
| `/teams <query>` | Microsoft Teams のメッセージ |
| `/sharepoint <query>` | SharePoint のサイトとページ |
| `/onedrive <query>` | OneDrive のファイル |
| `/onenote <query>` | OneNote のページ |
| `/task <query>` | Planner と Microsoft To Do のタスク |
| `/all <query>` | 有効なすべてのソース |
| `/ask <instruction>` | ピン留めスニペットまたは添付ファイルを Microsoft 365 Copilot に送信し（存在しない場合は送信を拒否）、応答をパネルに表示 |
| `/workiq <query>` | Work IQ（A2A プロトコル）に自然言語クエリを送信し、Microsoft 365 のワークインテリジェンスを取得 |
| `/clear` | チャット履歴を消去し、ピン留めスニペットをすべて破棄 |

`#` メンションの例（ローカルのワークスペースファイル）:

```text
Summarize #docs/plan.md
/ask Create release notes from #"docs/Release Plan.md"
/workiq Draft a status update using #notes/today.md
```

> **注**: `#` メンションが無効な場合（ファイルが存在しない、ワークスペース外、未対応の拡張子）、ContextRelay はリクエストをブロックしてエラーを表示します。

- **スニペットのピン留め** -- 任意の検索結果を名前付きスニペットとして保存し、セッションをまたいで参照できます。
- **タイムスタンプ付き引き継ぎドキュメント** -- 現在のコンテキストを記録した Markdown ドキュメントを生成します。

| ドキュメント | 目的 |
|----------|---------|
| `PLAN.md` | 上位レベルのゴールと決定事項 |
| `TASKS.md` | 実行可能な TODO 項目 |
| `TEST_PLAN.md` | テストケースと受け入れ基準 |
| `HANDOFF.md`（任意） | 次の担当者や Copilot セッションに渡すコンテキストの全体要約 |

- **GitHub Copilot 対応** -- 生成されるドキュメントは、Copilot が継続作業のために解析しやすい構造化フォーマットに従います。

---

## 動作要件

- ソースからのローカル開発・検証には Node.js 22.12 以降
- [Visual Studio Code](https://code.visualstudio.com/) 1.85 以降
- Microsoft 365 の職場または学校アカウント（Microsoft Entra ID）。個人用 Microsoft アカウントはサポートしません。
- **Exchange メール、Teams、SharePoint、OneDrive、OneNote、Planner、Microsoft To Do の検索**: 標準の Microsoft 365 ライセンスと、必要な Microsoft Graph 委任アクセス許可
- **Copilot グラウンディングを使うチャット機能**: テナントへの展開状況と API の提供状況によっては、Microsoft 365 Copilot ライセンスが必要になる場合があります

### 必要なアクセス許可

ContextRelay は **VS Code 組み込みの Microsoft 認証プロバイダー**（`providerId = microsoft`）を使用します。

ただし、VS Code 既定のファーストパーティクライアント ID は、限られたスコープにしか事前承認されていません。この拡張機能が `Mail.Read`、`Sites.Read.All`、`ChannelMessage.Read.All` などの Microsoft Graph スコープを要求すると、Microsoft Entra は次のエラーを返しました。

```text
AADSTS65002: Consent between first party application 'aebc6443-996d-45c2-90f0-388ff96faa56'
and first party resource '00000003-0000-0000-c000-000000000000' must be configured via preauthorization
```

つまり、**組み込みプロバイダー自体に問題はなく**、**VS Code 既定のクライアント登録が、この拡張機能に必要な Graph スコープに対して事前承認されていない**ということです。

対処方法は、組み込みプロバイダーを使い続けたまま、プロバイダーが元々備えているスコープ経由のエスケープハッチでクライアント／テナントを上書きすることです。

- `VSCODE_CLIENT_ID:<your-client-id>`
- `VSCODE_TENANT:<your-tenant-or-organizations>`

ContextRelay は現在、これらを設定値から自動的に注入します。

機能ごとに必要な Microsoft Graph の委任アクセス許可は次のとおりです。

| アクセス許可 | 利用する機能 |
|---|---|
| `Files.Read.All` | SharePoint / OneDrive 検索 |
| `Sites.Read.All` | SharePoint / OneDrive 検索、チャット |
| `Mail.Read` | Exchange メール検索、チャット |
| `Chat.Read` | Teams 検索、チャット |
| `ChannelMessage.Read.All` | Teams 検索、チャット |
| `Notes.Read` | OneNote 検索 |
| `Tasks.Read` | Planner と Microsoft To Do のタスク検索 |
| `People.Read.All` | チャット |
| `OnlineMeetingTranscript.Read.All` | チャット |
| `ExternalItem.Read.All` | コネクタ検索、チャット（任意） |

> **重要**:
>
> - 一部のアクセス許可（例: `ChannelMessage.Read.All`、`OnlineMeetingTranscript.Read.All`、`ExternalItem.Read.All`）には **テナント管理者の同意** が必要です。
> - この拡張機能は引き続き VS Code 組み込みの認証プロバイダーを使用します。Graph の同意について、VS Code 既定のファーストパーティクライアント ID を使わないようにしているだけです。

#### Work IQ（Graph 以外）のアクセス許可

`WorkIQAgent.Ask` は Microsoft Graph のアクセス許可では **ありません**。`/workiq` コマンドだけが使用する、別のリソースエンドポイントに対する委任アクセス許可です。

| アクセス許可 | リソースエンドポイント | 利用する機能 |
|---|---|---|
| `WorkIQAgent.Ask` | `api://workiq.svc.cloud.microsoft` | `/workiq` コマンド — Work IQ API（任意、Microsoft 365 Copilot ライセンスが必要） |

> **重要**: このアクセス許可には **テナント管理者の同意** が必要で、**Microsoft 365 Copilot ライセンス** を持つユーザーのみが利用できます。設定手順は [docs/work_iq_ja.md](docs/work_iq_ja.md) を参照してください。

---

## インストール

### VS Code Marketplace から

1. **拡張機能** を開きます（`Ctrl+Shift+X` / `Cmd+Shift+X`）。
2. **ContextRelay** を検索します。
3. **インストール** をクリックします。

### ソースから

1. このリポジトリをクローンします。
2. Node.js 22.12 以降を使用します。`nvm` を使う場合は次を実行します。

   ```bash
   nvm use
   ```

3. 依存関係をインストールします。

  ```bash
  npm install
  ```

  > **注意（npm allow-scripts ポリシー）**: npm の allow-scripts ポリシーが強制される環境では、`npx` が allow-scripts のランタイムフラグを入れ子の npm 実行に伝播させることがあるため、`npm run vsce:package` が `EALLOWSCRIPTS` で失敗する場合があります。本プロジェクトでは `scripts/run-audit-safe.cjs`（`security:check` とビルドフックが使用）でこれを回避しており、子プロセスの環境から継承された `npm_config_allow_scripts` を取り除いたうえで `npm audit --audit-level=moderate` を実行します。

4. ターミナルから拡張機能を一度ビルドします。

   ```bash
   npm run compile
   ```

   ```powershell
   npm run compile
   ```

5. VS Code で `F5` を押して拡張機能開発ホストを起動します。リポジトリに含まれる `.vscode/launch.json` はデバッガー起動前に `npm: compile` を自動実行するため、クリーンなチェックアウトでも `dist/extension.js` が無くて失敗することはありません。

変更を提出する前に、次を実行してください。

```bash
npm run compile
npm run lint
npm test
npm run security:check
```

```powershell
npm run compile
npm run lint
npm test
npm run security:check
```

プロジェクトの補足ドキュメント:

- [設計プラン](docs/plan.md)
- [実装タスク](docs/tasks.md)
- [テストプラン](docs/test_plan.md)
- [テナント管理者向けクイックスタート](docs/tenant_admin_quickstart.md)
- [テナント管理者への依頼テンプレート](docs/tenant_admin_request_template.md)
- [テナント管理者への依頼テンプレート（日本語）](docs/tenant_admin_request_template_ja.md)
- [日本語セットアップ要約](docs/setup_summary_ja.md)
- [PR 本文ドラフト](docs/pr_body_draft.md)
- [リリースノートドラフト](docs/release_notes_draft.md)
- [E2E 手動チェックリスト](docs/e2e_checklist.md)
- [E2E レビュー要約](docs/e2e_report.md)

---

## 設定

`settings.json` に次の設定を追加します（すべて任意）。

```jsonc
{
  // VS Code 組み込み認証プロバイダーが使用する Microsoft Entra アプリケーション（クライアント）ID
  "contextRelay.auth.clientId": "00000000-0000-0000-0000-000000000000",

  // VS Code 組み込み認証プロバイダーに渡すテナント ID またはドメイン。
  // 既定の "organizations" は、テナントをまたぐ職場／学校アカウントで動作します。
  "contextRelay.auth.tenantId": "organizations",

  // ソースごとに返す検索結果の件数（既定: 10）
  "contextRelay.maxResults": 10,

  // 引き継ぎドキュメントの保存先ディレクトリ（既定: ".contextrelay"）
  "contextRelay.outputDir": ".contextrelay",

  // キャッシュの TTL（秒）（既定: 300）
  "contextRelay.cache.ttlSeconds": 300,

  // キャッシュエントリの最大数、LRU で破棄（既定: 200）
  "contextRelay.cache.maxEntries": 200,

  // キャッシュをワークスペース状態に永続化（既定: true）
  "contextRelay.cache.persistWorkspaceState": true,

  // Chat タブを有効化 — Copilot Chat API はベータ（既定: true）
  "contextRelay.enableChatPreview": true,

  // アダプターごとの有効／無効（コネクタ以外はすべて既定で true）
  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": true,
  "contextRelay.adapters.sharepoint": true,
  "contextRelay.adapters.onedrive": true,
  "contextRelay.adapters.onenote": true,
  "contextRelay.adapters.planner": true,
  "contextRelay.adapters.connectors": false
}
```

### 初回実行時の推奨設定例

テナント管理者が最も摩擦の少ない形で始めたい場合は、**メールのみのパイロット** から開始し、同意とライセンスの準備が整うまで他のアダプターを無効のままにします。

```jsonc
{
  // テナント自身の Entra アプリ登録を使用
  "contextRelay.auth.clientId": "11111111-2222-3333-4444-555555555555",

  // サインインを 1 テナントに固定し、テナント間の混乱を防ぐ
  "contextRelay.auth.tenantId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",

  // 初期展開を狭く、予測しやすい範囲に保つ
  "contextRelay.maxResults": 10,
  "contextRelay.enableChatPreview": false,

  "contextRelay.adapters.mail": true,
  "contextRelay.adapters.teams": false,
  "contextRelay.adapters.sharepoint": false,
  "contextRelay.adapters.onedrive": false,
  "contextRelay.adapters.onenote": false,
  "contextRelay.adapters.planner": false,
  "contextRelay.adapters.connectors": false
}
```

このスタータープロファイルは、推奨される最小のアクセス許可セットにそのまま対応します。

- `User.Read`
- `Mail.Read`

最初のパイロットが成功したら、アダプターを段階的に有効化し、対応する委任アクセス許可だけを付与してください。

### 組み込みプロバイダー向けの Microsoft Entra アプリ登録設定

初回サインインの前に、VS Code 組み込み認証プロバイダーが使用できる Microsoft Entra アプリケーション登録を作成、または既存のものを再利用します。

1. **Microsoft Entra 管理センター** を開きます。
2. **アプリケーション** → **アプリの登録** → **新規登録** に進みます。
3. 次を設定します。
   - **名前**: `ContextRelay`（任意の名前で構いません）
   - **サポートされるアカウントの種類**: 単一テナントのみで使う場合は通常 **この組織ディレクトリのみに含まれるアカウント**
4. **登録** をクリックします。
5. 作成したアプリ登録を開き、次をコピーします。
   - **アプリケーション (クライアント) ID** → `contextRelay.auth.clientId` に設定
   - **ディレクトリ (テナント) ID**（任意） → `organizations` ではなくテナントを固定したい場合に `contextRelay.auth.tenantId` で使用

#### 手順 A — パブリッククライアントフローを有効化

1. **認証** を開きます。
2. **詳細設定** で **パブリック クライアント フローを許可する** を **はい** に設定します。
3. 保存します。

#### 手順 B — VS Code 組み込み認証プロバイダーが必要とするリダイレクト URI を追加

**認証** → **プラットフォーム構成** で、次のリダイレクト URI を追加します。

**パブリック クライアント／モバイルおよびデスクトップ**

- `http://localhost`
- `https://vscode.dev/redirect`
- `ms-appx-web://Microsoft.AAD.BrokerPlugin/<your-client-id>`
- `msauth.com.microsoft.VSCode.helper://auth`
- `msauth.com.microsoft.VSCodeInsiders.helper://auth`
- `msauth.com.microsoft.VSCodeExploration.helper://auth`

`<your-client-id>` は、アプリ登録の **アプリケーション (クライアント) ID** に置き換えてください。

> 一部の環境でしかテストしない場合、使われない URI もありますが、すべて登録しておくと組み込みプロバイダー特有のプラットフォーム依存のサインイン失敗を避けられます。

#### 手順 C — Microsoft Graph の委任アクセス許可を追加

1. **API のアクセス許可** を開きます。
2. **アクセス許可の追加** → **Microsoft Graph** → **委任されたアクセス許可** をクリックします。
3. 必要なアクセス許可だけを追加します。

推奨される最小セット:

| シナリオ | 最小の委任アクセス許可 |
|---|---|
| メール検索のみ | `User.Read`, `Mail.Read` |
| メール + Teams 検索 | `User.Read`, `Mail.Read`, `Chat.Read`, `ChannelMessage.Read.All` |
| SharePoint / OneDrive 検索 | `User.Read`, `Files.Read.All`, `Sites.Read.All` |
| OneNote 検索 | `User.Read`, `Notes.Read` |
| Planner 検索 | `User.Read`, `Tasks.Read` |
| Chat タブ有効時 | `User.Read`, `Sites.Read.All`, `Mail.Read`, `People.Read.All`, `OnlineMeetingTranscript.Read.All`, `Chat.Read`, `ChannelMessage.Read.All` |
| コネクタ有効時 | `User.Read`, `ExternalItem.Read.All` |

> 組み込みの Microsoft 認証プロバイダーは Graph のユーザープロファイルを前提としており、ContextRelay も常に要求するため、`User.Read` は常に推奨されます。

#### 最小構成のアプリ登録レシピ

できるだけ小さい構成にしたい場合は、次のいずれかのパターンを使ってください。

**パターン 1 — メール検索のみ**

- 委任アクセス許可:
  - `User.Read`
  - `Mail.Read`
- 管理者の同意:
  - 通常 **不要**
- 適した用途:
  - `/mail ...`

**パターン 2 — メール + Teams 検索**

- 委任アクセス許可:
  - `User.Read`
  - `Mail.Read`
  - `Chat.Read`
  - `ChannelMessage.Read.All`
- 管理者の同意:
  - 通常 `ChannelMessage.Read.All` に必要
- 適した用途:
  - `/mail ...`
  - `/teams ...`
  - メール + Teams をまたぐ `/all ...`

**パターン 3 — SharePoint / OneDrive 検索**

- 委任アクセス許可:
  - `User.Read`
  - `Files.Read.All`
  - `Sites.Read.All`
- 管理者の同意:
  - テナントのポリシーによっては必要になることが多い
- 適した用途:
  - `/sharepoint ...`
  - `/onedrive ...`

**パターン 4 — コネクタ以外のすべての機能**

- 委任アクセス許可:
  - `User.Read`
  - `Mail.Read`
  - `Chat.Read`
  - `ChannelMessage.Read.All`
  - `Files.Read.All`
  - `Sites.Read.All`
  - `Notes.Read`
  - `Tasks.Read`
  - `People.Read.All`
  - `OnlineMeetingTranscript.Read.All`
- 管理者の同意:
  - 上記のいくつかには通常必要
- 追加の要件:
  - Copilot グラウンディングを使うチャット機能は、テナントへの展開状況によっては Microsoft 365 Copilot ライセンスが必要な場合があります

**パターン 5 — コネクタを含むすべての機能**

- 委任アクセス許可:
  - パターン 4 のすべてのアクセス許可
  - `ExternalItem.Read.All`
- 管理者の同意:
  - 通常必要
- 追加の要件:
  - コネクタのデータソースが Microsoft 365 / Graph 側で構成済みであること

#### テナント管理者向けの推奨展開手順

承認の摩擦を減らすため、実用最小のアクセス許可セットから始めてください。

1. **パイロット 1**: `User.Read` + `Mail.Read`
2. **パイロット 2**: `Chat.Read` + `ChannelMessage.Read.All` を追加
3. **パイロット 3**: `Files.Read.All` + `Sites.Read.All` を追加
4. **パイロット 4**: 実際に必要な場合のみ、チャットとコネクタのスコープを追加

この進め方なら、広い委任アクセス許可を付与する前に業務上の必要性を検証しやすくなります。

テナント管理者に渡す短い資料は [テナント管理者向けクイックスタート](docs/tenant_admin_quickstart.md) を参照してください。

#### 手順 D — 必要に応じて管理者の同意を付与

一部の委任アクセス許可は **管理者の承認が必要** です。

本プロジェクトでの代表例:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- テナントのポリシーによっては `Sites.Read.All` も該当することが多い

テナントで管理者の承認が必要な場合:

1. **API のアクセス許可** を開いたままにします。
2. **<テナント> に管理者の同意を与えます** をクリックします。
3. 確認します。

管理者権限がない場合は、テナント管理者に同意の付与を依頼してください。

#### 手順 E — 拡張機能を構成

VS Code の設定に値を追加します。

```jsonc
{
  "contextRelay.auth.clientId": "<application-client-id>",
  "contextRelay.auth.tenantId": "organizations"
}
```

次の場合は `organizations` ではなく、固定のテナント GUID または検証済みドメインを使用してください。

- ユーザーのサインイン先を 1 テナントに限定したい
- 同意を 1 テナントでのみ付与している
- テナントをまたぐアカウント選択の混乱を避けたい

サインイン時、ContextRelay は引き続き `vscode.authentication.getSession('microsoft', scopes, ...)` を呼び出しますが、要求するスコープ一覧に、設定した `VSCODE_CLIENT_ID` と `VSCODE_TENANT` の上書きが含まれます。

### サインインのトラブルシューティング

#### `AADSTS65002`

次のエラーが出続ける場合:

```text
AADSTS65002: Consent between first party application 'aebc6443-996d-45c2-90f0-388ff96faa56' ...
```

原因は次のいずれかです。

1. `contextRelay.auth.clientId` が未設定、またはアクティブなウィンドウに読み込まれていない。
2. 構成したアプリ登録に、必要な Graph の委任アクセス許可が不足している。
3. 管理者の承認が必要なアクセス許可について、同意がまだ付与されていない。
4. 必要なリダイレクト URI がアプリ登録に追加されていない。

チェックリスト:

- **有効な** 設定に `contextRelay.auth.clientId` が含まれていることを確認する。
- 認証設定を変更したら VS Code ウィンドウを再読み込みする。
- 必要であれば新しいウィンドウでサインインをやり直す。
- アプリ登録の **API のアクセス許可** を確認する。
- **管理者の同意を与えます** の状態を確認する。

#### サインインはできるがトークン取得に失敗する

次を確認します。

- サインインしたアカウントが、同意を付与したテナントに属していること。
- `contextRelay.auth.tenantId` が正しいこと。
- 有効化したアダプターに必要な Microsoft 365 ライセンスと Graph のアクセス許可をアカウントが持っていること。

#### サインイン後に Teams / チャットのアクセス許可で失敗する

この場合、サインインは成功しているものの、必要な委任アクセス許可が付与されていない、またはテナントのポリシーでブロックされているために、Microsoft Graph が API 呼び出しを拒否しています。上記の機能別アクセス許可マトリクスを確認し、必要に応じてテナント管理者に同意を依頼してください。

### サインインに関する FAQ

#### 管理者の同意が必要と表示される

承認が必要というメッセージが表示される場合や、サインインはできるのに特定の Graph API 呼び出しだけ失敗する場合は、1 つ以上の委任アクセス許可についてテナント管理者の同意が不足している可能性が高いです。

この拡張機能で管理者の同意が必要になる代表例:

- `ChannelMessage.Read.All`
- `OnlineMeetingTranscript.Read.All`
- `ExternalItem.Read.All`
- テナントのポリシーによっては `Sites.Read.All`

対処:

1. **Microsoft Entra 管理センター** → **アプリの登録** → 対象アプリを開きます。
2. **API のアクセス許可** を確認し、必要な委任アクセス許可があることを確認します。
3. 自分のロールで可能であれば **<テナント> に管理者の同意を与えます** をクリックします。
4. ユーザーに VS Code の再読み込みと再サインインを依頼します。

#### リダイレクト URI の不一致

Microsoft Entra がリダイレクト URI の不一致を報告する場合、VS Code 組み込みプロバイダーからアプリ登録には到達しているものの、現在のクライアントプラットフォームの URI が登録されていません。

よくある原因:

- `http://localhost` が未追加
- `https://vscode.dev/redirect` が未追加
- 自分のクライアント ID を含むブローカー／モバイル用リダイレクト URI が未追加
- VS Code ヘルパー URI のいずれかが漏れている

対処:

1. アプリ登録の **認証** を開きます。
2. 上記 **手順 B** に挙げたリダイレクト URI をすべて再確認します。
3. `ms-appx-web://Microsoft.AAD.BrokerPlugin/<your-client-id>` が正確なアプリのクライアント ID になっていることを確認します。
4. 変更を保存し、VS Code を再読み込みしてサインインを再試行します。

#### ライセンス不足

メールと Teams の検索は動くのに SharePoint / OneDrive 検索だけ失敗する場合は、まずサインインしたユーザーに対する `Files.Read.All` と `Sites.Read.All` の同意を確認してください。チャット関連の機能が失敗する場合は、Microsoft 365 Copilot のライセンスが必要な可能性があります。

よくある症状:

- SharePoint や OneDrive のクエリがエラーになる、または有用な結果を返さない
- チャット関連の取得機能が利用できない
- サインインは成功するが、取得系の機能だけ失敗する

確認事項:

1. ユーザーが想定どおりの Microsoft 365 ライセンスを持っているか確認します。
2. SharePoint / OneDrive 検索では、`Files.Read.All` と `Sites.Read.All` が付与・同意されているか確認します。
3. チャットのシナリオでは、テナントが要求する場合に必要な Microsoft 365 Copilot ライセンスをユーザーが持っているか確認します。
4. ライセンスを最近割り当てた場合は、反映を待ってから再試行します。
5. パイロットで取得系の機能がまだ不要であれば、`contextRelay.adapters.sharepoint`、`contextRelay.adapters.onedrive`、`contextRelay.enableChatPreview` を一時的に無効のままにします。

---

## 使い方

### パネルを開く

アクティビティバーの **ContextRelay** アイコンをクリックするか、コマンドパレット（`Ctrl+Shift+P` / `Cmd+Shift+P`）から次を実行します。

```
ContextRelay: Open Panel
```

初回利用時、VS Code が組み込みの Microsoft 認証プロバイダーでのサインインを求めます。

### チャットと検索

スラッシュコマンドを付けずに通常のメッセージを入力して **Enter** を押すと、Microsoft 365 Copilot とのチャットを開始または継続します。ContextRelay はスラッシュコマンドなしのメッセージに対して Microsoft 365 ソースを自動検索しませんが、すでに **ピン留めスニペット** や **添付ファイル**（`#` メンション、📎、ドラッグ＆ドロップ）がある場合は、明示的なコンテキストとして自動的に添付します。これらを使うために `/ask` は不要です。コンテキストが添付されたターンでは、ContextRelay は Web 検索結果よりもそのコンテキストを優先するよう Copilot に指示します。応答はパネル内に表示され、**コピー**、アクティブエディタへの **追記**、アクティブな選択範囲／ドキュメントの **置換** を明示的に選べます。

Microsoft 365 ソースを検索するには、クエリの先頭にスラッシュコマンドを付けます。

```
/all architecture decisions
/mail project kickoff notes
/teams sprint review decisions
/sharepoint API design document
/onedrive architecture diagram
```

#### ローカルファイルの添付

- メッセージ内に `#path/to/file`（またはスペースを含む場合は `#"path with spaces"`）と入力します。
- 📎 をクリック（または **ContextRelay: Attach File to Chat** を実行）してワークスペースのファイルを選択します。
- エクスプローラーからチャット入力欄にファイルをドラッグします。
- 必要に応じて `contextRelay.chat.attachActiveEditor` を有効にすると、アクティブエディタ（または選択行のみ）をすべてのメッセージに添付できます。

添付ファイルは入力欄の上にチップとして表示され、メッセージ送信後にクリアされます。ContextRelay は各ファイルを読み取り、その内容（1 ファイルあたり最大 12,000 文字）を Copilot のコンテキストとして送信するため、OneDrive や SharePoint にアップロードしなくてもローカルファイルを利用できます。

| 設定 | 既定値 | 説明 |
|---------|---------|-------------|
| `contextRelay.chat.maxAttachedFiles` | `5` | 1 メッセージに添付できるファイルの最大数 |
| `contextRelay.chat.attachActiveEditor` | `false` | アクティブエディタまたはその選択範囲をすべてのメッセージに添付する（すべてのメッセージがそのファイルにグラウンディングされます） |
| `contextRelay.chat.streamResponses` | `true` | 応答を逐次描画する。ストリーミングが利用できない場合は同期エンドポイントにフォールバック |

スニペットをピン留めしたり検索を実行したりすると、以降のチャットターンでも同じ Copilot 会話を、その明示的な ContextRelay コンテキスト（ピン留めスニペットと最新の検索サマリー）付きで継続できます。過去の回答は Copilot 自身の会話履歴が保持しているため、ContextRelay は再送しません。

### 検索結果から引き継ぎ情報を作る

1. 検索を実行し、結果を詳細ペインで開きます。
2. 詳細本文から重要なテキストを選択します。
3. その抜粋だけを保存するには **Add selection** を、詳細本文全体を保存するには **Add preview** をクリックします。
4. 保存した抜粋を **Handoff** タブで確認します。
5. **Generate Docs** をクリックして `HANDOFF.md`、`PLAN.md`、`TASKS.md`、`TEST_PLAN.md` を書き出します。

結果カードを直接ピン留めすることもできます。対象がサポート対象のドキュメントやメッセージであれば、ContextRelay は Handoff ワークフローに保存する前に **全文** の取得を試みます。必要な抜粋だけを使いたい場合は、**詳細テキストの選択 → Handoff タブ → ドキュメント生成** という流れを推奨します。

### 引き継ぎドキュメントの生成

コマンドパレットから次を実行します。

```
ContextRelay: Generate Handoff Docs
```

実行するたびに、構成した出力ディレクトリ内の各ファイルへ、タイムスタンプ（UTC）付きのセクションが追記されます。

```
.contextrelay/
  PLAN.md
  TASKS.md
  TEST_PLAN.md
  HANDOFF.md
```

### Copilot への引き継ぎ

GitHub Copilot にコンテキストを引き継ぐには、組み込みコマンドを使用します。

- **ContextRelay: Open Copilot Chat with Handoff Prompt** -- `HANDOFF.md` を参照するプロンプトを入力済みの状態で Copilot Chat を開きます。
- **ContextRelay: Copy Handoff Prompt to Clipboard** -- そのまま貼り付けられる Copilot 用プロンプトをコピーします。

Copilot Chat では、VS Code のコンテキスト機構（#-mentions / Add Context）を使って `HANDOFF.md` を添付してください。

### `/ask` — Microsoft 365 Copilot への送信前にピン留めを必須にする

スラッシュコマンドなしのチャット（[チャットと検索](#チャットと検索)を参照）でも、ピン留めスニペットと添付ファイルは自動的に添付されるため、`/ask` は **任意** です。コンテキストが無い場合に ContextRelay へ送信を拒否させたいときに `/ask` を使います。無人実行やスクリプト化したプロンプトの前のガードとして有用です。

1. ドキュメントを 1 つ以上ピン留めします（`.docx`、SharePoint / OneDrive のファイル、メール、Teams メッセージ）。ContextRelay は可能な範囲でドキュメント全文を取得します。
2. チャット入力欄に `/ask` と指示を入力します。例:

  ```
  /ask Translate the pinned document into Japanese and output as markdown.
  /ask Summarize the pinned documents as a bullet list.
  /ask Extract every action item as JSON with fields owner, due, task.
  ```

3. ContextRelay はピン留めした内容と指示を Microsoft 365 Copilot に送信し、応答をパネルに表示します。応答のアクションから、コピー、アクティブエディタのカーソル位置への追記、アクティブな選択範囲／ドキュメントの置換を実行できます。

ピン留めスニペットが無く、ファイルも添付されていない場合（`#` メンション、📎、ドラッグ＆ドロップ、アクティブエディタのいずれも無い場合）、`/ask` はグラウンディングなしのチャットにフォールバックせず、警告を表示して中止します。この機能は Microsoft 365 Copilot API（ベータ）に依存するため、サインインしたアカウントに Microsoft 365 Copilot ライセンスが必要で、`contextRelay.enableChatPreview` を有効にしておく必要があります。

サインアウトするには、VS Code の **アカウント** メニューを使用します。

### `/workiq` — Work IQ に Microsoft 365 のワークインテリジェンスを問い合わせる

`/workiq` を使うと、A2A（Agent-to-Agent）v1.0 プロトコル経由で [Work IQ Gateway](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq-api-quickstart) に自然言語クエリを送信できます。Work IQ は、メール、会議、ファイル、組織のナレッジに AI 経由でアクセスする手段を提供します。

1. チャット入力欄に `/workiq` と質問を入力します。

   ```
   /workiq Summarize my recent emails from Alice
   /workiq What meetings do I have today?
   /workiq Find documents about the Q3 budget review
   ```

2. ContextRelay はクエリを Work IQ Gateway に送信し、応答をパネルに表示します。

3. 連続した `/workiq` クエリは会話コンテキストを維持するため、追加の質問（「14 時の打ち合わせについてもっと教えて」など）も自然に動作します。

> **前提条件**: `/workiq` コマンドには Microsoft 365 Copilot ライセンスと、Entra アプリ登録での `WorkIQAgent.Ask` 委任アクセス許可が必要です。設定手順は [docs/work_iq_ja.md](docs/work_iq_ja.md) を参照してください。

> **注**: `/workiq` を指定した場合、入力内の他のスラッシュコマンドはすべて無視され、クエリ本文の一部として扱われます。

---

## コントリビューション

コントリビューションを歓迎します。プルリクエストを送る前に、以下のガイドラインを確認してください。

[CONTRIBUTING.md](./CONTRIBUTING.md) と [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) もあわせてお読みください。

1. リポジトリをフォークします。
2. 機能ブランチを作成します: `git checkout -b feature/my-feature`
3. 変更をコミットします: `git commit -m "feat: add my feature"`
4. ブランチをプッシュします: `git push origin feature/my-feature`
5. プルリクエストを作成します。

---

## ライセンス

本プロジェクトは [MIT License](LICENSE) の下で提供されます。
