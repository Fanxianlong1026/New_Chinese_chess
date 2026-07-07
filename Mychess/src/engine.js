// ============================================================================
// engine.js — 新象棋·战棋 规则引擎（纯逻辑，无 DOM）
//   一回合 = 当前玩家选一个己方棋子，执行「移动/攻击」或「一个技能」，然后换手。
//   注：规则文档存在少量内部冲突（如 8.2「移动与技能不能同回合」对 轻骑/校准
//   「本回合下一次攻击」）。v1 的取舍：
//     - 轻骑/校准 视为 instant 预备增益：施放后不结束回合，本子可继续移动/攻击；
//       其余技能（含奋进，因其自带移动）即为该回合的行动，施放即结束回合。
//     - 激昂/校准/轻骑 等「下次」类增益保持到被消耗，便于上手。
//   这些取舍在代码注释与游戏内帮助中说明，后续可逐步贴近原文。
// ============================================================================

import {
  COLS, ROWS, PIECE_TYPES, RED_SETUP, PALACE, RIVER,
  ENERGY_CAP, E_MOVE, E_ATTACK, E_HURT, E_HURT_MAX,
  REGEN, CAMP_REGEN, FLOW_DAMAGE, HEAVY_WOUND_PCT,
  SKILLS, RIFTS, isCamp, isEnergyFlow, isRift, altarOwnerAt,
} from './data.js';

let _uid = 1;

