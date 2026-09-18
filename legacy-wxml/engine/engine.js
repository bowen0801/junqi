/**
 * 《军旗》纸牌 5x5 翻棋 —— 规则引擎（纯函数模块）
 *
 * 依据 docs/军旗小程序需求文档.md v1.1：
 * - 25 张牌随机背面覆盖 5x5 网格；先手翻出的第一张红/蓝牌定其阵营（翻出军旗不计数、正常换人）
 * - 每回合二选一：翻开任意暗牌，或将己方已翻开棋子向上下左右移动一格
 * - 战斗：大吃小占格；同级同归于尽；炸弹与任何牌同归于尽；工兵挖雷；军官撞雷同归于尽（可选"地雷保留"）
 * - 夺旗前置：对方全部 12 张牌移出棋盘（含对方地雷）；己方地雷不参与判定
 * - 胜负：夺旗胜 > 无棋可走判负 > 双方全灭平局 > 认输 > 连续 40 步无战斗判和 / 总步数 150 判和
 *
 * 状态全部为可 JSON 序列化的纯数据；所有 API 返回新状态（内部深拷贝），不修改入参。
 * CommonJS 导出，可直接被微信小程序 require。
 */

'use strict';

// ---------------------------------------------------------------------------
// 常量与牌组定义
// ---------------------------------------------------------------------------

const VERSION = '1.1.0';

const GRID_SIZE = 25; // 5 列 x 5 行
const GRID_COLS = 5;

/** 军官/工兵级别值：司令(10) > 军长(9) > ... > 班长(2) > 工兵(1) */
const RANKS = {
  siling: 10,
  junzhang: 9,
  shizhang: 8,
  lvzhang: 7,
  tuanzhang: 6,
  yingzhang: 5,
  lianzhang: 4,
  paizhang: 3,
  banzhang: 2,
  gongbing: 1,
};

const NAME_CN = {
  siling: '司令',
  junzhang: '军长',
  shizhang: '师长',
  lvzhang: '旅长',
  tuanzhang: '团长',
  yingzhang: '营长',
  lianzhang: '连长',
  paizhang: '排长',
  banzhang: '班长',
  gongbing: '工兵',
  dilei: '地雷',
  zhadan: '炸弹',
  junqi: '军旗',
};

/**
 * 生成 25 张标准牌组定义（不含位置）。
 * @returns {Array<{id,side,name,type,rank}>}
 */
function createDeck() {
  const cards = [];
  const pushSide = (side) => {
    // 9 级军官 + 工兵
    for (const name of Object.keys(RANKS)) {
      const type = name === 'gongbing' ? 'engineer' : 'officer';
      cards.push({ id: `${side}_${name}`, side, name, type, rank: RANKS[name] });
    }
    cards.push({ id: `${side}_dilei`, side, name: 'dilei', type: 'mine', rank: null });
    cards.push({ id: `${side}_zhadan`, side, name: 'zhadan', type: 'bomb', rank: null });
  };
  pushSide('red');
  pushSide('blue');
  cards.push({ id: 'junqi', side: 'neutral', name: 'junqi', type: 'flag', rank: null });
  return cards;
}

// ---------------------------------------------------------------------------
// 可复现随机（mulberry32），用于洗牌；不依赖 Math.random 以便测试与回放
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function rowOf(index) {
  return Math.floor(index / GRID_COLS);
}

function colOf(index) {
  return index % GRID_COLS;
}

/** 上下左右相邻（同格不判相邻；越界自然不相邻） */
function isAdjacent(a, b) {
  const dr = Math.abs(rowOf(a) - rowOf(b));
  const dc = Math.abs(colOf(a) - colOf(b));
  return dr + dc === 1;
}

/** 对方阵营 */
function enemySide(side) {
  return side === 'red' ? 'blue' : 'red';
}

