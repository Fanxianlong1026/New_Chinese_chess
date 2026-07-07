// ============================================================================
// main.js — 交互入口：选子、移动/攻击、技能释放、面板与弹窗
// ============================================================================
import { Game } from './engine.js';
import { Renderer } from './render.js';
import { SKILLS, TIER_LABEL, PIECE_TYPES } from './data.js';

const game = new Game();
const canvas = document.getElementById('board');
const renderer = new Renderer(canvas);

const state = {
  selected: null,                 // 选中的棋子
  moves: [],                      // 当前合法走法
  mode: 'idle',                   // 'idle' | 'move' | 'skillTarget'
  skillId: null,
  skillVariant: null,             // 领域改写：'mud' | 'wind'
  targets: [],                    // 技能可选目标
  effects: [],
  raf: null,
};

const $ = (id) => document.getElementById(id);

function render() {
  renderer.draw(game, {
    selected: state.selected ? { col: state.selected.col, row: state.selected.row } : null,
    moves: state.mode === 'move' ? state.moves : [],
    targets: state.mode === 'skillTarget' ? state.targets : [],
    effects: state.effects,
  });
  renderBanner();
  renderSelPanel();
  renderSkills();
  renderLog();
}

function renderBanner() {
  const side = game.current === 'r' ? '红方' : '黑方';
  $('turn-side').textContent = side;
  $('turn-side').className = 'side-tag ' + (game.current === 'r' ? 'red' : 'black');
  $('turn-num').textContent = '回合 ' + game.turn;
  const rk = game.king('r'), bk = game.king('b');
  $('hp-red').textContent = rk ? rk.hp : 0;
  $('hp-black').textContent = bk ? bk.hp : 0;
}

function statusTags(p) {
  const t = [];
  if (game.heavyWounded(p)) t.push('<span class="tag wound">重伤</span>');
  if (p.tempArmor > 0) t.push(`<span class="tag armor">护甲+${p.tempArmor}</span>`);
  if (p.buffs.inspired) t.push('<span class="tag insp">激昂</span>');
  if (p.flags.moveDebuff) t.push('<span class="tag debuff">震慑</span>');
  if (p.flags.tremor) t.push('<span class="tag debuff">震颤</span>');
  if (game.isInvincible(p)) t.push('<span class="tag insp">无敌</span>');
  if (game.isUntargetable(p)) t.push('<span class="tag armor">隐匿</span>');
  if (p.flags.calibrate) t.push('<span class="tag insp">校准</span>');
  if (p.flags.ignoreLeg) t.push('<span class="tag insp">轻骑</span>');
  if (p.flags.swiftKing) t.push('<span class="tag insp">急令</span>');
  if (p.flags.phaseMove) t.push('<span class="tag armor">穿行</span>');
  if (game.isSuppressed(p)) t.push('<span class="tag debuff">被压制</span>');
  if (game.isTopOfStack(p)) t.push('<span class="tag insp">压制中</span>');
  if (p.crossed) t.push('<span class="tag">已过河</span>');
  return t.join('');
}

function renderSelPanel() {
  const el = $('sel-panel');
  const p = state.selected;
  if (!p) { el.innerHTML = '<div class="muted">点击己方棋子查看详情并行动</div>'; return; }
  const def = PIECE_TYPES[p.type];
  const letters = 'ABCDEFGHIJKLMNOP';
  el.innerHTML = `
    <div class="sel-head">
      <span class="glyph ${p.owner}">${game.pieceName(p)}</span>
      <div>
        <div class="sel-name">${game.pieceName(p)} · ${letters[p.col]}${p.row + 1}</div>
        <div class="sel-tags">${statusTags(p) || '<span class="muted">无状态</span>'}</div>
      </div>
    </div>
    <div class="stat-grid">
      <div><b>HP</b><div class="bar"><i style="width:${Math.max(0, p.hp / p.maxHp * 100)}%"></i></div><span>${p.hp}/${p.maxHp}</span></div>
      <div><b>能量</b><div class="bar e"><i style="width:${p.energy / p.energyCap * 100}%"></i></div><span>${p.energy}/${p.energyCap}</span></div>
      <div class="kv"><b>攻击</b><span>${game.effAtk(p)}</span></div>
      <div class="kv"><b>护甲</b><span>${game.effDef(p)}</span></div>
    </div>`;
}

