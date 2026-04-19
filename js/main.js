/**
 * main.js
 * UI イベント連結・CSInterface ブリッジ・プリセット管理
 *
 * Version: 0.4.0
 * Date: Sun Apr 19 09:31:46 JST 2026
 */

// ── プリセット定義 ─────────────────────────────────────────
const PRESETS = [
    { name: 'Linear',      p1x: 0.00, p1y: 0.00, p2x: 1.00, p2y: 1.00 },
    { name: 'Ease',        p1x: 0.25, p1y: 0.10, p2x: 0.25, p2y: 1.00 },
    { name: 'Ease In',     p1x: 0.42, p1y: 0.00, p2x: 1.00, p2y: 1.00 },
    { name: 'Ease Out',    p1x: 0.00, p1y: 0.00, p2x: 0.58, p2y: 1.00 },
    { name: 'Ease In Out', p1x: 0.42, p1y: 0.00, p2x: 0.58, p2y: 1.00 },
    { name: 'AE Default',  p1x: 0.33, p1y: 0.00, p2x: 0.67, p2y: 1.00 },
    { name: 'Overshoot',   p1x: 0.34, p1y: 1.56, p2x: 0.64, p2y: 1.00 },
    { name: 'Anticipate',  p1x: 0.38, p1y: -0.4, p2x: 0.61, p2y: 1.00 },
    { name: 'Bounce Out',  p1x: 0.22, p1y: 1.20, p2x: 0.36, p2y: 1.00 },
];

// ── CSInterface ブリッジ ───────────────────────────────────
const csInterface = (() => {
    if (typeof window.__adobe_cep__ !== 'undefined') {
        return {
            evalScript(script, cb) {
                window.__adobe_cep__.evalScript(script, cb || (() => {}));
            },
        };
    }
    return {
        evalScript(script, cb) {
            console.log('[DEV] evalScript:', script.slice(0, 80));
            setTimeout(() => cb(JSON.stringify({ status: 'ok', count: 2 })), 50);
        },
    };
})();

// ── DOM 参照 ──────────────────────────────────────────────
const elCanvas       = document.getElementById('curveCanvas');
const elP1x          = document.getElementById('p1x');
const elP1y          = document.getElementById('p1y');
const elP2x          = document.getElementById('p2x');
const elP2y          = document.getElementById('p2y');
const elCoordArea    = document.getElementById('coord-area');
const elNodeInfo     = document.getElementById('node-info');
const elNodeControls = document.getElementById('node-controls');
const elBtnSmooth    = document.getElementById('btnSmooth');
const elBtnCorner    = document.getElementById('btnCorner');
const elBtnDelete    = document.getElementById('btnNodeDelete');
const elNcAnchorX    = document.getElementById('ncAnchorX');
const elNcAnchorY    = document.getElementById('ncAnchorY');
const elNcOutY       = document.getElementById('ncOutY');
const elNcInY        = document.getElementById('ncInY');
const elCssVal       = document.getElementById('cssValue');
const elCssWrap      = document.getElementById('css-value-wrap');
const elApply        = document.getElementById('btnApply');
const elStatus       = document.getElementById('statusText');
const elPresets      = document.getElementById('preset-buttons');

// ── 状態 ──────────────────────────────────────────────────
let currentNodes = null;

// ── カーブエディタ初期化 ───────────────────────────────────
const editor = new CurveEditor(elCanvas, (nodes) => {
    currentNodes = nodes;
    onNodesChanged(nodes);
});

