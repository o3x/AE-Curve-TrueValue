# Curve-TrueValue 設計思想書

> このドキュメントは実装の「なぜ」と「どうあるべきか」を記録する。
> コードは変わるが、設計思想はここに残る。

---

## 1. なぜ再設計するか

### AE の「速度ベース補完」という根本的な欠陥

AE の補完エンジンは内部的に **speed（単位/秒）と influence（%）** でキーフレーム間を制御する。
これはユーザーが意図する「値 A から値 B へどう変化するか」ではなく、
「ある時刻における速度がいくつか」という **微分的な概念** を介在させる。

この設計から以下の問題がすべて派生する：

| 問題 | 原因 |
|---|---|
| **オーバーシュート・アンティシペートの再現不能** | `KeyframeEase.speed` は非負数しか持てない |
| **Position の round-trip 不能** | `getTemporalEaseAtKey` が空間プロパティで未定義 |
| **ブーメラン効果** | AE が空間補完を自動で「滑らかに」しようとする |
| **多次元プロパティの speed 誤算** | speed の基準が X 成分のみになる実装バグ |
| **値グラフが扱いにくい** | 次元分割しないと Position の値グラフでハンドル編集不可 |

### 先行ツールの限界

**Flow** はカーブ UI を提供するが、内部では speed/influence に変換して AE に注入するため、
上記の根本問題は解決されない。本プロジェクトはその先を目指す。

---

## 2. 設計原則

1. **AE の補完エンジンを信用しない**
   - speed/influence への変換は捨てる
   - AE には「値そのもの」を渡す

2. **cubic-bezier が唯一の真実**
   - UI の `(p1x, p1y, p2x, p2y)` がアニメーションの完全な定義
   - AE 側のパラメータは AE の都合であり、ユーザーには関係ない

3. **完全な round-trip を保証する**
   - 適用 → 読み取りで必ず同じカーブが返る
   - 近似は許容しない

4. **プロパティ型に依存しない統一処理**
   - 1D スカラー・Position（2D/3D）・Color（4D）をすべて同じコードで扱う

---

## 3. 新アーキテクチャ

### コンセプト

```
旧: cubic-bezier → speed/influence → AE が補間   ← ここに全限界がある
新: cubic-bezier → AE エクスプレッション → 値を直接計算
```

AE はキーフレーム値を「アンカー」として保持するだけになる。
補間はすべてエクスプレッションが行う。

### データフロー

```
[UI カーブエディタ]
     ↓ nodes[]
[applyEase（JSX）]
  ├─ KF を HOLD 補間に設定（値のアンカー）
  └─ prop.expression にエクスプレッション文字列を書き込む
         ↑
    CTV メタデータ（bezier params）を埋め込み

[getKfCurve（JSX）]
  ├─ prop.expression の /*CTV:...*/ コメントをパース
  └─ 完全一致の nodes[] を返す（近似なし）
         ↓ フォールバック（エクスプレッションがない場合）
    valueAtTime サンプリング近似（現行ロジック）
```

---

## 4. エクスプレッション仕様

### 4.1 完成形

AE エクスプレッションは **ES2018** が使えるため、`const`/`let`/アロー関数使用可。

```javascript
/*CTV:[[0.42,0,0.58,1]]*/
(function(){
  const s = [[0.42, 0, 0.58, 1]]; // セグメントごとの [p1x, p1y, p2x, p2y]
  const t = time, n = numKeys;
  if (n < 2 || t <= key(1).time) return key(1).value;
  if (t >= key(n).time) return key(n).value;
  let i = 1;
  while (i < n - 1 && key(i + 1).time <= t) i++;
  const k1 = key(i), k2 = key(i + 1);
  const nt = (t - k1.time) / (k2.time - k1.time);
  const b = s[Math.min(i - 1, s.length - 1)];
  // Newton 法: Bx(u) = nt を解く
  const cx = 3*b[0], bx = 3*(b[2]-b[0])-cx, ax = 1-cx-bx;
  let u = nt;
  for (let j = 0; j < 8; j++) {
    const f  = ((ax*u + bx)*u + cx)*u - nt;
    const df = (3*ax*u + 2*bx)*u + cx;
    if (Math.abs(df) < 1e-8) break;
    u -= f / df;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
  }
  const cy = 3*b[1], by = 3*(b[3]-b[1])-cy, ay = 1-cy-by;
  const p  = ((ay*u + by)*u + cy)*u;
  return k1.value + p * (k2.value - k1.value);
})()
```

### 4.2 なぜこれで全プロパティ型に対応できるか

AE エクスプレッションの配列演算は **成分ごとに自動展開** される：

```
k1.value = [100, 200]    (Position 2D)
k2.value = [400, 500]
k1.value + p * (k2.value - k1.value)
→ [100 + p*(400-100), 200 + p*(500-200)]
→ [100 + 300p, 200 + 300p]
```

- **1D スカラー（不透明度・回転）**: そのまま数値演算
- **Position [x, y]**: 成分ごとに線形補間（空間的にも直線 → ブーメラン消滅）
- **Color [r, g, b, a]**: 成分ごとに補間

**1つのエクスプレッションコードがすべての型に対応する。**

### 4.3 Newton 法の正確性

Bx(u) を標準多項式形式に変換：

```
cx = 3·p1x
bx = 3·(p2x - p1x) - cx
ax = 1 - cx - bx

Bx(u) = ax·u³ + bx·u² + cx·u
dBx/du = 3ax·u² + 2bx·u + cx
```