export class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.pieces = [];
    this.board = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => []));
    this.current = 'r';
    this.turn = 1;
    this.winner = null;
    this.terrain = {};        // "c,r" -> 'mud' | 'wind' | 'crater'
    this.globalSkills = { r: {}, b: {} }; // skillId -> used count
    this.altarUsed = { r: false, b: false };
    this.graveyard = [];      // 阵亡记录 {type, owner}
    this.links = [];          // 灵魂链接 [{a:id, b:id, owner}]
    this.marks = [];          // 轨道轰炸预警 [{col,row,owner,fireTurn}]
    this.pendingRevive = { r: 0, b: 0 }; // 献祭守护：下个己方回合开始复活的兵数
    this.log = [];
    _uid = 1;

    const place = (owner, type, col, row) => {
      const base = PIECE_TYPES[type];
      const p = {
        id: _uid++, type, owner, col, row,
        maxHp: base.hp, hp: base.hp, atk: base.atk, def: base.def,
        energy: 0, energyCap: ENERGY_CAP,
        crossed: false,
        cooldowns: {},
        usedSkillThisTurn: false,
        hurtCount: 0,
        tempArmor: 0, tempArmorExpire: 0,
        buffs: { inspired: false },
        flags: {
          ignoreLeg: false, atkPenalty: 0, calibrate: false, moveDebuff: false,
          tremor: false,            // 震颤：本回合无法移动
          swiftKing: false,         // 急令：帅双步机动
          phaseMove: false,         // 伪装：下一次移动可穿子无视塞田
          riftArmed: false,         // 时空裂隙：本回合可瞬移
          invincibleUntil: 0,       // 献祭守护：免伤到此回合
          untargetableUntil: 0,     // 伪装/相位：不可被技能选取到此回合
        },
      };
      this.pieces.push(p);
      this.board[row][col].push(p);
      return p;
    };

    for (const s of RED_SETUP) {
      place('r', s.type, s.col, s.row);
      place('b', s.type, s.col, ROWS - 1 - s.row);
    }
    this._log(`对局开始 · 红方先手`);
  }

  // ---- 基础查询 -------------------------------------------------------------
  inBounds(c, r) { return c >= 0 && c < COLS && r >= 0 && r < ROWS; }
  isBoardCell(c, r) { return c >= 0 && c < COLS && r > 0 && r < ROWS - 1; }
  cell(c, r) { return this.board[r][c]; }
  top(c, r) { const a = this.board[r][c]; return a.length ? a[a.length - 1] : null; }
  count(c, r) { return this.board[r][c].length; }
  // 棋子是否被压制（处于两子堆叠的下层）
  isSuppressed(p) { const a = this.board[p.row][p.col]; return a.length === 2 && a[0] === p; }
  isTopOfStack(p) { const a = this.board[p.row][p.col]; return a.length === 2 && a[1] === p; }
  pieceName(p) { return p.owner === 'r' ? PIECE_TYPES[p.type].name : PIECE_TYPES[p.type].nameB; }
  enemyOf(owner) { return owner === 'r' ? 'b' : 'r'; }
  alivePieces(owner) { return this.pieces.filter(p => p.owner === owner); }
  king(owner) { return this.pieces.find(p => p.owner === owner && p.type === 'K'); }

  inPalace(owner, c, r) {
    const pa = PALACE[owner];
    return c >= pa.cols[0] && c <= pa.cols[1] && r >= pa.rows[0] && r <= pa.rows[1];
  }
  heavyWounded(p) { return p.hp < p.maxHp * HEAVY_WOUND_PCT; }
  effAtk(p) {
    let a = p.atk;
    if (this.heavyWounded(p)) a += 2;     // 重伤 ATK+2
    a -= (p.flags.atkPenalty || 0);       // 轻骑等
    return Math.max(1, a);
  }
  effDef(p) { return p.def + (p.tempArmor || 0); }

  // 终点可达性：空→可移动，单个敌方→可攻击，其它（友军/已两子）→不可
  _evalDest(p, c, r) {
    if (!this.inBounds(c, r)) return null;
    const altarOwner = altarOwnerAt(c, r);
    if (altarOwner) return this._canUseAltar(p, c, r) ? 'altar' : null;
    if (!this.isBoardCell(c, r)) return null;
    if (this._mudBlocks(p, c, r)) return null;        // 泥沼：敌方不可进入
    const cnt = this.count(c, r);
    if (cnt === 0) return 'move';
    if (this._attackTargetAt(p, c, r)) return 'attack';
    return null;
  }

  _log(msg) { this.log.push({ turn: this.turn, side: this.current, msg }); }

  _canUseAltar(p, c, r) {
    return altarOwnerAt(c, r) === p.owner &&
      !this.altarUsed[p.owner] &&
      p.type !== 'K' &&
      p.energy >= p.energyCap &&
      this.count(c, r) === 0;
  }

  _attackTargetAt(attacker, c, r) {
    const stack = this.board[r]?.[c] || [];
    if (!stack.length) return null;
    const top = stack[stack.length - 1];
    if (top.owner !== attacker.owner) return top;
    return stack.find(q => q.owner !== attacker.owner) || null;
  }

  // ---- 走法生成 -------------------------------------------------------------
  legalMoves(p) {
    if (this.winner) return [];
    if (p.owner !== this.current) return [];
    if (p.flags.tremor) return [];                                 // 震颤：本回合无法移动
    const suppressed = this.isSuppressed(p);
    let moves = this._genByType(p);
    moves = this._applyWind(p, moves);                             // 疾风：己方步型棋子移动力+1
    moves = moves.concat(this._riftMoves(p));                      // 时空裂隙：瞬移
    if (suppressed) moves = moves.filter(m => m.kind === 'move'); // 被压制者只能离开到空格
    return moves;
  }

  // 疾风：站在己方疾风格上时，帅/士在九宫内、兵向前各 +1 步可达
  _applyWind(p, moves) {
    if (!this._onOwnWind(p)) return moves;
    const type = PIECE_TYPES[p.type].move;
    const seen = new Set(moves.map(m => `${m.col},${m.row}`));
    const add = (c, r) => {
      const k = `${c},${r}`;
      if (this._evalDest(p, c, r) === 'move' &&
          !seen.has(k) && !(c === p.col && r === p.row)) {
        moves.push({ col: c, row: r, kind: 'move' }); seen.add(k);
      }
    };
    if (type === 'king' || type === 'advisor') {
      for (const m of [...moves]) {
        if (m.kind !== 'move') continue;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = m.col + dc, r = m.row + dr;
          if (this.inPalace(p.owner, c, r)) add(c, r);
        }
      }
    } else if (type === 'pawn') {
      const fwd = p.owner === 'r' ? 1 : -1;
      for (const m of [...moves]) {
        if (m.kind !== 'move') continue;
        add(m.col, m.row + fwd);
        if (p.crossed) { add(m.col - 1, m.row); add(m.col + 1, m.row); }
      }
    }
    return moves;
  }

  // 时空裂隙：上一轮已在裂隙上（riftArmed）的棋子，本回合可瞬移到任意其它空裂隙
  _riftMoves(p) {
    if (!p.flags.riftArmed || !isRift(p.col, p.row)) return [];
    const out = [];
    for (const rf of RIFTS) {
      if (rf.col === p.col && rf.row === p.row) continue;
      if (this.count(rf.col, rf.row) === 0) out.push({ col: rf.col, row: rf.row, kind: 'teleport' });
    }
    return out;
  }

  _genByType(p) {
    switch (PIECE_TYPES[p.type].move) {
      case 'king': return this._genKing(p);
      case 'advisor': return this._genAdvisor(p);
      case 'elephant': return this._genElephant(p);
      case 'horse': return this._genHorse(p);
      case 'chariot': return this._genLine(p, false);
      case 'cannon': return this._genCannon(p);
      case 'pawn': return this._genPawn(p);
      case 'shield': return this._genShield(p);
      case 'crossbow': return this._genCrossbow(p);
      case 'witch': return this._genWitch(p);
      case 'assassin': return this._genAssassin(p);
      default: return [];
    }
  }

  _push(out, p, c, r) {
    const k = this._evalDest(p, c, r);
    if (k) out.push({ col: c, row: r, kind: k });
  }

  _genKing(p) {
    const out = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
      const c = p.col + dc, r = p.row + dr;
      if (this.inPalace(p.owner, c, r)) this._push(out, p, c, r);
    }
    if (p.flags.swiftKing) {
      // 急令：九宫内沿空格再走一步（双步机动，仅落空格）
      const seen = new Set(out.map(m => `${m.col},${m.row}`));
      for (const m of [...out]) {
        if (m.kind !== 'move') continue;
        for (const [dc, dr] of dirs) {
          const c = m.col + dc, r = m.row + dr, key = `${c},${r}`;
          if (this.inPalace(p.owner, c, r) && this.count(c, r) === 0 &&
              !seen.has(key) && !(c === p.col && r === p.row)) {
            out.push({ col: c, row: r, kind: 'move' }); seen.add(key);
          }
        }
      }
    }
    return out;
  }
  _genAdvisor(p) {
    const out = [];
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const c = p.col + dc, r = p.row + dr;
      if (this.inPalace(p.owner, c, r)) this._push(out, p, c, r);
    }
    return out;
  }
  _genElephant(p) {
    const out = [];
    for (const [dc, dr] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const eyeC = p.col + dc / 2, eyeR = p.row + dr / 2;     // 象眼（塞田）
      if (!this.inBounds(eyeC, eyeR)) continue;
      if (!p.flags.phaseMove && this.count(eyeC, eyeR) > 0) continue; // 伪装可无视塞田
      this._push(out, p, p.col + dc, p.row + dr);
    }
    return out;
  }
  _genHorse(p) {
    const out = [];
    const legs = [
      { d: [1, 2], leg: [0, 1] }, { d: [-1, 2], leg: [0, 1] },
      { d: [1, -2], leg: [0, -1] }, { d: [-1, -2], leg: [0, -1] },
      { d: [2, 1], leg: [1, 0] }, { d: [2, -1], leg: [1, 0] },
      { d: [-2, 1], leg: [-1, 0] }, { d: [-2, -1], leg: [-1, 0] },
    ];
    for (const { d, leg } of legs) {
      const lc = p.col + leg[0], lr = p.row + leg[1];
      if (!p.flags.ignoreLeg && (this.inBounds(lc, lr) && this.count(lc, lr) > 0)) continue; // 蹩腿
      this._push(out, p, p.col + d[0], p.row + d[1]);
    }
    return out;
  }
  _genLine(p, isCannon) {
    const out = [];
    const debuff = p.flags.moveDebuff ? 1 : 0;                 // 震慑：移动力-1
    const base = this.heavyWounded(p) ? Math.max(1, Math.floor(15 / 2)) : 15; // 重伤减半
    const maxStep = Math.max(1, base - debuff);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
      let c = p.col + dc, r = p.row + dr, taken = 0;
      while (this.inBounds(c, r) && taken < maxStep) {
        const altarMove = this._evalDest(p, c, r) === 'altar';
        if (altarMove) { out.push({ col: c, row: r, kind: 'altar' }); break; }
        if (!this.isBoardCell(c, r)) break;
        if (this._mudBlocks(p, c, r)) break;         // 泥沼挡路，敌方车/炮无法穿过
        if (this.count(c, r) === 0) {
          out.push({ col: c, row: r, kind: 'move' });
        } else {
          if (!isCannon && this._attackTargetAt(p, c, r))
            out.push({ col: c, row: r, kind: 'attack' });
          break; // 遇子停止（车可吃，炮停）
        }
        c += dc; r += dr; taken++;
      }
    }
    return out;
  }
  _genCannon(p) {
    // 移动同车（仅空格，不吃）；吃子需一个炮架；校准时可无视炮架直接打第一个敌人
    const out = this._genLine(p, true);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dc, dr] of dirs) {
      let c = p.col + dc, r = p.row + dr, screen = 0;
      while (this.inBounds(c, r)) {
        if (!this.isBoardCell(c, r)) break;
        const cnt = this.count(c, r);
        if (cnt === 0) { c += dc; r += dr; continue; }
        if (p.flags.calibrate && screen === 0) {              // 校准：直射第一个敌人
          if (this._attackTargetAt(p, c, r) && !this._mudBlocks(p, c, r))
            out.push({ col: c, row: r, kind: 'attack' });
          break;
        }
        if (screen === 0) { screen = 1; c += dc; r += dr; continue; } // 炮架
        if (this._attackTargetAt(p, c, r) && !this._mudBlocks(p, c, r)) // 炮架之后第一个敌人
          out.push({ col: c, row: r, kind: 'attack' });
        break;
      }
    }
    return out;
  }
  _genPawn(p) {
    const out = [];
    const fwd = p.owner === 'r' ? 1 : -1;
    this._push(out, p, p.col, p.row + fwd);              // 前进
    if (p.crossed) {                                     // 过河后可左右
      this._push(out, p, p.col - 1, p.row);
      this._push(out, p, p.col + 1, p.row);
    }
    return out;
  }
  _genShield(p) {
    const out = [];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this._push(out, p, p.col + dc, p.row + dr);
    return out;
  }
  _genCrossbow(p) {
    const out = [];
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      if (dc || dr) this._push(out, p, p.col + dc, p.row + dr);
    }
    return out;
  }
  _genWitch(p) {
    const out = [];
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (let step = 1; step <= 2; step++) {
        const c = p.col + dc * step, r = p.row + dr * step;
        const k = this._evalDest(p, c, r);
        if (!k) break;
        out.push({ col: c, row: r, kind: k });
        if (k !== 'move') break;
      }
    }
    return out;
  }
  _genAssassin(p) {
    const out = [];
    for (const [dc, dr] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this._push(out, p, p.col + dc, p.row + dr);
    for (const [dc, dr] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const midC = p.col + dc / 2, midR = p.row + dr / 2;
      if (this.inBounds(midC, midR) && this.count(midC, midR) === 0) this._push(out, p, p.col + dc, p.row + dr);
    }
    return out;
  }

  // ---- 执行移动/攻击 --------------------------------------------------------
  _removeFromCell(p) {
    const a = this.board[p.row][p.col];
    const i = a.indexOf(p);
    if (i >= 0) a.splice(i, 1);
  }
  _placeAt(p, c, r) {
    this.board[r][c].push(p);
    p.col = c; p.row = r;
    if (p.type === 'P') {
      if ((p.owner === 'r' && r >= RIVER.redCrossRow) ||
          (p.owner === 'b' && r <= RIVER.blackCrossRow)) p.crossed = true;
    }
  }
  _gainEnergy(p, amt) {
    if (isEnergyFlow(p.col, p.row)) amt *= 2;
    p.energy = Math.min(p.energyCap, p.energy + amt);
  }
  _gainHurtEnergy(p) {
    if (p.hurtCount < E_HURT_MAX) { this._gainEnergy(p, E_HURT); p.hurtCount++; }
  }

  isInvincible(p) { return this.turn < (p.flags.invincibleUntil || 0); }
  isUntargetable(p) { return this.turn < (p.flags.untargetableUntil || 0); }
  _linkPartner(p) {
    for (const l of this.links) {
      if (l.a === p.id) return this.pieces.find(q => q.id === l.b);
      if (l.b === p.id) return this.pieces.find(q => q.id === l.a);
    }
    return null;
  }

  // 统一伤害结算；amount 已是最终值（外部算好护甲）。返回是否击杀。
  _dealDamage(target, amount, { applyCover = false, shared = false } = {}) {
    if (!this.pieces.includes(target)) return false;       // 已阵亡
    if (this.isInvincible(target)) return false;           // 献祭守护：免伤
    let dmg = Math.max(0, Math.floor(amount));
    if (applyCover && this.isSuppressed(target)) dmg = Math.floor(dmg / 2); // 压制者50%掩护
    // 灵魂链接：40% 伤害转移给链接对象（不再二次转移）
    if (!shared && dmg > 0) {
      const partner = this._linkPartner(target);
      if (partner) {
        const moved = Math.floor(dmg * 0.4);
        if (moved > 0) {
          dmg -= moved;
          this._dealDamage(partner, moved, { shared: true });
        }
      }
    }
    target.hp -= dmg;
    if (dmg > 0) this._gainHurtEnergy(target);
    if (target.hp <= 0) { this._kill(target); return true; }
    return false;
  }
  _kill(p) {
    this._removeFromCell(p);
    const i = this.pieces.indexOf(p);
    if (i >= 0) this.pieces.splice(i, 1);
    this.graveyard.push({ type: p.type, owner: p.owner });
    this.links = this.links.filter(l => l.a !== p.id && l.b !== p.id); // 断开其链接
    this._log(`${p.owner === 'r' ? '红' : '黑'}·${this.pieceName(p)} 阵亡`);
    if (p.type === 'K') this.winner = this.enemyOf(p.owner);
  }

  // 玩家点击落点：移动或普通攻击。返回 {ok, info}
  act(p, col, row) {
    if (this.winner) return { ok: false, info: '对局已结束' };
    if (p.owner !== this.current) return { ok: false, info: '不是你的回合' };
    const legal = this.legalMoves(p).find(m => m.col === col && m.row === row);
    if (!legal) return { ok: false, info: '非法落点' };

    if (legal.kind === 'altar') {
      const info = this._sacrificeAtAltar(p);
      this._endTurn();
      return { ok: true, info };
    }

    if (legal.kind === 'move' || legal.kind === 'teleport') {
      this._removeFromCell(p);
      this._placeAt(p, col, row);
      this._gainEnergy(p, E_MOVE);
      this._consumeMoveBuffs(p);
      p.flags.riftArmed = false;                      // 瞬移后落地眩晕（回合结束）
      this._log(legal.kind === 'teleport' ? `${this.pieceName(p)} 穿越时空裂隙` : `${this.pieceName(p)} 移动`);
      this._endTurn();
      return { ok: true, info: legal.kind === 'teleport' ? '瞬移' : '移动' };
    }
    // 攻击
    const defender = this._attackTargetAt(p, col, row);
    if (!defender) return { ok: false, info: '目标无效' };
    const res = this._normalAttack(p, defender, col, row);
    this._endTurn();
    return { ok: true, info: res };
  }

  _sacrificeAtAltar(p) {
    const owner = p.owner;
    this.altarUsed[owner] = true;
    this._kill(p);
    let healed = 0;
    for (const q of this.alivePieces(owner)) {
      q.hp = Math.min(q.maxHp, q.hp + 10);
      q.flags.moveDebuff = false;
      q.flags.tremor = false;
      healed++;
    }
    this._log(`${owner === 'r' ? 'Red' : 'Black'} altar sacrifice healed ${healed} allies`);
    return `Altar sacrifice: ${healed} allies healed`;
  }

  _consumeMoveBuffs(p) {
    p.flags.ignoreLeg = false;
    p.flags.atkPenalty = 0;
    p.flags.swiftKing = false;
    p.flags.phaseMove = false;
  }

  // 普通攻击（含轻骑减攻、激昂、校准返还、堆叠/击杀位移）
  _normalAttack(attacker, defender, col, row) {
    let dmg = Math.max(1, this.effAtk(attacker) - this.effDef(defender));
    if (attacker.buffs.inspired) { dmg = Math.floor(dmg * 1.5); attacker.buffs.inspired = false; }
    const calibrated = attacker.flags.calibrate;
    const holdPosition = this.count(col, row) >= 2;
    if (holdPosition && this.isSuppressed(defender)) dmg = Math.floor(dmg / 2);
    const preview = `${this.pieceName(attacker)} 攻击 ${this.pieceName(defender)}，${dmg}伤害`;
    const killed = this._dealDamage(defender, dmg);
    this._gainEnergy(attacker, E_ATTACK);
    attacker.flags.calibrate = false;
    this._consumeMoveBuffs(attacker);

    if (holdPosition) {
      this._log(`${preview} · 外部攻击堆叠`);
      return killed ? `${preview}，击杀，位置不变` : `${preview}，位置不变`;
    }

    if (killed) {
      if (calibrated) this._gainEnergy(attacker, 10);         // 校准击杀返还
      this._removeFromCell(attacker);
      this._placeAt(attacker, col, row);                      // 击杀后进入目标格
      this._log(`${preview} · 击杀`);
      return `${preview}，击杀并占位`;
    }
    // 未击杀 -> 堆叠压制：攻击方成为压制者（上层）
    this._removeFromCell(attacker);
    this.board[row][col].push(attacker);                       // 压在目标格上层
    attacker.col = col; attacker.row = row;
    this._log(`${preview} · 堆叠压制`);
    return `${preview}，未击杀，形成堆叠（你方在上）`;
  }

  // ---- 技能 -----------------------------------------------------------------
  skillDefs(p) { return SKILLS[p.type] || []; }
  skillDef(p, id) { return this.skillDefs(p).find(s => s.id === id); }

  canUseSkill(p, id) {
    if (this.winner) return { ok: false, reason: '对局已结束' };
    if (p.owner !== this.current) return { ok: false, reason: '不是你的回合' };
    const s = this.skillDef(p, id);
    if (!s) return { ok: false, reason: '无此技能' };
    if (!s.impl) return { ok: false, reason: '该技能即将开放' };
    if (this.isSuppressed(p)) return { ok: false, reason: '被压制时无法使用技能' };
    if (p.usedSkillThisTurn) return { ok: false, reason: '本回合该子已用过技能' };
    if (p.energy < s.cost) return { ok: false, reason: `能量不足（需${s.cost}）` };
    const cd = p.cooldowns[id] || 0;
    if (cd > 0) return { ok: false, reason: `冷却中（剩${cd}回合）` };
    if (s.global) {
      const used = this.globalSkills[p.owner][id] || 0;
      if (used >= s.global) return { ok: false, reason: '全局次数已用尽' };
    }
    return { ok: true, reason: '' };
  }

  // 需要选目标的技能，返回可选目标格列表（自/无目标返回 null）
  skillTargets(p, id) {
    const s = this.skillDef(p, id);
    if (!s) return null;
    if (id === 'a_guard') {       // 自身或相邻友军
      const out = [{ col: p.col, row: p.row }];
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const c = p.col + dc, r = p.row + dr;
        const t = this.top(c, r);
        if (t && t.owner === p.owner) out.push({ col: c, row: r });
      }
      return out;
    }
    if (id === 'c_railgun') {     // 四正方向的第一个敌人（无视炮架/阻挡）
      const out = [];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let c = p.col + dc, r = p.row + dr;
        while (this.inBounds(c, r)) {
          const t = this.top(c, r);
          if (t) { if (t.owner !== p.owner && !this.isUntargetable(t)) out.push({ col: c, row: r }); break; }
          c += dc; r += dr;
        }
      }
      return out;
    }
    if (id === 'a_link') {        // 任意其他友军
      const out = [];
      for (const q of this.alivePieces(p.owner)) {
        if (q !== p && !this._linkPartner(q)) out.push({ col: q.col, row: q.row });
      }
      return out;
    }
    if (id === 'b_phase') {       // 任意友军相邻的空格
      const set = new Set(), out = [];
      for (const q of this.alivePieces(p.owner)) {
        for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
          if (!dc && !dr) continue;
          const c = q.col + dc, r = q.row + dr, key = `${c},${r}`;
          if (this.isBoardCell(c, r) && this.count(c, r) === 0 && !set.has(key)) { set.add(key); out.push({ col: c, row: r }); }
        }
      }
      return out;
    }
    if (id === 'n_eightstep') {   // 无视蹩腿、最多三跳可达的空格或敌方
      return this._knightReach(p, 3);
    }
    if (id === 'n_dragon' || id === 'r_warmachine') { // 传送/冲锋落点：任意空格
      const out = [];
      for (let r = 1; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++)
        if (this.count(c, r) === 0) out.push({ col: c, row: r });
      return out;
    }
    if (id === 'r_charge') {      // 直线方向上的空格落点（可碾过敌方，遇友军止步）
      const out = [];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let c = p.col + dc, r = p.row + dr;
        while (this.inBounds(c, r)) {
          if (!this.isBoardCell(c, r)) break;
          const t = this.top(c, r);
          if (t && t.owner === p.owner) break;          // 不碾己方
          if (this.count(c, r) === 0) out.push({ col: c, row: r });
          c += dc; r += dr;
        }
      }
      return out;
    }
    if (id === 'b_domain' || id === 'c_orbital') { // 任意格
      const out = [];
      for (let r = 1; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) out.push({ col: c, row: r });
      return out;
    }
    if (id === 'd_cover') {
      const out = [{ col: p.col, row: p.row }];
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        if (!dc && !dr) continue;
        const t = this.top(p.col + dc, p.row + dr);
        if (t && t.owner === p.owner) out.push({ col: t.col, row: t.row });
      }
      return out;
    }
    if (id === 'x_mark') return this._enemyTargetsInRange(p, 3);
    if (id === 'x_pierce') return this._firstEnemiesInLines(p, 5, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
    if (id === 'w_cleanse') return this._allyTargetsInRange(p, 2);
    if (id === 'w_drain') return this._enemyTargetsInRange(p, 3);
    if (id === 's_backstab') return this._enemyTargetsInRange(p, 2);
    if (id === 's_execute') return this._enemyTargetsInRange(p, 4);
    if (id === 'x_rain') {
      const out = [];
      for (let r = 1; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) out.push({ col: c, row: r });
      return out;
    }
    return null; // self / none
  }

  _enemyTargetsInRange(p, range) {
    const out = [];
    for (const e of this.alivePieces(this.enemyOf(p.owner))) {
      if (this.isUntargetable(e)) continue;
      if (Math.max(Math.abs(e.col - p.col), Math.abs(e.row - p.row)) <= range) out.push({ col: e.col, row: e.row });
    }
    return out;
  }
  _allyTargetsInRange(p, range) {
    const out = [];
    for (const q of this.alivePieces(p.owner)) {
      if (Math.max(Math.abs(q.col - p.col), Math.abs(q.row - p.row)) <= range) out.push({ col: q.col, row: q.row });
    }
    return out;
  }
  _firstEnemiesInLines(p, range, dirs) {
    const out = [];
    for (const [dc, dr] of dirs) {
      let c = p.col + dc, r = p.row + dr, step = 1;
      while (this.isBoardCell(c, r) && step <= range) {
        const t = this._attackTargetAt(p, c, r);
        if (t) { if (!this.isUntargetable(t)) out.push({ col: c, row: r }); break; }
        if (this.count(c, r) > 0) break;
        c += dc; r += dr; step++;
      }
    }
    return out;
  }

  // 无视蹩腿，BFS 最多 maxJumps 步可达：空格（可落）与敌方格（可攻击）
  _knightReach(p, maxJumps) {
    const jumps = [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
    const start = `${p.col},${p.row}`;
    let frontier = [{ c: p.col, r: p.row }];
    const visited = new Set([start]);
    const empties = new Set(), enemies = new Set();
    for (let step = 0; step < maxJumps; step++) {
      const next = [];
      for (const { c, r } of frontier) {
        for (const [dc, dr] of jumps) {
          const nc = c + dc, nr = r + dr, key = `${nc},${nr}`;
          if (!this.isBoardCell(nc, nr) || visited.has(key)) continue;
          const t = this.top(nc, nr);
          if (!t) { visited.add(key); empties.add(key); next.push({ c: nc, r: nr }); }
          else if (t.owner !== p.owner && !this.isUntargetable(t)) { enemies.add(key); } // 敌方为终点，不再延伸
        }
      }
      frontier = next;
    }
    const toCell = (k) => ({ col: +k.split(',')[0], row: +k.split(',')[1] });
    return [...empties, ...enemies].map(toCell);
  }

  // target: {col,row} 或 {col,row,variant} 或 null
  useSkill(p, id, target) {
    const chk = this.canUseSkill(p, id);
    if (!chk.ok) return { ok: false, info: chk.reason };
    const s = this.skillDef(p, id);

    const handler = this[`_skill_${id}`];
    if (!handler) return { ok: false, info: '技能未实现' };
    const result = handler.call(this, p, target);
    if (!result.ok) return result;

    // 通用结算
    p.energy -= s.cost;
    if (s.cd) p.cooldowns[id] = s.cd + 1; // +1 抵消本回合末的统一递减
    if (s.global) this.globalSkills[p.owner][id] = (this.globalSkills[p.owner][id] || 0) + 1;
    p.usedSkillThisTurn = true;
    this._log(`${this.pieceName(p)} 施放「${s.name}」`);

    if (!result.instant) this._endTurn();   // instant（轻骑/校准）不结束回合
    return { ok: true, info: result.info, instant: !!result.instant };
  }

  // --- 各技能实现 ---
  _skill_k_tianming(p) {
    p.hp = Math.min(p.maxHp, p.hp + 10);
    let n = 0;
    for (const q of this.alivePieces(p.owner)) {
      if (Math.abs(q.col - p.col) <= 1 && Math.abs(q.row - p.row) <= 1) { q.buffs.inspired = true; n++; }
    }
    return { ok: true, info: `回复10HP，${n}个友军获得激昂` };
  }
  _skill_k_doomsday(p) {
    let total = 0;
    for (const e of [...this.alivePieces(this.enemyOf(p.owner))]) {
      const d = Math.floor((e.maxHp - e.hp) * 0.5);
      if (d > 0) { this._dealDamage(e, d); total += d; }
    }
    const allies = this.alivePieces(p.owner).filter(q => q.type !== 'K');
    if (allies.length) {
      const victim = allies[Math.floor(Math.random() * allies.length)];
      this._dealDamage(victim, 15);
    }
    return { ok: true, info: `末日裁决：敌方共受${total}伤害` };
  }
  _skill_a_guard(p, target) {
    if (!target) return { ok: false, info: '需选择目标' };
    const t = this.top(target.col, target.row);
    if (!t || t.owner !== p.owner) return { ok: false, info: '目标无效' };
    t.tempArmor += 2;
    t.tempArmorExpire = this.turn + 2; // 持续到敌方下回合结束
    return { ok: true, info: `${this.pieceName(t)} 获得2点临时护甲` };
  }
  _skill_b_domain(p, target) {
    if (!target || !target.variant) return { ok: false, info: '需选择中心与类型' };
    const kind = target.variant === 'mud' ? 'mud' : 'wind';
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const c = target.col + dc, r = target.row + dr;
      if (this.isBoardCell(c, r)) this.terrain[`${c},${r}`] = { kind, owner: p.owner };
    }
    return { ok: true, info: `3×3 区域改写为${kind === 'mud' ? '泥沼（敌方难行）' : '疾风（己方加速）'}` };
  }
  _skill_n_light(p) {
    p.flags.ignoreLeg = true;
    p.flags.atkPenalty = 2;
    return { ok: true, info: '本回合无视蹩腿（攻击-2），可继续移动', instant: true };
  }
  _skill_r_shock(p) {
    let n = 0;
    for (const e of this.alivePieces(this.enemyOf(p.owner))) {
      const sameLine = (e.col === p.col || e.row === p.row);
      const dist = Math.abs(e.col - p.col) + Math.abs(e.row - p.row);
      if (sameLine && dist <= 3) { e.flags.moveDebuff = true; n++; }
    }
    return { ok: true, info: `震慑 ${n} 个敌方单位` };
  }
  _skill_c_calibrate(p) {
    p.flags.calibrate = true;
    return { ok: true, info: '下次攻击无视炮架，可继续行动', instant: true };
  }
  _skill_c_railgun(p, target) {
    if (!target) return { ok: false, info: '需选择敌方目标' };
    const t = this.top(target.col, target.row);
    if (!t || t.owner === p.owner) return { ok: false, info: '目标无效' };
    // 12 真实伤害（无视护甲），击退到尽头
    const dirC = Math.sign(target.col - p.col), dirR = Math.sign(target.row - p.row);
    const killed = this._dealDamage(t, 12);
    this._gainEnergy(p, E_ATTACK);
    if (!killed) this._knockback(t, dirC, dirR);
    return { ok: true, info: `超电磁炮命中，12真实伤害` };
  }
  _skill_p_advance(p) {
    const fwd = p.owner === 'r' ? 1 : -1;
    const c = p.col, r = p.row + fwd;
    const k = this._evalDest(p, c, r);
    if (!k) return { ok: false, info: '前方无法突进' };
    if (k === 'move') {
      this._removeFromCell(p); this._placeAt(p, c, r); this._gainEnergy(p, E_MOVE);
      return { ok: true, info: '奋进突进一格' };
    }
    const defender = this.top(c, r);
    const info = this._normalAttack(p, defender, c, r);
    return { ok: true, info: '奋进：' + info };
  }
  _skill_k_jiling(p) {
    p.flags.swiftKing = true;
    return { ok: true, info: '急令：本回合可在九宫内连走两步', instant: true };
  }
  _skill_a_link(p, target) {
    if (!target) return { ok: false, info: '需选择友军' };
    const t = this.top(target.col, target.row);
    if (!t || t.owner !== p.owner || t === p) return { ok: false, info: '目标无效' };
    if (this.links.filter(l => l.owner === p.owner).length >= 2) return { ok: false, info: '链接已达上限(2)' };
    if (this._linkPartner(p) || this._linkPartner(t)) return { ok: false, info: '该子已被链接' };
    this.links.push({ a: p.id, b: t.id, owner: p.owner });
    return { ok: true, info: `与 ${this.pieceName(t)} 建立灵魂链接` };
  }
  _skill_a_sacrifice(p) {
    // 本回合内（含敌方下回合）所有友军免伤
    for (const q of this.alivePieces(p.owner)) q.flags.invincibleUntil = this.turn + 2;
    this.pendingRevive[p.owner] = Math.min(3, this.pendingRevive[p.owner] + 3);
    this._kill(p); // 献祭自身
    return { ok: true, info: '献祭守护：友军免伤，下回合复活阵亡兵' };
  }
  _skill_b_disguise(p) {
    p.flags.untargetableUntil = this.turn + 2;
    p.flags.phaseMove = true;
    return { ok: true, info: '伪装：不可被选取，下次移动可穿子', instant: true };
  }
  _skill_b_phase(p, target) {
    if (!target || this.count(target.col, target.row) !== 0) return { ok: false, info: '落点须为空格' };
    this._removeFromCell(p);
    this._placeAt(p, target.col, target.row);
    p.flags.untargetableUntil = this.turn + 2;
    return { ok: true, info: '相位转移完成' };
  }
  _skill_n_eightstep(p, target) {
    if (!target) return { ok: false, info: '需选择落点' };
    const t = this.top(target.col, target.row);
    if (t && t.owner !== p.owner) {                 // 落点为敌方 -> 攻击
      const info = this._normalAttack(p, t, target.col, target.row);
      return { ok: true, info: '八步赶蝉：' + info };
    }
    if (t) return { ok: false, info: '落点无效' };
    this._removeFromCell(p); this._placeAt(p, target.col, target.row);
    this._dealDamage(p, 10);                          // 未攻击 -> 自伤10
    return { ok: true, info: '八步赶蝉：未命中敌方，自伤10' };
  }
  _skill_n_dragon(p, target) {
    if (!target || this.count(target.col, target.row) !== 0) return { ok: false, info: '落点须为空格' };
    let hit = 0;
    for (const e of [...this.alivePieces(this.enemyOf(p.owner))]) {
      if (e.col === p.col || e.row === p.row) { this._dealDamage(e, 8); hit++; } // 同行同列
    }
    this._removeFromCell(p); this._placeAt(p, target.col, target.row);
    p.energyCap = Math.max(0, p.energyCap - 20);
    p.energy = Math.min(p.energy, p.energyCap);
    return { ok: true, info: `天翔龙闪：命中${hit}个敌方，能量上限-20` };
  }
  _skill_r_charge(p, target) {
    if (!target || this.count(target.col, target.row) !== 0) return { ok: false, info: '落点须为空格' };
    const dc = Math.sign(target.col - p.col), dr = Math.sign(target.row - p.row);
    if ((dc !== 0) === (dr !== 0)) return { ok: false, info: '只能直线冲锋' }; // 必须正交
    let c = p.col + dc, r = p.row + dr, hit = 0;
    while (!(c === target.col && r === target.row) && this.inBounds(c, r)) {
      const e = this.top(c, r);
      if (e && e.owner !== p.owner) { this._dealDamage(e, 5); this._knockback(e, dc, dr); hit++; }
      c += dc; r += dr;
    }
    this._removeFromCell(p); this._placeAt(p, target.col, target.row);
    return { ok: true, info: `毁灭冲锋：碾过${hit}个敌方` };
  }
  _skill_r_warmachine(p, target) {
    if (!target || this.count(target.col, target.row) !== 0) return { ok: false, info: '落点须为空格' };
    const dc = Math.sign(target.col - p.col), dr = Math.sign(target.row - p.row);
    if ((dc !== 0) === (dr !== 0)) return { ok: false, info: '只能直线冲锋' };
    let c = p.col + dc, r = p.row + dr;
    while (!(c === target.col && r === target.row) && this.inBounds(c, r)) {
      const e = this.top(c, r);
      if (e && e.owner !== p.owner) e.flags.tremor = true;  // 沿途敌方震颤
      c += dc; r += dr;
    }
    this._removeFromCell(p); this._placeAt(p, target.col, target.row);
    // 抵达后自爆：3×3 12 真实伤害（含自身），随后战车阵亡
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      for (const q of [...(this.board[target.row + y]?.[target.col + x] || [])]) this._dealDamage(q, 12);
    }
    if (this.pieces.includes(p)) this._kill(p);
    return { ok: true, info: '末日战车自爆' };
  }
  _skill_c_orbital(p, target) {
    if (!target) return { ok: false, info: '需选择轰炸格' };
    this.marks.push({ col: target.col, row: target.row, owner: p.owner, fireTurn: this.turn + 2 });
    return { ok: true, info: '已标记轨道轰炸，下个己方回合引爆' };
  }
  _skill_p_martyr(p) {
    if (!p.crossed) return { ok: false, info: '过河后才能自爆' };
    const cx = p.col, cy = p.row;
    this._kill(p);                                   // 先移除自身，避免炸到自己
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
      const row = this.board[cy + y]; if (!row) continue;
      for (const q of [...(row[cx + x] || [])]) this._dealDamage(q, 8);
    }
    this.terrain[`${cx},${cy}`] = { kind: 'crater', owner: null }; // 弹坑
    return { ok: true, info: '死士自爆：5×5 范围8真实伤害，留下弹坑' };
  }
  _skill_p_apocalypse(p) {
    const deadPawns = this.graveyard.filter(g => g.owner === p.owner && g.type === 'P').length;
    const alivePawns = this.alivePieces(p.owner).filter(q => q.type === 'P').length;
    if (deadPawns < 4 || alivePawns > 1) return { ok: false, info: '需已阵亡4个兵且仅剩此兵' };
    const ek = this.king(this.enemyOf(p.owner));
    this._kill(p);
    if (ek) {
      for (let c = 0; c < COLS; c++) this.terrain[`${c},${ek.row}`] = { kind: 'crater', owner: null }; // 整行废墟
      this._dealDamage(ek, 30);
    }
    return { ok: true, info: '末日降临：敌方将帅整行化为废墟' };
  }

  _cleanseDebuffs(q) {
    q.flags.moveDebuff = false;
    q.flags.tremor = false;
    if (q.tempArmor < 0) q.tempArmor = 0;
  }
  _emptyAdjacentTo(c, r) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (this.isBoardCell(nc, nr) && this.count(nc, nr) === 0) return { col: nc, row: nr };
    }
    return null;
  }

  _skill_d_bulwark(p) {
    p.tempArmor += 3;
    p.tempArmorExpire = this.turn + 2;
    return { ok: true, info: '铁壁：护甲+3，可继续行动', instant: true };
  }
  _skill_d_cover(p, target) {
    if (!target) return { ok: false, info: '需要选择友军' };
    const t = this.top(target.col, target.row);
    if (!t || t.owner !== p.owner || Math.max(Math.abs(t.col - p.col), Math.abs(t.row - p.row)) > 1)
      return { ok: false, info: '目标无效' };
    t.tempArmor += 4;
    t.tempArmorExpire = this.turn + 2;
    this._cleanseDebuffs(t);
    return { ok: true, info: `${this.pieceName(t)} 获得援护` };
  }
  _skill_d_fortress(p) {
    let n = 0;
    for (const q of this.alivePieces(p.owner)) {
      if (Math.max(Math.abs(q.col - p.col), Math.abs(q.row - p.row)) <= 2) {
        q.hp = Math.min(q.maxHp, q.hp + 4);
        q.tempArmor += 2;
        q.tempArmorExpire = this.turn + 2;
        n++;
      }
    }
    return { ok: true, info: `不破阵线：强化${n}个友军` };
  }

  _skill_x_mark(p, target) {
    const t = target && this._attackTargetAt(p, target.col, target.row);
    if (!t) return { ok: false, info: '目标无效' };
    t.flags.moveDebuff = true;
    t.tempArmor -= 1;
    t.tempArmorExpire = this.turn + 2;
    return { ok: true, info: `${this.pieceName(t)} 被破甲标记`, instant: true };
  }
  _skill_x_pierce(p, target) {
    const t = target && this._attackTargetAt(p, target.col, target.row);
    if (!t) return { ok: false, info: '目标无效' };
    this._dealDamage(t, 10);
    return { ok: true, info: '贯穿弩矢：10真实伤害' };
  }
  _skill_x_rain(p, target) {
    if (!target) return { ok: false, info: '需要选择中心格' };
    let hit = 0;
    for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
      const stack = this.board[target.row + dr]?.[target.col + dc] || [];
      for (const q of [...stack]) {
        if (q.owner !== p.owner) {
          this._dealDamage(q, dc === 0 && dr === 0 ? 12 : 8);
          hit++;
        }
      }
    }
    return { ok: true, info: `箭雨封域：命中${hit}个敌军` };
  }

  _skill_w_cleanse(p, target) {
    if (!target) return { ok: false, info: '需要选择友军' };
    const t = this.top(target.col, target.row);
    if (!t || t.owner !== p.owner || Math.max(Math.abs(t.col - p.col), Math.abs(t.row - p.row)) > 2)
      return { ok: false, info: '目标无效' };
    t.hp = Math.min(t.maxHp, t.hp + 6);
    this._cleanseDebuffs(t);
    return { ok: true, info: `${this.pieceName(t)} 回复并净化` };
  }
  _skill_w_drain(p, target) {
    const t = target && this._attackTargetAt(p, target.col, target.row);
    if (!t) return { ok: false, info: '目标无效' };
    const drained = Math.min(25, t.energy || 0);
    t.energy -= drained;
    p.energy = Math.min(p.energyCap, p.energy + drained);
    this._dealDamage(t, 4);
    return { ok: true, info: `蚀能：抽取${drained}能量` };
  }
  _skill_w_confluence(p) {
    for (const q of this.alivePieces(p.owner)) {
      q.energy = Math.min(q.energyCap, q.energy + 15);
      this._cleanseDebuffs(q);
    }
    let drained = 0;
    for (const e of this.alivePieces(this.enemyOf(p.owner))) {
      if (Math.max(Math.abs(e.col - p.col), Math.abs(e.row - p.row)) <= 3) {
        const d = Math.min(15, e.energy || 0);
        e.energy -= d; drained += d;
      }
    }
    return { ok: true, info: `灵潮共鸣：友军充能，敌军失去${drained}能量` };
  }

  _skill_s_shadow(p) {
    p.flags.untargetableUntil = this.turn + 2;
    return { ok: true, info: '潜影：本回合不可被技能选中', instant: true };
  }
  _skill_s_backstab(p, target) {
    const t = target && this._attackTargetAt(p, target.col, target.row);
    if (!t) return { ok: false, info: '目标无效' };
    const dmg = 8 + ((this.heavyWounded(t) || this.isSuppressed(t)) ? 5 : 0);
    this._dealDamage(t, dmg);
    return { ok: true, info: `背刺：${dmg}真实伤害` };
  }
  _skill_s_execute(p, target) {
    const t = target && this._attackTargetAt(p, target.col, target.row);
    if (!t) return { ok: false, info: '目标无效' };
    const c = t.col, r = t.row;
    this._dealDamage(t, 16);
    const dest = this.pieces.includes(t) ? this._emptyAdjacentTo(c, r) : (this.count(c, r) === 0 ? { col: c, row: r } : this._emptyAdjacentTo(c, r));
    if (dest) { this._removeFromCell(p); this._placeAt(p, dest.col, dest.row); }
    return { ok: true, info: '影杀：16真实伤害并闪现' };
  }

  _knockback(target, dc, dr) {
    if (dc === 0 && dr === 0) return;
    let c = target.col, r = target.row, lastC = c, lastR = r;
    while (true) {
      const nc = c + dc, nr = r + dr;
      if (!this.inBounds(nc, nr)) { this._dealDamage(target, 5); break; } // 撞墙额外5
      if (!this.isBoardCell(nc, nr)) { this._dealDamage(target, 5); break; }
      if (this.count(nc, nr) === 0) { lastC = nc; lastR = nr; c = nc; r = nr; continue; }
      // 撞到棋子：额外5伤；若该格仅1子则压上去形成堆叠
      this._dealDamage(target, 5);
      if (this.count(nc, nr) === 1) { lastC = nc; lastR = nr; }
      break;
    }
    if (this.pieces.includes(target) && (lastC !== target.col || lastR !== target.row)) {
      this._removeFromCell(target);
      this.board[lastR][lastC].push(target);
      target.col = lastC; target.row = lastR;
    }
  }

  // ---- 回合流程 -------------------------------------------------------------
  _endTurn() {
    // 结束阶段：仅结算「行动方」的棋子，使每个棋子每一轮只触发一次
    // （能量洪流/弹坑伤害、回血都在该子所属方的回合末发生，而不是每一手都触发，
    //  否则刚打掉的敌方血会被立刻回满、导致杀不死人）。
    for (const p of [...this.pieces]) {
      if (p.owner !== this.current) continue;
      if (isEnergyFlow(p.col, p.row)) this._dealDamage(p, FLOW_DAMAGE);
      if (this.terrainAt(p.col, p.row) === 'crater') this._dealDamage(p, 2); // 弹坑
    }
    for (const p of this.pieces) {
      if (p.owner === this.current) {
        const regen = REGEN + (isCamp(p.owner, p.row) ? CAMP_REGEN : 0);
        p.hp = Math.min(p.maxHp, p.hp + regen);
        // 震慑「下回合移动力-1」、震颤 在被影响方的回合生效后，于其回合末清除
        p.flags.moveDebuff = false; p.flags.tremor = false;
      }
      if (p.tempArmorExpire && this.turn >= p.tempArmorExpire) { p.tempArmor = 0; p.tempArmorExpire = 0; }
    }
    // 胜负：将帅阵亡（已在 _kill 处理）或回合结束时被压制
    this._checkSuppressLoss();
    if (this.winner) return;

    // 换手
    this.current = this.enemyOf(this.current);
    this.turn += 1;
    this._beginTurn(this.current);
  }

  _checkSuppressLoss() {
    for (const owner of ['r', 'b']) {
      const k = this.king(owner);
      if (k && this.isSuppressed(k)) this.winner = this.enemyOf(owner);
    }
  }

  _beginTurn(side) {
    // 轨道轰炸引爆（己方标记，到期）
    const ready = this.marks.filter(m => m.owner === side && this.turn >= m.fireTurn);
    this.marks = this.marks.filter(m => !(m.owner === side && this.turn >= m.fireTurn));
    for (const m of ready) this._detonateOrbital(m);
    if (this.winner) return;

    // 献祭守护：复活阵亡兵（半血）
    if (this.pendingRevive[side] > 0) { this._reviveePawns(side, this.pendingRevive[side]); this.pendingRevive[side] = 0; }

    for (const p of this.pieces) {
      if (p.owner === side) {
        p.usedSkillThisTurn = false;
        p.hurtCount = 0;
        // 时空裂隙：进入裂隙后的下一个己方回合方可瞬移（落地眩晕=瞬移即结束回合）
        p.flags.riftArmed = isRift(p.col, p.row);
        for (const k of Object.keys(p.cooldowns)) {           // 冷却递减（按己方回合计）
          if (p.cooldowns[k] > 0) p.cooldowns[k] -= 1;
        }
      }
    }
  }

  _detonateOrbital(m) {
    // 该格整行整列 20 真实伤害（将帅减半）
    for (const e of [...this.pieces]) {
      if (e.col === m.col || e.row === m.row) this._dealDamage(e, e.type === 'K' ? 10 : 20);
    }
    this._log(`轨道轰炸在 ${m.col},${m.row} 引爆`);
  }
  _reviveePawns(side, n) {
    let revived = 0;
    const owner = side;
    // 在己方军营找空格放置半血兵
    const rows = owner === 'r' ? [1, 2] : [ROWS - 2, ROWS - 3];
    for (const r of rows) {
      for (let c = 0; c < COLS && revived < n; c++) {
        if (this.count(c, r) !== 0) continue;
        const p = {
          id: _uid++, type: 'P', owner, col: c, row: r,
          maxHp: PIECE_TYPES.P.hp, hp: 6, atk: PIECE_TYPES.P.atk, def: PIECE_TYPES.P.def,
          energy: 0, energyCap: ENERGY_CAP, crossed: false, cooldowns: {},
          usedSkillThisTurn: false, hurtCount: 0, tempArmor: 0, tempArmorExpire: 0,
          buffs: { inspired: false },
          flags: { ignoreLeg: false, atkPenalty: 0, calibrate: false, moveDebuff: false,
            tremor: false, swiftKing: false, phaseMove: false, riftArmed: false,
            invincibleUntil: 0, untargetableUntil: 0 },
        };
        this.pieces.push(p); this.board[r][c].push(p); revived++;
      }
      if (revived >= n) break;
    }
    if (revived) this._log(`献祭守护：复活 ${revived} 个兵`);
  }

  surrender(owner) { this.winner = this.enemyOf(owner); this._log(`${owner === 'r' ? '红' : '黑'}方认输`); }

  // 供 UI 读取的格子地形种类（含奥义改写）；返回 'mud'|'wind'|'crater'|null
  terrainAt(c, r) { return this.terrain[`${c},${r}`]?.kind || null; }
  _terrainEntry(c, r) { return this.terrain[`${c},${r}`] || null; }
  terrainOwnerAt(c, r) { return this.terrain[`${c},${r}`]?.owner || null; }
  // 泥沼：敌方（相对地形拥有者）无法进入/穿过
  _mudBlocks(p, c, r) {
    const e = this._terrainEntry(c, r);
    return !!(e && e.kind === 'mud' && e.owner && e.owner !== p.owner);
  }
  // 疾风：己方棋子站在己方疾风上，移动力+1（仅对步型棋子有意义）
  _onOwnWind(p) {
    const e = this._terrainEntry(p.col, p.row);
    return !!(e && e.kind === 'wind' && e.owner === p.owner);
  }
}
