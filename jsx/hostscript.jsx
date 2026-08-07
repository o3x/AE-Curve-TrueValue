/**
 * hostscript.jsx
 * AE ExtendScript ホストスクリプト（ES3 必須）
 *
 * Version: 0.8.3
 * Date: Sat May 23 11:01:07 JST 2026
 *
 * 関数一覧:
 *   getKfCurve()         → JSON            選択KF全体のカーブをP1/P2として取得
 *   applyEase(argsJson)  → JSON
 *     argsJson: { nodes, linearSpatial, splitDimensions }
 *     3KF以上選択時: ダイアログでモードA/B を選択
 *       A: 各セグメントに現在のカーブを適用
 *       B: 中間KFを削除し始点〜終点に適用
 *   clearExpression()    → JSON            選択プロパティの CTV エクスプレッションを解除しネイティブ補完に変換
 */

// ── JSON ポリフィル（ExtendScript には JSON が存在しないため） ──
if (typeof JSON === 'undefined') {
    JSON = {};
}
if (typeof JSON.stringify !== 'function') {
    JSON.stringify = function (val) {
        if (val === null) return 'null';
        var t = typeof val;
        if (t === 'undefined') return undefined;
        if (t === 'boolean') return val ? 'true' : 'false';
        if (t === 'number') return isFinite(val) ? String(val) : 'null';
        if (t === 'string') {
            return '"' + val.replace(/\\/g, '\\\\')
                            .replace(/"/g,  '\\"')
                            .replace(/\n/g, '\\n')
                            .replace(/\r/g, '\\r')
                            .replace(/\t/g, '\\t') + '"';
        }
        if (t === 'object') {
            var i, out;
            if (val instanceof Array) {
                out = [];
                for (i = 0; i < val.length; i++) {
                    var sv = JSON.stringify(val[i]);
                    out.push(sv === undefined ? 'null' : sv);
                }
                return '[' + out.join(',') + ']';
            }
            out = [];
            for (var k in val) {
                if (val.hasOwnProperty(k)) {
                    var vv = JSON.stringify(val[k]);
                    if (vv !== undefined) {
                        out.push(JSON.stringify(k) + ':' + vv);
                    }
                }
            }
            return '{' + out.join(',') + '}';
        }
        return undefined;
    };
}
if (typeof JSON.parse !== 'function') {
    JSON.parse = function (str) {
        return eval('(' + str + ')');
    };
}

// ── cubic-bezier → AE ease 変換 ────────────────────────────
function calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta) {
    var scale       = timeDelta > 0 ? valueDelta / timeDelta : 0;
    var outInfluence = Math.max(0.1, Math.min(99.9, p1x * 100));
    var outSpeed     = p1x > 1e-4 ? (p1y / p1x) * scale : 0;
    var inInfluence  = Math.max(0.1, Math.min(99.9, (1 - p2x) * 100));
    var inSpeed      = (1 - p2x) > 1e-4 ? ((1 - p2y) / (1 - p2x)) * scale : 0;
    return { outInfluence: outInfluence, outSpeed: outSpeed,
             inInfluence: inInfluence,  inSpeed: inSpeed };
}

// ── CTV エクスプレッション生成 ────────────────────────────────
// segsJson: JSON 文字列 "[[p1x,p1y,p2x,p2y], ...]"（セグメント数だけ要素がある）
function _buildCtvExpr(segsJson) {
    return '/*CTV:' + segsJson + '*/\n' +
        '(function(){\n' +
        '  const s=' + segsJson + ';\n' +
        '  const t=time,n=numKeys;\n' +
        '  if(n<2||t<=key(1).time)return key(1).value;\n' +
        '  if(t>=key(n).time)return key(n).value;\n' +
        '  let i=1;\n' +
        '  while(i<n-1&&key(i+1).time<=t)i++;\n' +
        '  const k1=key(i),k2=key(i+1);\n' +
        '  const nt=(t-k1.time)/(k2.time-k1.time);\n' +
        '  const b=s[Math.min(i-1,s.length-1)];\n' +
        '  const cx=3*b[0],bx=3*(b[2]-b[0])-cx,ax=1-cx-bx;\n' +
        '  let u=nt;\n' +
        '  for(let j=0;j<8;j++){\n' +
        '    const f=((ax*u+bx)*u+cx)*u-nt;\n' +
        '    const df=(3*ax*u+2*bx)*u+cx;\n' +
        '    if(Math.abs(df)<1e-8)break;\n' +
        '    u-=f/df;\n' +
        '    u=u<0?0:u>1?1:u;\n' +
        '  }\n' +
        '  const cy=3*b[1],by=3*(b[3]-b[1])-cy,ay=1-cy-by;\n' +
        '  const p=((ay*u+by)*u+cy)*u;\n' +
        '  return k1.value+p*(k2.value-k1.value);\n' +
        '})()';
}

