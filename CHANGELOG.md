# Changelog

このプロジェクトのすべての重要な変更はこのファイルに記録されます。

## [0.8.4] - 作業中（refactor/2026-07、日付はマージ時に確定）
### Fixed
- `jsx/hostscript.jsx` `_findLivePropByTimes()`: 複数プロパティ（例: Position と Scale）が同時刻に KF を持つ場合、live 参照の解決が最初に見つかったプロパティに固定され、2つ目以降のプロパティのエクスプレッションが誤ったプロパティへ書き込まれる不具合を修正
  - `matchName` による絞り込みを追加（`getKfCurve`・`applyEase` の呼び出し箇所も対応）
  - **Windows 実機確認待ち**: 同一レイヤーの Position と Scale に同時刻の KF を作り両方選択して Apply → それぞれのプロパティに自分のエクスプレッションが付くこと
  - 既知の限界: 異なるレイヤーに同じ matchName・同時刻の KF がある場合の曖昧さは残る（未解決、コード内コメントに記載）
### Removed
- `jsx/hostscript.jsx`: `getSelectedKfData()` を削除（未使用・`getKfCurve()` に置換済み）

## [0.8.2] - Thu May 21 10:43:54 JST 2026
### Fixed
- `jsx/hostscript.jsx` `getKfCurve()`: Scale など多次元プロパティの GET で P1y/P2y が正しく復元されない不具合を修正
  - **原因**: 速度からの逆算（`segVin` / `segVout`）にユークリッド距離（`segDists`）を使用していたが、Apply 側の `calcAeEase` は第1次元の値差（`vB[0] - vA[0]`）を使っていたため不整合。2次元均一変化では `1/√2` 倍のズレが生じていた。
  - **修正**: `segVin` / `segVout` を第1次元の値差に統一し、Apply ↔ GET の往復が正確になるよう修正。1D プロパティ（不透明度・回転等）は変更なし（既に正確）。

## [0.8.1] - Wed May 20 21:27:14 JST 2026
### Fixed
- `jsx/hostscript.jsx` `getKfCurve()`: KF 読み取り結果が全プロパティでズレる不具合を修正
  - **原因①**: `typeof prop.getTemporalEaseAtKey !== 'function'` チェックが ExtendScript では live 参照でも `true` を返すため、常に `spatialFallback = true`（P1x/P2x を 1/3・2/3 固定のサンプリングパス）に落ちていた。`typeof` を廃止し `try-catch` のみで判定するよう変更。リニア KF だけ偶然一致して見えていた。
  - **原因②**: `applyEase` が disconnected 参照（`comp.selectedProperties`）で `prop.expression =` を呼んでいたため CTV メタデータが live プロパティに書き込まれず、Apply→GET でも native 近似パスに落ちていた。`_findLivePropByTimes` で live 参照を事前取得し expression を live 側で設定するよう変更。
- `CSXS/manifest.xml`: `ExtensionBundleVersion` / Extension `Version` が 0.7.0 のまま放置されていたため 0.8.1 に修正

## [0.8.0] - Fri May 15 10:33:23 JST 2026
### Changed（破壊的変更）
- **KF 補間方式を HOLD → BEZIER に変更（C案採用）**
  - `jsx/hostscript.jsx` `_applySegmentEase`: HOLD KF → **BEZIER KF + speed/influence 近似 fallback** に切替
  - `jsx/hostscript.jsx` `_applyMultiNodeEase`: 同様。中間 KF 挿入時も BEZIER 補間で生成
  - BEZIER KF にすることでグラフエディタに「視覚的ヒントとしてのカーブ形状」が残る
  - Expression を削除しても近似カーブが残るため、`clearExpression()` 後の挙動が改善
### Added
- `jsx/hostscript.jsx`: `calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta)` — cubic-bezier → speed/influence 変換ヘルパーを共通関数として抽出
- `jsx/hostscript.jsx` `getKfCurve()`: 戻り値に `mode: 'expr' | 'native'` フィールドを追加（CTV コメントパース成功時は `'expr'`、フォールバック時は `'native'`）
- `index.html` / `css/style.css` / `js/main.js`: **モードバッジ**を追加（Phase 3 実装）
  - ステータスバー右端に `Exact`（Expression 有効）/ `≈ Native`（ネイティブ近似）を表示
  - `Exact` バッジをクリックすると `clearExpression()` を呼び出す
  - GET/Apply/Clear ボタン操作に連動してバッジが自動更新

