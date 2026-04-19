/**
 * curveEditor.js
 * canvas ベースの多点 cubic-bezier インタラクティブエディタ
 *
 * ノード構造:
 *   { anchor:{x,y}, handleIn:{x,y}|null, handleOut:{x,y}|null, smooth:boolean }
 *   smooth=true  → ハンドルをリンク（対称ミラー、スムーズ接続）
 *   smooth=false → ハンドルを独立（コーナー、別々に動く）
 *
 * 操作:
 *   ドラッグ          アンカー / ハンドルを移動
 *   ダブルクリック    曲線上に新規ノードを追加（De Casteljau 分割）
 *   Alt+クリック      中間ノードの smooth/corner 切替
 *   Delete/Backspace  選択中の中間ノードを削除
 *
 * Version: 0.4.0
 * Date: Sun Apr 19 09:31:46 JST 2026
 */

class CurveEditor {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {function(nodes: Array): void} onChange
     */
    constructor(canvas, onChange) {
        this.canvas   = canvas;
        this.ctx      = canvas.getContext('2d');
        this.onChange = onChange;

        this.nodes = [
            { anchor:{x:0,y:0}, handleIn:null,            handleOut:{x:0.42,y:0.00}, smooth:true },
            { anchor:{x:1,y:1}, handleIn:{x:0.58,y:1.00}, handleOut:null,             smooth:true },
        ];

        this._drag     = null;   // { type:'anchor'|'handleIn'|'handleOut', idx:number }
        this._selected = null;   // 選択中ノードインデックス

        this._setupResize();
        this._bindEvents();
    }

    // ── getter ───────────────────────────────────────────
    get selectedIndex() { return this._selected; }
    get selectedNode()  {
        return this._selected !== null ? this.nodes[this._selected] : null;
    }

    // ── レスポンシブキャンバス ─────────────────────────────
    _setupResize() {
        const sync = () => {
            const w = Math.floor(this.canvas.parentElement.clientWidth) - 2;
            if (w > 0 && this.canvas.width !== w) {
                this.canvas.width  = w;
                this.canvas.height = w;
                this.draw();
            }
        };
        new ResizeObserver(sync).observe(this.canvas.parentElement);
        sync();
    }

    // ── 座標変換 ──────────────────────────────────────────
    get size()  { return this.canvas.width; }
    get _pad()  { return Math.max(16, Math.floor(this.size * 0.085)); }

    toCanvas(bx, by) {
        const inner = this.size - this._pad * 2;
        return { cx: this._pad + bx * inner, cy: this._pad + (1 - by) * inner };
    }

    toBezier(cx, cy) {
        const inner = this.size - this._pad * 2;
        return { x: (cx - this._pad) / inner, y: 1 - (cy - this._pad) / inner };
    }

    // ── セグメント評価 ─────────────────────────────────────
    _evalSegment(a, b, t) {
        const P0 = a.anchor, P1 = a.handleOut, P2 = b.handleIn, P3 = b.anchor;
        const mt = 1 - t;
        return {
            x: mt*mt*mt*P0.x + 3*mt*mt*t*P1.x + 3*mt*t*t*P2.x + t*t*t*P3.x,
            y: mt*mt*mt*P0.y + 3*mt*mt*t*P1.y + 3*mt*t*t*P2.y + t*t*t*P3.y,
        };
    }

    // ── De Casteljau 分割 ──────────────────────────────────
    _splitAt(segIdx, t) {
        const a  = this.nodes[segIdx];
        const b  = this.nodes[segIdx + 1];
        const P0 = a.anchor, P1 = a.handleOut, P2 = b.handleIn, P3 = b.anchor;
        const lerp = (u, v, s) => ({ x: u.x+(v.x-u.x)*s, y: u.y+(v.y-u.y)*s });

        const Q1  = lerp(P0, P1, t);
        const Q2  = lerp(P1, P2, t);
        const Q3  = lerp(P2, P3, t);
        const R1  = lerp(Q1, Q2, t);
        const R2  = lerp(Q2, Q3, t);
        const mid = lerp(R1, R2, t);

        // 既存ノードのハンドルを更新（分割で短くなる）
        a.handleOut = Q1;
        b.handleIn  = Q3;

        // 新しい中間ノード（smooth=true で挿入）
        const newNode = { anchor: mid, handleIn: R1, handleOut: R2, smooth: true };
        this.nodes.splice(segIdx + 1, 0, newNode);
        this._selected = segIdx + 1;
    }

