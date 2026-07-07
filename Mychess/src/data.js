// ============================================================================
// data.js - static data for the chess tactics game.
// Coordinates: col 0..15 (A..P), row 0..13.
// row 0 and row 13 are altar rows; red's home rank starts at row 1.
// ============================================================================

export const COLS = 16;
export const ROWS = 14;

export const PIECE_TYPES = {
  K: { name: '帅', nameB: '将', hp: 30, atk: 5,  def: 0, move: 'king' },
  A: { name: '仕', nameB: '士', hp: 20, atk: 6,  def: 1, move: 'advisor' },
  B: { name: '相', nameB: '象', hp: 22, atk: 6,  def: 2, move: 'elephant' },
  N: { name: '马', nameB: '马', hp: 18, atk: 8,  def: 0, move: 'horse' },
  R: { name: '车', nameB: '车', hp: 25, atk: 10, def: 2, move: 'chariot' },
  C: { name: '炮', nameB: '炮', hp: 16, atk: 12, def: 0, move: 'cannon' },
  P: { name: '兵', nameB: '卒', hp: 12, atk: 4,  def: 0, move: 'pawn' },
  D: { name: '盾', nameB: '盾', hp: 28, atk: 5,  def: 4, move: 'shield' },
  X: { name: '弩', nameB: '弩', hp: 14, atk: 7,  def: 0, move: 'crossbow' },
  W: { name: '巫', nameB: '巫', hp: 16, atk: 3,  def: 1, move: 'witch' },
  S: { name: '刺', nameB: '刺', hp: 15, atk: 9,  def: 0, move: 'assassin' },
};

export const RED_SETUP = [
  { type: 'R', col: 0,  row: 1 }, { type: 'R', col: 15, row: 1 },
  { type: 'N', col: 1,  row: 1 }, { type: 'N', col: 14, row: 1 },
  { type: 'B', col: 3,  row: 1 }, { type: 'B', col: 12, row: 1 },
  { type: 'A', col: 6,  row: 1 }, { type: 'A', col: 8,  row: 1 },
  { type: 'K', col: 7,  row: 1 },
  { type: 'D', col: 4,  row: 2 }, { type: 'X', col: 11, row: 2 },
  { type: 'C', col: 1,  row: 3 }, { type: 'C', col: 14, row: 3 },
  { type: 'W', col: 5,  row: 3 }, { type: 'S', col: 10, row: 3 },
  { type: 'P', col: 0,  row: 4 }, { type: 'P', col: 4,  row: 4 },
  { type: 'P', col: 7,  row: 4 }, { type: 'P', col: 11, row: 4 },
  { type: 'P', col: 15, row: 4 },
];

export const PALACE = {
  r: { cols: [6, 8], rows: [1, 3] },
  b: { cols: [6, 8], rows: [10, 12] },
};

export const RIVER = { redCrossRow: 7, blackCrossRow: 6 };

export const RIFTS = [
  { col: 0, row: 1 }, { col: 0, row: 12 },
  { col: 15, row: 1 }, { col: 15, row: 12 },
];
export const ENERGY_FLOW = [
  { col: 7, row: 6 }, { col: 8, row: 6 },
  { col: 7, row: 7 }, { col: 8, row: 7 },
];
export const ALTARS = {
  r: Array.from({ length: 5 }, (_, i) => ({ col: 5 + i, row: 0 })),
  b: Array.from({ length: 5 }, (_, i) => ({ col: 5 + i, row: 13 })),
};

export function isCamp(owner, row) {
  return owner === 'r' ? row >= 1 && row <= 2 : row >= 11 && row <= 12;
}
export function altarOwnerAt(col, row) {
  for (const owner of ['r', 'b']) {
    if (ALTARS[owner].some(a => a.col === col && a.row === row)) return owner;
  }
  return null;
}
export function isAltar(col, row) {
  return !!altarOwnerAt(col, row);
}
export function isRift(col, row) {
  return RIFTS.some(r => r.col === col && r.row === row);
}
export function isEnergyFlow(col, row) {
  return ENERGY_FLOW.some(r => r.col === col && r.row === row);
}

