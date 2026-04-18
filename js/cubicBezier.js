/**
 * cubicBezier.js
 * 0-1 正規化 cubic-bezier の数学ユーティリティ
 * P0=(0,0), P3=(1,1) 固定。P1, P2 が制御点（CSS / Figma と同一形式）
 *
 * Version: 0.1.0
 * Date: Sun Apr 19 08:42:43 JST 2026
 */

const CubicBezier = (() => {
    'use strict';

    // Newton 法による t の精度設定
    const NEWTON_ITERATIONS = 8;
    const NEWTON_MIN_SLOPE  = 0.001;
    const SUBDIVIDE_PRECISION = 1e-7;
    const SUBDIVIDE_MAX_ITER  = 10;
    const SAMPLE_COUNT = 11;

    // ── 基本評価式 ──────────────────────────────────────────
    // 1 次元ベジェ B(t) = 3(1-t)²t·a1 + 3(1-t)t²·a2 + t³
    function calcBezier(t, a1, a2) {
        return ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
    }

    // B'(t)
    function getSlope(t, a1, a2) {
        return 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
    }

    // ── t 探索（X → t） ────────────────────────────────────
    function binarySubdivide(x, lowerT, upperT, mX1, mX2) {
        let t, xAtT, i = 0;
        do {
            t = lowerT + (upperT - lowerT) / 2;
            xAtT = calcBezier(t, mX1, mX2) - x;
            if (xAtT > 0) upperT = t; else lowerT = t;
        } while (Math.abs(xAtT) > SUBDIVIDE_PRECISION && ++i < SUBDIVIDE_MAX_ITER);
        return t;
    }

    function newtonRaphson(x, guessT, mX1, mX2) {
        for (let i = 0; i < NEWTON_ITERATIONS; i++) {
            const slope = getSlope(guessT, mX1, mX2);
            if (slope === 0) return guessT;
            guessT -= (calcBezier(guessT, mX1, mX2) - x) / slope;
        }
        return guessT;
    }

    /**
     * X に対する t を求める（サンプルテーブル + Newton 法）
     */
    function getTForX(x, mX1, mX2) {
        const step = 1 / SAMPLE_COUNT;
        // サンプルテーブルで最近傍区間を探す
        let intervalStart = 0;
        let s = 1;
        for (; s !== SAMPLE_COUNT && calcBezier(s * step, mX1, mX2) <= x; s++) {
            intervalStart += step;
        }
        s--;
        const dist = (x - calcBezier(s * step, mX1, mX2)) /
                     (calcBezier((s + 1) * step, mX1, mX2) - calcBezier(s * step, mX1, mX2));
        const guessT = intervalStart + dist * step;
        const slope  = getSlope(guessT, mX1, mX2);
        if (slope >= NEWTON_MIN_SLOPE) return newtonRaphson(x, guessT, mX1, mX2);
        if (slope === 0) return guessT;
        return binarySubdivide(x, intervalStart, intervalStart + step, mX1, mX2);
    }

    // ── 公開 API ──────────────────────────────────────────

    /**
     * cubic-bezier(p1x, p1y, p2x, p2y) の Y 値を X [0,1] から取得
     * CSS timing-function と同一の挙動
     */
    function solveY(x, p1x, p1y, p2x, p2y) {
        if (p1x === p1y && p2x === p2y) return x; // Linear 最適化
        if (x === 0 || x === 1) return x;
        return calcBezier(getTForX(x, p1x, p2x), p1y, p2y);
    }

    /**
     * 描画用の点列を生成（t を均等サンプリング）
     * @returns {Array<{x: number, y: number}>}
     */
    function samplePoints(p1x, p1y, p2x, p2y, steps = 60) {
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            pts.push({
                x: calcBezier(t, p1x, p2x),
                y: calcBezier(t, p1y, p2y),
            });
        }
        return pts;
    }

    /**
     * cubic-bezier (P1, P2) → AE KeyframeEase パラメータに変換（近似）
     *
     * @param {number} p1x, p1y  - 制御点 P1
     * @param {number} p2x, p2y  - 制御点 P2
     * @param {number} valueDelta - キーフレーム間の値の差（符号付き）
     * @param {number} timeDelta  - キーフレーム間の時間差（秒、正の値）
     * @returns {{ outInfluence, outSpeed, inInfluence, inSpeed }}
     *
     * @problem AE の influence/speed モデルは Hermite 基底。cubic-bezier との
     *          厳密な変換式は存在しない。ここでは接線の傾きを近似として使用。
     * @solution 実用精度は高い。ただし influence=0 や speed 極端値では誤差が出る。
     *           今後 round-trip テストで精度を検証する。
     */
    function toAeEase(p1x, p1y, p2x, p2y, valueDelta, timeDelta) {
        const scale = timeDelta > 0 ? valueDelta / timeDelta : 0;
        const outInfluence = Math.max(0.1, Math.min(99.9, p1x * 100));
        const outSpeed     = p1x > 1e-4 ? (p1y / p1x) * scale : 0;
        const inInfluence  = Math.max(0.1, Math.min(99.9, (1 - p2x) * 100));
        const inSpeed      = (1 - p2x) > 1e-4 ? ((1 - p2y) / (1 - p2x)) * scale : 0;
        return { outInfluence, outSpeed, inInfluence, inSpeed };
    }

    /**
     * AE KeyframeEase → cubic-bezier P1, P2 に逆変換（近似）
     */
    function fromAeEase(outInfluence, outSpeed, inInfluence, inSpeed, valueDelta, timeDelta) {
        const scale = valueDelta !== 0 ? timeDelta / valueDelta : 0;
        const p1x = outInfluence / 100;
        const p1y = p1x > 0 ? outSpeed * scale * p1x : 0;
        const p2x = 1 - inInfluence / 100;
        const p2y = (1 - p2x) > 0 ? 1 - inSpeed * scale * (1 - p2x) : 1;
        return { p1x, p1y, p2x, p2y };
    }

    return { solveY, samplePoints, toAeEase, fromAeEase, calcBezier };
})();
