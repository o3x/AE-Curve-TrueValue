/**
 * main.js
 * UI イベント連結・CSInterface ブリッジ・プリセット管理
 *
 * Version: 0.1.0
 * Date: Sun Apr 19 08:42:43 JST 2026
 */

// ── プリセット定義 ─────────────────────────────────────────
const PRESETS = [
    { name: 'Linear',      p1x: 0.00, p1y: 0.00, p2x: 1.00, p2y: 1.00 },
    { name: 'Ease',        p1x: 0.25, p1y: 0.10, p2x: 0.25, p2y: 1.00 },  // CSS ease
    { name: 'Ease In',     p1x: 0.42, p1y: 0.00, p2x: 1.00, p2y: 1.00 },  // CSS ease-in
    { name: 'Ease Out',    p1x: 0.00, p1y: 0.00, p2x: 0.58, p2y: 1.00 },  // CSS ease-out
    { name: 'Ease In Out', p1x: 0.42, p1y: 0.00, p2x: 0.58, p2y: 1.00 },  // CSS ease-in-out
    { name: 'AE Default',  p1x: 0.33, p1y: 0.00, p2x: 0.67, p2y: 1.00 },  // AE Easy Ease
    { name: 'Overshoot',   p1x: 0.34, p1y: 1.56, p2x: 0.64, p2y: 1.00 },
    { name: 'Anticipate',  p1x: 0.38, p1y: -0.4, p2x: 0.61, p2y: 1.00 },
    { name: 'Bounce Out',  p1x: 0.22, p1y: 1.20, p2x: 0.36, p2y: 1.00 },
];

// ── CSInterface ブリッジ ───────────────────────────────────
const csInterface = (() => {
    // AE CEP 環境
    if (typeof window.__adobe_cep__ !== 'undefined') {
        return {
            evalScript(script, cb) {
                window.__adobe_cep__.evalScript(script, cb || (() => {}));
            },
        };
    }
    // ブラウザ開発モード: モック
    return {
        evalScript(script, cb) {
            console.log('[DEV] evalScript:', script);
            // ダミーの KF データを返す
            if (script.startsWith('getSelectedKfData')) {
                setTimeout(() => cb(JSON.stringify({
                    status: 'ok',
                    keyframes: [{ p1x: 0.33, p1y: 0, p2x: 0.67, p2y: 1, valueDelta: 100, timeDelta: 1 }],
                })), 50);
            } else {
                setTimeout(() => cb(JSON.stringify({ status: 'ok', count: 2 })), 50);
            }
        },
    };
})();

// ── DOM 参照 ──────────────────────────────────────────────
const elCanvas  = document.getElementById('curveCanvas');
const elP1x     = document.getElementById('p1x');
const elP1y     = document.getElementById('p1y');
const elP2x     = document.getElementById('p2x');
const elP2y     = document.getElementById('p2y');
const elCssVal  = document.getElementById('cssValue');
const elApply   = document.getElementById('btnApply');
const elStatus  = document.getElementById('statusText');
const elPresets = document.getElementById('preset-buttons');

// ── カーブエディタ初期化 ──────────────────────────────────
const editor = new CurveEditor(elCanvas, (vals) => {
    syncInputsFromEditor(vals);
});

// ── 数値入力 → エディタ同期 ──────────────────────────────
function syncEditorFromInputs() {
    const p1x = parseFloat(elP1x.value);
    const p1y = parseFloat(elP1y.value);
    const p2x = parseFloat(elP2x.value);
    const p2y = parseFloat(elP2y.value);
    if (isNaN(p1x) || isNaN(p1y) || isNaN(p2x) || isNaN(p2y)) return;
    editor.setValues(p1x, p1y, p2x, p2y);
    updateCssValue(p1x, p1y, p2x, p2y);
}

// ── エディタ → 数値入力同期 ──────────────────────────────
function syncInputsFromEditor({ p1x, p1y, p2x, p2y }) {
    elP1x.value = round(p1x);
    elP1y.value = round(p1y);
    elP2x.value = round(p2x);
    elP2y.value = round(p2y);
    updateCssValue(p1x, p1y, p2x, p2y);
}

function updateCssValue(p1x, p1y, p2x, p2y) {
    elCssVal.textContent =
        `cubic-bezier(${round(p1x)}, ${round(p1y)}, ${round(p2x)}, ${round(p2y)})`;
}

function round(v) { return Math.round(v * 100) / 100; }

// ── プリセットボタン生成 ──────────────────────────────────
PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.textContent = preset.name;
    btn.dataset.name = preset.name;
    btn.addEventListener('click', () => {
        applyPreset(preset);
        document.querySelectorAll('#preset-buttons button')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
    elPresets.appendChild(btn);
});

function applyPreset({ p1x, p1y, p2x, p2y }) {
    elP1x.value = p1x;
    elP1y.value = p1y;
    elP2x.value = p2x;
    elP2y.value = p2y;
    editor.setValues(p1x, p1y, p2x, p2y);
    updateCssValue(p1x, p1y, p2x, p2y);
}

// ── 数値入力イベント ──────────────────────────────────────
[elP1x, elP1y, elP2x, elP2y].forEach(el => {
    el.addEventListener('input',  syncEditorFromInputs);
    el.addEventListener('change', syncEditorFromInputs);
});

// ── 適用ボタン ────────────────────────────────────────────
elApply.addEventListener('click', () => {
    const p1x = parseFloat(elP1x.value);
    const p1y = parseFloat(elP1y.value);
    const p2x = parseFloat(elP2x.value);
    const p2y = parseFloat(elP2y.value);
    const linearSpatial  = document.getElementById('optLinearSpatial').checked;
    const splitDimensions = document.getElementById('optSplitDimensions').checked;

    setStatus('適用中...', 'info');
    elApply.disabled = true;

    const argsJson = JSON.stringify({ p1x, p1y, p2x, p2y, linearSpatial, splitDimensions });
    csInterface.evalScript(`applyEase(${JSON.stringify(argsJson)})`, (result) => {
        elApply.disabled = false;
        try {
            const res = JSON.parse(result);
            if (res.status === 'ok') {
                setStatus(`${res.count} KF に適用しました`, 'success');
            } else {
                setStatus(`エラー: ${res.message}`, 'error');
            }
        } catch {
            setStatus('レスポンス解析エラー', 'error');
        }
    });
});

// ── ステータス表示 ────────────────────────────────────────
function setStatus(msg, type = '') {
    elStatus.textContent = msg;
    elStatus.className = type;
    if (type === 'success') {
        setTimeout(() => setStatus('準備完了'), 3000);
    }
}

// ── 初期描画 ──────────────────────────────────────────────
updateCssValue(
    parseFloat(elP1x.value), parseFloat(elP1y.value),
    parseFloat(elP2x.value), parseFloat(elP2y.value),
);
