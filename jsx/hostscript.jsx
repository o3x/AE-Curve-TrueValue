/**
 * hostscript.jsx
 * AE ExtendScript ホストスクリプト
 * CSInterface.evalScript() から呼び出される AE API レイヤー
 *
 * Version: 0.1.0
 * Date: Sun Apr 19 08:42:43 JST 2026
 *
 * 注意: このファイルは ES3 必須。var のみ使用。
 */

// ── cubic-bezier → AE ease 変換 ────────────────────────────
/**
 * @param {Number} p1x, p1y, p2x, p2y  0-1 正規化ベジェ制御点
 * @param {Number} valueDelta  キーフレーム間の値の差
 * @param {Number} timeDelta   キーフレーム間の時間差（秒）
 * @returns {{ outInfluence, outSpeed, inInfluence, inSpeed }}
 */
function calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta) {
    var scale = timeDelta > 0 ? valueDelta / timeDelta : 0;
    var outInfluence = Math.max(0.1, Math.min(99.9, p1x * 100));
    var outSpeed     = p1x > 1e-4 ? (p1y / p1x) * scale : 0;
    var inInfluence  = Math.max(0.1, Math.min(99.9, (1 - p2x) * 100));
    var inSpeed      = (1 - p2x) > 1e-4 ? ((1 - p2y) / (1 - p2x)) * scale : 0;
    return { outInfluence: outInfluence, outSpeed: outSpeed,
             inInfluence: inInfluence, inSpeed: inSpeed };
}

// ── 選択 KF データ取得 ─────────────────────────────────────
/**
 * パネルから呼ばれる: 選択中のキーフレームのイーズを読み取って JSON で返す
 * 戻り値: JSON.stringify({ status, keyframes: [{p1x,p1y,p2x,p2y,valueDelta,timeDelta}] })
 */
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

            for (var k = 1; k <= prop.numKeys; k++) {
                if (!prop.keySelected(k)) continue;
                if (k >= prop.numKeys) continue; // 後続キーがない最後の点はスキップ

                var timeA    = prop.keyTime(k);
                var timeB    = prop.keyTime(k + 1);
                var timeDelta = timeB - timeA;

                // 多次元プロパティは最初の次元の値差を代表値として使用
                var valueA = prop.keyValue(k);
                var valueB = prop.keyValue(k + 1);
                var valueDelta;
                if (valueA instanceof Array) {
                    valueDelta = valueB[0] - valueA[0];
                } else {
                    valueDelta = valueB - valueA;
                }

                // 現在の out ease から cubic-bezier を逆算（近似）
                var eases     = prop.getTemporalEaseAtKey(k);
                var outEase   = eases[1][0]; // out (後ろ向き)
                var inEaseNext = prop.getTemporalEaseAtKey(k + 1)[0][0]; // in (前向き)

                var scale = Math.abs(valueDelta) > 1e-6 && timeDelta > 1e-6
                    ? timeDelta / valueDelta : 0;

                var p1x = outEase.influence / 100;
                var p1y = p1x > 0 ? outEase.speed * scale * p1x : 0;
                var p2x = 1 - inEaseNext.influence / 100;
                var p2y = (1 - p2x) > 0 ? 1 - inEaseNext.speed * scale * (1 - p2x) : 1;

                result.push({
                    p1x: p1x, p1y: p1y, p2x: p2x, p2y: p2y,
                    valueDelta: valueDelta, timeDelta: timeDelta,
                });
            }
        }

        if (result.length === 0) {
            return JSON.stringify({ status: 'error', message: 'キーフレームが選択されていません（隣接する2点を選択してください）' });
        }
        return JSON.stringify({ status: 'ok', keyframes: result });
    } catch (e) {
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}

// ── イーズ適用 ────────────────────────────────────────────
/**
 * パネルから呼ばれる: 選択中のキーフレームに cubic-bezier イーズを適用
 * @param {String} argsJson  JSON.stringify({ p1x, p1y, p2x, p2y, linearSpatial, splitDimensions })
 * @returns {String} JSON.stringify({ status, count, message })
 */
function applyEase(argsJson) {
    var args;
    try {
        args = JSON.parse(argsJson);
    } catch (e) {
        return JSON.stringify({ status: 'error', message: '引数の解析に失敗: ' + e.message });
    }

    var p1x             = args.p1x;
    var p1y             = args.p1y;
    var p2x             = args.p2x;
    var p2y             = args.p2y;
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

                // 次元分割オプション（Position プロパティに対してのみ）
                // @problem dimensionsSeparated は Position 系のみ有効。他で実行するとエラー
                // @solution propertyName で Position か判定してから実行
                if (splitDimensions) {
                    try {
                        var pname = prop.matchName;
                        if (pname === 'ADBE Position' || pname === 'ADBE Position_0') {
                            prop.dimensionsSeparated = true;
                            // 次元分割後はプロパティ参照が変わるためスキップして再選択を促す
                            continue;
                        }
                    } catch (dimErr) { /* 非対応プロパティは無視 */ }
                }

                for (var k = 1; k <= prop.numKeys; k++) {
                    if (!prop.keySelected(k)) continue;

                    // 補完タイプを BEZIER に設定
                    prop.setInterpolationTypeAtKey(k,
                        KeyframeInterpolationType.BEZIER,
                        KeyframeInterpolationType.BEZIER);

                    // valueDelta / timeDelta を算出（隣接キーフレームを参照）
                    var timeDelta  = 0;
                    var valueDelta = 0;

                    if (k < prop.numKeys) {
                        timeDelta  = prop.keyTime(k + 1) - prop.keyTime(k);
                        var vA = prop.keyValue(k);
                        var vB = prop.keyValue(k + 1);
                        valueDelta = (vA instanceof Array) ? (vB[0] - vA[0]) : (vB - vA);
                    } else if (k > 1) {
                        timeDelta  = prop.keyTime(k) - prop.keyTime(k - 1);
                        var vA2 = prop.keyValue(k - 1);
                        var vB2 = prop.keyValue(k);
                        valueDelta = (vA2 instanceof Array) ? (vB2[0] - vA2[0]) : (vB2 - vA2);
                    }

                    var ease = calcAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta);

                    var outEaseObj = new KeyframeEase(Math.abs(ease.outSpeed), ease.outInfluence);
                    var inEaseObj  = new KeyframeEase(Math.abs(ease.inSpeed),  ease.inInfluence);

                    prop.setTemporalEaseAtKey(k, [inEaseObj], [outEaseObj]);

                    // 空間補完のリニア化（ブーメラン効果の解消）
                    // @problem Position 以外で setSpatialTangents を呼ぶとエラー
                    // @solution try/catch で握りつぶす（空間補完を持つプロパティのみ適用される）
                    if (linearSpatial) {
                        try {
                            prop.setSpatialTangentsAtKey(k, [0, 0, 0], [0, 0, 0]);
                        } catch (spatialErr) { /* 空間補完を持たないプロパティは無視 */ }
                    }

                    appliedCount++;
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (appliedCount === 0) {
            return JSON.stringify({ status: 'error', message: 'キーフレームが選択されていません' });
        }
        return JSON.stringify({ status: 'ok', count: appliedCount });
    } catch (e) {
        app.endUndoGroup();
        return JSON.stringify({ status: 'error', message: e.message + ' (line ' + e.line + ')' });
    }
}
