# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

After Effects の「速度グラフ中心・次元非分離」という設計上の問題を解決し、**Figma スタイルの 0-1 正規化 cubic-bezier カーブ編集** を AE 内パネルで実現する **CEP 拡張パネル**。

- 名称: **Curve-TrueValue** / GitHub: https://github.com/o3x/AE-Curve-TrueValue

解決する問題:
- **速度グラフの認知不整合** → 0-1 正規化 cubic-bezier カーブで直感的に表示
- **ブーメラン効果** → 空間補完を Linear に自動設定するオプション（暫定）→ 将来はエクスプレッション方式で根絶
- **次元の不分離** → 適用時に `dimensionsSeparated = true` で自動分割（暫定）→ 将来はエクスプレッション方式で不要に

### アーキテクチャ進化

v0.7.0 よりエクスプレッションベース補完に移行、v0.8.0 で **C案（BEZIER KF + Expression）** に切替済み。設計思想の詳細は **`DESIGN.md`** を参照。

```
旧（〜v0.6.x）: cubic-bezier → speed/influence → AE が補間  ← オーバーシュート不可・round-trip 不可
旧（v0.7.x）  : cubic-bezier → HOLD KF + prop.expression（Newton 法ソルバー）
現行（v0.8.0〜）: cubic-bezier → BEZIER KF（近似 fallback）+ prop.expression → AE は値を受け取るだけ
```

- BEZIER KF に speed/influence の近似値を書き込み、グラフエディタに視覚的ヒントを残す
- Expression が毎フレームの正確な値を上書き計算（Newton 法 cubic-bezier ソルバー）
- `/*CTV:[[p1x,p1y,p2x,p2y], ...]*/` コメントを先頭に埋め込み、GET 時に完全一致で復元
- `clearExpression()` で Expression を削除し、BEZIER KF の近似 ease のみで動作するネイティブモードに戻せる
- **モードバッジ**: `setMode('expr'|'native')` がステータスバー右端のバッジを切替。`Exact` バッジクリックで `clearExpression()` を呼び出し。GET 時に `mode` フィールドで返すことで自動反映

## Tech Stack

| 対象 | 技術 | 制約 |
|---|---|---|
| パネル UI | HTML5 / CSS3 / ES2020+ | CEP 内蔵 Chromium で動作 |
| AE API アクセス | ExtendScript (.jsx) | **ES3 必須**（`var` のみ） |
| AE ↔ パネル通信 | `csInterface.evalScript()` | JSON 文字列でやり取り |
| AE エクスプレッション | JS 文字列として JSX から `prop.expression` に書き込む | **ES2018 使用可**（`const`/`let`/アロー関数 OK） |

ビルドシステムなし。ファイルを直接 CEP がロードする。

> **言語の混在に注意**: JSX は ES3 だが、JSX が生成して `prop.expression` に書き込む文字列の中身は ES2018 で書いてよい。

## 開発環境セットアップ（初回のみ）

### CEP デバッグモードを有効化
```powershell
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f
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
// ノード = { anchor:{x,y}, handleIn:{x,y}|null, handleOut:{x,y}|null, smooth:boolean }
//   smooth=true  → ハンドルをリンク（対称ミラー、C1 連続）
//   smooth=false → ハンドルを独立（コーナー）
//   開始ノード: handleIn=null、終了ノード: handleOut=null
nodes = [
    { anchor:{x:0,y:0}, handleIn:null,             handleOut:{x:0.42,y:0.00}, smooth:true },
    { anchor:{x:1,y:1}, handleIn:{x:0.58,y:1.00},  handleOut:null,            smooth:true },
]
```

このノード配列がパネル全体を流れる唯一の状態。`CurveEditor.onChange(nodes)` → `main.js` → `applyEase(argsJson)` → `hostscript.jsx` の順に伝播する。

### CurveEditor クラス（js/curveEditor.js）

