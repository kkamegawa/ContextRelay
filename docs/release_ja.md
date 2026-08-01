# リリースとバージョニング

`package.json` の拡張機能バージョンは、リリースのトリガーとなる git タグから
導出されます。リリースのために `version` フィールドを手動で編集する必要は
ありません。

## タグ形式

- タグは小文字の `v` 接頭辞と、それに続く厳密な
  [SemVer](https://semver.org/) バージョンを使用します（例: `v1.2.3`）。
- プレリリースタグもサポートします（例: `v1.2.3-beta.1`）。
- 大文字の `V` 接頭辞（例: `V1.2.3`）や接頭辞なし（例: `1.2.3`）は拒否されます。
- 先頭の `v` は除去され、`package.json` のバージョンになります
  （`v1.2.3` → `1.2.3`）。

## 信頼できる唯一の情報源（source of truth）

リリースビルドにおいては git タグが信頼できる唯一の情報源です。リリース
ワークフローでは、ビルドやパッケージ化を行う前にバージョンを `package.json`
（および `package-lock.json`）へ反映し、その後、生成された VSIX マニフェストと
照合します。不一致の場合はビルドが失敗します。

## リリース手順

1. リリースしたいコミットが `main` 上にあることを確認します。
2. バージョンタグを作成してプッシュします。

   ```sh
   git tag v1.2.3
   git push origin v1.2.3
   ```

3. `Release VSIX` ワークフロー（`v*.*.*` タグでトリガー）が以下を実行します。
   - `package.json` をタグのバージョンに同期、
   - 拡張機能をビルドして VSIX にパッケージ化、
   - VSIX マニフェストのバージョンがタグと一致するか検証、
   - VSIX をビルド成果物としてアップロード、
   - 生成されたリリースノートと VSIX を添付した Draft の GitHub Release を作成。

4. ワークフロー完了後、Draft の GitHub Release を開き、生成されたリリース
   ノート、タグ、バージョン、添付された VSIX を確認します。問題がなければ、
   **Publish release** を手動で選択して公開します。ワークフローは自動的に
   公開しません。

## ローカル / CI でのタグベースビルド

既定の `npm run package` はバージョンを **変更しません**。そのため通常の
開発には影響しません。

タグベースのビルドをローカルで再現するには、現在のコミットから到達可能な
最新のバージョンタグからバージョンを同期し、パッケージ化します。

```sh
npm run version:from-tag   # 到達可能な最新の v* タグを package.json へ反映
npm run package
npm run vsce:package
```

- `npm run version:resolve` はファイルを変更せず、解決したバージョンを表示します。
- `npm run version:from-tag` は
  `npm version --no-git-tag-version --allow-same-version --ignore-scripts`
  を用いて反映します。
- 到達可能なバージョンタグが存在しない場合、いずれのコマンドも明確な
  エラーで失敗します。

「最新のタグ」とは、リポジトリ全体で最も新しいタグではなく、現在のコミット
履歴から到達可能な最も新しい `v*` タグを指します
（`git tag --list 'v*' --sort=-v:refname --merged HEAD` で検出）。

## 実装

共有ロジックは [`scripts/tag-version.cjs`](../scripts/tag-version.cjs) にあり、
[`src/test/suite/tagVersion.test.ts`](../src/test/suite/tagVersion.test.ts) の
ユニットテストでカバーされています。
