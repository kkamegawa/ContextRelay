# ADR 0001: 明示したSharePoint Embeddedコンテンツを直接取得する

- 状態: 承認済み
- 日付: 2026-10-24
- 承認: この会話でユーザーがEmbedded設計・実装を承認し、ブランチ・Issue・英日Wikiの作成を明示的に依頼した。
- 追跡: [Issue #287](https://github.com/kkamegawa/ContextRelay/issues/287)

## 背景

ContextRelayはMicrosoft 365の根拠情報を自分のパネルに表示する。既存のSharePoint・OneDriveはGraph Search、ConnectorsはCopilot Retrievalを使う。SharePoint Embeddedではコンテナータイプの指定とアプリ権限が別途必要。ユーザーがLoopコンテンツを所有しても、コンテナータイプの所有アプリになるわけではない。

## 決定

自然言語の検索文を受け付け、設定した表示名で検索先を1つ選ぶ、明示的な`/embedded`経路を追加する。`sharePointEmbedded`を指定してCopilot Retrievalを直接呼び、取得したextractをプレビュー・Pin・HANDOFF・チャットの本文グラウンディングへ渡す。検索キャッシュはプロセス内とし、認証と検索先で分離する。`FileStorageContainer.Selected`は`/embedded`だけが使うEmbedded専用のサインインセッションで要求し、Embeddedの同意不足が他のアダプターの共通セッションを妨げないようにする。

コンテナータイプの所有アプリがContextRelayへの委任読み取り権限を登録し、ユーザーのコンテナーアクセス権と課金・インデックスの前提を満たす必要がある。設定は対象を指定するもので、権限は付与しない。Microsoft所有の任意のLoopへのアクセスは保証しない。

製品の操作はContextRelay内で完結させる。Work IQ MCPは承認範囲外。直接Work IQ REST／A2Aの機能・制約を記録し、生成回答を取得原文と同一視しない。開発用SPE MCPはバージョン固定・読み取り専用とし、クライアントごとに状態ディレクトリを分け、拡張機能の検索実行経路とは分ける。

## 代替案と影響

- OneDrive Copilot Search Previewは異なるファイル発見用途のため見送る。
- Work IQ RESTは生成回答・引用を扱うが、確認した公開仕様では現在の原文extract取得REST代替を提供していない。既存A2Aは独立して維持する。
- SPE検索と開発用MCPはPreviewであり、セットアップと実テナント検証が必要。
- Pinでは選択した本文と最小限の検索先識別情報を意図的に保存する。自動検索キャッシュは永続化しない。

## 検証

[Embeddedセットアップ](../spe-embedded_ja.md)、実装の回帰テスト、[作業記録](../tasks.md)を参照する。ローカルビルド・UI fixtureの成功は、実際のLoop・テナントでの成功を意味しない。

## 参照

2026-10-24に確認:

- [Embeddedのエージェント体験](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/agent-experiences): 直接Retrievalの要求形式、Preview、課金前提。
- [アプリ権限の登録](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/register-application-permissions): 所有アプリだけが他アプリ許可を登録でき、登録は許可一覧全体を置換する。
- [Work IQ REST概要](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/overview): 生成された会話回答。

## 変更履歴

| 日付 | 以前の決定 | 現在の決定 | 理由と承認 |
|---|---|---|---|
| 2026-10-24 | Embeddedアダプターなし。 | 名前で検索先を選ぶ明示的な直接取得と、読み取り専用の開発支援を追加する。 | この会話でユーザーが実装範囲を承認。 |
| 2026-10-24 | `FileStorageContainer.Selected`を共通セッションに追加し、Claude CodeとCopilot CLIがSPE MCPの状態ディレクトリを共有していた。 | EmbeddedはEmbedded専用のサインインセッションを使い、MCPクライアントごとに状態ディレクトリを分ける。 | コードレビューで、Embeddedの同意不足が全アダプターを止めることと、承認済みのクライアント分離が満たされていないことが判明した。ユーザーが修正を承認。 |