function renderSkills() {
  const el = $('skill-list');
  const p = state.selected;
  if (!p || p.owner !== game.current) { el.innerHTML = '<div class="muted">选中己方棋子以查看技能</div>'; return; }
  const defs = SKILLS[p.type] || [];
  el.innerHTML = defs.map(s => {
    const chk = game.canUseSkill(p, s.id);
    const cd = p.cooldowns[s.id] || 0;
    const usedGlobal = s.global ? (game.globalSkills[p.owner][s.id] || 0) : 0;
    const meta = [
      `<span class="t-${s.tier}">${TIER_LABEL[s.tier]}</span>`,
      `<span class="cost">${s.cost}能</span>`,
      s.cd ? `<span class="cd">CD${s.cd}${cd ? ` · 剩${cd}` : ''}</span>` : '',
      s.global ? `<span class="cd">全局${usedGlobal}/${s.global}</span>` : '',
      s.impl ? '' : '<span class="soon">即将开放</span>',
    ].filter(Boolean).join('');
    const dis = chk.ok ? '' : 'disabled';
    const title = chk.ok ? s.desc : (s.desc + ' ｜ ' + chk.reason);
    return `<button class="skill ${dis}" data-id="${s.id}" ${dis} title="${title}">
        <div class="s-top"><span class="s-name">${s.name}</span>${meta}</div>
        <div class="s-desc">${s.desc}</div>
      </button>`;
  }).join('');
  el.querySelectorAll('button.skill:not(.disabled)').forEach(b => {
    b.onclick = () => onSkillClick(b.dataset.id);
  });
}

function renderLog() {
  const el = $('log');
  el.innerHTML = game.log.slice(-40).reverse().map(l => {
    const who = l.side === 'r' ? 'r' : 'b';
    return `<div class="log-line"><span class="dot ${who}"></span>${l.msg}</div>`;
  }).join('');
}

// ---- 交互 -------------------------------------------------------------------
function ownPieceAt(col, row) {
  const stack = game.board[row][col];
  return stack.find(p => p.owner === game.current) || null;
}

function selectPiece(p) {
  state.selected = p;
  state.mode = 'move';
  state.skillId = null; state.skillVariant = null; state.targets = [];
  state.moves = game.legalMoves(p);
  render();
}
function clearSelection() {
  state.selected = null; state.mode = 'idle'; state.moves = []; state.targets = []; state.skillId = null;
  render();
}

function onCellClick(col, row) {
  if (game.winner) return;
  if (state.mode === 'skillTarget') {
    const hit = state.targets.find(t => t.col === col && t.row === row);
    if (hit) { doSkill({ col, row, variant: state.skillVariant }); return; }
    // 点别处取消技能瞄准，回到普通选择
    state.mode = 'move'; state.targets = []; state.skillId = null;
    const own = ownPieceAt(col, row);
    if (own) selectPiece(own); else render();
    return;
  }
  // 移动模式：若点到合法落点则行动
  if (state.selected) {
    const m = state.moves.find(mm => mm.col === col && mm.row === row);
    if (m) { doAct(col, row); return; }
  }
  const own = ownPieceAt(col, row);
  if (own) selectPiece(own); else clearSelection();
}

function doAct(col, row) {
  const res = game.act(state.selected, col, row);
  toast(res.info);
  afterAction();
}

function onSkillClick(id) {
  const p = state.selected; if (!p) return;
  const chk = game.canUseSkill(p, id);
  if (!chk.ok) { toast(chk.reason); return; }
  // 领域改写：先选地形类型
  if (id === 'b_domain') { askDomainVariant(id); return; }
  const targets = game.skillTargets(p, id);
  if (targets && targets.length) {
    state.mode = 'skillTarget'; state.skillId = id; state.targets = targets;
    toast('请选择技能目标');
    render();
    return;
  }
  if (targets && targets.length === 0) { toast('当前没有合法目标'); return; }
  // self / none 技能：直接执行
  state.skillId = id;
  doSkill(null);
}