// 数値を小数点4桁に丸める（エクスプレッション埋め込み用）
function _r4(v) { return Math.round(v * 10000) / 10000; }

// ── KF時刻でliveプロパティを検索 ────────────────────────────
/**
 * propGroup を再帰的に辿り、指定した時刻群すべてにKFを持つ leaf property を返す。
 * 返り値: { prop, indices:[] } または null
 */
function _findLivePropByTimes(propGroup, times) {
    var count = 0;
    try { count = propGroup.numProperties; } catch (e) { return null; }
    for (var p = 1; p <= count; p++) {
        var prop;
        try { prop = propGroup.property(p); } catch (e) { continue; }
        if (!prop) continue;
        if (prop.propertyType !== PropertyType.PROPERTY) {
            var sub = _findLivePropByTimes(prop, times);
            if (sub) return sub;
            continue;
        }
        var numKeys;
        try { numKeys = prop.numKeys; } catch (e) { continue; }
        if (numKeys < times.length) continue;
        var indices = [];
        var allMatch = true;
        for (var ti = 0; ti < times.length; ti++) {
            var ni;
            try { ni = prop.nearestKeyIndex(times[ti]); } catch (e) { allMatch = false; break; }
            var kt;
            try { kt = prop.keyTime(ni); } catch (e) { allMatch = false; break; }
            if (Math.abs(kt - times[ti]) > 0.02) { allMatch = false; break; }
            indices.push(ni);
        }
        if (!allMatch || indices.length !== times.length) continue;
        return { prop: prop, indices: indices };
    }
    return null;
}

// ── 全体カーブ取得（GET ボタン用） ────────────────────────
/**
 * 選択KF群を nodes 配列（カーブエディタ形式）に変換して返す。
 * 2KF → 2ノード（単一セグメント）
 * 3KF以上 → 中間KFを中間ノードとして復元（各セグメントのイーズから逆算）
 *
 * keySelected() は comp.selectedProperties 参照（disconnected）でしか動かない。
 * getTemporalEaseAtKey() はレイヤー階層参照（live）でしか動かない。
 * そのため両者を組み合わせる: Step1 で選択KF時刻を取得し、
 * Step2 でその時刻に一致する live property を探す。
 */
