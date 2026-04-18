# Changelog

このプロジェクトのすべての重要な変更はこのファイルに記録されます。

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
