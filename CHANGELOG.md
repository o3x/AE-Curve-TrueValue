# Changelog

このプロジェクトのすべての重要な変更はこのファイルに記録されます。

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