export const ENERGY_CAP = 100;
export const E_MOVE = 10;
export const E_ATTACK = 10;
export const E_HURT = 5;
export const E_HURT_MAX = 3;
export const REGEN = 0;
export const CAMP_REGEN = 1;
export const FLOW_DAMAGE = 2;
export const HEAVY_WOUND_PCT = 0.30;

export const SKILLS = {
  K: [
    { id: 'k_tianming', name: '天命', tier: 'small', cost: 50, cd: 3, target: 'self', impl: true,
      desc: '自身回复10HP，自身周围3×3范围内友军获得“激昂”（下次攻击伤害+50%）。' },
    { id: 'k_jiling', name: '急令', tier: 'micro', cost: 10, cd: 0, target: 'self', impl: true,
      desc: '帅获得本回合双步机动：可在九宫内连走两个相邻空格。' },
    { id: 'k_doomsday', name: '末日裁决', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'none', impl: true,
      desc: '所有敌方受到其已损失HP的50%伤害；代价：己方随机非帅棋子受15真实伤害。' },
  ],
  A: [
    { id: 'a_guard', name: '坚守', tier: 'micro', cost: 10, cd: 1, target: 'cell', impl: true,
      desc: '为自身或一个相邻友军提供2点临时护甲，持续到敌方下回合结束。' },
    { id: 'a_link', name: '灵魂链接', tier: 'small', cost: 40, cd: 0, target: 'cell', impl: true,
      desc: '与一个友军建立链接（每方最多2条），任一方受伤时40%伤害转移给另一方。' },
    { id: 'a_sacrifice', name: '献祭守护', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'none', impl: true,
      desc: '牺牲自身，本回合内所有友军免疫伤害，下回合开始时复活至多3个阵亡的兵（半血）。' },
  ],
  B: [
    { id: 'b_disguise', name: '伪装', tier: 'micro', cost: 20, cd: 2, target: 'self', impl: true,
      desc: '本回合不可被敌方技能选为目标；下一次移动可无视塞田穿过棋子落入身后空格。' },
    { id: 'b_phase', name: '相位转移', tier: 'small', cost: 45, cd: 2, target: 'cell', impl: true,
      desc: '瞬移到任意友军相邻的空格，并获得本回合不可被选为目标。' },
    { id: 'b_domain', name: '领域改写', tier: 'ult', cost: 100, cd: 0, global: 1, target: 'region', impl: true,
      desc: '将任意3×3区域永久变为泥沼或疾风。每方限一次。' },
  ],
  N: [
    { id: 'n_light', name: '轻骑', tier: 'micro', cost: 10, cd: 1, target: 'self', impl: true,
      desc: '本回合无视蹩腿，但攻击力-2（最低1）。' },
    { id: 'n_eightstep', name: '八步赶蝉', tier: 'small', cost: 60, cd: 3, target: 'cell', impl: true,
      desc: '无视蹩腿，最多连跳三步抵达目标；若落点不是敌方则自伤10。' },
    { id: 'n_dragon', name: '天翔龙闪', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'cell', impl: true,
      desc: '对与自身同行同列的所有敌方造成8真实伤害，随后传送到指定空格；能量上限-20。' },
  ],
  R: [
    { id: 'r_shock', name: '震慑', tier: 'micro', cost: 20, cd: 2, target: 'self', impl: true,
      desc: '以车为中心十字方向3格内所有敌方，下回合移动力-1（最少1）。' },
    { id: 'r_charge', name: '毁灭冲锋', tier: 'small', cost: 60, cd: 3, target: 'cell', impl: true,
      desc: '沿直线冲锋到空格，碾过沿途敌方造成5伤并向前击退一格。' },
    { id: 'r_warmachine', name: '末日战车', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'cell', impl: true,
      desc: '无视阻挡冲向目标，沿途敌方陷入震颤，抵达后自爆，对周围3×3造成12真实伤害。' },
  ],
  C: [
    { id: 'c_calibrate', name: '校准', tier: 'micro', cost: 10, cd: 1, target: 'self', impl: true,
      desc: '本回合下一次普通攻击无视炮架规则。若击杀，返还10能量。' },
    { id: 'c_railgun', name: '超电磁炮', tier: 'small', cost: 50, cd: 2, target: 'enemy', impl: true,
      desc: '攻击无视阻挡、地形、护甲，造成12伤并击退到尽头（受阻额外5伤）。' },
    { id: 'c_orbital', name: '轨道轰炸', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'cell', impl: true,
      desc: '标记一格，下个己方回合开始时对该格整行整列造成20真实伤害（将帅减半）。' },
  ],
  P: [
    { id: 'p_advance', name: '奋进', tier: 'micro', cost: 10, cd: 0, target: 'self', impl: true,
      desc: '向前突进1格，若该格有敌方则进行普通攻击。此移动不计入正常移动。' },
    { id: 'p_martyr', name: '死士意志', tier: 'small', cost: 40, cd: 0, target: 'none', impl: true,
      desc: '过河后自爆，对周围5×5造成8真实伤害，原地留下弹坑。' },
    { id: 'p_apocalypse', name: '末日降临', tier: 'ult', cost: 100, cd: 0, global: 1, target: 'none', impl: true,
      desc: '需己方已阵亡4个兵且仅剩此兵：献祭自身，将敌方将帅整行化为废墟，并对其造成30真实伤害。' },
  ],
  D: [
    { id: 'd_bulwark', name: '铁壁', tier: 'micro', cost: 10, cd: 1, target: 'self', impl: true,
      desc: '自身获得3点临时护甲，可继续行动。' },
    { id: 'd_cover', name: '援护', tier: 'small', cost: 35, cd: 2, target: 'cell', impl: true,
      desc: '自身或相邻友军获得4点临时护甲，并清除震慑/震颤。' },
    { id: 'd_fortress', name: '不破阵线', tier: 'ult', cost: 100, cd: 0, global: 1, target: 'none', impl: true,
      desc: '2格范围内友军回复4HP并获得2点临时护甲。' },
  ],
  X: [
    { id: 'x_mark', name: '破甲标记', tier: 'micro', cost: 10, cd: 0, target: 'enemy', impl: true,
      desc: '标记3格内敌军：下回合移动力-1，护甲-1，可继续行动。' },
    { id: 'x_pierce', name: '贯穿弩矢', tier: 'small', cost: 45, cd: 2, target: 'enemy', impl: true,
      desc: '对5格直线内第一个敌军造成10真实伤害。' },
    { id: 'x_rain', name: '箭雨封域', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'cell', impl: true,
      desc: '目标3×3区域敌军受到8真实伤害，中心额外提高到12。' },
  ],
  W: [
    { id: 'w_cleanse', name: '净魂', tier: 'micro', cost: 10, cd: 1, target: 'cell', impl: true,
      desc: '2格内友军回复6HP并清除负面状态。' },
    { id: 'w_drain', name: '蚀能', tier: 'small', cost: 40, cd: 2, target: 'enemy', impl: true,
      desc: '3格内敌军失去最多25能量，并受到4真实伤害；巫获得等量能量。' },
    { id: 'w_confluence', name: '灵潮共鸣', tier: 'ult', cost: 100, cd: 0, global: 1, target: 'none', impl: true,
      desc: '所有友军获得15能量并清负面；周围3格敌军失去15能量。' },
  ],
  S: [
    { id: 's_shadow', name: '潜影', tier: 'micro', cost: 10, cd: 1, target: 'self', impl: true,
      desc: '本回合不被敌方技能选中，可继续行动。' },
    { id: 's_backstab', name: '背刺', tier: 'small', cost: 45, cd: 2, target: 'enemy', impl: true,
      desc: '2格内敌军受到8真实伤害；若目标重伤或被压制，额外5伤。' },
    { id: 's_execute', name: '影杀', tier: 'ult', cost: 100, cd: 0, global: 2, target: 'enemy', impl: true,
      desc: '4格内敌军受到16真实伤害；随后闪现到目标附近空格。' },
  ],
};

export const TIER_LABEL = { micro: '微型', small: '小', ult: '奥义' };