## [0.7.0] - Sun May 03 17:41:57 JST 2026
### Changed（破壊的変更）
- **エクスプレッションベース補完に全面移行（DESIGN.md Phase 1 + Phase 2 実装）**
  - `_applySegmentEase`: BEZIER + speed/influence 方式 → **HOLD KF + `prop.expression` 書き込み**に置き換え
  - `_applyMultiNodeEase`: 同様（`s` 配列に全セグメントのベジェパラメータを格納し一括でエクスプレッション書き込み）
  - エクスプレッション本体は Newton 法 cubic-bezier ソルバー（ES2018）、先頭 `/*CTV:[[...]]*/` にメタデータ埋め込み
  - この変更により**オーバーシュート・アンティシペートが正確に適用可能**、**Position の完全 round-trip が実現**
### Added
- `jsx/hostscript.jsx`: `_buildCtvExpr(segsJson)` — CTV エクスプレッション文字列を生成するヘルパー
- `jsx/hostscript.jsx`: `_r4(v)` — 小数点4桁丸め（エクスプレッション埋め込み用）
- `jsx/hostscript.jsx`: `clearExpression()` — CTV エクスプレッションを削除し speed/influence ネイティブ補完に変換（オーバーシュートは近似）
- `jsx/hostscript.jsx`: `getKfCurve()` に `/*CTV:...*/` コメントパースを優先ルートとして追加（Phase 2）。パース成功時は完全一致の nodes[] を返す（近似なし）
- `index.html` / `css/style.css` / `js/main.js`: **「Expr クリア」ボタン**を追加（`clearExpression` 呼び出し）

## [0.6.1] - Sun May 03 14:41:07 JST 2026
### Fixed
- `jsx/hostscript.jsx`: `getKfCurve()` — spatialFallback の `speedAtTime` 近似を `valueAtTime` サンプリング＋線形システムによる逆算に置き換え
  - P1x=1/3, P2x=2/3 に固定すると ベジェパラメータ t が正規化時間 x と一致する性質を利用
  - セグメント 25%/75% 時刻でサンプリングし、`By(0.25)` / `By(0.75)` の連立方程式を解析的に解いて P1y/P2y を逆算
  - 多次元プロパティ（Position）は累積ユークリッド距離で正規化してから同方程式を適用
- `jsx/hostscript.jsx`: `getKfCurve()` — 1D プロパティで値が**減少**するセグメントのイーズ逆算バグを修正
  - AE の `KeyframeEase.speed` は常に非負（絶対値）で保存されるにもかかわらず、逆算スケール係数 `scIn`/`scOut` に符号付き `segV` を使っていたため P1y/P2y が鏡像になっていた
  - 修正: `segTin / Math.abs(segVin)` / `segTout / Math.abs(segVout)` に変更

## [0.6.0] - Sat May 02 17:51:07 JST 2026
### Added
- **KFから読み取り（GET）ボタン**を追加
  - 選択KF群のイーズを逆変換してカーブエディタへ反映（2KF → 単一セグメント、3KF以上 → 中間ノードを復元）
  - 各セグメントの OutEase/InEase から cubic-bezier ハンドル座標を逆算し、ノード配列として復元
  - `comp.selectedProperties`（disconnected 参照）では `keySelected()` は動くが `getTemporalEaseAtKey()` は未定義になる AE の制限を回避するため、選択KF時刻を取得してレイヤー階層の live 参照を逆引きする方式を採用
  - `jsx/hostscript.jsx`: `getKfCurve()` / `_findLivePropByTimes()` 関数を新規追加
