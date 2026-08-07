# EXEC-REPORT: AE-Curve-TrueValue

- 実施日: 2026-08-07（望）
- ブランチ: `refactor/2026-07`（master へ未マージ・未push、5コミット）
- 対象: `jsx/hostscript.jsx`（886行）

## 実施前に見つかった別件（先に対処済み）

着手前の `git status` で、`CLAUDE.md`・`js/curveEditor.js`・`js/main.js`・`jsx/hostscript.jsx` にEOL churnではない実質的な未コミット・ステージ済み変更（v0.8.2→v0.8.3、v0.5.2→v0.5.5への更新作業、81行追加・44行削除）を発見。大山さんの進行中の作業と判断し、安全ルールに従い一切内容を変更せず、大山さんに確認したところ「コミットしてほしい」との指示だったため、そのままの内容で `43c62a7`としてコミット・push（v0.8.3）した。今回の計画書の作業（項目0以降）はこの v0.8.3 を起点に実施している。

## 実施内容

| 項目 | 内容 | コミット |
|---|---|---|
| 項目0 | 安全網構築。git status クリーン確認（上記コミット後）→ `master`から`refactor/2026-07`分岐 → 静的ゲート実行（`node --check`全ファイル、ES3ゲート＝ES6+構文13件すべて`_buildCtvExpr`のエクスプレッション文字列内であることを再確認、危険コメントゲート0件） | （ブランチ作成のみ） |
| R1 | dead code `getSelectedKfData()`削除（未使用・`getKfCurve()`に置換済み）。冒頭コメントの関数一覧からも削除 | `e96e668` |
| R2 | `_findLivePropByTimes`に第3引数`matchName`を追加し、複数プロパティ（Position/Scale等）が同時刻にKFを持つ場合の live 参照取り違えを修正。`getKfCurve`・`applyEase`双方の呼び出し箇所を対応。既知の限界（異なるレイヤーの同matchName・同時刻KFの曖昧さ）はコード内コメントに明記し、スコープを広げず | `0d7f4a9` |
| R3 | `JSON.parse`ポリフィルをjson2.js方式の安全性検査付きに差し替え。node上で「正常な配列/オブジェクトは通る」「`alert(1)`のような不正な文字列は拒否される」の両方を確認 | `d4ac262` |
| R4 | `_showModeDialog`の説明文に`multiline:true`を追加（2行表示の修正）、`applyEase`のP1/P2取得に`_applyMultiNodeEase`と同じfallback値（0.42/0/0.58/1）でnullガードを追加 | `3850113` |
| R5 | `hostscript.jsx`・`main.js`のVersion/DateをJST日時形式でv0.8.4に更新。CHANGELOG.mdの見出しを確定日時に差し替え | `cc99428` |

## 完了条件の実測結果

- **静的ゲートA**: 全コミットで`node --check`（`jsx`は一時`.js`コピー、`js/*.js`は直接）パス
- **ES3ゲート**: `grep -nE '\bconst |\blet |=>' jsx/hostscript.jsx` のヒットは常に13件（`_buildCtvExpr`内のエクスプレッション文字列のみ、本体への混入なし）
- **危険コメントゲート**: `grep -c '// *@'` は常に0件
- **R1完了条件**: `grep -rn "getSelectedKfData" .`（.git除く）がヒット0を確認
- **R3完了条件**: node上で安全性検査ロジックを単体検証し、「配列が返る」「`alert(1)`は拒否される」「正常なJSONオブジェクトも通る」の3点を確認
- **R5完了条件（UIスモーク）**: **未実施**。下記「実施できなかったこと」参照

## 実施できなかったこと

- **ブラウザでのUIスモークテスト**: `index.html`をブラウザで開いての目視確認・DevToolsコンソール確認は、この実行環境にブラウザ自動化ツール（chromium-cli等）が無く、GUIを目視できないため実施できなかった。代わりに全JSファイルの`node --check`（構文チェック）と、`VERSION`定数が`elVersion.textContent`に反映される実装であることの静的確認のみ行った。**大山さんに実際のブラウザでの確認をお願いしたい**
- **Windows + AE実機での動作確認**: 計画書の通り、これは元々実行者の担当外

## 大山さんへの確認事項

1. **ブラウザUIスモーク**: `index.html`をブラウザで開き、プリセットクリック→カーブドラッグ→ダブルクリックでノード追加→GET/Applyボタン（開発モック）→DevToolsコンソールにエラーがないこと、バージョン表示が`v0.8.4`になっていることを確認してください
2. **AE実機確認（特にR2）**: 同一レイヤーのPositionとScaleに同時刻のKFを作り両方選択してApply → それぞれのプロパティに自分のエクスプレッションが正しく付くことを確認してください
3. 上記2点に問題なければ、マージ・pushの承認をお願いします

## やったこと・やらなかったこと（計画書との対応）

- ✅ R1〜R5 全項目完了（R5のUIスモークのみブラウザ環境の制約で未実施）
- ✅「やらないことリスト」全項目遵守: カーブ数学・`_buildCtvExpr`のエクスプレッション文字列の中身・curveEditor.jsのインタラクション/ヒット判定/描画ロジック・CSXS/manifest.xml・index.html/CSS構造・spatialFallbackの25%/75%サンプリング・`.ai/`フォルダには一切触れていない
- ❌ mainへのマージ・push（大山さんの実機確認・承認待ち）
- ❌ ブラウザUIスモーク・AE実機確認（大山さんに依頼）
