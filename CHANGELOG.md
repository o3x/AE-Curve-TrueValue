# Changelog

このプロジェクトのすべての重要な変更はこのファイルに記録されます。

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