| API | 用途 |
|---|---|
| `constructor(canvas, onChange)` | `onChange(nodes)` はノード変更のたびに呼ばれる |
| `setValues(p1x, p1y, p2x, p2y)` | プリセット適用など、単一セグメントを直接セット |
| `setNodes(nodes)` | ノード配列を一括セット |
| `setSelectedNodeCoords({anchorX, anchorY, outY, inY})` | 選択中の中間ノードの座標を精密設定 |
| `deleteSelected()` | 選択中の中間ノードを削除 |
| `toggleSmooth(forceSmooth?)` | 選択ノードの smooth フラグを切替 |
| `get selectedIndex` / `get selectedNode` | 選択ノードの参照 |
| `get p1` / `get p2` | 単一セグメント時の後方互換ゲッター |

内部状態: `_drag = { type:'anchor'|'handleIn'|'handleOut', idx }` / `_selected = number|null`

### インタラクション

| 操作 | 動作 |
|---|---|
| ダブルクリック（空き箇所） | ノード追加（De Casteljau 分割でカーブ形状を保ったまま挿入） |
| **Ctrl+クリック**（空き箇所） | ノード追加（ダブルクリックと同等） |
| ハンドルをドラッグ | **スムーズモード**（反対ハンドルを対称ミラー）、`node.smooth = true` に更新 |
| **Ctrl**+ハンドルをドラッグ | **コーナーモード**（独立移動）、`node.smooth = false` に更新 |
| Delete / Backspace | 選択中の中間ノードを削除 |

- Alt+クリックによる smooth/corner トグルは廃止済み（v0.5.2）。README の記述は古いので注意。
- 開始・終了ノードは反対ハンドルを持たないため、Ctrl 有無にかかわらず常に独立移動

### 描画サイズとヒット判定の分離

視覚半径とヒット判定半径を意図的に分離している。ポイントを小さく表示しながら操作しやすくするため：

| | 計算式 | 目的 |
|---|---|---|
| ハンドル描画半径 | `max(2, size×0.007)` | 表示（小さく） |
| アンカー描画半径 | `max(2, size×0.008)` | 表示（小さく） |
| ヒット判定半径 | `max(10, size×0.055)` | クリック・ドラッグの操作性 |

### 座標系

- canvas Y 軸は上が 0（スクリーン座標）→ ベジェ変換は `by = 1 - cy/inner`
- パディング `_pad = size * 0.085` でキャンバス周囲に余白
- Y 軸は **[0, 1] 固定**（A〜B の正規化範囲のみ。オーバーシュートは許容しない）
- ハンドル X 軸: `handleOut.x ∈ [anchor.x, 次アンカーX]`、`handleIn.x ∈ [前アンカーX, anchor.x]`（時間軸をまたがない制限）

### AE ↔ cubic-bezier 変換（現行・暫定）

> 将来はエクスプレッション方式（`DESIGN.md` Phase 1）に置き換え予定。以下は現行の speed/influence 変換の仕様。

**単一セグメント（グローバル座標 = セグメント座標）:**
```
outInfluence = P1x * 100
outSpeed     = (P1y / P1x) * (valueDelta / timeDelta)

inInfluence  = (1 - P2x) * 100
inSpeed      = ((1 - P2y) / (1 - P2x)) * (valueDelta / timeDelta)
```

**多点セグメント（セグメント相対座標に変換が必要）:**
```
lP1x = (handleOut.x - ta) / (tb - ta)   // ta,tb = 前後アンカーの x
lP1y = (handleOut.y - va) / (vb - va)   // va,vb = 前後アンカーの y
```

### 多ノード適用フロー（hostscript.jsx）

nodes が 3 点以上の場合、`_applyMultiNodeEase` が:
1. 中間ノードをループ（**後ろから**）して `prop.addKey()` で AE に中間 KF を **BEZIER 補間**で生成
2. 各挿入後、既存 `insertedIndices` のうち `>= newIdx` のものを +1 補正（インデックスズレ防止）
3. セグメントごとにローカル座標へ変換した bezier パラメータで `s = [[...], ...]` 配列を構築
4. `prop.expression = _buildCtvExpr(segsJson)` でエクスプレッションを一括書き込み

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

### live 参照 vs disconnected 参照（ExtendScript）

`comp.selectedProperties` は **disconnected 参照**、`comp.layer(l).property(...)` は **live 参照**。この違いが重要：