    _findClosest(bx, by) {
        let bestDist = Infinity, bestSeg = 0, bestT = 0.5;
        for (let i = 0; i < this.nodes.length - 1; i++) {
            const a = this.nodes[i], b = this.nodes[i+1];
            if (!a.handleOut || !b.handleIn) continue;
            for (let j = 0; j <= 60; j++) {
                const t = j / 60;
                const p = this._evalSegment(a, b, t);
                const d = Math.hypot(p.x - bx, p.y - by);
                if (d < bestDist) { bestDist = d; bestSeg = i; bestT = t; }
            }
        }
        return { segIdx: bestSeg, t: bestT };
    }

    // ── 描画 ──────────────────────────────────────────────
    draw() {
        const { ctx, size } = this;
        ctx.clearRect(0, 0, size, size);
        this._drawGrid();
        this._drawDiagonal();
        this._drawCurve();
        this._drawHandleLines();
        this._drawNodes();
    }

    _drawGrid() {
        const { ctx, size, _pad: p } = this;
        const inner = size - p * 2;
        ctx.strokeStyle = '#282828';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const v = p + i / 4 * inner;
            ctx.beginPath(); ctx.moveTo(v, p); ctx.lineTo(v, p + inner); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(p, v); ctx.lineTo(p + inner, v); ctx.stroke();
        }
    }

    _drawDiagonal() {
        const { ctx } = this;
        const p0 = this.toCanvas(0, 0), p3 = this.toCanvas(1, 1);
        ctx.strokeStyle = '#353535';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(p0.cx, p0.cy); ctx.lineTo(p3.cx, p3.cy); ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawCurve() {
        const { ctx, nodes } = this;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 2;
        ctx.beginPath();
        for (let i = 0; i < nodes.length - 1; i++) {
            const a = nodes[i], b = nodes[i+1];
            if (!a.handleOut || !b.handleIn) continue;
            const pa = this.toCanvas(a.anchor.x, a.anchor.y);
            const ho = this.toCanvas(a.handleOut.x, a.handleOut.y);
            const hi = this.toCanvas(b.handleIn.x, b.handleIn.y);
            const pb = this.toCanvas(b.anchor.x, b.anchor.y);
            if (i === 0) ctx.moveTo(pa.cx, pa.cy);
            ctx.bezierCurveTo(ho.cx, ho.cy, hi.cx, hi.cy, pb.cx, pb.cy);
        }
        ctx.stroke();
    }

    _drawHandleLines() {
        const { ctx, nodes } = this;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        for (let i = 0; i < nodes.length; i++) {
            const n  = nodes[i];
            const ac = this.toCanvas(n.anchor.x, n.anchor.y);
            if (n.handleOut) {
                const hoc = this.toCanvas(n.handleOut.x, n.handleOut.y);
                ctx.strokeStyle = 'rgba(232,160,32,0.55)';
                ctx.beginPath(); ctx.moveTo(ac.cx, ac.cy); ctx.lineTo(hoc.cx, hoc.cy); ctx.stroke();
            }
            if (n.handleIn) {
                const hic = this.toCanvas(n.handleIn.x, n.handleIn.y);
                ctx.strokeStyle = 'rgba(56,184,224,0.55)';
                ctx.beginPath(); ctx.moveTo(ac.cx, ac.cy); ctx.lineTo(hic.cx, hic.cy); ctx.stroke();
            }
        }
        ctx.setLineDash([]);
    }

    _drawNodes() {
        const { nodes } = this;
        for (let i = 0; i < nodes.length; i++) {
            const n          = nodes[i];
            const isStart    = i === 0;
            const isEnd      = i === nodes.length - 1;
            const isSelected = this._selected === i;

            if (n.handleOut) this._drawHandle(n.handleOut.x, n.handleOut.y, '#e8a020');
            if (n.handleIn)  this._drawHandle(n.handleIn.x,  n.handleIn.y,  '#38b8e0');

            if (isStart || isEnd) {
                this._drawAnchor(n.anchor.x, n.anchor.y, '#555555', isSelected, false);
            } else {
                // 中間ノード: smooth=true → 円、smooth=false → 四角
                this._drawAnchor(n.anchor.x, n.anchor.y, '#dddddd', isSelected, !n.smooth);
            }
        }
    }

    _drawHandle(bx, by, color) {
        const { ctx } = this;
        const r = Math.max(4, Math.floor(this.size * 0.025));
        const { cx, cy } = this.toCanvas(bx, by);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    /** @param {boolean} isCorner - true なら四角（コーナーノード） */
    _drawAnchor(bx, by, color, selected, isCorner) {
        const { ctx } = this;
        const r = Math.max(5, Math.floor(this.size * 0.028));
        const { cx, cy } = this.toCanvas(bx, by);
        ctx.beginPath();
        if (isCorner) {
            // 四角: コーナーノード
            ctx.rect(cx - r, cy - r, r * 2, r * 2);
        } else {
            // 円: スムーズノード / 端点
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.fillStyle   = selected ? '#ffffff' : color;
        ctx.fill();
        ctx.strokeStyle = selected ? '#1a9cd8' : '#888888';
        ctx.lineWidth   = selected ? 2 : 1;
        ctx.stroke();
    }

    // ── ヒットテスト ──────────────────────────────────────
    _hitTest(cx, cy) {
        const r = Math.max(10, Math.floor(this.size * 0.055));
        for (let i = 0; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            const check = (pt, type) => {
                if (!pt) return null;
                const p = this.toCanvas(pt.x, pt.y);
                return Math.hypot(cx - p.cx, cy - p.cy) < r ? { type, idx: i } : null;
            };
            const hIn  = check(n.handleIn,  'handleIn');
            const hOut = check(n.handleOut, 'handleOut');
            const anch = check(n.anchor,    'anchor');
            if (hIn)  return hIn;
            if (hOut) return hOut;
            if (anch) return anch;
        }
        return null;
    }

    // ── イベント ──────────────────────────────────────────
    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('dblclick',  (e) => this._onDblClick(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup',   ()  => this._onMouseUp());
        window.addEventListener('keydown',   (e) => this._onKeyDown(e));
    }

    _getPos(e) {
        const rect   = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width  / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            cx: (e.clientX - rect.left) * scaleX,
            cy: (e.clientY - rect.top)  * scaleY,
        };
    }

    _onMouseDown(e) {
        if (e.detail >= 2) return; // dblclick は別処理
        const { cx, cy } = this._getPos(e);
        const hit = this._hitTest(cx, cy);

        // Alt+クリック: 中間ノードの smooth/corner を切替
        if (e.altKey && hit && hit.type === 'anchor') {
            const { idx } = hit;
            if (idx > 0 && idx < this.nodes.length - 1) {
                this.nodes[idx].smooth = !this.nodes[idx].smooth;
                this._selected = idx;
                this.draw();
                this._notifyChange();
            }
            return;
        }

        const prevSel  = this._selected;
        this._drag     = hit;
        this._selected = hit ? hit.idx : null;
        this.draw();
        if (hit) e.preventDefault();
        // 選択変化でも onChange を発火して UI を更新
        if (prevSel !== this._selected) this._notifyChange();
    }

    _onDblClick(e) {
        const { cx, cy } = this._getPos(e);
        if (this._hitTest(cx, cy)) return; // 既存ノードならスキップ
        const bz = this.toBezier(cx, cy);
        const { segIdx, t } = this._findClosest(bz.x, bz.y);
        this._splitAt(segIdx, t);
        this.draw();
        this._notifyChange();
    }

    _onMouseMove(e) {
        if (!this._drag) return;
        const { cx, cy } = this._getPos(e);
        const bz = this.toBezier(cx, cy);
        const { type, idx } = this._drag;
        const node        = this.nodes[idx];
        const isFirst     = idx === 0;
        const isLast      = idx === this.nodes.length - 1;
        // 隣接アンカーの X 境界（ハンドルが時間軸をまたがないよう制限）
        const prevAnchorX = !isFirst ? this.nodes[idx - 1].anchor.x : 0;
        const nextAnchorX = !isLast  ? this.nodes[idx + 1].anchor.x : 1;

        if (type === 'anchor' && !isFirst && !isLast) {
            const minX = prevAnchorX + 0.01;
            const maxX = nextAnchorX - 0.01;
            const newX = Math.max(minX, Math.min(maxX, bz.x));
            const dx   = newX - node.anchor.x;
            const dy   = bz.y - node.anchor.y;
            node.anchor.x += dx;
            node.anchor.y  = Math.max(-0.5, Math.min(1.5, bz.y));
            if (node.handleIn)  { node.handleIn.x  += dx; node.handleIn.y  += dy; }
            if (node.handleOut) { node.handleOut.x += dx; node.handleOut.y += dy; }

        } else if (type === 'handleOut' && node.handleOut) {
            if (node.smooth && node.handleIn) {
                // スムーズ: 対称ミラー（X は隣接アンカー境界内に制限）
                const ox = Math.max(node.anchor.x, Math.min(nextAnchorX, bz.x));
                const oy = Math.max(-0.5, Math.min(1.5, bz.y));
                node.handleOut.x = ox;
                node.handleOut.y = oy;
                const vx = ox - node.anchor.x;
                const vy = oy - node.anchor.y;
                node.handleIn.x = Math.max(prevAnchorX, node.anchor.x - vx);
                node.handleIn.y = Math.max(-0.5, Math.min(1.5, node.anchor.y - vy));
            } else {
                // コーナー: 独立
                node.handleOut.x = Math.max(node.anchor.x, Math.min(nextAnchorX, bz.x));
                node.handleOut.y = Math.max(-0.5, Math.min(1.5, bz.y));
            }

        } else if (type === 'handleIn' && node.handleIn) {
            if (node.smooth && node.handleOut) {
                // スムーズ: 対称ミラー
                const ix = Math.max(prevAnchorX, Math.min(node.anchor.x, bz.x));
                const iy = Math.max(-0.5, Math.min(1.5, bz.y));
                node.handleIn.x = ix;
                node.handleIn.y = iy;
                const vx = ix - node.anchor.x;
                const vy = iy - node.anchor.y;
                node.handleOut.x = Math.min(nextAnchorX, node.anchor.x - vx);
                node.handleOut.y = Math.max(-0.5, Math.min(1.5, node.anchor.y - vy));
            } else {
                // コーナー: 独立
                node.handleIn.x = Math.max(prevAnchorX, Math.min(node.anchor.x, bz.x));
                node.handleIn.y = Math.max(-0.5, Math.min(1.5, bz.y));
            }
        }

        this.draw();
        this._notifyChange();
    }

    _onMouseUp() { this._drag = null; }

    _onKeyDown(e) {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        this.deleteSelected();
    }

    // ── 外部 API ──────────────────────────────────────────
    /** 選択中の中間ノードを削除（main.js の削除ボタンからも呼べる） */
    deleteSelected() {
        const idx = this._selected;
        if (idx === null || idx === 0 || idx === this.nodes.length - 1) return;
        this.nodes.splice(idx, 1);
        this._selected = null;
        this.draw();
        this._notifyChange();
    }

    /** 選択中の中間ノードの smooth を切替（main.js のボタンからも呼べる） */
    toggleSmooth(forceSmooth) {
        const node = this.selectedNode;
        if (!node) return;
        const idx = this._selected;
        if (idx === 0 || idx === this.nodes.length - 1) return;
        node.smooth = forceSmooth !== undefined ? forceSmooth : !node.smooth;
        this.draw();
        this._notifyChange();
    }

    /** 選択中の中間ノードの座標を数値で設定（数値入力欄からの精密入力用） */
    setSelectedNodeCoords({ anchorX, anchorY, outY, inY } = {}) {
        const idx = this._selected;
        if (idx === null || idx === 0 || idx === this.nodes.length - 1) return;
        const node        = this.nodes[idx];
        const prevAnchorX = this.nodes[idx - 1].anchor.x;
        const nextAnchorX = this.nodes[idx + 1].anchor.x;

        if (anchorX !== undefined && !isNaN(anchorX)) {
            const newX = Math.max(prevAnchorX + 0.01, Math.min(nextAnchorX - 0.01, anchorX));
            const dx   = newX - node.anchor.x;
            node.anchor.x = newX;
            if (node.handleIn)  node.handleIn.x  = Math.max(prevAnchorX, Math.min(newX, node.handleIn.x  + dx));
            if (node.handleOut) node.handleOut.x = Math.min(nextAnchorX, Math.max(newX, node.handleOut.x + dx));
        }
        if (anchorY !== undefined && !isNaN(anchorY)) {
            const newY = Math.max(-0.5, Math.min(1.5, anchorY));
            const dy   = newY - node.anchor.y;
            node.anchor.y = newY;
            if (node.handleIn)  node.handleIn.y  += dy;
            if (node.handleOut) node.handleOut.y += dy;
        }
        if (outY !== undefined && !isNaN(outY) && node.handleOut) {
            node.handleOut.y = Math.max(-0.5, Math.min(1.5, outY));
            if (node.smooth && node.handleIn) {
                const vy = node.handleOut.y - node.anchor.y;
                node.handleIn.y = Math.max(-0.5, Math.min(1.5, node.anchor.y - vy));
            }
        }
        if (inY !== undefined && !isNaN(inY) && node.handleIn) {
            node.handleIn.y = Math.max(-0.5, Math.min(1.5, inY));
            if (node.smooth && node.handleOut) {
                const vy = node.handleIn.y - node.anchor.y;
                node.handleOut.y = Math.max(-0.5, Math.min(1.5, node.anchor.y - vy));
            }
        }
        this.draw();
        this._notifyChange();
    }

    setNodes(nodes) {
        this.nodes     = nodes;
        this._selected = null;
        this.draw();
        this._notifyChange();
    }

    setValues(p1x, p1y, p2x, p2y) {
        this.nodes = [
            { anchor:{x:0,y:0}, handleIn:null,            handleOut:{x:p1x,y:p1y}, smooth:true },
            { anchor:{x:1,y:1}, handleIn:{x:p2x,y:p2y},   handleOut:null,          smooth:true },
        ];
        this._selected = null;
        this.draw();
        this._notifyChange();
    }

    get p1() { return this.nodes[0].handleOut || {x:0.42, y:0}; }
    get p2() { return this.nodes[this.nodes.length-1].handleIn || {x:0.58, y:1}; }

    _notifyChange() { this.onChange(this.nodes); }
}