- **複数KF適用時のモード選択ダイアログ**を追加
  - 3KF以上選択状態で適用すると ExtendScript ダイアログを表示
  - A: 各セグメントに現在のカーブを適用（既存動作）
  - B: 中間KFをすべて削除し始点〜終点に適用
  - Enter でフォーカス中のボタンを実行、Esc でキャンセル
  - `jsx/hostscript.jsx`: `_showModeDialog()` 関数を新規追加
### Changed
- `jsx/hostscript.jsx`: `applyEase()` を改修 — KF数判定・ダイアログ呼出し・モードA/B分岐を追加
- `js/main.js`: キャンセル応答 (`status:'cancel'`) を適用ハンドラで処理
- ステータスメッセージから廃止済みの Alt+クリック案内を削除

## [0.5.2] - Thu Apr 30 12:03:27 JST 2026
### Changed
- `js/curveEditor.js`: ノード追加・スムーズ/コーナー切替の操作方法を変更
  - **Ctrl+クリック**（空き箇所）でノードを追加（ダブルクリックと併用）
  - ハンドルドラッグ時、**Ctrl なし → スムーズ**（反対ハンドルをミラー）、**Ctrl あり → コーナー**（独立移動）
  - ドラッグ操作が `node.smooth` フラグを即時更新するため、別途切替操作が不要
  - Alt+クリックによる smooth/corner トグルを廃止

## [0.5.1] - Thu Apr 30 12:03:27 JST 2026
### Changed
- `js/curveEditor.js`: ハンドル・アンカーポイントの描画半径を縮小（視覚的に小さく）
  - ハンドル: `max(4, size×0.025)` → `max(3, size×0.014)`（約55%）
  - アンカー: `max(5, size×0.028)` → `max(3, size×0.016)`（約57%）
  - ヒットテスト半径は変更なし（クリック・ドラッグの操作性を維持）

## [0.5.0] - Sun Apr 19 20:00:00 JST 2026
### Fixed
- `jsx/hostscript.jsx`: JSON ポリフィルを追加（ExtendScript には `JSON` オブジェクトが存在しないため `JSON.stringify` が動かない問題を修正）
- `jsx/hostscript.jsx`: `getTemporalEaseAtKey` / `setTemporalEaseAtKey` を try-catch で保護。`typeof` によるメソッド存在確認が ExtendScript では機能しないため
- `jsx/hostscript.jsx`: `splitDimensions` 有効時に Position のイーズが適用されないバグを修正（`dimensionsSeparated = true` をイーズ適用後に移動）
- `css/style.css`: ステータスバーのテキストをマウスで選択・コピー可能に（`user-select: text`）
### Changed
- `jsx/hostscript.jsx`: テンポラル補完に非対応なプロパティは try-catch でスキップ（エラー時はメッセージを表示）

## [0.4.2] - Sun Apr 19 14:44:00 JST 2026
### Changed
- `CSXS/manifest.xml`: CEPの必須ランタイムを11.0から9.0に変更し、幅広いAEバージョンで認識されるように修正。
- `CSXS/manifest.xml`: ExtensionManifest Version (マニフェスト自体のバージョン) が 11.0 となっていたためロードエラーになる問題を修正し、9.0 に変更。
- `CSXS/manifest.xml`: パネルサイズ定義が `<PreferredSize>` となっており、ロード時に不完全な拡張機能として弾かれていた問題を修正（正しくは `<Size>`）。
- `CSXS/manifest.xml`: ExtensionBundleVersion を 0.4.2 に更新。

## [0.4.1] - Sun Apr 19 09:44:49 JST 2026
### Fixed
- `jsx/hostscript.jsx`: 多点ノード適用時のインデックスズレを修正
  - 後ろから KF を挿入するたびに `insertedIndices` の既存エントリを +1 補正するよう変更
  - 修正前: 2点以上の中間ノードがある場合にセグメントが重複・誤指定されていた
- `jsx/hostscript.jsx`: セグメント handle 座標をグローバル 0-1 からセグメント相対座標に変換して AE ease に渡すよう修正
  - `localP1x = (handleOut.x - ta) / (tb - ta)` に正規化
  - 修正前: 全セグメントで AE の influence/speed が誤った値になっていた

