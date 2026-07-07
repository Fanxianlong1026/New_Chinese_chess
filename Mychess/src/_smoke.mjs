import { Game } from './engine.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', m); } };

const g = new Game();
ok(g.pieces.length === 40, `piece count = ${g.pieces.length} (want 40)`);
ok(g.king('r') && g.king('b'), 'both kings exist');
ok(g.current === 'r', 'red starts');

// 红兵 (col0,row3) 应能前进到 row4
const pawn = g.pieces.find(p => p.owner === 'r' && p.type === 'P' && p.col === 0 && p.row === 4);
const pm = g.legalMoves(pawn);
ok(pm.some(m => m.col === 0 && m.row === 5 && m.kind === 'move'), 'pawn can advance');

// 红车 (col0,row0) 受前方己方阻挡，纵向走不远
const rook = g.pieces.find(p => p.owner === 'r' && p.type === 'R' && p.col === 0 && p.row === 1);
const rm = g.legalMoves(rook);
ok(rm.every(m => !(m.col === 0 && m.row === 4)), 'rook blocked by own pawn at row4');
ok(rm.some(m => m.col === 0 && m.row === 2), 'rook can slide up the file');
ok(rm.every(m => m.col === 0), 'corner rook boxed in horizontally by own horse');

// 红马 (col1,row0) 蹩腿/日字
const horse = g.pieces.find(p => p.owner === 'r' && p.type === 'N' && p.col === 1 && p.row === 1);
ok(g.legalMoves(horse).length > 0, 'horse has moves');

// 移动获能
const e0 = pawn.energy;
g.act(pawn, 0, 5);
ok(pawn.energy === e0 + 10, `pawn gained move energy (${pawn.energy})`);
ok(g.current === 'b', 'turn switched to black after move');

// 构造一次堆叠：手动放置相邻敌子并攻击
const g2 = new Game();
// 找红车，清空其前路，放一个低血黑兵相邻让车攻击但不致死
const r2 = g2.pieces.find(p => p.owner === 'r' && p.type === 'R' && p.col === 15 && p.row === 1);
// 直接造个测试场景：把一个黑兵移到 (15,1)，hp 设高于车伤害
const victim = g2.pieces.find(p => p.owner === 'b' && p.type === 'R'); // 黑车 def2
g2._removeFromCell(victim); g2._placeAt(victim, 15, 2); victim.hp = 100;
const before = g2.count(15, 2);
g2.act(r2, 15, 1); // 红车攻击，伤害=max(1,10-2)=8 <100 -> 堆叠
g2.act(r2, 15, 2);
ok(g2.count(15, 2) === 2, `stack formed (cell has ${g2.count(15,2)})`);
ok(g2.isSuppressed(victim), 'victim suppressed (bottom)');
ok(g2.top(15, 2) === r2, 'attacker on top');

// 击杀位移
const g3 = new Game();
const r3 = g3.pieces.find(p => p.owner === 'r' && p.type === 'R' && p.col === 0 && p.row === 1);
const weak = g3.pieces.find(p => p.owner === 'b' && p.type === 'P');
g3._removeFromCell(weak); g3._placeAt(weak, 0, 2); weak.hp = 3;
g3.act(r3, 0, 2);
ok(g3.count(0, 2) === 1 && g3.top(0, 2) === r3, 'kill -> attacker occupies, no stack');
ok(!g3.pieces.includes(weak), 'victim removed on kill');

// 技能：马·轻骑（instant），不结束回合
const g4 = new Game();
const n4 = g4.pieces.find(p => p.owner === 'r' && p.type === 'N');
n4.energy = 50;
const res = g4.useSkill(n4, 'n_light', null);
ok(res.ok && res.instant, 'qingji is instant');
ok(g4.current === 'r' && n4.flags.ignoreLeg, 'turn kept, ignoreLeg set');

// 技能：帅·天命 回血+激昂，结束回合
const g5 = new Game();
const k5 = g5.king('r'); k5.energy = 80; k5.hp = 10;
const r5 = g5.useSkill(k5, 'k_tianming', null);
// 10 +10(heal) +3(回合末军营回复) = 23
ok(r5.ok && k5.hp === 21, `tianming heals then camp regen (hp=${k5.hp})`);
ok(g5.current === 'b', 'tianming ends turn');

