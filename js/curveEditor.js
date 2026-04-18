/**
 * curveEditor.js
 * canvas ベースの cubic-bezier インタラクティブエディタ
 * P0=(0,0) 左下, P3=(1,1) 右上。Y 軸はスクリーン座標と逆向き。
 *
 * Version: 0.1.0
 * Date: Sun Apr 19 08:42:43 JST 2026
 */

class CurveEditor {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {function({p1x, p1y, p2x, p2y}): void} onChange
     */
    constructor(canvas, onChange) {
        this.canvas  = canvas;
        this.ctx     = canvas.getContext('2d');
        this.onChange = onChange;

        this.p1 = { x: 0.42, y: 0.00 };
        this.p2 = { x: 0.58, y: 1.00 };

        this._drag = null; // 'p1' | 'p2' | null

        this._bindEvents();
        this.draw();
    }

    // ── 座標変換 ─────────────────────────────────────────
    get size() { return this.canvas.width; }

    // ベジェ座標 → canvas ピクセル
    toCanvas(bx, by) {
        const pad = 20; // 余白
        const inner = this.size - pad * 2;
        return {
            cx: pad + bx * inner,
            cy: pad + (1 - by) * inner,
        };
    }

    // canvas ピクセル → ベジェ座標
    toBezier(cx, cy) {
        const pad = 20;
        const inner = this.size - pad * 2;
        return {
            x: (cx - pad) / inner,
            y: 1 - (cy - pad) / inner,
        };
    }

    // ── 描画 ──────────────────────────────────────────────
    draw() {
        const { ctx, size } = this;
        ctx.clearRect(0, 0, size, size);

        this._drawGrid();
        this._drawDiagonal();
        this._drawCurve();
        this._drawHandleLines();
        this._drawHandles();
    }

    _drawGrid() {
        const { ctx, size } = this;
        ctx.strokeStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--grid').trim() || '#2a2a2a';
        ctx.lineWidth = 0.5;
        const pad = 20;
        const inner = size - pad * 2;
        for (let i = 0; i <= 4; i++) {
            const t = i / 4;
            const x = pad + t * inner;
            const y = pad + t * inner;
            ctx.beginPath();
            ctx.moveTo(x, pad);
            ctx.lineTo(x, pad + inner);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(pad + inner, y);
            ctx.stroke();
        }
    }

    _drawDiagonal() {
        const { ctx } = this;
        const p0 = this.toCanvas(0, 0);
        const p3 = this.toCanvas(1, 1);
        ctx.strokeStyle = getComputedStyle(document.documentElement)
            .getPropertyValue('--diagonal').trim() || '#383838';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(p0.cx, p0.cy);
        ctx.lineTo(p3.cx, p3.cy);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    _drawCurve() {
        const { ctx, p1, p2 } = this;
        const pts = CubicBezier.samplePoints(p1.x, p1.y, p2.x, p2.y, 80);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        pts.forEach((pt, i) => {
            const { cx, cy } = this.toCanvas(pt.x, pt.y);
            i === 0 ? ctx.moveTo(cx, cy) : ctx.lineTo(cx, cy);
        });
        ctx.stroke();
    }

    _drawHandleLines() {
        const { ctx } = this;
        const p0c = this.toCanvas(0, 0);
        const p1c = this.toCanvas(this.p1.x, this.p1.y);
        const p3c = this.toCanvas(1, 1);
        const p2c = this.toCanvas(this.p2.x, this.p2.y);

        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);

        // P0 → P1 ライン (オレンジ)
        ctx.strokeStyle = 'rgba(232, 160, 32, 0.6)';
        ctx.beginPath();
        ctx.moveTo(p0c.cx, p0c.cy);
        ctx.lineTo(p1c.cx, p1c.cy);
        ctx.stroke();

        // P3 → P2 ライン (シアン)
        ctx.strokeStyle = 'rgba(56, 184, 224, 0.6)';
        ctx.beginPath();
        ctx.moveTo(p3c.cx, p3c.cy);
        ctx.lineTo(p2c.cx, p2c.cy);
        ctx.stroke();

        ctx.setLineDash([]);
    }

    _drawHandles() {
        const RADIUS = 6;
        this._drawHandle(this.p1.x, this.p1.y, '#e8a020', RADIUS); // P1: オレンジ
        this._drawHandle(this.p2.x, this.p2.y, '#38b8e0', RADIUS); // P2: シアン
        // アンカー点
        this._drawAnchor(0, 0);
        this._drawAnchor(1, 1);
    }

    _drawHandle(bx, by, color, r) {
        const { ctx } = this;
        const { cx, cy } = this.toCanvas(bx, by);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    _drawAnchor(bx, by) {
        const { ctx } = this;
        const { cx, cy } = this.toCanvas(bx, by);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#555555';
        ctx.fill();
        ctx.strokeStyle = '#888888';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ── マウスイベント ────────────────────────────────────
    _bindEvents() {
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        window.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup',   ()  => this._onMouseUp());
    }

    _getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
    }

    _hitTest(cx, cy) {
        const HIT_R = 10;
        const p1c = this.toCanvas(this.p1.x, this.p1.y);
        const p2c = this.toCanvas(this.p2.x, this.p2.y);
        if (Math.hypot(cx - p1c.cx, cy - p1c.cy) < HIT_R) return 'p1';
        if (Math.hypot(cx - p2c.cx, cy - p2c.cy) < HIT_R) return 'p2';
        return null;
    }

    _onMouseDown(e) {
        const { cx, cy } = this._getPos(e);
        this._drag = this._hitTest(cx, cy);
        if (this._drag) e.preventDefault();
    }

    _onMouseMove(e) {
        if (!this._drag) return;
        const { cx, cy } = this._getPos(e);
        const bz = this.toBezier(cx, cy);
        // X は [0, 1] にクランプ。Y はオーバーシュート許容で [-0.5, 1.5]
        bz.x = Math.max(0, Math.min(1, bz.x));
        bz.y = Math.max(-0.5, Math.min(1.5, bz.y));
        this[this._drag] = { x: bz.x, y: bz.y };
        this.draw();
        this.onChange({ p1x: this.p1.x, p1y: this.p1.y, p2x: this.p2.x, p2y: this.p2.y });
    }

    _onMouseUp() {
        this._drag = null;
    }

    // ── 外部からの値設定 ─────────────────────────────────
    setValues(p1x, p1y, p2x, p2y) {
        this.p1 = { x: p1x, y: p1y };
        this.p2 = { x: p2x, y: p2y };
        this.draw();
    }
}