## [0.4.0] - Sun Apr 19 09:31:46 JST 2026
### Added
- `js/curveEditor.js`: `setSelectedNodeCoords({ anchorX, anchorY, outY, inY })` — 選択ノードの座標を数値で精密設定（数値入力欄からの入力用）
- `index.html` / `css/style.css`: `#nc-coords` — 中間ノード選択時にアンカー X/Y・ハンドル Out Y・ハンドル In Y の精密入力欄を表示
- `js/main.js`: 座標入力欄とエディタの双方向同期（フォーカス中は入力上書きしない）
### Changed
- `js/curveEditor.js`: ハンドル X の移動範囲を隣接アンカーの X 境界内に制限（時間軸をまたがない）
  - handleOut.x ≤ 次アンカーの X、handleIn.x ≥ 前アンカーの X
  - スムーズミラー後も両ハンドルにクランプ適用

## [0.3.0] - Sun Apr 19 09:26:02 JST 2026
### Added
- `js/curveEditor.js`: ノード `smooth` プロパティ — `true` でハンドルをリンク（スムーズ接続）、`false` でコーナー（独立）
- `js/curveEditor.js`: Alt+クリックで中間ノードの smooth/corner 切替
- `js/curveEditor.js`: スムーズノードは円、コーナーノードは四角で描画を区別
- `js/curveEditor.js`: 公開 API `deleteSelected()` / `toggleSmooth(forceSmooth?)` / `selectedIndex` / `selectedNode`
- `index.html`: `#node-controls` — スムーズ / コーナー / 削除 ボタンを追加
- `css/style.css`: `.nc-btn`, `.nc-btn.active`, `.nc-btn-delete` スタイル追加
- `js/main.js`: 中間ノード選択時に `#node-controls` を表示し、smooth 状態をボタンに反映
### Changed
- `js/curveEditor.js`: De Casteljau 挿入ノードのデフォルトを `smooth: true` に設定
- `index.html`: ステータスバー初期テキストに Alt+クリック操作説明を追加

## [0.2.0] - Sun Apr 19 09:11:55 JST 2026
### Added
- `js/curveEditor.js`: 多点ノード対応（ダブルクリックで曲線上にノード追加 / De Casteljau 分割 / Delete で削除）
- `js/curveEditor.js`: ResizeObserver によるレスポンシブキャンバス（パネル幅に自動追従）
- `jsx/hostscript.jsx`: 多点ノード対応の `_applyMultiNodeEase` — 中間ノードを AE の中間キーフレームとして生成
- `css/style.css`: `.node-info` スタイル追加、キャンバスのレスポンシブ CSS
- `index.html`: 多ノード時のノード数表示エリア・ステータスバーにヒント追加
### Changed
- `js/main.js`: `onChange(nodes)` — ノード配列を受け取る形式に変更。2ノード時は P1/P2 入力表示、3ノード以上はノード数表示に切替
- `jsx/hostscript.jsx`: `_applyMultiNodeEase` の不要パラメータ `timeB` を削除

## [0.1.0] - Sun Apr 19 08:42:43 JST 2026
### Added
- CEP パネル方式でプロジェクトをセットアップ
- `CSXS/manifest.xml`: CEP 拡張定義（AE CC 2019+, CSXS 11.0）
- `index.html` / `css/style.css`: AE ダークテーマのパネル UI
- `js/cubicBezier.js`: 0-1 正規化 cubic-bezier 評価・AE ease 変換ユーティリティ
- `js/curveEditor.js`: canvas ベースのインタラクティブ bezier ハンドルエディタ
- `js/main.js`: CSInterface ブリッジ・プリセット 9種・UI イベント連結
- `jsx/hostscript.jsx`: AE API ホストスクリプト（キーフレーム読み書き・空間補完リニア化・次元分割、ES3）
- `CLAUDE.md`: CEP アーキテクチャ・開発環境セットアップ・コーディング規約
- プロジェクトの初期リポジトリ（フォルダ構成）の作成
- `README.md` および本 `CHANGELOG.md` の追加
- AI向け設定ファイル `.ai/SOUL.md` の追加