// 胜负：直接击杀将
const g6 = new Game();
const bk = g6.king('b'); bk.hp = 2;
const rcannon = g6.pieces.find(p => p.owner === 'r' && p.type === 'C');
// 用 dealDamage 模拟
g6._dealDamage(bk, 99);
ok(g6.winner === 'r', 'red wins when black king dies');

// ---- 新技能 ----------------------------------------------------------------
function freshRedSkill(type, id) {
  const g = new Game();
  const p = g.pieces.find(x => x.owner === 'r' && x.type === type);
  p.energy = 100;
  return { g, p };
}

// 急令：帅获得双步机动（instant）
{
  const { g, p } = freshRedSkill('K', 'k_jiling');
  const r = g.useSkill(p, 'k_jiling', null);
  ok(r.ok && r.instant && p.flags.swiftKing, 'jiling instant + swiftKing');
  // 帅在九宫(6-8,0-2)，双步应能到 (7,2) 之类两步空格
  const dests = g.legalMoves(p);
  ok(dests.some(m => Math.abs(m.col - p.col) + Math.abs(m.row - p.row) === 2), 'king reaches 2-step cell');
}

// 灵魂链接：40% 伤害转移
{
  const g = new Game();
  const a = g.pieces.find(x => x.owner === 'r' && x.type === 'A'); a.energy = 100;
  const mate = g.pieces.find(x => x.owner === 'r' && x.type === 'R');
  const r = g.useSkill(a, 'a_link', { col: mate.col, row: mate.row });
  ok(r.ok && g._linkPartner(a) === mate, 'soul link established');
  const hpA = a.hp, hpM = mate.hp;
  g._dealDamage(a, 10);
  ok(a.hp === hpA - 6 && mate.hp === hpM - 4, `link splits dmg (a-${hpA - a.hp}, m-${hpM - mate.hp})`);
}

// 献祭守护：友军无敌 + 死亡 + 安排复活
{
  const g = new Game();
  const a = g.pieces.find(x => x.owner === 'r' && x.type === 'A'); a.energy = 100;
  // 先制造2个阵亡的红兵以便复活
  const pawns = g.pieces.filter(x => x.owner === 'r' && x.type === 'P').slice(0, 2);
  pawns.forEach(pw => g._kill(pw));
  const ally = g.king('r');
  g.useSkill(a, 'a_sacrifice', null);
  ok(!g.pieces.includes(a), 'sacrifice kills self');
  ok(g.isInvincible(ally), 'allies invincible');
  const before = g.alivePieces('r').filter(x => x.type === 'P').length;
  g._dealDamage(ally, 50); ok(ally.hp === 30, 'invincible blocks damage');
  // 推进到红方下回合开始（black 行动一次）
  const bp = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g.act(bp, bp.col, bp.row - 1);
  const after = g.alivePieces('r').filter(x => x.type === 'P').length;
  ok(after > before, `pawns revived (${before} -> ${after})`);
}

// 八步赶蝉：三跳可达，落空格自伤10
{
  const { g, p } = freshRedSkill('N', 'n_eightstep');
  const targets = g.skillTargets(p, 'n_eightstep');
  ok(targets.length > 0, 'eightstep has reachable cells');
  const empty = targets.find(t => g.count(t.col, t.row) === 0);
  const hp0 = p.hp;
  g.useSkill(p, 'n_eightstep', empty);
  ok(p.col === empty.col && p.row === empty.row, 'eightstep moved');
  // 自伤10 后回合末回血2/3，净变化 <= -7
  ok(p.hp < hp0, `eightstep self-damage applied (hp ${hp0}->${p.hp})`);
}

// 天翔龙闪：同行同列敌方受伤 + 能量上限-20
{
  const g = new Game();
  const n = g.pieces.find(x => x.owner === 'r' && x.type === 'N'); n.energy = 100;
  // 在同列放一个敌人
  const e = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g._removeFromCell(e); g._placeAt(e, n.col, 8); const eh = e.hp;
  const dest = { col: n.col, row: 5 };
  g.useSkill(n, 'n_dragon', dest);
  // 敌方不在行动方回合末回血，净 8
  ok(e.hp === eh - 8, `dragon hits same-column enemy (net ${eh - e.hp})`);
  ok(n.energyCap === 80, `dragon lowers cap (${n.energyCap})`);
}

