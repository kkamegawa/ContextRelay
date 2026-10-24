# Work IQ 連携

ContextRelay は A2A v1.0 を使った `/workiq` コマンドで Work IQ に問い合わせます。ContextRelay 自身がサインインユーザーの委任 ID を使って Work IQ を直接呼び出します。GitHub Copilot、Claude、Codex など別のエージェントや Work IQ MCP クライアントは必要ありません。

## 前提条件

- 組織に **Work IQ サービスプリンシパル**が作成されていること
- Work IQ が有効なテナントと、呼び出すユーザーを含む Work IQ API 従量課金ポリシー
- `contextRelay.auth.clientId` に設定された [Entra アプリ登録](../README.md#microsoft-entra-app-registration-setup-for-the-built-in-provider)
- アプリ登録に **`WorkIQAgent.Ask`** 委任されたアクセス許可が追加され、管理者の同意が付与されていること

## 組織で Work IQ を有効にする

> ⏱️ 組織ごとに1回、約5分で完了します。

### 手順 1: Work IQ サービスプリンシパルを作成する

Work IQ サービスプリンシパルを作成すると、テナントに Work IQ リソースがプロビジョニングされ、アプリケーションがそのトークンを要求できるようになります。この手順を行わないと、手順 3 で API のアクセス許可を検索しても **Work IQ** が表示されません。テナント管理者（またはグローバル管理者）が1回だけ実施します。

**Graph Explorer**

1. [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) に**テナント管理者**アカウントでサインインします。
2. メソッドを **POST**、URL を `https://graph.microsoft.com/v1.0/servicePrincipals` に設定します。Graph Explorer が関連するスコープを表示できるよう、同意の前に URL を入力してください。
3. **アクセス許可の変更** を選択し、`Application.ReadWrite.All` に同意します。この同意は自分の Graph Explorer セッションにだけ適用されます。
4. **要求本文** に次の内容を入力します。

   ```json
   {
     "appId": "fdcc1f02-fc51-4226-8753-f668596af7f7"
   }
   ```

5. **クエリの実行** を選択します。**201 Created** が返れば成功です。競合エラーはサービスプリンシパルが作成済みであることを意味します。次の手順に進んでください。

**Azure CLI**（テナント管理者として `az login` でサインイン済み）。次のコマンドは、サービスプリンシパルがまだない場合だけ作成します。

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

### 手順 2: Work IQ と従量課金を有効にする

Microsoft の [Work IQ テナント設定](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq/enable-work-iq)に従います。従量課金を設定し、呼び出すユーザーを Work IQ API を含む利用ポリシーに割り当てます。Microsoft 365 Copilot ライセンスを割り当てても、この課金ポリシーは自動構成されません。

### 手順 3: アプリ登録に WorkIQAgent.Ask アクセス許可を追加

1. [Microsoft Entra 管理センター](https://entra.microsoft.com) にアクセスします。
2. **Entra ID** → **アプリの登録** → ContextRelay アプリ登録（`contextRelay.auth.clientId` に設定されているもの）を選択します。
3. **API のアクセス許可** → **アクセス許可の追加** → **自分の組織で使用している API** を選択します。
4. **Work IQ** を検索して選択します。表示されない場合は、先に手順 1 を完了してください。
5. **委任されたアクセス許可** → **WorkIQAgent.Ask** にチェック → **アクセス許可の追加** を選択します。
6. **[テナント名] に管理者の同意を与える** を選択 → **はい** で確認します。

### 手順 4: 確認

管理者の同意後、アプリ登録の **API のアクセス許可** に `WorkIQAgent.Ask` が緑色のチェックマーク付きで表示されることを確認します。クエリを実行する前にテストユーザーが Work IQ API の利用ポリシーに含まれていることも確認してください。

> **注意**: ライセンスやテナント設定変更後、検索が利用可能になるまで時間がかかることがあります。Work IQ 呼び出しは Copilot Credits の従量課金対象です。展開前に支出上限とポリシー割り当てを確認してください。

## 使い方

### 基本的なクエリ

ContextRelay チャットパネルで `/workiq` の後に質問を入力します：

```
/workiq Alice からの最近のメールを要約して
/workiq 今日のミーティングは何がありますか？
/workiq Q3 予算レビューに関するドキュメントを探して
```

### マルチターン会話

連続する `/workiq` クエリは A2A `contextId` を通じて会話コンテキストを維持します。フォローアップの質問が自然に機能します：

```
/workiq 今日のミーティングは何がありますか？
/workiq 14時のお客様ミーティングについてもっと教えて
```

会話コンテキストをリセットしてやり直すには `/clear` を使用してください。

### スラッシュコマンドの動作

`/workiq` を指定すると、入力中の他のすべてのスラッシュコマンドはクエリテキストの一部として扱われます。例：

```
/workiq /mail プロジェクト更新
```

これはメールアダプターにルーティングするのではなく、テキスト全体 `/mail プロジェクト更新` をクエリとして Work IQ に送信します。

## Work IQ API の評価

Work IQ REST API はアプリケーションから直接利用できます。Microsoft の資料では、Microsoft 365 エンタープライズ検索と Web 検索でグラウンディングし、生成した回答を返すマルチターン会話 API として説明されています。委任ユーザー ID、ユーザー権限による結果のフィルタリング、SharePoint / OneDrive ファイルをコンテキストとして渡す機能をサポートします。ただしこれは回答生成 API であり、Copilot Retrieval の抽出 DTO とそのまま置き換えられません。ContextRelay のピン留め・検索結果フローに適した、Work IQ MCP の `retrieve` ツールと同等の抽出専用 REST API は現時点で公開されていません。

Microsoft の移行ガイドでは、Work IQ MCP の `retrieve` ツールは引用付き Markdown と構造化された `retrievalHits` を返し、REST による抽出取得は 2026 年11月に提供予定とされています。この文書を確認した 2026-10-24 時点では、将来予定の機能であり現在利用できる機能ではありません。そのため、このプロジェクトでは直接呼び出す既存の A2A `/workiq` を維持し、SharePoint Embedded 実装に Work IQ REST / MCP は追加しません。ユーザーは外部エージェントのセットアップ負担を避けるため Work IQ MCP をこのスコープから除外しました。これはプロジェクト上の範囲決定であり、MCP の技術的な連携方式に制約があるという意味ではありません。

REST API は、Work IQ が合成回答を返す UX を求める場合、または文書化された REST 抽出機能が公開されたときに再検討できます。採用前に、回答と引用の形式、ユーザー同意と Copilot Credits の費用、グラウンディング制御、遅延、エラー動作を既存の A2A 経路と比較してください。

### Loop コンテンツの検証項目

次のすべての項目を実テナントで確認するまで、Work IQ API による Loop 横断検索は ContextRelay の対応機能として扱いません。Embedded 検索には取得した原文 extract が必要で、Work IQ は生成回答を返すため、`/embedded` が Work IQ に自動で切り替わることはありません。

| ID | 確認内容 | 確認方法 |
|---|---|---|
| WIQ-01 | ユーザー自身の Loop コンポーネントやページにある既知の情報を、A2A と REST で取得できる。 | テストユーザーが作成した Loop ワークスペースにだけある事実を質問し、A2A と REST の回答を比較する。 |
| WIQ-02 | ユーザーに共有された Loop コンテンツにある既知の情報を、A2A と REST で取得できる。 | 別のユーザーが所有し、テストユーザーに共有した Loop コンテンツで WIQ-01 を繰り返す。 |
| WIQ-03 | 各回答に検証可能な出典が付く。 | すべての出典から、記載された事実を含む Loop アイテムを開ける。 |
| WIQ-04 | 生成された回答文と引用された原文を区別できる。 | 応答が引用部分を生成部分と区別して示すか、原文の抜粋をそのまま取得できるかを確認する。 |
| WIQ-05 | 検索対象を明示的に制限できる。 | 要求で回答の対象を Loop コンテンツや特定のワークスペースに限定できるか、対象外の出典が含まれないかを確認する。 |
| WIQ-06 | ユーザーがアクセスできないコンテンツが回答に含まれない。 | テストユーザーがアクセスできない Loop コンテンツにだけある事実を質問し、回答がその内容を示さず、出典にも含まないことを確認する。 |
| WIQ-07 | テナントの前提条件を満たしている。 | Work IQ サービスプリンシパルが存在し、`WorkIQAgent.Ask` に管理者の同意があり、テストユーザーが Work IQ API の利用ポリシーに含まれ、Copilot Credits が利用できる。 |

実テナントの結果は、日付、使用した API（A2A または REST）、各項目の結果とともに、ローカルテストの結果とは分けて記録してください。

## 仕組み

`/workiq` コマンドは [A2A (Agent-to-Agent) v1.0 プロトコル](https://a2a-protocol.org)（エージェント間通信のオープン標準）を使用します：

- **エンドポイント**: `https://workiq.svc.cloud.microsoft/a2a/`
- **プロトコル**: JSON-RPC 2.0、`SendMessage` メソッド
- **トークンオーディエンス**: `api://workiq.svc.cloud.microsoft`
- **バージョンヘッダー**: `A2A-Version: 1.0`

Work IQ はサインインしたユーザーの ID を使用して Microsoft 365 データにアクセスします。`Location` メタデータ（タイムゾーン）は自動的に含まれるため、時間に関するクエリ（「今日」「今週」）はユーザーのローカル時間に基づいて処理されます。

## トラブルシューティング

| 症状 | 対処法 |
|------|--------|
| `401 Unauthorized` | トークンオーディエンスの不一致。アプリ登録に `WorkIQAgent.Ask` アクセス許可があることを確認してください。 |
| `403 Forbidden`（スコープエラーなし） | ユーザーが Work IQ API を含む従量課金ポリシーに含まれていないか、利用上限に達した可能性があります。ポリシー割り当てと Copilot Credits のコスト管理を確認してください。 |
| `403 Forbidden`（スコープエラーあり） | `WorkIQAgent.Ask` の管理者の同意が付与されていません。テナント管理者に同意の付与を依頼してください（上記手順 3）。 |
| 空のレスポンス | ユーザーが対象コンテンツにアクセスできること、関連するテナントインデックスが利用可能であることを確認してください。 |
| `AADSTS65001: consent required` | 管理者の同意が付与されていません。上記手順 3 を完了してください。 |
| **自分の組織で使用している API** に **Work IQ** が表示されない | テナントに Work IQ サービスプリンシパルがありません。上記手順 1 を完了してください。 |

## 参考情報

- [Work IQ API 概要](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq/api-overview)
- [Work IQ REST API 概要](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq/rest/overview)
- [Work IQ MCP retrieval 移行ガイド](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq/mcp/migrate-retrieval-api)
- [Work IQ A2A クイックスタート](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq/a2a/quickstart)
- [Work IQ サンプル (GitHub)](https://github.com/microsoft/work-iq-samples)
- [A2A プロトコル仕様](https://a2a-protocol.org/latest/specification/)
