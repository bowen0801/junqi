/**
 * 《军旗》AI 对手（简单 / 普通）
 * - 简单：随机行动（翻牌或随机合法移动）
 * - 普通：贪心吃子 + 威胁回避 + 夺旗；收官阶段（对方全灭后）寻旗 + BFS 最短路径夺旗
 */
'use strict';

/**
 * 计算 AI 行动。
 * @param {object} state 引擎状态
 * @param {'A'|'B'} aiPlayer AI 玩家
 * @returns {{type:'flip',cell:number}|{type:'move',from:number,to:number}|null}
 */
function decide(state, aiPlayer) {
  const acts = engine.getLegalActions(state, aiPlayer);
  if (!acts.length) return null;
  const side = state.sides[aiPlayer];
  if (!side) {
    // 定色阶段：随机翻
    return pick(acts);
  }
  return smart(state, aiPlayer, side, acts);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function smart(state, aiPlayer, side, acts) {
  const enemySideStr = side === 'red' ? 'blue' : 'red';
  const enemyEliminated = engine.isSideEliminated(state, enemySideStr);
  const flips = acts.filter((a) => a.type === 'flip');
  const moves = acts.filter((a) => a.type === 'move');

  // ---- 收官阶段：对方全灭，找旗/夺旗 ----
  if (enemyEliminated) {
    // 军旗已翻开且可走上去？
    const flagIdx = state.grid.findIndex((c) => c.cardId === 'junqi' && c.revealed);
    if (flagIdx >= 0) {
      const toFlag = moves.find((m) => m.to === flagIdx);
      if (toFlag) return toFlag;
      // BFS 走向军旗：选让 BFS 距离变小的移动
      return stepToward(state, moves, flagIdx) || (flips.length ? pick(flips) : pick(moves));
    }
    // 军旗未翻开：翻开距己方棋子最近的暗点
    if (flips.length) {
      let best = null;
      let bestDist = Infinity;
      for (const f of flips) {
        const d = distToNearestOwn(state, side, f.cell);
        if (d < bestDist) { bestDist = d; best = f; }
      }
      return best || pick(flips);
    }
    return moves.length ? pick(moves) : null;
  }

  // ---- 正常阶段 ----
  // 1) 直接夺旗的移动（理论上来不到这，防御）
  // 2) 吃子：对每个移动目标估值，挑净收益最大的
  let bestMove = null;
  let bestScore = 0.5; // 低于阈值不如翻牌/走位
  for (const m of moves) {
    const toCell = state.grid[m.to];
    if (!toCell.cardId) continue;
    const target = state.cards[toCell.cardId];
    const attacker = state.cards[state.grid[m.from].cardId];
    const score = scoreBattle(attacker, target);
    if (score > bestScore) { bestScore = score; bestMove = m; }
  }
  if (bestMove) return bestMove;

  // 3) 威胁回避：己方大牌贴着敌方更强牌 → 移开
  const threat = avoidThreat(state, side, moves, enemySideStr);
  if (threat && Math.random() < 0.8) return threat;

  // 4) 有威胁目标可打但打不过：翻牌扩张信息
  if (flips.length && Math.random() < 0.6) return pick(flips);

  // 5) 走位：向敌方已翻开弱子/中心靠拢
  const approach = stepTowardWeakestEnemy(state, side, moves, enemySideStr);
  if (approach) return approach;

  return flips.length ? pick(flips) : pick(moves);
}

/** 战斗净收益估值（粗略）：吃弱子赚，送强子亏 */
function scoreBattle(attacker, target) {
  if (target.type === 'flag') return 100; // 夺旗
  if (attacker.type === 'bomb') {
    // 炸弹换高价值目标才值得
    return target.rank >= 8 ? 2 : -1;
  }
  if (target.type === 'mine') {
    return attacker.type === 'engineer' ? 3 : -1; // 只有工兵挖雷赚
  }
  if (attacker.type === 'engineer' && target.type !== 'mine') return -1;
  if (attacker.rank > target.rank) return 1 + (target.rank - attacker.rank) * 0.2 + target.rank * 0.05;
  if (attacker.rank === target.rank) return 0.3; // 换子（同级同归）
  return -2; // 送子
}

/** 回避威胁：己方被翻开大牌贴着的弱子，移开 */
function avoidThreat(state, side, moves, enemySideStr) {
  let best = null;
  for (const m of moves) {
    const fromCell = state.grid[m.from];
    const card = state.cards[fromCell.cardId];
    if (card.rank == null || card.rank < 5) continue; // 只保大牌
    const r = engine.rowOf(m.from);
    const c = engine.colOf(m.from);
    const around = [
      r > 0 ? m.from - 5 : -1,
      r < 4 ? m.from + 5 : -1,
      c > 0 ? m.from - 1 : -1,
      c < 4 ? m.from + 1 : -1,
    ];
    let danger = false;
    for (const n of around) {
      if (n < 0) continue;
      const nc = state.grid[n];
      if (!nc.cardId || !nc.revealed) continue;
      const ncard = state.cards[nc.cardId];
      if (ncard.side !== enemySideStr) continue;
      if (ncard.type === 'bomb') danger = true;
      else if (ncard.rank != null && card.rank != null && ncard.rank > card.rank) danger = true;
    }
    if (danger && !state.grid[m.to].cardId) { best = m; break; }
  }
  return best;
}

/** BFS 最短路径的下一步（空点穿行，敌人牌视为障碍但目标点除外） */
function bfsNext(state, from, target) {
  const prev = new Array(25).fill(-2);
  prev[from] = -1;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === target) break;
    const r = engine.rowOf(cur);
    const c = engine.colOf(cur);
    const nexts = [];
    if (r > 0) nexts.push(cur - 5);
    if (r < 4) nexts.push(cur + 5);
    if (c > 0) nexts.push(cur - 1);
    if (c < 4) nexts.push(cur + 1);
    for (const n of nexts) {
      if (prev[n] !== -2) continue;
      const cell = state.grid[n];
      if (cell.cardId && n !== target) continue; // 障碍
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[target] === -2) return null;
  let cur = target;
  while (prev[cur] !== from) {
    cur = prev[cur];
    if (cur === -1 || cur === -2) return null;
  }
  return cur; // from 的下一步
}