function askDomainVariant(id) {
  const wrap = $('variant-pick');
  wrap.style.display = 'flex';
  wrap.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      wrap.style.display = 'none';
      state.skillVariant = b.dataset.v;
      state.mode = 'skillTarget'; state.skillId = id;
      state.targets = game.skillTargets(state.selected, id);
      toast('点击 3×3 区域中心');
      render();
    };
  });
}

function doSkill(target) {
  const p = state.selected, id = state.skillId;
  const skill = game.skillDef(p, id);
  const caster = { col: p.col, row: p.row, owner: p.owner, name: game.pieceName(p) };
  const fxTarget = target ? { col: target.col, row: target.row, variant: target.variant } : null;
  const res = game.useSkill(p, id, target);
  toast(res.info);
  if (!res.ok) { state.mode = 'move'; state.targets = []; render(); return; }
  playSkillFx(caster, skill, fxTarget);
  if (res.instant) {
    // 轻骑/校准：保留选中，刷新走法，可继续行动
    state.mode = 'move'; state.targets = []; state.skillId = null;
    state.moves = game.legalMoves(p);
    render();
    return;
  }
  afterAction();
}

function afterAction() {
  clearSelection();
  if (game.winner) showResult();
}

function playSkillFx(caster, skill, target) {
  if (!skill) return;
  const now = performance.now();
  const duration = skill.tier === 'ult' ? 1450 : skill.tier === 'small' ? 1150 : 850;
  state.effects.push({
    id: skill.id, tier: skill.tier, targetType: skill.target,
    caster, target, started: now, duration,
  });
  showSkillBroadcast(caster, skill);
  scheduleFxFrame();
}

let broadcastTimer = null;
function showSkillBroadcast(caster, skill) {
  const wrap = $('skill-broadcast');
  if (!wrap) return;
  wrap.className = `skill-broadcast show ${skill.tier} ${caster.owner === 'r' ? 'red' : 'black'}`;
  $('skill-broadcast-tier').textContent = TIER_LABEL[skill.tier] || 'SKILL';
  $('skill-broadcast-name').textContent = skill.name;
  $('skill-broadcast-meta').textContent = `${caster.owner === 'r' ? '红方' : '黑方'} · ${caster.name}`;
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => wrap.classList.remove('show'), skill.tier === 'ult' ? 1250 : 950);
}

function scheduleFxFrame() {
  if (state.raf) return;
  const tick = () => {
    const now = performance.now();
    state.effects = state.effects.filter(e => now - e.started < e.duration);
    render();
    if (state.effects.length) state.raf = requestAnimationFrame(tick);
    else state.raf = null;
  };
  state.raf = requestAnimationFrame(tick);
}

function clearFx() {
  state.effects = [];
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = null;
  clearTimeout(broadcastTimer);
  const wrap = $('skill-broadcast');
  if (wrap) wrap.classList.remove('show');
}

// ---- 提示与弹窗 -------------------------------------------------------------
let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function showResult() {
  const w = game.winner === 'r' ? '红方' : '黑方';
  $('result-text').innerHTML = `<span class="${game.winner === 'r' ? 'red' : 'black'}">${w}</span> 胜利！`;
  $('result-modal').classList.add('show');
}

// ---- 事件绑定 ---------------------------------------------------------------
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (renderer.W / rect.width);
  const py = (e.clientY - rect.top) * (renderer.H / rect.height);
  const cell = renderer.pick(px, py);
  if (cell) onCellClick(cell.col, cell.row);
});

$('btn-new').onclick = () => { clearFx(); game.reset(); clearSelection(); $('result-modal').classList.remove('show'); toast('新对局开始'); };
$('btn-surrender').onclick = () => { game.surrender(game.current); render(); showResult(); };
$('btn-help').onclick = () => $('help-modal').classList.add('show');
$('help-close').onclick = () => $('help-modal').classList.remove('show');
$('result-again').onclick = () => { clearFx(); game.reset(); clearSelection(); $('result-modal').classList.remove('show'); };

document.querySelectorAll('[data-close-modal]').forEach(b => {
  b.onclick = (e) => e.target.closest('.modal').classList.remove('show');
});

render();
