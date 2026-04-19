/**
 * hostscript.jsx
 * AE ExtendScript ホストスクリプト（ES3 必須）
 *
 * Version: 0.4.7
 * Date: Sun Apr 19 09:31:46 JST 2026
 *
 * 関数一覧:
 *   getSelectedKfData() → JSON
 *   applyEase(argsJson) → JSON
 *     argsJson: { nodes, linearSpatial, splitDimensions }
 *     nodes が 2 点なら単一セグメント、3 点以上なら中間 KF を生成
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

// ── イーズ適用 ────────────────────────────────────────────
/**
 * nodes が 2 点の場合: 選択 KF ペアに単一セグメントのイーズを適用
 * nodes が 3 点以上の場合: 中間ノードに対応する中間 KF を生成してイーズを適用
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

        var appliedCount = 0;
        app.beginUndoGroup('Curve-TrueValue: イーズ適用');

        try {
            var props = comp.selectedProperties;
            for (var i = 0; i < props.length; i++) {
                var prop = props[i];
                if (prop.numKeys === 0) continue;
                if (prop.propertyValueType === PropertyValueType.NO_VALUE) continue;

                // 選択済み KF ペア (k, k+1) を列挙
                for (var k = 1; k <= prop.numKeys; k++) {
                    if (!prop.keySelected(k) || k >= prop.numKeys) continue;
                    if (!prop.keySelected(k + 1)) continue;

                    var timeA    = prop.keyTime(k);
                    var timeB    = prop.keyTime(k + 1);
                    var vA       = prop.keyValue(k);
                    var vB       = prop.keyValue(k + 1);
                    var timeDeltaFull  = timeB - timeA;
                    var valueDeltaFull = (vA instanceof Array) ? vB[0] - vA[0] : vB - vA;

                    try {
                        if (nodes.length <= 2) {
                            var p1x = nodes[0].handleOut.x, p1y = nodes[0].handleOut.y;
                            var p2x = nodes[nodes.length-1].handleIn.x,
                                p2y = nodes[nodes.length-1].handleIn.y;
                            appliedCount += _applySegmentEase(
                                prop, k, k + 1,
                                p1x, p1y, p2x, p2y,
                                valueDeltaFull, timeDeltaFull,
                                linearSpatial);
                        } else {
                            appliedCount += _applyMultiNodeEase(
                                prop, k, k + 1,
                                nodes,
                                timeA, vA, vB,
                                timeDeltaFull, valueDeltaFull,
                                linearSpatial);
                        }
                    } catch (segErr) { /* テンポラル補完非対応プロパティは無視 */ }
                }

                // イーズ適用後に次元分割（先に分割するとプロパティ構造が変わるため）
                if (splitDimensions) {
                    try {
                        var mn = prop.matchName;
                        if (mn === 'ADBE Position' || mn === 'ADBE Position_0') {
                            prop.dimensionsSeparated = true;
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

    // idxA の out ease, idxB の in ease を設定
    var easesA = prop.getTemporalEaseAtKey(idxA);
    prop.setTemporalEaseAtKey(idxA, easesA[0], [outEase]);

    var easesB = prop.getTemporalEaseAtKey(idxB);
    prop.setTemporalEaseAtKey(idxB, [inEase], easesB[1]);

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
