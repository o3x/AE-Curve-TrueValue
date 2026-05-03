/**
 * hostscript.jsx
 * AE ExtendScript ホストスクリプト（ES3 必須）
 *
 * Version: 0.6.1
 * Date: Sun May 03 14:41:07 JST 2026
 *
 * 関数一覧:
 *   getSelectedKfData() → JSON            （旧・後方互換用）
 *   getKfCurve()        → JSON            選択KF全体のカーブをP1/P2として取得
 *   applyEase(argsJson) → JSON
 *     argsJson: { nodes, linearSpatial, splitDimensions }
 *     3KF以上選択時: ダイアログでモードA/B を選択
 *       A: 各セグメントに現在のカーブを適用
 *       B: 中間KFを削除し始点〜終点に適用
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

// ── 選択 KF データ取得 ─────────────────────────────────────
function getSelectedKfData() {
    try {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ status: 'error', message: 'コンポジションを選択してください' });
        }
        var result = [];
        var props = comp.selectedProperties;
        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            if (prop.numKeys === 0) continue;
            if (prop.propertyValueType === PropertyValueType.NO_VALUE) continue;
            if (typeof prop.getTemporalEaseAtKey !== 'function') continue;
            for (var k = 1; k <= prop.numKeys; k++) {
                if (!prop.keySelected(k) || k >= prop.numKeys) continue;
                var timeA = prop.keyTime(k), timeB = prop.keyTime(k + 1);
                var vA = prop.keyValue(k),   vB = prop.keyValue(k + 1);
                var valueDelta = (vA instanceof Array) ? vB[0] - vA[0] : vB - vA;
                var timeDelta  = timeB - timeA;
                var eases = prop.getTemporalEaseAtKey(k);
                var outEase   = eases[1][0];
                var inEaseNxt = prop.getTemporalEaseAtKey(k + 1)[0][0];
                var scale = Math.abs(valueDelta) > 1e-6 && timeDelta > 1e-6
                    ? timeDelta / valueDelta : 0;
                var p1x = outEase.influence / 100;
                var p1y = p1x > 0 ? outEase.speed * scale * p1x : 0;
                var p2x = 1 - inEaseNxt.influence / 100;
                var p2y = (1 - p2x) > 0 ? 1 - inEaseNxt.speed * scale * (1 - p2x) : 1;
                result.push({ p1x: p1x, p1y: p1y, p2x: p2x, p2y: p2y,
                               valueDelta: valueDelta, timeDelta: timeDelta });
            }
        }
        if (result.length === 0) {
            return JSON.stringify({ status: 'error', message: 'キーフレームが選択されていません' });
        }
        return JSON.stringify({ status: 'ok', keyframes: result });
    } catch (e) {
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}

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

        // Step 3: イーズ取得（getTemporalEaseAtKey が使える場合のみ）
        var eases = [];
        var spatialFallback = (typeof prop.getTemporalEaseAtKey !== 'function');
        if (!spatialFallback) {
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
                    var segVin = isMultiDim ? segDists[ni] : (prop.keyValue(indices[ni]) - prop.keyValue(indices[ni-1]));
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
                    var segVout = isMultiDim ? segDists[ni+1] : (prop.keyValue(indices[ni+1]) - prop.keyValue(indices[ni]));
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

        return JSON.stringify({ status: 'ok', nodes: nodes, spatialFallback: spatialFallback });
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
                            p1x, p1y, p2x, p2y, vDelta, tDelta, linearSpatial);
                    } else {
                        appliedCount += _applyMultiNodeEase(
                            eProp, newFirstIdx, newLastIdx, nodes,
                            timeFirst, vFirst, vLast, tDelta, vDelta, linearSpatial);
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
                                    vDeltaSeg, tDeltaSeg, linearSpatial);
                            } else {
                                appliedCount += _applyMultiNodeEase(
                                    eProp, k, k + 1, nodes,
                                    timeA, vA, vB, tDeltaSeg, vDeltaSeg, linearSpatial);
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

// ── 単一セグメントのイーズ適用 ────────────────────────────
function _applySegmentEase(prop, idxA, idxB, p1x, p1y, p2x, p2y,
                            valueDelta, timeDelta, linearSpatial) {
    prop.setInterpolationTypeAtKey(idxA,
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    prop.setInterpolationTypeAtKey(idxB,
        KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

    var ease = calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta);
    var outEase = new KeyframeEase(Math.abs(ease.outSpeed), ease.outInfluence);
    var inEase  = new KeyframeEase(Math.abs(ease.inSpeed),  ease.inInfluence);

    // idxA の out ease、idxB の in ease を設定
    // getTemporalEaseAtKey が使えない場合はデフォルト値でフォールバック
    var defEase = new KeyframeEase(0, 33.33);
    var inEaseA = defEase;
    try { inEaseA = prop.getTemporalEaseAtKey(idxA)[0][0]; } catch(e) {}
    prop.setTemporalEaseAtKey(idxA, [inEaseA], [outEase]);

    var outEaseB = defEase;
    try { outEaseB = prop.getTemporalEaseAtKey(idxB)[1][0]; } catch(e) {}
    prop.setTemporalEaseAtKey(idxB, [inEase], [outEaseB]);

    // 空間補完のリニア化（Position 以外で呼ぶとエラーになるため try/catch で握りつぶす）
    if (linearSpatial) {
        try { prop.setSpatialTangentsAtKey(idxA, [0,0,0], [0,0,0]); } catch(e2) {}
        try { prop.setSpatialTangentsAtKey(idxB, [0,0,0], [0,0,0]); } catch(e2) {}
    }
    return 1;
}

// ── 多点ノードのイーズ適用（中間 KF を生成） ─────────────
function _applyMultiNodeEase(prop, idxA, idxB, nodes,
                              timeA, vA, vB,
                              timeDeltaFull, valueDeltaFull, linearSpatial) {
    var count = 0;

    // 中間ノード (index 1 〜 nodes.length-2) を実際の KF に変換
    // キーフレームを後ろから挿入して index のずれを防ぐ
    var insertedIndices = [];

    for (var n = nodes.length - 2; n >= 1; n--) {
        var node = nodes[n];
        var tx = node.anchor.x; // 0-1 正規化時間
        var ty = node.anchor.y; // 0-1 正規化値

        var insertTime  = timeA + tx * timeDeltaFull;
        var insertValue;
        if (vA instanceof Array) {
            insertValue = [];
            for (var d = 0; d < vA.length; d++) {
                insertValue.push(vA[d] + ty * (vB[d] - vA[d]));
            }
        } else {
            insertValue = vA + ty * valueDeltaFull;
        }

        prop.addKey(insertTime);
        var newIdx = prop.nearestKeyIndex(insertTime);
        prop.setValueAtKey(newIdx, insertValue);
        prop.setInterpolationTypeAtKey(newIdx,
            KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

        if (linearSpatial) {
            try { prop.setSpatialTangentsAtKey(newIdx, [0,0,0], [0,0,0]); } catch(e2) {}
        }

        // 後ろから挿入するたびに既存インデックスが +1 ずれるため補正
        for (var j = 0; j < insertedIndices.length; j++) {
            if (insertedIndices[j] >= newIdx) insertedIndices[j]++;
        }
        insertedIndices.unshift(newIdx);
        count++;
    }

    // 全セグメントにイーズを適用
    var allIndices = [idxA];
    for (var m = 0; m < insertedIndices.length; m++) {
        allIndices.push(insertedIndices[m]);
    }
    allIndices.push(idxB + insertedIndices.length);

    for (var s = 0; s < allIndices.length - 1; s++) {
        var segA = allIndices[s];
        var segB = allIndices[s + 1];
        var nodeA = nodes[s];
        var nodeB = nodes[s + 1];
        if (!nodeA.handleOut || !nodeB.handleIn) continue;

        var segTimeDelta  = prop.keyTime(segB) - prop.keyTime(segA);
        var svA = prop.keyValue(segA), svB = prop.keyValue(segB);
        var segValueDelta = (svA instanceof Array) ? svB[0] - svA[0] : svB - svA;

        // handle 座標はグローバル 0-1 空間のため、セグメント相対座標に変換してから渡す
        var ta = nodeA.anchor.x, tb = nodeB.anchor.x;
        var va = nodeA.anchor.y, vb = nodeB.anchor.y;
        var dtSeg = tb - ta;
        var dvSeg = vb - va;
        var lP1x = dtSeg > 1e-6 ? (nodeA.handleOut.x - ta) / dtSeg : 0;
        var lP1y = Math.abs(dvSeg) > 1e-6 ? (nodeA.handleOut.y - va) / dvSeg : 0;
        var lP2x = dtSeg > 1e-6 ? (nodeB.handleIn.x  - ta) / dtSeg : 1;
        var lP2y = Math.abs(dvSeg) > 1e-6 ? (nodeB.handleIn.y  - va) / dvSeg : 1;

        _applySegmentEase(prop, segA, segB,
            lP1x, lP1y, lP2x, lP2y,
            segValueDelta, segTimeDelta, linearSpatial);
    }

    return count;
}