function getKfCurve() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ status: 'error', message: 'コンポジションを選択してください' });
        }

        // Step 1: comp.selectedProperties（disconnected 参照）から選択KF時刻を取得
        var kfTimes = null;
        var selProps = comp.selectedProperties;
        for (var si = 0; si < selProps.length; si++) {
            var sp = selProps[si];
            if (!sp || sp.numKeys === 0) continue;
            var tmp = [];
            for (var k = 1; k <= sp.numKeys; k++) {
                try { if (sp.keySelected(k)) tmp.push(k); } catch (e) {}
            }
            if (tmp.length < 2) continue;
            var times = [];
            var timesOk = true;
            for (var ti = 0; ti < tmp.length; ti++) {
                try { times.push(sp.keyTime(tmp[ti])); }
                catch (e) { timesOk = false; break; }
            }
            if (!timesOk) continue;
            kfTimes = times;
            break;
        }
        if (!kfTimes) {
            return JSON.stringify({ status: 'error', message: 'タイムラインで2つ以上のキーフレームを選択してください' });
        }

        // Step 2: レイヤー階層を辿って getTemporalEaseAtKey が動く live property を取得
        var liveResult = null;
        for (var l = 1; l <= comp.numLayers; l++) {
            liveResult = _findLivePropByTimes(comp.layer(l), kfTimes);
            if (liveResult) break;
        }
        if (!liveResult) {
            return JSON.stringify({ status: 'error', message: 'プロパティの解決に失敗しました（HoldKFまたは非対応プロパティの可能性があります）' });
        }

        var prop    = liveResult.prop;
        var indices = liveResult.indices;
        var n       = indices.length;

        // Step 3: イーズ取得
        // typeof による存在確認は ExtendScript では信頼できない（live 参照でも 'undefined' を返す）。
        // try-catch のみで判定する。
        var eases = [];
        var spatialFallback = false;
        for (var qi = 0; qi < n; qi++) {
            try {
                var ea = prop.getTemporalEaseAtKey(indices[qi]);
                eases.push({ inEase: ea[0][0], outEase: ea[1][0] });
            } catch (e) {
                spatialFallback = true;
                eases = [];
                break;
            }
        }

        // 全体の時間・値のスパンを計算
        // 多次元プロパティ（Position 等）は累積ユークリッド距離で正規化する。
        // 1D プロパティは符号付きスカラー差で正規化（getTemporalEaseAtKey の speed も符号付き）。
        var tFirst = prop.keyTime(indices[0]);
        var tLast  = prop.keyTime(indices[n - 1]);
        var tFull  = tLast - tFirst;

        if (tFull < 1e-6) {
            return JSON.stringify({ status: 'error', message: 'キーフレームの時間差が小さすぎます' });
        }

        var vFirst = prop.keyValue(indices[0]);
        var isMultiDim = (vFirst instanceof Array);

        // segDists[i] = KF[i-1] → KF[i] のユークリッド距離（または 1D 符号付き変化量）
        var segDists = [0]; // index 0 unused; segDists[i] = dist from KF[i-1] to KF[i]
        var cumDists = [0]; // cumDists[i] = KF[0] からの累積距離
        for (var ci = 1; ci < n; ci++) {
            var cvA = prop.keyValue(indices[ci - 1]);
            var cvB = prop.keyValue(indices[ci]);
            var cDist;
            if (isMultiDim) {
                var cSq = 0;
                for (var cd = 0; cd < cvA.length; cd++) { var cdd = cvB[cd]-cvA[cd]; cSq += cdd*cdd; }
                cDist = Math.sqrt(cSq);
            } else {
                cDist = cvB - cvA; // 符号付き
            }
            segDists.push(cDist);
            cumDists.push(cumDists[ci - 1] + (isMultiDim ? cDist : Math.abs(cDist)));
        }
        var vFull = isMultiDim ? cumDists[n - 1] : (prop.keyValue(indices[n-1]) - vFirst);

        // 各KFの正規化アンカー座標
        var anchors = [];
        for (var ai = 0; ai < n; ai++) {
            var at = prop.keyTime(indices[ai]);
            var ay = isMultiDim
                ? (Math.abs(vFull) > 1e-6 ? cumDists[ai] / vFull : ai / (n - 1))
                : (Math.abs(vFull) > 1e-6 ? (prop.keyValue(indices[ai]) - vFirst) / vFull : ai / (n - 1));
            anchors.push({ x: (at - tFirst) / tFull, y: ay });
        }

        // CTV エクスプレッションが設定されていれば /*CTV:...*/ をパースして完全一致で返す
        var liveExpr = '';
        try { liveExpr = prop.expression; } catch(eEx) {}
        if (liveExpr) {
            var ctvM = liveExpr.match(/\/\*CTV:([\s\S]*?)\*\//);
            if (ctvM) {
                try {
                    var ctvSegs = JSON.parse(ctvM[1]);
                    var ctvNodes = [];
                    for (var cni = 0; cni < n; cni++) {
                        var ca = anchors[cni];
                        var cHIn = null, cHOut = null;
                        if (cni > 0) {
                            var csi = Math.min(cni - 1, ctvSegs.length - 1);
                            var cta = anchors[cni-1].x, ctb = ca.x;
                            var cva = anchors[cni-1].y, cvb = ca.y;
                            var cdt = ctb - cta, cdv = cvb - cva;
                            cHIn = {
                                x: Math.round((cta + ctvSegs[csi][2] * cdt) * 1000) / 1000,
                                y: Math.round((cva + ctvSegs[csi][3] * cdv) * 1000) / 1000
                            };
                        }
                        if (cni < n - 1) {
                            var cso = Math.min(cni, ctvSegs.length - 1);
                            var cta2 = ca.x, ctb2 = anchors[cni+1].x;
                            var cva2 = ca.y, cvb2 = anchors[cni+1].y;
                            var cdt2 = ctb2 - cta2, cdv2 = cvb2 - cva2;
                            cHOut = {
                                x: Math.round((cta2 + ctvSegs[cso][0] * cdt2) * 1000) / 1000,
                                y: Math.round((cva2 + ctvSegs[cso][1] * cdv2) * 1000) / 1000
                            };
                        }
                        ctvNodes.push({
                            anchor:   { x: Math.round(ca.x * 1000) / 1000,
                                        y: Math.round(ca.y * 1000) / 1000 },
                            handleIn:  cHIn,
                            handleOut: cHOut,
                            smooth:    true
                        });
                    }
                    return JSON.stringify({ status: 'ok', nodes: ctvNodes, spatialFallback: false, mode: 'expr' });
                } catch(ctvErr) {
                    // パース失敗時は通常フローにフォールバック
                }
            }
        }

        // spatialFallback: valueAtTime 25%/75% サンプリングで各セグメントの bezier を逆算
        // P1x=1/3, P2x=2/3 に固定するとベジェパラメータが正規化時間と一致し、線形システムが解析的に解ける。
        // By(0.25) = 0.421875*P1y + 0.140625*P2y + 0.015625
        // By(0.75) = 0.140625*P1y + 0.421875*P2y + 0.421875
        var segBezier = [];
        if (spatialFallback) {
            for (var si = 0; si < n - 1; si++) {
                var tS0 = prop.keyTime(indices[si]);
                var tS1 = prop.keyTime(indices[si + 1]);
                var segTD = tS1 - tS0;
                var vm25, vm75, sy25, sy75;
                try {
                    vm25 = prop.valueAtTime(tS0 + segTD * 0.25, false);
                    vm75 = prop.valueAtTime(tS0 + segTD * 0.75, false);
                } catch (eV) {
                    segBezier.push({ p1x: 0.333, p1y: 0, p2x: 0.667, p2y: 1 });
                    continue;
                }
                if (isMultiDim) {
                    var vS0m = prop.keyValue(indices[si]);
                    var dFull = segDists[si + 1];
                    var sq25 = 0, sq75 = 0;
                    for (var dm = 0; dm < vS0m.length; dm++) {
                        var d25 = vm25[dm] - vS0m[dm];
                        var d75 = vm75[dm] - vS0m[dm];
                        sq25 += d25 * d25;
                        sq75 += d75 * d75;
                    }
                    sy25 = dFull > 1e-6 ? Math.sqrt(sq25) / dFull : 0.25;
                    sy75 = dFull > 1e-6 ? Math.sqrt(sq75) / dFull : 0.75;
                } else {
                    var vS0s = prop.keyValue(indices[si]);
                    var dvSeg = segDists[si + 1];
                    sy25 = Math.abs(dvSeg) > 1e-6 ? (vm25 - vS0s) / dvSeg : 0.25;
                    sy75 = Math.abs(dvSeg) > 1e-6 ? (vm75 - vS0s) / dvSeg : 0.75;
                }
                var sbA = sy25 - 0.015625;
                var sbB = sy75 - 0.421875;
                var sbD = 0.158203125;
                var sp1y = (0.421875 * sbA - 0.140625 * sbB) / sbD;
                var sp2y = (0.421875 * sbB - 0.140625 * sbA) / sbD;
                if (sp1y < -1.5) { sp1y = -1.5; } if (sp1y > 1.5) { sp1y = 1.5; }
                if (sp2y < -1.5) { sp2y = -1.5; } if (sp2y > 1.5) { sp2y = 1.5; }
                segBezier.push({ p1x: 0.333, p1y: sp1y, p2x: 0.667, p2y: sp2y });
            }
        }

        // ノード配列を構築
        var nodes = [];
        for (var ni = 0; ni < n; ni++) {
            var anch = anchors[ni];
            var hIn  = null;
            var hOut = null;

            // handleIn: セグメント [ni-1 → ni] の P2(local) → global
            if (ni > 0) {
                var taN = anchors[ni-1].x, tbN = anch.x;
                var vaN = anchors[ni-1].y, vbN = anch.y;
                var dtSN = tbN - taN, dvSN = vbN - vaN;
                var lP2x, lP2y;
                if (spatialFallback) {
                    lP2x = segBezier[ni - 1].p2x;
                    lP2y = segBezier[ni - 1].p2y;
                } else {
                    var segTin = prop.keyTime(indices[ni]) - prop.keyTime(indices[ni-1]);
                    // isMultiDim の場合は segDists（ユークリッド距離）を使う。
                    // X 成分差分のみでは Y/Z 主体の動きで誤差が生じるため。
                    var segVin = segDists[ni];
                    var iEase = eases[ni].inEase;
                    lP2x = 1 - iEase.influence / 100;
                    var scIn = Math.abs(segVin) > 1e-6 ? segTin / Math.abs(segVin) : 0;
                    lP2y = (1 - lP2x) > 1e-4 && Math.abs(scIn) > 1e-6
                        ? 1 - iEase.speed * scIn * (1 - lP2x) : 1;
                }
                hIn = {
                    x: Math.round((taN + lP2x * dtSN) * 1000) / 1000,
                    y: Math.round((Math.abs(dvSN) > 1e-6 ? vaN + lP2y * dvSN : vbN) * 1000) / 1000
                };
            }

            // handleOut: セグメント [ni → ni+1] の P1(local) → global
            if (ni < n - 1) {
                var taN2 = anch.x, tbN2 = anchors[ni+1].x;
                var vaN2 = anch.y, vbN2 = anchors[ni+1].y;
                var dtSN2 = tbN2 - taN2, dvSN2 = vbN2 - vaN2;
                var lP1x, lP1y;
                if (spatialFallback) {
                    lP1x = segBezier[ni].p1x;
                    lP1y = segBezier[ni].p1y;
                } else {
                    var segTout = prop.keyTime(indices[ni+1]) - prop.keyTime(indices[ni]);
                    // isMultiDim の場合は segDists（ユークリッド距離）を使う。
                    var segVout = segDists[ni + 1];
                    var oEase = eases[ni].outEase;
                    lP1x = oEase.influence / 100;
                    var scOut = Math.abs(segVout) > 1e-6 ? segTout / Math.abs(segVout) : 0;
                    lP1y = lP1x > 1e-4 && Math.abs(scOut) > 1e-6
                        ? oEase.speed * scOut * lP1x : 0;
                }
                hOut = {
                    x: Math.round((taN2 + lP1x * dtSN2) * 1000) / 1000,
                    y: Math.round((Math.abs(dvSN2) > 1e-6 ? vaN2 + lP1y * dvSN2 : vaN2) * 1000) / 1000
                };
            }

            nodes.push({
                anchor:    { x: Math.round(anch.x * 1000) / 1000, y: Math.round(anch.y * 1000) / 1000 },
                handleIn:  hIn,
                handleOut: hOut,
                smooth:    true
            });
        }

        return JSON.stringify({ status: 'ok', nodes: nodes, spatialFallback: spatialFallback, mode: 'native' });
    } catch (e) {
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}