| 操作 | disconnected 参照 | live 参照 |
|---|---|---|
| `keySelected()` | 動く | 常に false |
| `getTemporalEaseAtKey()` | 未定義エラー | 動く |
| `prop.expression =` | 反映されないことがある | 動く |

**解決策（`getKfCurve` / `applyEase` で実装済み）**:
1. `comp.selectedProperties`（disconnected）で選択KF時刻を収集
2. `_findLivePropByTimes(propGroup, times)` でその時刻に一致する live property を探す
3. expression 書き込み・`getTemporalEaseAtKey` は live 参照で行う

### AE キーフレーム API チートシート

```javascript
// テンポラル補完
var ease = new KeyframeEase(speed, influence);
prop.setTemporalEaseAtKey(k, [inEase], [outEase]);
var eases = prop.getTemporalEaseAtKey(k); // [[inEase], [outEase]]

// 空間補完のリニア化（Position 以外ではエラー → try/catch で握りつぶす）
try { prop.setSpatialTangentsAtKey(k, [0,0,0], [0,0,0]); } catch(e) {}

// 次元分割はイーズ適用の【後】に行う（先に分割するとプロパティ構造が変わる）
if (prop.matchName === 'ADBE Position') prop.dimensionsSeparated = true;
```

### ExtendScript 既知の落とし穴

- **`typeof` でプロパティメソッドを確認できない**: AE オブジェクトのメソッドは `typeof prop.getTemporalEaseAtKey` が `'undefined'` を返すことがあるが、実際には呼び出せない（未定義エラーになる）。メソッドの存在確認には `typeof` ではなく `try-catch` を使う。
- **`JSON` が存在しない**: `typeof JSON === 'undefined'`。`hostscript.jsx` 先頭の JSON ポリフィルで対処済み。新規 JSX ファイルを作る場合も同様のポリフィルが必要。
- **`// @` で始まるコメントは ExtendScript がプリプロセッサ命令と解釈して構文エラーになる**: JSX 内では `//` の後に `@` を書かない。
- **`KeyframeEase.speed` は非負数**: `Math.abs()` を必ず挟む。逆算時は `segTin / Math.abs(segVin)` で符号を除去しないと値が減少するセグメントで P1y/P2y が鏡像になる（v0.6.1 修正済み）。
- **多次元プロパティの `valueDelta` / `segVin` の使い分け**: `calcAeEase` の `valueDelta` は第1次元の符号付き差（`vB[0] - vA[0]`）で渡す。`getKfCurve` の `segVin`/`segVout` はユークリッド距離（`segDists`）を使う（X 成分のみでは Y/Z 主体の動きで誤差が出るため）。

## コーディング規則

### JS（js/*.js）
- ES2020+ 使用可（`const`/`let`/アロー関数/テンプレートリテラル）
- コメントは日本語

### JSX（jsx/*.jsx）
- **ES3 必須**: `var` のみ、`let`/`const`/アロー関数禁止
- `app.beginUndoGroup` / `app.endUndoGroup` で囲む（`finally` で確実に閉じる）
- エラーは `JSON.stringify({ status:'error', message: e.message + ' (line ' + e.line + ')' })` で返す
- **`// @` で始まるコメントは書かない**: ExtendScript がプリプロセッサ命令と解釈して構文エラーになる
- **`prop.expression` に書き込む文字列の中身は ES2018 で書いてよい**: JSX の ES3 制約はホストスクリプト本体にのみ適用される

### 共通
- コメント・コミットメッセージは日本語

## バージョン管理

日時形式（ソース先頭・CHANGELOG.md 共通）:
```powershell
powershell -Command "[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture; Get-Date -Format 'ddd MMM dd HH:mm:ss JST yyyy'"
```

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| `DESIGN.md` | 設計思想・エクスプレッション仕様・Newton 法の詳細・フェーズ別実装状況 |
| `.ai/SOUL.md` | プロジェクトの核心的な設計理念 |
| `.ai/DESIGN.md` | AI との設計検討ログ（実装とは独立した思考記録） |
