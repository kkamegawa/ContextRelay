# Fix Dependabot Pull Requests（日本語）

## 目的
複数のDependabot PRを、1つのissueと1つの集約PRで確実に処理するための標準手順です。

## 必須ワークフロー
1. Dependabotが作成したオープンPRのみを検出する。
2. Dependabot PRが2件以上ある場合、追跡用issueを1件だけ作成する。
3. ブランチ `fix-dependabot-pullrequest` を作成または利用する。
4. 対象の依存関係更新をその単一ブランチへすべて反映する。
5. 対象Dependabot PRにあるレビュー指摘・コメントを収集し、必要な対応を行う。
6. 必須検証を実行する。
   - `npm run compile`
   - `npm run lint`
   - `npm test`
   - `npm run security:check`
7. issueに紐づく置き換えPRを1件作成する。
8. 置き換え対象となるDependabot PRそれぞれへコメントを付けてクローズする。

## ルール
- 対象はDependabot作成PRのみとする。
- 複数PRをまとめる場合、issueは1件、置き換えPRも1件とする。
- 明示的な指示がない限り、無関係な機能変更や版上げを混在させない。
- moderate/high/critical脆弱性は0件を維持する。

## 完了条件
- 1件のissueで集約作業が追跡されている。
- 1件のPRにDependabot更新が集約されている。
- 置き換え元Dependabot PRにコメント付与のうえクローズされている。
- 必須検証が成功し、security checkが0 vulnerabilitiesである。