初期値 `u = nt`（正規化時間）から 8 回反復で収束。
典型的なアニメーションカーブでは 3〜4 回で機械精度に達する。

### 4.4 メタデータ形式

エクスプレッション先頭の `/*CTV:...*/ ` コメントが GET 時のパース源：

```
/*CTV:[[p1x,p1y,p2x,p2y],[p1x,p1y,p2x,p2y]]*/
         ↑                ↑
    セグメント0        セグメント1（多ノード時）
```

- 単一セグメント（2KF）: 配列の要素は 1 つ
- 多ノード（3KF 以上）: セグメント数 = KF 数 - 1

### 4.5 GET 時のパース（ExtendScript）

```javascript
var expr = prop.expression;
var m    = expr.match(/\/\*CTV:(.*?)\*\//);
if (m) {
    var segs = JSON.parse(m[1]); // [[p1x,p1y,p2x,p2y], ...]
    // segs[i] がセグメント i の bezier params
    // KF の時刻と値は prop.keyTime(i)/keyValue(i) から取得
    // → 完全な nodes[] を再構築
}
```

---

## 5. キーフレームの扱い

### Hold 補間を使う理由

| | Hold KF | Linear KF | Bezier KF |
|---|---|---|---|
| 値が正確か | ✅ KF 時刻に正確な値 | ✅ | ✅ |
| エクスプレッション削除後 | アンカー値がそのまま残る | 線形補間（ほぼ正しい） | 近似補間（形が変わる） |
| AE グラフ表示 | 階段状（正直） | 誤解を招く直線 | 誤解を招く曲線 |
| 設計の意図 | 「エクスプレッションが制御する」を明示 | 曖昧 | 曖昧 |

**Hold が最も誠実な表現。**
AE のグラフエディタで見ると「階段」に見えるが、これは「エクスプレッションが担当している」という正確な状態表示。

### 「ネイティブに戻す（Clear Expression）」ボタン

エクスプレッションを外し、可能な限り native ease に変換して戻す：

1. `prop.expression = ''` で解除
2. Bezier 補間に変更
3. 現行の speed/influence 変換ロジックで近似的に書き込む

**注意**: オーバーシュート系カーブは native ease で正確には再現できない。
ユーザーへの告知が必要：「Overshoot/Anticipate はネイティブモードで近似になります」。

---

## 6. 解決される問題 / 残るトレードオフ

### 解決

| 問題 | 解決方法 |
|---|---|
| オーバーシュート・アンティシペート不能 | エクスプレッションなら制限なし |
| Position round-trip 不可 | CTV コメントをパースするだけ |
| ブーメラン効果 | Hold KF + 線形補間で空間補完が入る余地なし |
| valueDelta X 成分のみバグ | speed/influence 計算自体をしないので消滅 |
| getTemporalEaseAtKey Position 制限 | 関係なくなる |

### 残るトレードオフ

| トレードオフ | 対策 |
|---|---|
| プロパティにエクスプレッションが付く | 「AE ネイティブモード」を UI に用意 |
| AE グラフエディタで直接編集不可 | このツールが編集UIを提供するので問題ない |
| エクスプレッション削除で Hold 階段になる | Clear ボタンで近似 native ease に変換 |
| 他ツール（Flow 等）との共存 | 先に Clear してから他ツールを使う |

---

## 7. 実装計画

### Phase 1: 適用側の刷新（コア）

**`jsx/hostscript.jsx`**
- `_applySegmentEase` → Hold KF 設定 + エクスプレッション書き込みに全面置換
- `_applyMultiNodeEase` → 同様（`s` 配列にセグメントごとの params を格納）
- `_clearExpression` 関数を新規追加
- エクスプレッション文字列テンプレートを定数として定義

**`index.html`**
- 「エクスプレッションをクリア」ボタン追加
- （将来）「ネイティブモード」トグル追加

**`js/main.js`**
- Clear ボタンのハンドラ追加

### Phase 2: GET 側の刷新

**`jsx/hostscript.jsx` の `getKfCurve`**
- `/*CTV:...*/` コメントパースを優先ルートに
- パース失敗時のみ現行 valueAtTime フォールバックを実行

### Phase 3: ネイティブモード（オプション）

- UI にトグルを追加
- ON: エクスプレッション（デフォルト、理想）
- OFF: speed/influence（互換性重視、現行相当）

---

## 8. 技術メモ

### AE エクスプレッション vs ExtendScript の言語差異

| | エクスプレッション | ExtendScript（JSX） |
|---|---|---|
| 言語仕様 | ES2018（モダン JS） | ES3（古い JS） |
| `const` / `let` | ✅ 使える | ❌ `var` のみ |
| アロー関数 | ✅ | ❌ |
| 用途 | AE の値計算（毎フレーム） | UI スクリプト・KF 操作 |

エクスプレッション文字列は JSX から**文字列として生成**してプロパティに設定する。
JSX 側は ES3 で文字列を組み立て、エクスプレッション本体は ES2018 で書く。

### Newton 法の収束保証

- `u` を `[0, 1]` にクランプするため発散しない
- `df < 1e-8` の場合は更新をスキップ（ゼロ除算回避）
- 標準的なアニメーションカーブ（Influence 5%〜95%）では 8 回以内に収束する

### エクスプレッション長の目安

- ソルバー本体: 約 350 文字
- セグメントデータ: 1 セグメントあたり約 20 文字
- AE のエクスプレッション長制限: 実用上 ~30,000 文字（問題なし）

---

*最終更新: Sun May 03 14:41:07 JST 2026*