// ── ノード変更ハンドラ ─────────────────────────────────────
function onNodesChanged(nodes) {
    currentNodes = nodes;
    const isSingle = nodes.length === 2;
    const selIdx   = editor.selectedIndex;
    const isIntermediateSelected =
        selIdx !== null && selIdx > 0 && selIdx < nodes.length - 1;

    // 単一セグメント: P1/P2 入力を表示
    elCoordArea.style.display = isSingle ? '' : 'none';
    elNodeInfo.style.display  = isSingle ? 'none' : '';
    elCssWrap.style.display   = isSingle ? '' : 'none';

    if (isSingle) {
        const p1 = nodes[0].handleOut || {x:0.42, y:0};
        const p2 = nodes[nodes.length-1].handleIn || {x:0.58, y:1};
        elP1x.value = fmt(p1.x); elP1y.value = fmt(p1.y);
        elP2x.value = fmt(p2.x); elP2y.value = fmt(p2.y);
        elCssVal.textContent =
            `cubic-bezier(${fmt(p1.x)}, ${fmt(p1.y)}, ${fmt(p2.x)}, ${fmt(p2.y)})`;
    } else {
        elNodeInfo.textContent = `ノード ${nodes.length} 点（中間 ${nodes.length - 2} 点）`;
    }

    // 中間ノードが選択されているときのみノードコントロールを表示
    elNodeControls.style.display = isIntermediateSelected ? '' : 'none';
    if (isIntermediateSelected) {
        const node = nodes[selIdx];
        const isSmooth = node.smooth !== false;
        elBtnSmooth.classList.toggle('active', isSmooth);
        elBtnCorner.classList.toggle('active', !isSmooth);

        // 座標入力を更新（フォーカス中は上書きしない）
        const act = document.activeElement;
        if (act !== elNcAnchorX) elNcAnchorX.value = fmt(node.anchor.x);
        if (act !== elNcAnchorY) elNcAnchorY.value = fmt(node.anchor.y);
        if (node.handleOut && act !== elNcOutY) elNcOutY.value = fmt(node.handleOut.y);
        if (node.handleIn  && act !== elNcInY)  elNcInY.value  = fmt(node.handleIn.y);
    }
}

function fmt(v) { return Math.round(v * 100) / 100; }

// ── 数値入力 → エディタ同期 ───────────────────────────────
function syncEditorFromInputs() {
    const p1x = parseFloat(elP1x.value);
    const p1y = parseFloat(elP1y.value);
    const p2x = parseFloat(elP2x.value);
    const p2y = parseFloat(elP2y.value);
    if ([p1x, p1y, p2x, p2y].some(isNaN)) return;
    editor.setValues(p1x, p1y, p2x, p2y);
}

[elP1x, elP1y, elP2x, elP2y].forEach(el => {
    el.addEventListener('input',  syncEditorFromInputs);
    el.addEventListener('change', syncEditorFromInputs);
});

// ── 選択ノード座標入力 ────────────────────────────────────
/** @type {[HTMLInputElement, string][]} */
const ncInputPairs = [
    [elNcAnchorX, 'anchorX'],
    [elNcAnchorY, 'anchorY'],
    [elNcOutY,    'outY'],
    [elNcInY,     'inY'],
];
ncInputPairs.forEach(([el, field]) => {
    const sync = () => {
        const val = parseFloat(el.value);
        if (!isNaN(val)) editor.setSelectedNodeCoords({ [field]: val });
    };
    el.addEventListener('input',  sync);
    el.addEventListener('change', sync);
});

// ── ノードコントロールボタン ───────────────────────────────
elBtnSmooth.addEventListener('click', () => editor.toggleSmooth(true));
elBtnCorner.addEventListener('click', () => editor.toggleSmooth(false));
elBtnDelete.addEventListener('click', () => {
    editor.deleteSelected();
    setStatus('ノードを削除しました', 'success');
});

// ── プリセットボタン生成 ──────────────────────────────────
PRESETS.forEach((preset) => {
    const btn = document.createElement('button');
    btn.textContent  = preset.name;
    btn.dataset.name = preset.name;
    btn.addEventListener('click', () => {
        editor.setValues(preset.p1x, preset.p1y, preset.p2x, preset.p2y);
        document.querySelectorAll('#preset-buttons button')
            .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
    elPresets.appendChild(btn);
});

// ── 適用ボタン ────────────────────────────────────────────
elApply.addEventListener('click', () => {
    if (!currentNodes) return;
    const linearSpatial   = document.getElementById('optLinearSpatial').checked;
    const splitDimensions = document.getElementById('optSplitDimensions').checked;

    setStatus('適用中...', 'info');
    elApply.disabled = true;

    const argsJson = JSON.stringify({
        nodes:           currentNodes,
        linearSpatial:   linearSpatial,
        splitDimensions: splitDimensions,
    });
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

// ── ステータス ────────────────────────────────────────────
function setStatus(msg, type = '') {
    elStatus.textContent = msg;
    elStatus.className   = type;
    if (type === 'success') setTimeout(() => setStatus(
        'ダブルクリック: ノード追加 / Alt+クリック: スムーズ切替'
    ), 3000);
}

// ── 初期化 ────────────────────────────────────────────────
currentNodes = editor.nodes;
onNodesChanged(currentNodes);