// ── モード選択ダイアログ（3KF以上時） ─────────────────────
function _showModeDialog() {
    var dlg = new Window('dialog', '複数KFへの適用');
    dlg.orientation  = 'column';
    dlg.alignChildren = 'fill';
    dlg.spacing      = 8;
    dlg.margins      = [15, 15, 15, 15];

    dlg.add('statictext', undefined,
        '3つ以上のキーフレームが選択されています。\n適用方法を選択してください。');

    var btnA = dlg.add('button', undefined, 'A  各セグメントに適用（各区間に現在のカーブを適用）');
    var btnB = dlg.add('button', undefined, 'B  全体を繋ぎ直す（中間KFを削除し始点〜終点に適用）');

    var cancelGroup = dlg.add('group');
    cancelGroup.alignment = 'right';
    var btnC = cancelGroup.add('button', undefined, 'キャンセル');

    var result = 'cancel';
    btnA.onClick = function() { result = 'segment'; dlg.close(); };
    btnB.onClick = function() { result = 'connect'; dlg.close(); };
    btnC.onClick  = function() { result = 'cancel';  dlg.close(); };

    dlg.defaultElement = btnA; // Enter → A
    dlg.cancelElement  = btnC; // Esc  → キャンセル

    dlg.show();
    return result;
}

