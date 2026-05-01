# Work IQ 連携

ContextRelay は `/workiq` スラッシュコマンドを通じて [Work IQ Gateway](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq-api-quickstart) への問い合わせをサポートします。Work IQ は Microsoft 365 のワークインテリジェンスへの AI ネイティブインターフェースであり、メール、会議、ファイル、組織のナレッジに対して自然言語でクエリを実行できます。

## 前提条件

- **Microsoft 365 Copilot ライセンス** を持つユーザー
- `contextRelay.auth.clientId` に設定された [Entra アプリ登録](../README.md#microsoft-entra-app-registration-setup-for-the-built-in-provider)
- 組織に **Work IQ サービスプリンシパル** がプロビジョニングされていること
- アプリ登録に **`WorkIQAgent.Ask`** 委任されたアクセス許可が追加され、管理者の同意が付与されていること

## 組織で Work IQ API を有効にする

> ⏱️ 組織ごとに1回、約5分で完了します。

### 手順 1: Work IQ サービスプリンシパルの作成

Work IQ サービスプリンシパルは、ユーザーがトークンを要求できるようにテナントに Work IQ リソースをプロビジョニングします。

1. [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) にアクセスし、**テナント管理者** アカウントでサインインします。
2. メソッドを **POST** に設定し、URL を `https://graph.microsoft.com/v1.0/servicePrincipals` に設定します。
3. **アクセス許可の変更** を選択し、`Application.ReadWrite.All` に同意します。
4. **要求本文** に以下を入力します：

   ```json
   {
     "appId": "fdcc1f02-fc51-4226-8753-f668596af7f7"
   }
   ```

5. **クエリの実行** を選択します。**201 Created** レスポンスが表示されれば成功です。競合エラーはサービスプリンシパルが既に存在することを意味します — 次の手順に進んでください。

### 手順 2: アプリ登録に WorkIQAgent.Ask アクセス許可を追加

1. [Microsoft Entra 管理センター](https://entra.microsoft.com) にアクセスします。
2. **Entra ID** → **アプリの登録** → ContextRelay アプリ登録（`contextRelay.auth.clientId` に設定されているもの）を選択します。
3. **API のアクセス許可** → **アクセス許可の追加** → **自分の組織で使用している API** を選択します。
4. **Work IQ** を検索して選択します。
5. **委任されたアクセス許可** → **WorkIQAgent.Ask** にチェック → **アクセス許可の追加** を選択します。
6. **[テナント名] に管理者の同意を与える** を選択 → **はい** で確認します。

### 手順 3: 確認

管理者の同意を付与した後、アプリ登録の **API のアクセス許可** に `WorkIQAgent.Ask` アクセス許可が緑色のチェックマーク付きで表示されるはずです。Microsoft 365 Copilot ライセンスを持つユーザーは、ContextRelay で `/workiq` コマンドを使用できるようになります。

> **注意**: ユーザーの Copilot ライセンスが最近割り当てられた場合、Work IQ インデックスの構築に 15〜30 分かかることがあり、その間クエリ結果が返されない場合があります。

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
| `403 Forbidden`（スコープエラーなし） | ユーザーに Microsoft 365 Copilot ライセンスがありません。ライセンスを割り当て、15〜30 分待ってください。 |
| `403 Forbidden`（スコープエラーあり） | `WorkIQAgent.Ask` の管理者の同意が付与されていません。テナント管理者に同意の付与を依頼してください（上記手順 2）。 |
| 空のレスポンス | ユーザーの Copilot ライセンスが最近割り当てられた可能性があります。インデックスの構築に 15〜30 分待ってください。 |
| `AADSTS65001: consent required` | 管理者の同意が付与されていません。上記手順 2 を完了してください。 |

## 参考情報

- [Work IQ API クイックスタート](https://learn.microsoft.com/ja-jp/microsoft-365/copilot/extensibility/work-iq-api-quickstart)
- [Work IQ サンプル (GitHub)](https://github.com/microsoft/work-iq-samples)
- [A2A プロトコル仕様](https://a2a-protocol.org/latest/specification/)