// 毁灭冲锋：碾过敌方
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0); r.energy = 100;
  // 在 (0,1)(0,2) 放敌人，冲到 (0,4) 之前需空格；清理路径
  const e = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g._removeFromCell(e); g._placeAt(e, 0, 2); const eh = e.hp;
  // (0,1) 空, (0,3) 是己方兵 -> 目标只能到 (0,2) 之前的空格?  选 (0,1) 不碾; 选更远需空。
  // 直接验证 charge 到 (0,4)? 路径有己方兵(0,3) 会阻断 target 列表。改放敌人到(0,1)，目标(0,2)空？(0,2)有炮?
  // 简化：清掉己方兵(0,3)
  const ownPawn = g.board[3][0][0]; if (ownPawn) g._kill(ownPawn);
  const tlist = g.skillTargets(r, 'r_charge');
  const far = tlist.find(t => t.col === 0 && t.row === 4) || tlist.find(t => t.col === 0 && t.row === 3);
  if (far) { g.useSkill(r, 'r_charge', far); ok(e.hp < eh, `charge trampled enemy (${eh}->${e.hp})`); }
  else ok(false, 'charge target not found');
}

// 末日战车：自爆并阵亡
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 15); r.energy = 100;
  const ownPawn = g.board[3][15][0]; if (ownPawn) g._kill(ownPawn);
  const tlist = g.skillTargets(r, 'r_warmachine');
  const dest = tlist.find(t => t.col === 15 && t.row === 3);
  g.useSkill(r, 'r_warmachine', dest);
  ok(!g.pieces.includes(r), 'war machine self-destructs');
}

// 轨道轰炸：标记 -> 下个己方回合引爆
{
  const g = new Game();
  const c = g.pieces.find(x => x.owner === 'r' && x.type === 'C'); c.energy = 100;
  const e = g.pieces.find(x => x.owner === 'b' && x.type === 'R');
  const eh = e.hp;
  g.useSkill(c, 'c_orbital', { col: e.col, row: e.row });
  ok(g.marks.length === 1, 'orbital mark placed');
  // black 行动 -> red 回合开始引爆
  const bp = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g.act(bp, bp.col, bp.row - 1);
  ok(g.marks.length === 0, 'orbital detonated');
  ok(!g.pieces.includes(e) || e.hp < eh, 'orbital damaged target line');
}

// 死士意志：过河自爆 + 弹坑
{
  const g = new Game();
  const p = g.pieces.find(x => x.owner === 'r' && x.type === 'P'); p.energy = 100; p.crossed = true;
  g._removeFromCell(p); g._placeAt(p, 5, 7);
  const e = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g._removeFromCell(e); g._placeAt(e, 6, 7); const eh = e.hp;
  g.useSkill(p, 'p_martyr', null);
  ok(!g.pieces.includes(p), 'martyr dies');
  ok(g.terrainAt(5, 7) === 'crater', 'crater left');
  ok(!g.pieces.includes(e) || e.hp < eh, 'martyr blast hit enemy');
}

// 末日降临：条件满足时整行废墟 + 30 真伤
{
  const g = new Game();
  const pawns = g.pieces.filter(x => x.owner === 'r' && x.type === 'P');
  pawns.slice(0, 4).forEach(pw => g._kill(pw));   // 阵亡4个
  const last = g.alivePieces('r').find(x => x.type === 'P'); last.energy = 100;
  const ek = g.king('b'); const ekh = ek.hp;
  const r = g.useSkill(last, 'p_apocalypse', null);
  ok(r.ok, 'apocalypse fires when condition met');
  ok(g.terrainAt(0, ek.row) === 'crater', 'enemy king row turned to ruins');
  ok(ek.hp === ekh - 30 || !g.pieces.includes(ek), 'enemy king took 30');
}