// ── イーズ適用 ────────────────────────────────────────────
/**
 * nodes が 2 点の場合: 選択 KF ペアに単一セグメントのイーズを適用
 * nodes が 3 点以上の場合: 中間ノードに対応する中間 KF を生成してイーズを適用
 * 3KF以上選択時: ダイアログでモード A（各セグメント）/ B（全体繋ぎ直し）を選択
 */
function applyEase(argsJson) {
    var args;
    try { args = JSON.parse(argsJson); }
    catch (e) { return JSON.stringify({ status: 'error', message: '引数解析失敗: ' + e.message }); }

    var nodes           = args.nodes;
    var linearSpatial   = args.linearSpatial;
    var splitDimensions = args.splitDimensions;

    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ status: 'error', message: 'コンポジションを選択してください' });
        }

        // 選択KFを収集: propEntries = [{ prop, indices:[] }, ...]
        var propEntries = [];
        var maxKfCount  = 0;
        var props = comp.selectedProperties;
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            if (prop.numKeys === 0) continue;
            if (prop.propertyValueType === PropertyValueType.NO_VALUE) continue;
            var selIdx = [];
            for (var k = 1; k <= prop.numKeys; k++) {
                if (prop.keySelected(k)) selIdx.push(k);
            }
            if (selIdx.length >= 2) {
                propEntries.push({ prop: prop, indices: selIdx });
                if (selIdx.length > maxKfCount) maxKfCount = selIdx.length;
            }
        }

        if (propEntries.length === 0) {
            return JSON.stringify({ status: 'error', message: 'キーフレームが選択されていません（隣接する2点を選択してください）' });
        }

        // 3KF以上選択されている場合はモード選択ダイアログを表示
        var mode = 'segment';
        if (maxKfCount >= 3) {
            mode = _showModeDialog();
            if (mode === 'cancel') {
                return JSON.stringify({ status: 'cancel' });
            }
        }

        var p1x = nodes[0].handleOut.x,           p1y = nodes[0].handleOut.y;
        var p2x = nodes[nodes.length-1].handleIn.x, p2y = nodes[nodes.length-1].handleIn.y;

        var appliedCount = 0;
        app.beginUndoGroup('Curve-TrueValue: イーズ適用');

        try {
            for (var pi = 0; pi < propEntries.length; pi++) {
                var entry    = propEntries[pi];
                var eProp    = entry.prop;
                var eIndices = entry.indices;

                // expression 設定用の live 参照を事前に取得
                // （disconnected 参照では prop.expression = が反映されない場合があるため）
                var liveEProp = null;
                {
                    var leTimes = [];
                    for (var lei = 0; lei < eIndices.length; lei++) {
                        leTimes.push(eProp.keyTime(eIndices[lei]));
                    }
                    for (var lel = 1; lel <= comp.numLayers; lel++) {
                        var leResult = _findLivePropByTimes(comp.layer(lel), leTimes);
                        if (leResult) { liveEProp = leResult.prop; break; }
                    }
                }

                if (mode === 'connect') {
                    // モードB: 中間KFを後ろから削除し、始点〜終点に適用
                    var firstIdx  = eIndices[0];
                    var lastIdx   = eIndices[eIndices.length - 1];
                    var timeFirst = eProp.keyTime(firstIdx);
                    var timeLast  = eProp.keyTime(lastIdx);
                    var vFirst    = eProp.keyValue(firstIdx);
                    var vLast     = eProp.keyValue(lastIdx);

                    for (var di = eIndices.length - 2; di >= 1; di--) {
                        eProp.removeKey(eIndices[di]);
                    }

                    var newFirstIdx = eProp.nearestKeyIndex(timeFirst);
                    var newLastIdx  = eProp.nearestKeyIndex(timeLast);
                    var tDelta      = timeLast - timeFirst;
                    var vDelta      = (vFirst instanceof Array) ? vLast[0] - vFirst[0] : vLast - vFirst;

                    if (nodes.length <= 2) {
                        appliedCount += _applySegmentEase(
                            eProp, newFirstIdx, newLastIdx,
                            p1x, p1y, p2x, p2y, vDelta, tDelta, linearSpatial, liveEProp);
                    } else {
                        appliedCount += _applyMultiNodeEase(
                            eProp, newFirstIdx, newLastIdx, nodes,
                            timeFirst, vFirst, vLast, tDelta, vDelta, linearSpatial, liveEProp);
                    }

                } else {
                    // モードA（または2KF時）: 隣接する選択KFペアに順次適用
                    for (var k = 1; k <= eProp.numKeys; k++) {
                        if (!eProp.keySelected(k) || k >= eProp.numKeys) continue;
                        if (!eProp.keySelected(k + 1)) continue;

                        var timeA = eProp.keyTime(k), timeB = eProp.keyTime(k + 1);
                        var vA    = eProp.keyValue(k), vB    = eProp.keyValue(k + 1);
                        var tDeltaSeg = timeB - timeA;
                        var vDeltaSeg = (vA instanceof Array) ? vB[0] - vA[0] : vB - vA;

                        try {
                            if (nodes.length <= 2) {
                                appliedCount += _applySegmentEase(
                                    eProp, k, k + 1,
                                    p1x, p1y, p2x, p2y,
                                    vDeltaSeg, tDeltaSeg, linearSpatial, liveEProp);
                            } else {
                                appliedCount += _applyMultiNodeEase(
                                    eProp, k, k + 1, nodes,
                                    timeA, vA, vB, tDeltaSeg, vDeltaSeg, linearSpatial, liveEProp);
                            }
                        } catch (segErr) {
                            return JSON.stringify({ status: 'error', message: segErr.message + ' (line ' + segErr.line + ')' });
                        }
                    }
                }

                // イーズ適用後に次元分割（先に分割するとプロパティ構造が変わるため）
                if (splitDimensions) {
                    try {
                        var mn = eProp.matchName;
                        if (mn === 'ADBE Position' || mn === 'ADBE Position_0') {
                            eProp.dimensionsSeparated = true;
                        }
                    } catch (dimErr) { /* 非対応は無視 */ }
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (appliedCount === 0) {
            return JSON.stringify({ status: 'error', message: 'キーフレームが選択されていません（隣接する2点を選択してください）' });
        }
        return JSON.stringify({ status: 'ok', count: appliedCount });
    } catch (e) {
        try { app.endUndoGroup(); } catch (ee) { /* ignore */ }
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}

// ── 単一セグメントのイーズ適用（C案: BEZIER KF + Expression） ─────
// KF を BEZIER 補間に設定してグラフエディタに視覚的ヒントを残し、
// Expression が毎フレームの正確な値を上書き計算する。
// liveProp: expression 設定に使う live 参照。disconnected 参照では expression が
//           書き込まれない場合があるため applyEase 側で live 参照を渡す。
function _applySegmentEase(prop, idxA, idxB, p1x, p1y, p2x, p2y,
                            valueDelta, timeDelta, linearSpatial, liveProp) {
    prop.setInterpolationTypeAtKey(idxA,
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    prop.setInterpolationTypeAtKey(idxB,
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

    // speed/influence で近似 ease を fallback として書き込む
    // （Expression 無効時にもカーブ形状のヒントが残るようにする）
    var ease = calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta);
    var defEase = new KeyframeEase(0, 33.33);
    try {
        prop.setTemporalEaseAtKey(idxA,
            [defEase],
            [new KeyframeEase(Math.abs(ease.outSpeed), ease.outInfluence)]);
        prop.setTemporalEaseAtKey(idxB,
            [new KeyframeEase(Math.abs(ease.inSpeed), ease.inInfluence)],
            [defEase]);
    } catch(eEase) {}

    var segsJson = '[[' + _r4(p1x) + ',' + _r4(p1y) + ',' + _r4(p2x) + ',' + _r4(p2y) + ']]';
    var exprProp = liveProp || prop;
    exprProp.expression = _buildCtvExpr(segsJson);

    if (linearSpatial) {
        try { prop.setSpatialTangentsAtKey(idxA, [0,0,0], [0,0,0]); } catch(e2) {}
        try { prop.setSpatialTangentsAtKey(idxB, [0,0,0], [0,0,0]); } catch(e2) {}
    }
    return 1;
}

// ── 多点ノードのイーズ適用（C案: BEZIER KF + Expression） ──
function _applyMultiNodeEase(prop, idxA, idxB, nodes,
                              timeA, vA, vB,
                              timeDeltaFull, valueDeltaFull, linearSpatial, liveProp) {
    var count = 0;
    var insertedIndices = [];

    // 中間ノードを後ろから挿入（BEZIER 補間で近似 fallback として挿入）
    for (var ni = nodes.length - 2; ni >= 1; ni--) {
        var node = nodes[ni];
        var insertTime = timeA + node.anchor.x * timeDeltaFull;
        var insertValue;
        if (vA instanceof Array) {
            insertValue = [];
            for (var d = 0; d < vA.length; d++) {
                insertValue.push(vA[d] + node.anchor.y * (vB[d] - vA[d]));
            }
        } else {
            insertValue = vA + node.anchor.y * valueDeltaFull;
        }

        prop.addKey(insertTime);
        var newIdx = prop.nearestKeyIndex(insertTime);
        prop.setValueAtKey(newIdx, insertValue);
        prop.setInterpolationTypeAtKey(newIdx,
            KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

        if (linearSpatial) {
            try { prop.setSpatialTangentsAtKey(newIdx, [0,0,0], [0,0,0]); } catch(e2) {}
        }

        for (var j = 0; j < insertedIndices.length; j++) {
            if (insertedIndices[j] >= newIdx) insertedIndices[j]++;
        }
        insertedIndices.unshift(newIdx);
        count++;
    }

    // 全 KF インデックスを構築
    var allIndices = [idxA];
    for (var m = 0; m < insertedIndices.length; m++) { allIndices.push(insertedIndices[m]); }
    allIndices.push(idxB + insertedIndices.length);

    // 始点・終点も BEZIER に設定
    prop.setInterpolationTypeAtKey(allIndices[0],
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    prop.setInterpolationTypeAtKey(allIndices[allIndices.length - 1],
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

    // セグメントごとのローカルベジェパラメータを収集して s 配列を構築
    var segsData = [];
    var segParts = [];
    for (var si = 0; si < allIndices.length - 1; si++) {
        var nodeA = nodes[si];
        var nodeB = nodes[si + 1];
        var lP1x, lP1y, lP2x, lP2y;
        if (!nodeA.handleOut || !nodeB.handleIn) {
            lP1x = 0.42; lP1y = 0; lP2x = 0.58; lP2y = 1;
        } else {
            var ta = nodeA.anchor.x, tb = nodeB.anchor.x;
            var va = nodeA.anchor.y, vb = nodeB.anchor.y;
            var dtSeg = tb - ta;
            var dvSeg = vb - va;
            lP1x = dtSeg > 1e-6 ? (nodeA.handleOut.x - ta) / dtSeg : 0;
            lP1y = Math.abs(dvSeg) > 1e-6 ? (nodeA.handleOut.y - va) / dvSeg : 0;
            lP2x = dtSeg > 1e-6 ? (nodeB.handleIn.x  - ta) / dtSeg : 1;
            lP2y = Math.abs(dvSeg) > 1e-6 ? (nodeB.handleIn.y  - va) / dvSeg : 1;
        }
        segsData.push([lP1x, lP1y, lP2x, lP2y]);
        segParts.push('[' + _r4(lP1x) + ',' + _r4(lP1y) + ',' + _r4(lP2x) + ',' + _r4(lP2y) + ']');
    }

    // speed/influence で近似 ease を各 KF に書き込む
    // allIndices[ki] の inEase = segsData[ki-1] の inSpeed/Influence
    //                  outEase = segsData[ki]   の outSpeed/Influence
    var allEases = [];
    for (var ei = 0; ei < segsData.length; ei++) {
        var kA_e = allIndices[ei];
        var kB_e = allIndices[ei + 1];
        var tD_e = prop.keyTime(kB_e) - prop.keyTime(kA_e);
        var vA_e = prop.keyValue(kA_e);
        var vB_e = prop.keyValue(kB_e);
        var vD_e = (vA_e instanceof Array) ? vB_e[0] - vA_e[0] : vB_e - vA_e;
        var seg = segsData[ei];
        var ease = calcAeEase(seg[0], seg[1], seg[2], seg[3], vD_e, tD_e);
        allEases.push({
            outSpeed: Math.abs(ease.outSpeed), outInf: ease.outInfluence,
            inSpeed:  Math.abs(ease.inSpeed),  inInf:  ease.inInfluence
        });
    }
    var defEase = new KeyframeEase(0, 33.33);
    for (var ki = 0; ki < allIndices.length; ki++) {
        var inE  = ki > 0
            ? new KeyframeEase(allEases[ki - 1].inSpeed,  allEases[ki - 1].inInf)
            : defEase;
        var outE = ki < allIndices.length - 1
            ? new KeyframeEase(allEases[ki].outSpeed, allEases[ki].outInf)
            : defEase;
        try { prop.setTemporalEaseAtKey(allIndices[ki], [inE], [outE]); } catch(eEase) {}
    }

    var segsJson = '[' + segParts.join(',') + ']';
    var exprPropM = liveProp || prop;
    exprPropM.expression = _buildCtvExpr(segsJson);

    if (linearSpatial) {
        for (var li = 0; li < allIndices.length; li++) {
            try { prop.setSpatialTangentsAtKey(allIndices[li], [0,0,0], [0,0,0]); } catch(e2) {}
        }
    }

    return count;
}

// ── CTV エクスプレッション解除（ネイティブ補完に変換） ────────
// 選択プロパティに設定された CTV エクスプレッションを削除し、
// メタデータから読み取ったベジェパラメータを speed/influence に変換して書き戻す。
// オーバーシュート系は AE ネイティブで正確に再現できないため近似になる。
function clearExpression() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ status: 'error', message: 'コンポジションを選択してください' });
        }

        var clearedCount = 0;
        app.beginUndoGroup('Curve-TrueValue: エクスプレッションをクリア');

        try {
            var selProps = comp.selectedProperties;
            for (var i = 0; i < selProps.length; i++) {
                var prop = selProps[i];
                if (!prop || prop.numKeys < 2) continue;

                var expr = '';
                try { expr = prop.expression; } catch(eEx) { continue; }
                if (!expr) continue;

                // CTV メタデータを取得
                var ctvM = expr.match(/\/\*CTV:([\s\S]*?)\*\//);
                var segs = null;
                if (ctvM) {
                    try { segs = JSON.parse(ctvM[1]); } catch(eJ) {}
                }

                // エクスプレッション削除
                prop.expression = '';

                // 全 KF を BEZIER に戻して speed/influence で近似
                for (var k = 1; k <= prop.numKeys; k++) {
                    prop.setInterpolationTypeAtKey(k,
                        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                }

                if (segs) {
                    for (var k2 = 1; k2 < prop.numKeys; k2++) {
                        var segIdx = Math.min(k2 - 1, segs.length - 1);
                        var seg = segs[segIdx];
                        var tA = prop.keyTime(k2), tB = prop.keyTime(k2 + 1);
                        var vA = prop.keyValue(k2), vB = prop.keyValue(k2 + 1);
                        var tD = tB - tA;
                        var vD = (vA instanceof Array) ? vB[0] - vA[0] : vB - vA;

                        var ease = calcAeEase(seg[0], seg[1], seg[2], seg[3], vD, tD);
                        var outEase = new KeyframeEase(Math.abs(ease.outSpeed), ease.outInfluence);
                        var inEase  = new KeyframeEase(Math.abs(ease.inSpeed),  ease.inInfluence);

                        var defEase = new KeyframeEase(0, 33.33);
                        var inEaseK = defEase;
                        try { inEaseK = prop.getTemporalEaseAtKey(k2)[0][0]; } catch(e) {}
                        prop.setTemporalEaseAtKey(k2, [inEaseK], [outEase]);

                        var outEaseK1 = defEase;
                        try { outEaseK1 = prop.getTemporalEaseAtKey(k2 + 1)[1][0]; } catch(e) {}
                        prop.setTemporalEaseAtKey(k2 + 1, [inEase], [outEaseK1]);
                    }
                }

                clearedCount++;
            }
        } finally {
            app.endUndoGroup();
        }

        if (clearedCount === 0) {
            return JSON.stringify({ status: 'error', message: 'エクスプレッションが設定されたプロパティが見つかりません（プロパティを選択してください）' });
        }
        return JSON.stringify({ status: 'ok', count: clearedCount });
    } catch (e) {
        try { app.endUndoGroup(); } catch(ee) {}
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}
