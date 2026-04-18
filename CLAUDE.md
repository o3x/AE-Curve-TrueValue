# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

After Effects の「速度グラフ中心・次元非分離」設計上の問題を解決し、**Figma スタイルの 0-1 正規化 cubic-bezier カーブ編集** を AE 内パネルで実現する **CEP 拡張パネル**。

- スクリプト名: **Curve-TrueValue**
- GitHub: https://github.com/o3x/AE-Curve-TrueValue

### 解決する 3 つの問題

| 問題 | AE の現状 | このツールの解法 |
|---|---|---|
| **速度グラフの認知不整合** | デフォルトが speed graph で値の推移が見えない | 0-1 正規化 cubic-bezier カーブで直感的に表示・編集 |
| **ブーメラン効果** | 位置の空間補完がオートベジェで意図せず膨らむ | 空間補完を Linear に自動設定するオプション |
| **次元の不分離** | 位置 X/Y が一体でハンドル操作不可 | 適用時に `dimensionsSeparated = true` で自動分割 |

## Tech Stack

| 対象 | 技術 | 備考 |
|---|---|---|
| パネル UI | HTML5 / CSS3 / ES2020+ | CEP 内蔵 Chromium で動作 |
| AE API アクセス | ExtendScript (.jsx) / **ES3 必須** | `jsx/hostscript.jsx` |
| AE ↔ パネル通信 | `csInterface.evalScript()` | JSON 文字列でデータ交換 |

## ファイル構成

```
AE-Curve-TrueValue/
├── CSXS/
│   └── manifest.xml       ← CEP 拡張定義（ID・ホスト・バージョン）
├── css/
│   └── style.css          ← ダークテーマ（AE UI に合わせた配色）
├── js/
│   ├── cubicBezier.js     ← cubic-bezier 数学（評価・AE ease 変換）
│   ├── curveEditor.js     ← canvas 描画・マウスインタラクション
│   └── main.js            ← CSInterface ブリッジ・UI イベント連結
├── jsx/
│   └── hostscript.jsx     ← AE API: キーフレーム読み書き（ES3 必須）
├── index.html             ← パネル HTML エントリーポイント
├── CLAUDE.md
├── CHANGELOG.md
└── README.md
```

## 開発環境セットアップ（初回のみ）

### 1. CEP デバッグモードを有効化

```powershell
# Windows レジストリに PlayerDebugMode を設定（管理者権限不要）
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_STRING /d 1 /f
# CEP 10 も念のため
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_STRING /d 1 /f
```

### 2. AE 拡張フォルダにシンボリックリンクを作成

```powershell
# AE の CEP 拡張フォルダ（存在しない場合は手動作成）
$extDir = "$env:APPDATA\Adobe\CEP\extensions"
New-Item -ItemType Directory -Path $extDir -Force

# シンボリックリンク（管理者権限が必要）
New-Item -ItemType SymbolicLink `
    -Path "$extDir\com.o3x.curve-truevalue" `
    -Target "d:\Users\ooyama\Documents\VScode\AE-Curve-TrueValue"
```

### 3. After Effects を再起動 → ウィンドウ > 拡張機能 > Curve-TrueValue

### デバッグ（Chrome DevTools）

パネル上で右クリック → `Inspect Element` が使用可能（デバッグモード有効時のみ）

## アーキテクチャ詳細

### 0-1 正規化 cubic-bezier の座標系

- X 軸 = 時間進行度 [0, 1]（キーフレーム間の時間を正規化）
- Y 軸 = 値進行度 [0, 1]（開始値→終了値を 0→1 に正規化）
- **オーバーシュート許可**: Y が [0, 1] を超えることを視覚的に許容
- 形式: `cubic-bezier(P1x, P1y, P2x, P2y)` — Figma / CSS と同一

### AE ↔ cubic-bezier 変換（近似）

```
outInfluence = P1x * 100
outSpeed     = (P1y / P1x) * (valueDelta / timeDelta)   // P1x=0 のとき speed=0

inInfluence  = (1 - P2x) * 100
inSpeed      = ((1 - P2y) / (1 - P2x)) * (valueDelta / timeDelta)
```

精度問題が発生した箇所には `@problem` / `@solution` コメントで記録する。

### csInterface.evalScript の使い方

```javascript
// JS → JSX 呼び出し（引数は文字列に埋め込む）
csInterface.evalScript(
    'applyEase(' + JSON.stringify(args) + ')',
    function(result) {
        const data = JSON.parse(result);
        // ...
    }
);

// JSX 側は必ず JSON.stringify で返す
// function applyEase(argsJson) {
//     var args = JSON.parse(argsJson);
//     ...
//     return JSON.stringify({ status: "ok" });
// }
```

### AE キーフレーム API（hostscript.jsx）

```javascript
// テンポラル補完の読み書き
var outEase = new KeyframeEase(speed, influence);
prop.setTemporalEaseAtKey(keyIdx, [inEase], [outEase]);

// 空間補完のリニア化（ブーメラン効果の解消）
prop.setSpatialTangentsAtKey(keyIdx, [0, 0], [0, 0]);

// 次元分割（Position プロパティ）
prop.dimensionsSeparated = true;

// 選択済みキーフレームの検出
for (var k = 1; k <= prop.numKeys; k++) {
    if (prop.keySelected(k)) { /* 処理 */ }
}
```

## コーディング規則

### JS（index.html / js/*.js）
- モダン JS（ES2020+）使用可
- `const` / `let` / アロー関数 / テンプレートリテラル 全て使用可
- コメントは日本語

### JSX（jsx/*.jsx）
- **ES3 必須**: `var` のみ、`let`/`const`/アロー関数禁止
- 必ず `app.beginUndoGroup` / `app.endUndoGroup` で囲む
- `try...catch (e)` で `e.line`、`e.message` を含むエラーを JSON で返す
- アクセス前に必ず `null` チェックと型チェック

### 共通
- コメント・コミットメッセージは日本語
- バグ修正・仕様回避には `@problem` / `@solution` を記録

## バージョン管理

- CHANGELOG.md 日時形式: `Sun Apr 19 08:42:43 JST 2026`
- ソースコード先頭のバージョン・日付も同形式で更新