// 伪装：不可选取 + 穿行
{
  const { g, p } = freshRedSkill('B', 'b_disguise');
  const r = g.useSkill(p, 'b_disguise', null);
  ok(r.ok && r.instant && g.isUntargetable(p) && p.flags.phaseMove, 'disguise sets flags');
}

// 相位转移：瞬移到友军相邻空格
{
  const g = new Game();
  const b = g.pieces.find(x => x.owner === 'r' && x.type === 'B'); b.energy = 100;
  const tlist = g.skillTargets(b, 'b_phase');
  ok(tlist.length > 0, 'phase has targets');
  g.useSkill(b, 'b_phase', tlist[0]);
  ok(b.col === tlist[0].col && b.row === tlist[0].row && g.isUntargetable(b), 'phase teleported + untargetable');
}

// ---- 回血时序：敌方不应在我方回合自动回血 ------------------------------------
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0);
  const victim = g.pieces.find(x => x.owner === 'b' && x.type === 'R');
  g._removeFromCell(victim); g._placeAt(victim, 0, 2); victim.hp = 30; victim.maxHp = 30;
  g.act(r, 0, 2);                          // attack and stack
  ok(victim.hp === 22, `enemy not healed on attacker turn (hp=${victim.hp})`);
  // 黑方行动一手（移动一个兵），此时黑方棋子回合末才回血
  const bp = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  g.act(bp, bp.col, bp.row - 1);
  ok(victim.hp === 22, `enemy does not heal outside camp (hp=${victim.hp})`);
}

// 军营回血 +1（红方棋子在军营回合末 +3）
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0); // 在 row0 军营
  r.hp = 10;
  g.act(r, 0, 2);                          // move inside camp
  ok(r.hp === 11, `camp regen +1 (hp=${r.hp})`);
}

// 泥沼：敌方车无法穿过 / 无法进入
{
  const g = new Game();
  // 红方在 (5,4) 放一片泥沼（owner 'r'），黑车试图穿过
  const b = g.pieces.find(x => x.owner === 'b' && x.type === 'R');
  g.current = 'b';
  g._removeFromCell(b); g._placeAt(b, 5, 8);
  g.terrain['5,6'] = { kind: 'mud', owner: 'r' };
  const ms = g.legalMoves(b);
  ok(ms.every(m => !(m.col === 5 && m.row === 6)), 'enemy cannot enter mud');
  ok(ms.every(m => !(m.col === 5 && m.row < 6)), 'enemy chariot cannot pass through mud');
}

// 泥沼：拥有者可正常进入
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0);
  g._removeFromCell(r); g._placeAt(r, 5, 4);
  g.terrain['5,5'] = { kind: 'mud', owner: 'r' };
  const ms = g.legalMoves(r);
  ok(ms.some(m => m.col === 5 && m.row === 5), 'owner can enter own mud');
}

// 疾风：己方兵在疾风上向前 +1 步
{
  const g = new Game();
  const p = g.pieces.find(x => x.owner === 'r' && x.type === 'P');
  g._removeFromCell(p); g._placeAt(p, 2, 5);   // 放到空旷处
  g.terrain['2,5'] = { kind: 'wind', owner: 'r' };
  const ms = g.legalMoves(p);
  ok(ms.some(m => m.col === 2 && m.row === 6), 'pawn normal forward');
  ok(ms.some(m => m.col === 2 && m.row === 7), 'wind grants pawn +1 forward');
}

// 时空裂隙：进入后下个己方回合可瞬移到其它裂隙
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0); // 角上 (0,0) 是裂隙
  // 四角初始都是车，先清掉对角 (15,11) 腾出一个空裂隙作为瞬移落点
  const farRook = g.top(15, 12); if (farRook) g._kill(farRook);
  ok(g.legalMoves(r).every(m => m.kind !== 'teleport'), 'no teleport on the turn of entry');
  // 已在裂隙(0,0)，推进一整轮回到红方回合
  const bp = g.pieces.find(x => x.owner === 'b' && x.type === 'P');
  // 红先走一手别的子，触发换手
  const other = g.pieces.find(x => x.owner === 'r' && x.type === 'P');
  g.act(other, other.col, other.row + 1);
  g.act(bp, bp.col, bp.row - 1);
  const tmoves = g.legalMoves(r).filter(m => m.kind === 'teleport');
  ok(tmoves.length > 0, `rift armed next own turn (${tmoves.length} dests)`);
  const dest = tmoves[0];
  g.act(r, dest.col, dest.row);
  ok(r.col === dest.col && r.row === dest.row, 'teleported to another rift');
}

