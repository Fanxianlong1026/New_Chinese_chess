// ============================================================================
// render.js — Canvas 渲染层（水墨 + 霓虹 · 东方战棋）
// ============================================================================
import { COLS, ROWS, PIECE_TYPES, PALACE, ALTARS, isCamp, isRift, isEnergyFlow } from './data.js';

const MARGIN = 40;
const CELL = 48;

const COLORS = {
  bgA: '#0c1018', bgB: '#141b27',
  grid: 'rgba(120,150,180,0.18)',
  gridStrong: 'rgba(150,190,220,0.30)',
  label: 'rgba(180,205,225,0.55)',
  red: '#e74c3c', redGlow: 'rgba(231,76,60,0.55)', redInk: '#2a0e0c',
  black: '#7c6cff', blackGlow: 'rgba(124,108,255,0.55)', blackInk: '#12102a',
  rift: '#b46bff', flow: '#27e6c8', camp: 'rgba(255,196,120,0.10)',
  altar: 'rgba(255,211,77,0.22)',
  mud: 'rgba(120,86,52,0.55)', wind: 'rgba(120,230,160,0.30)', crater: 'rgba(30,20,30,0.7)',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = MARGIN * 2 + COLS * CELL;
    this.H = MARGIN * 2 + ROWS * CELL;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = this.W * dpr;
    canvas.height = this.H * dpr;
    canvas.style.width = this.W + 'px';
    canvas.style.height = this.H + 'px';
    this.ctx.scale(dpr, dpr);
  }

  // 屏幕 -> 格子（红方 row0 在下方）
  pick(px, py) {
    const c = Math.floor((px - MARGIN) / CELL);
    const rFromTop = Math.floor((py - MARGIN) / CELL);
    const r = ROWS - 1 - rFromTop;
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return { col: c, row: r };
  }
  cx(col) { return MARGIN + col * CELL + CELL / 2; }
  cy(row) { return MARGIN + (ROWS - 1 - row) * CELL + CELL / 2; }

  draw(game, view = {}) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this._bg();
    this._terrain(game);
    this._grid();
    this._palaces();
    this._river();
    this._marks(game);
    this._highlights(game, view);
    this._pieces(game, view);
    this._effects(view.effects || []);
    this._labels();
  }

  _marks(game) {
    const ctx = this.ctx;
    for (const m of (game.marks || [])) {
      const x = this.cx(m.col), y = this.cy(m.row);
      ctx.save();
      ctx.strokeStyle = '#ff5b5b'; ctx.fillStyle = 'rgba(255,91,91,0.12)';
      ctx.shadowColor = '#ff5b5b'; ctx.shadowBlur = 14; ctx.lineWidth = 2;
      const { x: rx, y: ry } = this._cellRect(m.col, m.row);
      ctx.fillRect(rx, ry, CELL, CELL);
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.34, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - CELL * 0.28, y); ctx.lineTo(x + CELL * 0.28, y);
      ctx.moveTo(x, y - CELL * 0.28); ctx.lineTo(x, y + CELL * 0.28); ctx.stroke();
      ctx.restore();
    }
  }

  _bg() {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, this.W, this.H);
    g.addColorStop(0, COLORS.bgA); g.addColorStop(1, COLORS.bgB);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.W, this.H);
  }

  _cellRect(c, r) {
    return { x: MARGIN + c * CELL, y: MARGIN + (ROWS - 1 - r) * CELL, w: CELL, h: CELL };
  }

  _terrain(game) {
    const ctx = this.ctx;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const { x, y } = this._cellRect(c, r);
      const altarOwner = this._altarOwner(c, r);
      if (altarOwner) this._altar(c, r, altarOwner, !!game.altarUsed?.[altarOwner]);
      // 军营底色
      if (isCamp('r', r)) { ctx.fillStyle = 'rgba(231,76,60,0.05)'; ctx.fillRect(x, y, CELL, CELL); }
      if (isCamp('b', r)) { ctx.fillStyle = 'rgba(124,108,255,0.05)'; ctx.fillRect(x, y, CELL, CELL); }
      const ov = game.terrainAt(c, r);
      if (ov === 'mud') this._fillCell(c, r, COLORS.mud);
      else if (ov === 'wind') this._fillCell(c, r, COLORS.wind);
      else if (ov === 'crater') this._fillCell(c, r, COLORS.crater);
      // 能量洪流
      if (isEnergyFlow(c, r)) this._glowCell(c, r, COLORS.flow, 0.22);
      // 时空裂隙
      if (isRift(c, r)) this._rift(c, r);
    }
  }
  _fillCell(c, r, color) {
    const { x, y } = this._cellRect(c, r);
    this.ctx.fillStyle = color; this.ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }
  _glowCell(c, r, color, alpha) {
    const ctx = this.ctx; const x = this.cx(c), y = this.cy(r);
    const g = ctx.createRadialGradient(x, y, 2, x, y, CELL * 0.75);
    g.addColorStop(0, color); g.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.fillRect(...Object.values(this._cellRect(c, r)).slice(0, 2), CELL, CELL); ctx.restore();
  }
  _rift(c, r) {
    const ctx = this.ctx, x = this.cx(c), y = this.cy(r);
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 1, x, y, CELL * 0.55);
    g.addColorStop(0, 'rgba(180,107,255,0.5)'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, CELL * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.rift; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(x, y, 6 + i * 6, i, i + Math.PI * 1.4); ctx.stroke();
    }
    ctx.restore();
  }

  _altarOwner(c, r) {
    for (const owner of ['r', 'b']) {
      if (ALTARS[owner].some(a => a.col === c && a.row === r)) return owner;
    }
    return null;
  }
  _altar(c, r, owner, used) {
    const ctx = this.ctx, x = this.cx(c), y = this.cy(r);
    ctx.save();
    ctx.globalAlpha = used ? 0.28 : 1;
    this._fillCell(c, r, COLORS.altar);
    ctx.strokeStyle = owner === 'r' ? COLORS.red : COLORS.black;
    ctx.fillStyle = '#ffd34d';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ffd34d';
    ctx.shadowBlur = used ? 0 : 10;
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '700 18px "Noto Serif SC", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('A', x, y + 1);
    ctx.restore();
  }

  _grid() {
    const ctx = this.ctx; ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      const x = MARGIN + c * CELL;
      ctx.beginPath(); ctx.moveTo(x, MARGIN); ctx.lineTo(x, MARGIN + ROWS * CELL); ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      const y = MARGIN + r * CELL;
      ctx.beginPath(); ctx.moveTo(MARGIN, y); ctx.lineTo(MARGIN + COLS * CELL, y); ctx.stroke();
    }
    ctx.strokeStyle = COLORS.gridStrong; ctx.lineWidth = 2;
    ctx.strokeRect(MARGIN, MARGIN, COLS * CELL, ROWS * CELL);
  }

  _palaces() {
    const ctx = this.ctx; ctx.strokeStyle = 'rgba(180,205,225,0.35)'; ctx.lineWidth = 1.5;
    for (const owner of ['r', 'b']) {
      const pa = PALACE[owner];
      const x0 = MARGIN + pa.cols[0] * CELL, x1 = MARGIN + (pa.cols[1] + 1) * CELL;
      const topRow = ROWS - 1 - pa.rows[1], botRow = ROWS - 1 - pa.rows[0];
      const y0 = MARGIN + topRow * CELL, y1 = MARGIN + (botRow + 1) * CELL;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1, y0); ctx.lineTo(x0, y1); ctx.stroke();
    }
  }

  _river() {
    const ctx = this.ctx;
    const y = MARGIN + 7 * CELL; // row6/row7 boundary
    ctx.save();
    const g = ctx.createLinearGradient(0, y - CELL, 0, y + CELL);
    g.addColorStop(0, 'transparent'); g.addColorStop(0.5, 'rgba(39,230,200,0.10)'); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(MARGIN, y - CELL, COLS * CELL, CELL * 2);
    ctx.fillStyle = 'rgba(39,230,200,0.5)';
    ctx.font = '600 20px "Noto Serif SC", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('能 量 长 河', MARGIN + COLS * CELL * 0.28, y);
    ctx.fillText('战 棋 之 界', MARGIN + COLS * CELL * 0.72, y);
    ctx.restore();
  }

  _highlights(game, view) {
    const ctx = this.ctx;
    // 技能目标
    for (const t of (view.targets || [])) this._ringCell(t.col, t.row, '#ffd34d', 0.9);
    // 选中
    if (view.selected) {
      const x = this.cx(view.selected.col), y = this.cy(view.selected.row);
      ctx.save(); ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3;
      ctx.shadowColor = '#ffe08a'; ctx.shadowBlur = 12;
      ctx.strokeRect(MARGIN + view.selected.col * CELL + 3,
        MARGIN + (ROWS - 1 - view.selected.row) * CELL + 3, CELL - 6, CELL - 6);
      ctx.restore();
    }
    // 合法走法
    for (const m of (view.moves || [])) {
      const x = this.cx(m.col), y = this.cy(m.row);
      ctx.save();
      if (m.kind === 'attack') {
        ctx.strokeStyle = '#ff5b5b'; ctx.lineWidth = 3; ctx.shadowColor = '#ff5b5b'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2); ctx.stroke();
      } else if (m.kind === 'teleport') {
        ctx.strokeStyle = '#b46bff'; ctx.lineWidth = 3; ctx.shadowColor = '#b46bff'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(x, y, CELL * 0.40, 0.3, 0.3 + Math.PI * 1.6); ctx.stroke();
        ctx.fillStyle = '#b46bff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
      } else if (m.kind === 'altar') {
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3; ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(x, y, CELL * 0.38, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,211,77,0.9)';
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(80,230,170,0.85)'; ctx.shadowColor = '#27e6c8'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  _ringCell(c, r, color, alpha) {
    const ctx = this.ctx, x = this.cx(c), y = this.cy(r);
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  _pieces(game, view) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const stack = game.board[r][c];
      if (!stack.length) continue;
      if (stack.length === 2) {
        this._disc(game, stack[0], c, r, { off: [-7, 7], scale: 0.82, dim: true }); // 被压制者
        this._disc(game, stack[1], c, r, { off: [6, -6], scale: 1, badge: '压' });   // 压制者
      } else {
        this._disc(game, stack[0], c, r, { off: [0, 0], scale: 1 });
      }
    }
  }

  _disc(game, p, c, r, opt) {
    const ctx = this.ctx;
    const x = this.cx(c) + opt.off[0], y = this.cy(r) + opt.off[1];
    const rad = CELL * 0.40 * (opt.scale || 1);
    const isRed = p.owner === 'r';
    const main = isRed ? COLORS.red : COLORS.black;
    const glow = isRed ? COLORS.redGlow : COLORS.blackGlow;
    const ink = isRed ? COLORS.redInk : COLORS.blackInk;

    ctx.save();
    if (opt.dim) ctx.globalAlpha = 0.78;
    // 光晕
    ctx.shadowColor = glow; ctx.shadowBlur = 14;
    const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.2, x, y, rad);
    g.addColorStop(0, '#1c2430'); g.addColorStop(1, ink);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // 外环
    ctx.lineWidth = 2.5; ctx.strokeStyle = main;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    // 能量环（金色弧）
    const ratio = Math.min(1, p.energy / p.energyCap);
    if (ratio > 0) {
      ctx.lineWidth = 3; ctx.strokeStyle = ratio >= 1 ? '#ffd34d' : 'rgba(255,211,77,0.7)';
      if (ratio >= 1) { ctx.shadowColor = '#ffd34d'; ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.arc(x, y, rad + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    // 字
    ctx.fillStyle = main;
    ctx.font = `700 ${Math.round(rad * 1.05)}px "Ma Shan Zheng","Noto Serif SC",serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(game.pieceName(p), x, y + 1);

    // HP 条
    const bw = rad * 1.6, bh = 4, bx = x - bw / 2, by = y + rad + 3;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
    const hpR = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = hpR > 0.5 ? '#5bd97a' : hpR > 0.25 ? '#ffd34d' : '#ff5b5b';
    ctx.fillRect(bx, by, bw * hpR, bh);
    // 状态点：临时护甲/激昂/震慑
    let sx = bx;
    const dot = (col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx + 3, by + bh + 6, 3, 0, Math.PI * 2); ctx.fill(); sx += 9; };
    if (p.tempArmor > 0) dot('#7fd0ff');
    if (p.buffs.inspired) dot('#ff9f43');
    if (p.flags.moveDebuff) dot('#b46bff');
    if (p.flags.tremor) dot('#ffffff');
    if (game.isInvincible && game.isInvincible(p)) dot('#ffd34d');
    if (game.isUntargetable && game.isUntargetable(p)) dot('#27e6c8');
    if (game.heavyWounded(p)) dot('#ff5b5b');
    // 压制者徽标
    if (opt.badge) {
      ctx.fillStyle = '#ffd34d'; ctx.font = '700 11px "Noto Sans SC",sans-serif';
      ctx.fillText(opt.badge, x + rad - 2, y - rad + 2);
    }
    ctx.restore();
  }

  _effects(effects) {
    if (!effects.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const fx of effects) {
      const t = Math.max(0, Math.min(1, (now - fx.started) / fx.duration));
      const alpha = Math.sin((1 - t) * Math.PI / 2);
      const caster = fx.caster;
      const target = fx.target || caster;
      const color = this._fxColor(fx);
      if (fx.targetType === 'region') this._regionFx(target, color, alpha, t);
      if (fx.target && (fx.target.col !== caster.col || fx.target.row !== caster.row)) this._beamFx(caster, target, color, alpha, t);
      if (fx.id === 'c_orbital') this._crossFx(target, color, alpha, t);
      if (!fx.target && fx.tier === 'ult') this._boardPulseFx(color, alpha, t);
      this._burstFx(target, color, alpha, t, fx.tier);
    }
  }

  _fxColor(fx) {
    if (fx.tier === 'ult') return '#ffd34d';
    if (fx.tier === 'small') return '#b46bff';
    return fx.caster.owner === 'r' ? '#ff6b5c' : '#8b7bff';
  }

  _beamFx(from, to, color, alpha, t) {
    const ctx = this.ctx;
    const x1 = this.cx(from.col), y1 = this.cy(from.row);
    const x2 = this.cx(to.col), y2 = this.cy(to.row);
    const mx = x1 + (x2 - x1) * Math.min(1, t * 1.45);
    const my = y1 + (y2 - y1) * Math.min(1, t * 1.45);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3 + (1 - t) * 5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(mx, my);
    ctx.stroke();
    ctx.restore();
  }

  _burstFx(cell, color, alpha, t, tier) {
    const ctx = this.ctx;
    const x = this.cx(cell.col), y = this.cy(cell.row);
    const maxR = tier === 'ult' ? CELL * 1.75 : tier === 'small' ? CELL * 1.25 : CELL * 0.85;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    for (let i = 0; i < 3; i++) {
      const r = maxR * Math.max(0, t - i * 0.16);
      if (r <= 0) continue;
      ctx.lineWidth = Math.max(1, 5 - i);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.35 * (1 - t * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _regionFx(cell, color, alpha, t) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha * 0.7;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const c = cell.col + dc, r = cell.row + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const rect = this._cellRect(c, r);
      ctx.globalAlpha = alpha * (0.12 + 0.18 * Math.sin((t + 0.2) * Math.PI));
      ctx.fillRect(rect.x + 2, rect.y + 2, CELL - 4, CELL - 4);
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeRect(rect.x + 4, rect.y + 4, CELL - 8, CELL - 8);
    }
    ctx.restore();
  }

  _crossFx(cell, color, alpha, t) {
    const ctx = this.ctx;
    const x = this.cx(cell.col), y = this.cy(cell.row);
    const len = CELL * (1.2 + t * 2.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
    ctx.stroke();
    ctx.restore();
  }

  _boardPulseFx(color, alpha, t) {
    const ctx = this.ctx;
    const cx = MARGIN + COLS * CELL / 2;
    const cy = MARGIN + ROWS * CELL / 2;
    const r = Math.max(COLS, ROWS) * CELL * (0.2 + t * 0.65);
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.save();
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = g;
    ctx.fillRect(MARGIN, MARGIN, COLS * CELL, ROWS * CELL);
    ctx.restore();
  }

  _labels() {
    const ctx = this.ctx; ctx.fillStyle = COLORS.label;
    ctx.font = '11px "Noto Sans SC",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const letters = 'ABCDEFGHIJKLMNOP';
    for (let c = 0; c < COLS; c++) {
      ctx.fillText(letters[c], this.cx(c), MARGIN - 18);
      ctx.fillText(letters[c], this.cx(c), MARGIN + ROWS * CELL + 18);
    }
    for (let r = 0; r < ROWS; r++) {
      ctx.fillText(this._rowLabel(r), MARGIN - 20, this.cy(r));
      ctx.fillText(this._rowLabel(r), MARGIN + COLS * CELL + 20, this.cy(r));
    }
  }
  _rowLabel(r) {
    if (r === 0) return '0';
    if (r === ROWS - 1) return '13';
    return String(r);
  }
}