// ---------------------------------------------------------------------------
// 建局
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  /** 军官撞地雷时地雷是否保留（默认 false = 同归于尽，v1.1 基准规则） */
  mineSurvivesOnOfficerCrash: false,
  /** 连续无战斗步数达到该值判和 */
  drawNoCombatSteps: 40,
  /** 总步数上限，达到判和 */
  maxSteps: 150,
};

/**
 * 创建对局。25 张牌洗匀后随机背面覆盖 5x5 网格。
 * @param {{seed?:number, firstPlayer?:'A'|'B', settings?:Partial<DEFAULT_SETTINGS>, initialGrid?:string[]}} opts
 *   initialGrid: 长度 25 的 cardId 数组（测试用固定布局）；缺省按 seed 洗牌。
 */
function createGame(opts) {
  opts = opts || {};
  const seed = opts.seed != null ? opts.seed >>> 0 : 1;
  const rng = makeRng(seed);
  const deck = createDeck();
  const order = opts.initialGrid
    ? opts.initialGrid.slice()
    : shuffleWithRng(deck.map((c) => c.id), rng);
  if (order.length !== GRID_SIZE) {
    throw new Error('initialGrid must contain 25 card ids');
  }
  const cardById = {};
  for (const c of deck) cardById[c.id] = c;

  const settings = Object.assign({}, DEFAULT_SETTINGS, opts.settings || {});
  const firstPlayer = opts.firstPlayer === 'B' ? 'B' : 'A';

  return {
    version: VERSION,
    cards: cardById,
    grid: order.map((id) => ({ cardId: id, revealed: false })),
    players: ['A', 'B'],
    /** 玩家 -> 'red' | 'blue' | null（定色前为 null） */
    sides: { A: null, B: null },
    /** 先手（v1.0 决议：第一局随机，之后双方轮流先手，由调用层传入） */
    current: firstPlayer,
    phase: 'assigning', // assigning -> playing -> finished
    deadIds: [],
    moveCount: 0,
    noCombatStreak: 0,
    winner: null, // 'red' | 'blue' | 'draw'
    winReason: null,
    history: [],
    settings,
  };
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 玩家已定阵营；未定色返回 null */
function sideOfPlayer(state, player) {
  return state.sides[player] || null;
}

/** 某阵营在棋盘上的存活牌数（已移出棋盘的不计） */
function aliveCount(state, side) {
  let n = 0;
  for (const cell of state.grid) {
    if (cell.cardId) {
      const c = state.cards[cell.cardId];
      if (c.side === side) n++;
    }
  }
  return n;
}

/** 对方是否全灭：对方 12 张牌全部移出棋盘（含其地雷）。己方地雷不参与判定。 */
function isSideEliminated(state, side) {
  return aliveCount(state, side) === 0;
}

/** 棋盘上是否还有未翻开的牌 */
function hasFaceDownCells(state) {
  return state.grid.some((cell) => cell.cardId && !cell.revealed);
}

/** 某张牌是否可被操纵移动（地雷、军旗不可移动） */
function isMovableCard(card) {
  return card.type !== 'mine' && card.type !== 'flag';
}

/**
 * 一次移动的合法性校验。返回 null 表示合法，否则为错误码字符串。
 * 错误码：not_playing / not_your_turn / side_unassigned / from_empty / not_revealed /
 *        not_your_card / immovable / not_adjacent / to_own_card / to_face_down / flag_precondition
 */
function validateMove(state, player, from, to) {
  if (state.phase !== 'playing') return 'not_playing';
  if (state.current !== player) return 'not_your_turn';
  const side = state.sides[player];
  if (!side) return 'side_unassigned';
  if (from < 0 || from >= GRID_SIZE || to < 0 || to >= GRID_SIZE) return 'not_adjacent';
  const fromCell = state.grid[from];
  if (!fromCell.cardId) return 'from_empty';
  if (!fromCell.revealed) return 'not_revealed';
  const card = state.cards[fromCell.cardId];
  if (!isMovableCard(card)) return 'immovable'; // 地雷/军旗（含中立军旗）不可移动
  if (card.side !== side) return 'not_your_card';
  if (!isAdjacent(from, to)) return 'not_adjacent';
  const toCell = state.grid[to];
  if (toCell.cardId) {
    const target = state.cards[toCell.cardId];
    if (!toCell.revealed) return 'to_face_down';
    if (target.side === side) return 'to_own_card';
    if (target.type === 'flag' && !isSideEliminated(state, enemySide(side))) {
      return 'flag_precondition'; // 对方未全灭，不可落子军旗格
    }
  }
  return null;
}

/**
 * 玩家的全部合法行动（供 UI 高亮与"无棋可走"判定）。
 * @returns {Array<{type:'flip',cell:number}|{type:'move',from:number,to:number}>}
 */
function getLegalActions(state, player) {
  const acts = [];
  if (state.phase === 'finished') return acts;
  if (state.current !== player) return acts;
  if (state.phase === 'assigning') {
    // 定色阶段只能翻牌
    state.grid.forEach((cell, i) => {
      if (cell.cardId && !cell.revealed) acts.push({ type: 'flip', cell: i });
    });
    return acts;
  }
  const side = state.sides[player];
  if (!side) return acts;
  state.grid.forEach((cell, i) => {
    if (cell.cardId && !cell.revealed) acts.push({ type: 'flip', cell: i });
  });
  state.grid.forEach((fromCell, i) => {
    if (!fromCell.cardId || !fromCell.revealed) return;
    const card = state.cards[fromCell.cardId];
    if (card.side !== side || !isMovableCard(card)) return;
    const r = rowOf(i);
    const c = colOf(i);
    const candidates = [];
    if (r > 0) candidates.push(i - GRID_COLS);
    if (r < GRID_COLS - 1) candidates.push(i + GRID_COLS);
    if (c > 0) candidates.push(i - 1);
    if (c < GRID_COLS - 1) candidates.push(i + 1);
    for (const to of candidates) {
      if (!validateMove(state, player, i, to)) acts.push({ type: 'move', from: i, to });
    }
  });
  return acts;
}

// ---------------------------------------------------------------------------
// 战斗结算
// ---------------------------------------------------------------------------

/**
 * 结算战斗（进攻方移动到防守方格）。
 * @returns {{outcome:string, attackerDead:bool, defenderDead:bool, attackerOccupies:bool, label:string}}
 *  outcome: attackerWins | defenderHolds | bothDie
 */
function resolveBattle(attacker, defender, settings) {
  // 军旗不参战（移动到军旗格在 applyAction 中走夺旗分支，不会进入本函数）
  if (attacker.type === 'bomb' || defender.type === 'bomb') {
    return { outcome: 'bothDie', attackerDead: true, defenderDead: true, attackerOccupies: false, label: 'bothDie' };
  }
  if (defender.type === 'mine') {
    if (attacker.type === 'engineer') {
      return { outcome: 'attackerWins', attackerDead: false, defenderDead: true, attackerOccupies: true, label: 'mineCleared' };
    }
    // 军官撞雷：默认同归于尽（v1.1）；可选"地雷保留、仅进攻方阵亡"
    if (settings.mineSurvivesOnOfficerCrash) {
      return { outcome: 'defenderHolds', attackerDead: true, defenderDead: false, attackerOccupies: false, label: 'crashMine' };
    }
    return { outcome: 'bothDie', attackerDead: true, defenderDead: true, attackerOccupies: false, label: 'crashMine' };
  }
  // 军官/工兵 vs 军官/工兵：大吃小，同级同归于尽
  if (attacker.rank > defender.rank) {
    return { outcome: 'attackerWins', attackerDead: false, defenderDead: true, attackerOccupies: true, label: 'capture' };
  }
  if (attacker.rank < defender.rank) {
    return { outcome: 'defenderHolds', attackerDead: true, defenderDead: false, attackerOccupies: false, label: 'capture' };
  }
  return { outcome: 'bothDie', attackerDead: true, defenderDead: true, attackerOccupies: false, label: 'bothDie' };
}

// ---------------------------------------------------------------------------
// 行动执行
// ---------------------------------------------------------------------------

/**
 * 执行行动。返回 {ok:true, state, events} 或 {ok:false, error}。
 * action: {type:'flip', player, cell}
 *       | {type:'move', player, from, to}
 *       | {type:'resign', player}
 */
function applyAction(state, action) {
  if (action.type === 'resign') {
    const next = cloneState(state);
    if (next.phase === 'finished') return { ok: false, error: 'game_finished' };
    const side = next.sides[action.player];
    if (!side) return { ok: false, error: 'side_unassigned' };
    next.winner = enemySide(side);
    next.winReason = 'resign';
    next.phase = 'finished';
    next.history.push({ action, events: [{ type: 'gameOver', winner: next.winner, reason: 'resign' }] });
    return { ok: true, state: next, events: [{ type: 'gameOver', winner: next.winner, reason: 'resign' }] };
  }

  if (action.type !== 'flip' && action.type !== 'move') {
    return { ok: false, error: 'unknown_action' };
  }
  const player = action.player;
  if (state.phase === 'finished') return { ok: false, error: 'game_finished' };
  if (state.current !== player) return { ok: false, error: 'not_your_turn' };

  if (action.type === 'flip') {
    return applyFlip(state, action);
  }
  return applyMove(state, action);
}

function applyFlip(state, action) {
  const cellIdx = action.cell;
  if (cellIdx < 0 || cellIdx >= GRID_SIZE) return { ok: false, error: 'bad_cell' };
  const origCell = state.grid[cellIdx];
  if (!origCell.cardId) return { ok: false, error: 'bad_cell' };
  if (origCell.revealed) return { ok: false, error: 'already_revealed' };

  const next = cloneState(state);
  const events = [];
  const cell = next.grid[cellIdx]; // 注意：必须在克隆后的状态上修改
  cell.revealed = true;
  const card = next.cards[cell.cardId];
  events.push({ type: 'revealed', cell: cellIdx, cardId: card.id, name: card.name, side: card.side });

  // 定色：先手翻出的第一张红/蓝牌即定其阵营；军旗不计数、正常换人
  if (next.phase === 'assigning' && (card.side === 'red' || card.side === 'blue')) {
    const player = next.current;
    const other = player === 'A' ? 'B' : 'A';
    next.sides[player] = card.side;
    next.sides[other] = enemySide(card.side);
    next.phase = 'playing';
    events.push({ type: 'colorAssigned', player, side: card.side, otherPlayer: other, otherSide: enemySide(card.side) });
  }

  next.moveCount++;
  next.noCombatStreak++; // 翻牌无战斗
  next.history.push({ action, events });
  return finalizeTurn(next, events);
}

function applyMove(state, action) {
  const err = validateMove(state, action.player, action.from, action.to);
  if (err) return { ok: false, error: err };

  const next = cloneState(state);
  const events = [];
  const side = next.sides[action.player];
  const fromCell = next.grid[action.from];
  const toCell = next.grid[action.to];
  const mover = next.cards[fromCell.cardId];

  fromCell.cardId = null;

  if (!toCell.cardId) {
    // 空格落子
    toCell.cardId = mover.id;
    toCell.revealed = true; // 棋子始终明置，移动后保持翻开
    next.noCombatStreak++; // 无战斗步
    events.push({ type: 'move', from: action.from, to: action.to, cardId: mover.id, name: mover.name, side });
  } else {
    const target = next.cards[toCell.cardId];
    if (target.type === 'flag') {
      // 夺旗（validateMove 已校验对方全灭前置）
      toCell.cardId = mover.id;
      next.winner = side;
      next.winReason = 'flagCaptured';
      next.phase = 'finished';
      events.push({ type: 'flagCaptured', cell: action.to, cardId: mover.id, name: mover.name, side });
      events.push({ type: 'gameOver', winner: side, reason: 'flagCaptured' });
      next.moveCount++;
      next.noCombatStreak = 0;
      next.history.push({ action, events });
      return { ok: true, state: next, events };
    }
    const result = resolveBattle(mover, target, next.settings);
    events.push({
      type: 'battle',
      from: action.from,
      to: action.to,
      attacker: mover.id,
      attackerName: mover.name,
      attackerSide: side,
      defender: target.id,
      defenderName: target.name,
      defenderSide: target.side,
      outcome: result.outcome,
      label: result.label,
    });
    if (result.attackerDead) next.deadIds.push(mover.id);
    if (result.defenderDead) next.deadIds.push(target.id);
    if (result.attackerOccupies) {
      toCell.cardId = mover.id;
      toCell.revealed = true;
    } else if (result.defenderDead) {
      toCell.cardId = null; // 同归于尽，格子清空
    } else {
      toCell.cardId = target.id; // 防守方守住（如"地雷保留"变体）
    }
    next.noCombatStreak = 0; // 发生战斗
  }

  next.moveCount++;
  next.history.push({ action, events });
  return finalizeTurn(next, events);
}

/**
 * 每步行动后的收尾：判和/判负检查 + 换手。
 */
function finalizeTurn(next, events) {
  // 1) 双方全灭平局（军旗无人可夺）
  if (aliveCount(next, 'red') === 0 && aliveCount(next, 'blue') === 0) {
    next.winner = 'draw';
    next.winReason = 'bothEliminated';
    next.phase = 'finished';
    events.push({ type: 'gameOver', winner: 'draw', reason: 'bothEliminated' });
    return { ok: true, state: next, events };
  }
  // 2) 和棋保护
  if (next.noCombatStreak >= next.settings.drawNoCombatSteps) {
    next.winner = 'draw';
    next.winReason = 'noCombatDraw';
    next.phase = 'finished';
    events.push({ type: 'gameOver', winner: 'draw', reason: 'noCombatDraw' });
    return { ok: true, state: next, events };
  }
  if (next.moveCount >= next.settings.maxSteps) {
    next.winner = 'draw';
    next.winReason = 'maxStepsDraw';
    next.phase = 'finished';
    events.push({ type: 'gameOver', winner: 'draw', reason: 'maxStepsDraw' });
    return { ok: true, state: next, events };
  }
  // 3) 换手；新行动方无棋可走判负
  next.current = next.current === 'A' ? 'B' : 'A';
  if (next.phase === 'playing') {
    if (!hasFaceDownCells(next) && getLegalActions(next, next.current).length === 0) {
      const loserSide = next.sides[next.current];
      next.winner = enemySide(loserSide);
      next.winReason = 'noMoves';
      next.phase = 'finished';
      events.push({ type: 'gameOver', winner: next.winner, reason: 'noMoves' });
      return { ok: true, state: next, events };
    }
  } else if (next.phase === 'assigning' && !hasFaceDownCells(next)) {
    // 理论不可达（必有红/蓝牌被翻出定色），防御性处理
    next.winner = 'draw';
    next.winReason = 'noMoves';
    next.phase = 'finished';
    events.push({ type: 'gameOver', winner: 'draw', reason: 'noMoves' });
  }
  return { ok: true, state: next, events };
}

// ---------------------------------------------------------------------------

module.exports = {
  VERSION,
  GRID_SIZE,
  GRID_COLS,
  RANKS,
  NAME_CN,
  createDeck,
  createGame,
  getLegalActions,
  validateMove,
  resolveBattle,
  applyAction,
  sideOfPlayer,
  aliveCount,
  isSideEliminated,
  hasFaceDownCells,
  isAdjacent,
  isMovableCard,
  rowOf,
  colOf,
};