// External attacks against a stacked cell hit an enemy in the stack without moving in.
{
  const g = new Game();
  const attacker = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0);
  const cover = g.pieces.find(x => x.owner === 'r' && x.type === 'P' && x.col === 7);
  const victim = g.pieces.find(x => x.owner === 'b' && x.type === 'R');
  for (const q of [...g.board[3][5]]) g._kill(q);
  g._removeFromCell(attacker); g._placeAt(attacker, 5, 1);
  g._removeFromCell(victim); g._placeAt(victim, 5, 3); victim.hp = 100;
  g._removeFromCell(cover); g.board[3][5].push(cover); cover.col = 5; cover.row = 3;
  const hp0 = victim.hp;
  ok(g.legalMoves(attacker).some(m => m.col === 5 && m.row === 3 && m.kind === 'attack'), 'stacked enemy can be attacked');
  g.act(attacker, 5, 3);
  ok(attacker.col === 5 && attacker.row === 1, 'external stack attack keeps attacker in place');
  ok(g.count(5, 3) === 2, 'external stack attack does not create a 3-stack');
  ok(victim.hp === hp0 - 4, `suppressed stack target took covered damage (${hp0}->${victim.hp})`);
}

// Altar: a full-energy non-king can sacrifice once for team heal and cleanse.
{
  const g = new Game();
  const r = g.pieces.find(x => x.owner === 'r' && x.type === 'R' && x.col === 0);
  const ally = g.pieces.find(x => x.owner === 'r' && x.type === 'P' && x.col === 7);
  g._removeFromCell(r); g._placeAt(r, 5, 1); r.energy = 100;
  ally.hp = 2; ally.flags.moveDebuff = true; ally.flags.tremor = true;
  const altarMove = g.legalMoves(r).find(m => m.col === 5 && m.row === 0 && m.kind === 'altar');
  ok(!!altarMove, 'full-energy rook can enter own altar');
  g.act(r, 5, 0);
  ok(!g.pieces.includes(r), 'altar sacrifices the piece');
  ok(g.altarUsed.r, 'red altar marked used');
  ok(ally.hp === ally.maxHp && !ally.flags.moveDebuff && !ally.flags.tremor, 'altar heals and cleanses allies');
  ok(g.current === 'b', 'altar sacrifice ends the turn');
}

// New pieces: shield, crossbow, witch, assassin exist and have moves.
{
  const g = new Game();
  for (const type of ['D', 'X', 'W', 'S']) {
    const p = g.pieces.find(x => x.owner === 'r' && x.type === type);
    ok(!!p, `${type} exists`);
    ok(g.legalMoves(p).length > 0, `${type} has legal moves`);
  }
}

// Shield skills: bulwark, cover, fortress.
{
  const { g, p } = freshRedSkill('D', 'd_bulwark');
  const r = g.useSkill(p, 'd_bulwark', null);
  ok(r.ok && r.instant && p.tempArmor >= 3, 'shield bulwark is instant armor');
}
{
  const g = new Game();
  const d = g.pieces.find(x => x.owner === 'r' && x.type === 'D'); d.energy = 100;
  const ally = g.pieces.find(x => x.owner === 'r' && x.type === 'X');
  g._removeFromCell(ally); g._placeAt(ally, d.col + 1, d.row); ally.flags.tremor = true;
  g.useSkill(d, 'd_cover', { col: ally.col, row: ally.row });
  ok(ally.tempArmor >= 4 && !ally.flags.tremor, 'shield cover protects and cleanses');
}
{
  const { g, p } = freshRedSkill('D', 'd_fortress');
  const ally = g.pieces.find(x => x.owner === 'r' && x.type === 'X');
  g._removeFromCell(ally); g._placeAt(ally, p.col + 1, p.row); ally.hp = 1;
  g.useSkill(p, 'd_fortress', null);
  ok(ally.hp > 1 && ally.tempArmor >= 2, 'shield fortress buffs nearby allies');
}