/** 选让整体 BFS 距离减小的移动（走向 target） */
function stepToward(state, moves, target) {
  let best = null;
  let bestDist = Infinity;
  for (const m of moves) {
    if (state.grid[m.to].cardId && m.to !== target) continue;
    const d = bfsDist(state, m.to, target, m.from);
    if (d != null && d < bestDist) { bestDist = d; best = m; }
  }
  return best;
}

function bfsDist(state, from, target, ignoreCell) {
  if (from === target) return 0;
  const dist = new Array(25).fill(-1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const r = engine.rowOf(cur);
    const c = engine.colOf(cur);
    const nexts = [];
    if (r > 0) nexts.push(cur - 5);
    if (r < 4) nexts.push(cur + 5);
    if (c > 0) nexts.push(cur - 1);
    if (c < 4) nexts.push(cur + 1);
    for (const n of nexts) {
      if (dist[n] !== -1) continue;
      const cell = state.grid[n];
      if (cell.cardId && n !== target && n !== ignoreCell) continue;
      dist[n] = dist[cur] + 1;
      if (n === target) return dist[n];
      queue.push(n);
    }
  }
  return null;
}

/** 收官寻旗：暗点到己方最近棋子的距离 */
function distToNearestOwn(state, side, cell) {
  let best = Infinity;
  state.grid.forEach((c, i) => {
    if (!c.cardId || !c.revealed) return;
    const card = state.cards[c.cardId];
    if (card.side !== side || !engine.isMovableCard || card.type === 'mine') return;
    const d = manhattan(i, cell);
    if (d < best) best = d;
  });
  return best === Infinity ? 0 : best;
}

function manhattan(a, b) {
  return Math.abs(engine.rowOf(a) - engine.rowOf(b)) + Math.abs(engine.colOf(a) - engine.colOf(b));
}

/** 走位：向敌方已翻开的弱子靠拢 */
function stepTowardWeakestEnemy(state, side, moves, enemySideStr) {
  let target = -1;
  let weakest = Infinity;
  state.grid.forEach((c, i) => {
    if (!c.cardId || !c.revealed) return;
    const card = state.cards[c.cardId];
    if (card.side !== enemySideStr || card.type === 'mine' || card.type === 'bomb') return;
    if (card.rank != null && card.rank < weakest) { weakest = card.rank; target = i; }
  });
  if (target < 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const m of moves) {
    if (state.grid[m.to].cardId) continue;
    const d = manhattan(m.to, target);
    if (d < bestDist) { bestDist = d; best = m; }
  }
  return best;
}

const engine = require('../engine/engine.js');

module.exports = { decide, bfsNext, bfsDist };
