# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

After Effects の「速度グラフ中心・次元非分離」という設計上の問題を解決し、**Figma スタイルの 0-1 正規化 cubic-bezier カーブ編集** を AE 内パネルで実現する **CEP 拡張パネル**。

- 名称: **Curve-TrueValue** / GitHub: https://github.com/o3x/AE-Curve-TrueValue
- 設計思想の詳細: `.ai/After Effects カーブ調整の理想を求めて.md`

解決する問題（設計文書より）:
- **速度グラフの認知不整合** → 0-1 正規化 cubic-bezier カーブで直感的に表示
- **ブーメラン効果** → 空間補完を Linear に自動設定するオプション
- **次元の不分離** → 適用時に `dimensionsSeparated = true` で自動分割

## Tech Stack

| 対象 | 技術 | 制約 |
|---|---|---|
| パネル UI | HTML5 / CSS3 / ES2020+ | CEP 内蔵 Chromium で動作 |
| AE API アクセス | ExtendScript (.jsx) | **ES3 必須**（`var` のみ） |
| AE ↔ パネル通信 | `csInterface.evalScript()` | JSON 文字列でやり取り |

ビルドシステムなし。ファイルを直接 CEP がロードする。

## 開発環境セットアップ（初回のみ）

### CEP デバッグモードを有効化
```powershell
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_STRING /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_STRING /d 1 /f
```

### AE 拡張フォルダにシンボリックリンクを作成（管理者 PowerShell）
```powershell
New-Item -ItemType Directory -Path "$env:APPDATA\Adobe\CEP\extensions" -Force
New-Item -ItemType SymbolicLink `
    -Path "$env:APPDATA\Adobe\CEP\extensions\com.o3x.curve-truevalue" `
    -Target "d:\Users\ooyama\Documents\VScode\AE-Curve-TrueValue"
```

**AE 再起動 → ウィンドウ > 拡張機能 > Curve-TrueValue**

### UI のみ確認（AE 不要）
`index.html` をブラウザで直接開く。`csInterface` は自動的に開発モックに切り替わり、`console.log` でデバッグ可能。AE 上での DevTools は パネル右クリック → Inspect Element。

## アーキテクチャ

### コアデータ構造: ノード配列

```javascript
// ノード = { anchor: {x,y}, handleIn: {x,y}|null, handleOut: {x,y}|null }
//   開始ノード: handleIn=null、終了ノード: handleOut=null、中間ノード: 両方あり
// 例: 単一セグメント（デフォルト）
nodes = [
    { anchor: {x:0, y:0}, handleIn: null,            handleOut: {x:0.42, y:0.00} },
    { anchor: {x:1, y:1}, handleIn: {x:0.58, y:1.00}, handleOut: null           },
]
```

このノード配列がパネル全体を流れる唯一の状態。`CurveEditor.onChange(nodes)` → `main.js` → `applyEase(argsJson)` → `hostscript.jsx` の順に伝播する。

### CurveEditor クラス（js/curveEditor.js）

| API | 用途 |
|---|---|
| `constructor(canvas, onChange)` | `onChange(nodes)` はノード変更のたびに呼ばれる |
| `setValues(p1x, p1y, p2x, p2y)` | プリセット適用など、単一セグメントを直接セット |
| `setNodes(nodes)` | ノード配列を一括セット |
| `get p1` / `get p2` | 単一セグメント時の後方互換ゲッター |

内部状態: `_drag = { type:'anchor'|'handleIn'|'handleOut', idx }` / `_selected = number|null`

ダブルクリックでノード追加する際は **De Casteljau 分割** でカーブ形状を保ったまま挿入する（`_splitAt(segIdx, t)` メソッド）。

### 座標系

- canvas Y 軸は上が 0（スクリーン座標）→ ベジェ変換は `by = 1 - cy/inner`
- パディング `_pad = size * 0.085` でキャンバス周囲に余白
- Y 軸は [-0.5, 1.5] を許容（オーバーシュート表現）
- ハンドル X 軸: `handleOut.x >= anchor.x`、`handleIn.x <= anchor.x` で制限

### AE ↔ cubic-bezier 変換（近似）

```
outInfluence = P1x * 100
outSpeed     = (P1y / P1x) * (valueDelta / timeDelta)   // P1x=0 のとき 0

inInfluence  = (1 - P2x) * 100
inSpeed      = ((1 - P2y) / (1 - P2x)) * (valueDelta / timeDelta)
```

精度問題には `@problem` / `@solution` コメントで記録する。

### 多ノード適用フロー（hostscript.jsx）

nodes が 3 点以上の場合、`_applyMultiNodeEase` が:
1. 中間ノードをループ（後ろから）して `prop.addKey()` で AE に中間 KF を生成
2. 挿入後のインデックスを再取得して `_applySegmentEase` を各セグメントに適用

### csInterface パターン

```javascript
// JS → JSX: 引数を JSON 文字列で二重エンコード
csInterface.evalScript(`applyEase(${JSON.stringify(argsJson)})`, (result) => {
    const res = JSON.parse(result); // { status, count|message }
});

// JSX → JS: 必ず JSON.stringify で返す
function applyEase(argsJson) {
    var args = JSON.parse(argsJson);
    // ...
    return JSON.stringify({ status: 'ok', count: n });
}
```

### AE キーフレーム API チートシート

```javascript
// テンポラル補完
var ease = new KeyframeEase(speed, influence);
prop.setTemporalEaseAtKey(k, [inEase], [outEase]);
var eases = prop.getTemporalEaseAtKey(k); // [[inEase], [outEase]]

// 空間補完のリニア化
// @problem Position 以外で呼ぶとエラー → @solution try/catch で握りつぶす
prop.setSpatialTangentsAtKey(k, [0,0,0], [0,0,0]);

// 次元分割
// @problem Position 系以外では matchName チェックが必要
prop.dimensionsSeparated = true;
```

## コーディング規則

### JS（js/*.js）
- ES2020+ 使用可（`const`/`let`/アロー関数/テンプレートリテラル）
- コメントは日本語

### JSX（jsx/*.jsx）
- **ES3 必須**: `var` のみ、`let`/`const`/アロー関数禁止
- `app.beginUndoGroup` / `app.endUndoGroup` で囲む（`finally` で確実に閉じる）
- エラーは `JSON.stringify({ status:'error', message: e.message + ' (line ' + e.line + ')' })` で返す

### 共通
- コメント・コミットメッセージは日本語
- AE 特有の仕様回避には `@problem` / `@solution` を記録

## バージョン管理

日時形式（ソース先頭・CHANGELOG.md 共通）:
```powershell
powershell -Command "[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture; Get-Date -Format 'ddd MMM dd HH:mm:ss JST yyyy'"
```