// Crossbow skills: mark, pierce, rain.
{
  const g = new Game();
  const x = g.pieces.find(q => q.owner === 'r' && q.type === 'X'); x.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'P');
  g._removeFromCell(e); g._placeAt(e, x.col, x.row + 2);
  const r = g.useSkill(x, 'x_mark', { col: e.col, row: e.row });
  ok(r.ok && r.instant && e.flags.moveDebuff && e.tempArmor < 0, 'crossbow mark debuffs');
}
{
  const g = new Game();
  const x = g.pieces.find(q => q.owner === 'r' && q.type === 'X'); x.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'P');
  g._removeFromCell(e); g._placeAt(e, x.col, x.row + 3); const hp = e.hp;
  g.useSkill(x, 'x_pierce', { col: e.col, row: e.row });
  ok(e.hp === hp - 10 || !g.pieces.includes(e), 'crossbow pierce deals true damage');
}
{
  const g = new Game();
  const x = g.pieces.find(q => q.owner === 'r' && q.type === 'X'); x.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'P');
  g._removeFromCell(e); g._placeAt(e, 8, 7); const hp = e.hp;
  g.useSkill(x, 'x_rain', { col: 8, row: 7 });
  ok(e.hp === hp - 12 || !g.pieces.includes(e), 'crossbow rain hits center harder');
}

// Witch skills: cleanse, drain, confluence.
{
  const g = new Game();
  const w = g.pieces.find(q => q.owner === 'r' && q.type === 'W'); w.energy = 100;
  const ally = g.pieces.find(q => q.owner === 'r' && q.type === 'S');
  g._removeFromCell(ally); g._placeAt(ally, w.col + 1, w.row); ally.hp = 2; ally.flags.moveDebuff = true;
  g.useSkill(w, 'w_cleanse', { col: ally.col, row: ally.row });
  ok(ally.hp > 2 && !ally.flags.moveDebuff, 'witch cleanse heals and clears');
}
{
  const g = new Game();
  const w = g.pieces.find(q => q.owner === 'r' && q.type === 'W'); w.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'P');
  g._removeFromCell(e); g._placeAt(e, w.col, w.row + 2); e.energy = 30; const hp = e.hp;
  g.useSkill(w, 'w_drain', { col: e.col, row: e.row });
  ok(e.energy === 10 && e.hp === hp - 4, 'witch drain removes energy and damages');
}
{
  const { g, p } = freshRedSkill('W', 'w_confluence');
  const ally = g.pieces.find(q => q.owner === 'r' && q.type === 'D'); ally.flags.tremor = true;
  g.useSkill(p, 'w_confluence', null);
  ok(ally.energy >= 15 && !ally.flags.tremor, 'witch confluence charges and cleanses allies');
}

// Assassin skills: shadow, backstab, execute.
{
  const { g, p } = freshRedSkill('S', 's_shadow');
  const r = g.useSkill(p, 's_shadow', null);
  ok(r.ok && r.instant && g.isUntargetable(p), 'assassin shadow is instant stealth');
}
{
  const g = new Game();
  const s = g.pieces.find(q => q.owner === 'r' && q.type === 'S'); s.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'P');
  g._removeFromCell(e); g._placeAt(e, s.col + 1, s.row); e.hp = 3;
  g.useSkill(s, 's_backstab', { col: e.col, row: e.row });
  ok(!g.pieces.includes(e), 'assassin backstab can finish wounded target');
}
{
  const g = new Game();
  const s = g.pieces.find(q => q.owner === 'r' && q.type === 'S'); s.energy = 100;
  const e = g.pieces.find(q => q.owner === 'b' && q.type === 'R');
  g._removeFromCell(e); g._placeAt(e, s.col, s.row + 3); const start = `${s.col},${s.row}`;
  g.useSkill(s, 's_execute', { col: e.col, row: e.row });
  ok(`${s.col},${s.row}` !== start, 'assassin execute blinks after hit');
}

console.log(`\n  smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
