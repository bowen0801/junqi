/**
 * 《军旗》规则引擎单元测试
 * 运行：node --test engine/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

const ALL_CARDS = [
  'red_siling', 'red_junzhang', 'red_shizhang', 'red_lvzhang', 'red_tuanzhang',
  'red_yingzhang', 'red_lianzhang', 'red_paizhang', 'red_banzhang', 'red_gongbing',
  'red_dilei', 'red_zhadan',
  'blue_siling', 'blue_junzhang', 'blue_shizhang', 'blue_lvzhang', 'blue_tuanzhang',
  'blue_yingzhang', 'blue_lianzhang', 'blue_paizhang', 'blue_banzhang', 'blue_gongbing',
  'blue_dilei', 'blue_zhadan',
  'junqi',
];

/** 构造固定布局：pairs = {cellIndex: cardId}，其余格子按剩余牌顺序填充 */
function layoutWith(pairs) {
  const used = new Set(Object.values(pairs));
  const rest = ALL_CARDS.filter((id) => !used.has(id));
  const layout = new Array(25).fill(null);
  for (const [k, v] of Object.entries(pairs)) layout[Number(k)] = v;
  for (let i = 0; i < 25; i++) if (!layout[i]) layout[i] = rest.shift();
  return layout;
}

/** 建一个已定色（A=red, B=blue）、处于 playing 阶段的可控局面 */
function setupGame(pairs, opts = {}) {
  const state = E.createGame({
    seed: 42,
    initialGrid: layoutWith(pairs),
    settings: opts.settings,
  });
  state.sides = { A: 'red', B: 'blue' };
  state.phase = 'playing';
  state.current = opts.current || 'A';
  return state;
}

/** 清场：仅保留 keepIds 指定的牌在棋盘上，其余全部移出（计入 deadIds） */
function stripOthers(state, keepIds) {
  for (const cell of state.grid) {
    if (cell.cardId && !keepIds.includes(cell.cardId)) {
      state.deadIds.push(cell.cardId);
      cell.cardId = null;
    }
  }
}

/** 将某阵营全部牌移出棋盘（模拟被歼灭），可选保留例外 */
function killSide(state, side, keepIds = []) {
  for (const cell of state.grid) {
    if (cell.cardId) {
      const c = state.cards[cell.cardId];
      if (c.side === side && !keepIds.includes(c.id)) {
        state.deadIds.push(cell.cardId);
        cell.cardId = null;
      }
    }
  }
}

/** 全部翻开（便于纯移动场景测试） */
function revealAll(state) {
  state.grid.forEach((c) => {
    if (c.cardId) c.revealed = true;
  });
}

function flipFirstCellOfSide(state, player, side) {
  const idx = state.grid.findIndex(
    (c) => c.cardId && !c.revealed && state.cards[c.cardId].side === side
  );
  return E.applyAction(state, { type: 'flip', player, cell: idx });
}

// ---------------------------------------------------------------------------
// 牌组与建局
// ---------------------------------------------------------------------------

test('牌组构成：25 张，红蓝各 12 + 中立军旗 1', () => {
  const deck = E.createDeck();
  assert.strictEqual(deck.length, 25);
  assert.strictEqual(deck.filter((c) => c.side === 'red').length, 12);
  assert.strictEqual(deck.filter((c) => c.side === 'blue').length, 12);
  assert.strictEqual(deck.filter((c) => c.type === 'flag').length, 1);
  assert.strictEqual(deck.filter((c) => c.type === 'mine').length, 2);
  assert.strictEqual(deck.filter((c) => c.type === 'bomb').length, 2);
  assert.ok(deck.find((c) => c.id === 'red_banzhang'), '纸牌版有班长');
});

test('建局可复现：同 seed 布局一致，不同 seed 不同；初始全部暗牌', () => {
  const a = E.createGame({ seed: 7 });
  const b = E.createGame({ seed: 7 });
  const c = E.createGame({ seed: 8 });
  assert.deepStrictEqual(a.grid, b.grid);
  assert.notDeepStrictEqual(a.grid, c.grid);
  assert.strictEqual(a.phase, 'assigning');
  assert.strictEqual(a.current, 'A');
  assert.ok(a.grid.every((cell) => cell.cardId && !cell.revealed));
});

// ---------------------------------------------------------------------------
// 定色
// ---------------------------------------------------------------------------

test('定色：翻出红/蓝牌即定色（归翻出者），换对方行动', () => {
  const state = E.createGame({ seed: 42 });
  const res = flipFirstCellOfSide(state, 'A', 'red');
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.sides.A, 'red');
  assert.strictEqual(res.state.sides.B, 'blue');
  assert.strictEqual(res.state.phase, 'playing');
  assert.strictEqual(res.state.current, 'B');
  assert.ok(res.events.some((e) => e.type === 'colorAssigned'));
});

test('定色：首翻军旗不定色，正常换人', () => {
  const state = E.createGame({ seed: 42 });
  const flagIdx = state.grid.findIndex((c) => c.cardId === 'junqi');
  const res = E.applyAction(state, { type: 'flip', player: 'A', cell: flagIdx });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.phase, 'assigning');
  assert.strictEqual(res.state.sides.A, null);
  assert.strictEqual(res.state.current, 'B');
  assert.ok(res.state.grid[flagIdx].revealed);
});

test('定色：先手翻军旗后，对方翻出蓝牌则对方执蓝', () => {
  const state = E.createGame({ seed: 42 });
  const flagIdx = state.grid.findIndex((c) => c.cardId === 'junqi');
  const r1 = E.applyAction(state, { type: 'flip', player: 'A', cell: flagIdx });
  assert.ok(r1.ok, r1.error);
  const res = flipFirstCellOfSide(r1.state, 'B', 'blue');
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.sides.B, 'blue');
  assert.strictEqual(res.state.sides.A, 'red');
});

test('定色阶段不允许移动', () => {
  const state = E.createGame({ seed: 42 });
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'not_playing');
});

// ---------------------------------------------------------------------------
// 翻牌合法性
// ---------------------------------------------------------------------------

test('翻牌：已翻开的格子不可再翻；非本方回合不可行动', () => {
  const state = E.createGame({ seed: 42 });
  const idx = state.grid.findIndex((c) => !c.revealed);
  const r1 = E.applyAction(state, { type: 'flip', player: 'A', cell: idx });
  assert.ok(r1.ok);
  const s1 = r1.state; // 后续断言基于最新状态
  const r2 = E.applyAction(s1, { type: 'flip', player: 'A', cell: idx });
  assert.strictEqual(r2.error, 'not_your_turn'); // 已换手
  const r3 = E.applyAction(s1, { type: 'flip', player: 'B', cell: idx });
  assert.strictEqual(r3.error, 'already_revealed');
});

test('纯函数性：翻牌不修改入参状态（回归）', () => {
  const state = E.createGame({ seed: 42 });
  const before = JSON.stringify(state);
  const idx = state.grid.findIndex((c) => !c.revealed);
  E.applyAction(state, { type: 'flip', player: 'A', cell: idx });
  assert.strictEqual(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------
// 移动合法性
// ---------------------------------------------------------------------------

test('移动：空格落子合法并换手', () => {
  // cell0(r0c0)=红司令, cell1=红军长, cell6=蓝炸弹，其余清空
  const state = setupGame({ 0: 'red_siling', 1: 'red_junzhang', 6: 'blue_zhadan' });
  stripOthers(state, ['red_siling', 'red_junzhang', 'blue_zhadan']);
  revealAll(state);

  assert.strictEqual(E.validateMove(state, 'A', 0, 5), null, '向下空格 (0,0)->(1,0)');
  const ok = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(ok.ok, ok.error);
  assert.strictEqual(ok.state.grid[5].cardId, 'red_siling');
  assert.strictEqual(ok.state.grid[0].cardId, null);
  assert.strictEqual(ok.state.current, 'B');
});

test('移动合法性细节：斜向/越界/自身/回合均拦截', () => {
  const state = setupGame({ 0: 'red_siling', 1: 'red_junzhang', 5: 'blue_siling', 6: 'blue_zhadan' });
  stripOthers(state, ['red_siling', 'red_junzhang', 'blue_siling', 'blue_zhadan']);
  revealAll(state);
  // cell0(r0c0) 的邻居只有 1(右) 和 5(下)
  assert.strictEqual(E.validateMove(state, 'A', 0, 1), 'to_own_card');
  assert.strictEqual(E.validateMove(state, 'A', 0, 5), null, '敌方已翻开牌可攻击');
  assert.strictEqual(E.validateMove(state, 'A', 0, 6), 'not_adjacent', 'r0c0->r1c2 斜跨');
  assert.strictEqual(E.validateMove(state, 'A', 0, -1), 'not_adjacent');
  assert.strictEqual(E.validateMove(state, 'A', 0, 0), 'not_adjacent');
  assert.strictEqual(E.validateMove(state, 'B', 5, 0), 'not_your_turn');
});

test('移动：不可落在未翻开的牌上', () => {
  const state = setupGame({ 0: 'red_siling', 1: 'blue_shizhang' });
  stripOthers(state, ['red_siling', 'blue_shizhang']);
  revealAll(state);
  state.grid[1].revealed = false;
  assert.strictEqual(E.validateMove(state, 'A', 0, 1), 'to_face_down');
});

test('移动：地雷与军旗不可移动；敌方棋子可主动攻击地雷', () => {
  const state = setupGame({ 0: 'red_dilei', 1: 'junqi', 5: 'blue_paizhang', 6: 'blue_siling' });
  stripOthers(state, ['red_dilei', 'junqi', 'blue_paizhang', 'blue_siling']);
  revealAll(state);
  assert.strictEqual(E.validateMove(state, 'A', 0, 5), 'immovable');
  assert.strictEqual(E.validateMove(state, 'A', 1, 6), 'immovable');
  state.current = 'B'; // 轮到蓝方行动
  const r = E.applyAction(state, { type: 'move', player: 'B', from: 5, to: 0 });
  assert.ok(r.ok, r.error);
});

// ---------------------------------------------------------------------------
// 战斗结算（单元覆盖全部对阵组合）
// ---------------------------------------------------------------------------

test('resolveBattle：军官/工兵大小比较（大吃小、同级同归）', () => {
  const S = {};
  const siling = { id: 'a', side: 'red', name: 'siling', type: 'officer', rank: 10 };
  const siling2 = { id: 'a2', side: 'blue', name: 'siling', type: 'officer', rank: 10 };
  const banzhang = { id: 'b', side: 'blue', name: 'banzhang', type: 'officer', rank: 2 };
  const gongbing = { id: 'g', side: 'red', name: 'gongbing', type: 'engineer', rank: 1 };
  const gongbing2 = { id: 'g2', side: 'blue', name: 'gongbing', type: 'engineer', rank: 1 };
  assert.strictEqual(E.resolveBattle(siling, banzhang, S).outcome, 'attackerWins');
  assert.strictEqual(E.resolveBattle(banzhang, siling, S).outcome, 'defenderHolds');
  assert.strictEqual(E.resolveBattle(siling, siling2, S).outcome, 'bothDie');
  assert.strictEqual(E.resolveBattle(gongbing, gongbing2, S).outcome, 'bothDie');
  assert.strictEqual(E.resolveBattle(gongbing, banzhang, S).outcome, 'defenderHolds');
  assert.strictEqual(E.resolveBattle(banzhang, gongbing2, S).outcome, 'attackerWins');
});

test('resolveBattle：炸弹与任何牌同归于尽', () => {
  const S = {};
  const bomb = { id: 'zb', side: 'red', name: 'zhadan', type: 'bomb', rank: null };
  const bomb2 = { id: 'zb2', side: 'blue', name: 'zhadan', type: 'bomb', rank: null };
  const mine = { id: 'ml', side: 'blue', name: 'dilei', type: 'mine', rank: null };
  const siling = { id: 'sl', side: 'blue', name: 'siling', type: 'officer', rank: 10 };
  const gong = { id: 'gb', side: 'blue', name: 'gongbing', type: 'engineer', rank: 1 };
  for (const d of [siling, mine, bomb2, gong]) {
    assert.strictEqual(E.resolveBattle(bomb, d, S).outcome, 'bothDie', `bomb vs ${d.name}`);
    assert.strictEqual(E.resolveBattle(d, bomb, S).outcome, 'bothDie', `${d.name} vs bomb`);
  }
});

test('resolveBattle：工兵挖雷；军官撞雷默认同归于尽；可选地雷保留', () => {
  const S = {};
  const gong = { id: 'gb', side: 'red', name: 'gongbing', type: 'engineer', rank: 1 };
  const siling = { id: 'sl', side: 'red', name: 'siling', type: 'officer', rank: 10 };
  const mine = { id: 'ml', side: 'blue', name: 'dilei', type: 'mine', rank: null };
  const mine2 = { id: 'ml2', side: 'red', name: 'dilei', type: 'mine', rank: null };

  const r1 = E.resolveBattle(gong, mine, S);
  assert.strictEqual(r1.outcome, 'attackerWins');
  assert.strictEqual(r1.defenderDead, true);
  assert.strictEqual(r1.attackerOccupies, true);

  const r2 = E.resolveBattle(siling, mine, S);
  assert.strictEqual(r2.outcome, 'bothDie', 'v1.1 基准：军官撞雷同归于尽');

  const r3 = E.resolveBattle(siling, mine, { mineSurvivesOnOfficerCrash: true });
  assert.strictEqual(r3.outcome, 'defenderHolds');
  assert.strictEqual(r3.attackerDead, true);
  assert.strictEqual(r3.defenderDead, false);

  assert.strictEqual(E.resolveBattle(mine2, mine, S).outcome, 'bothDie', '防御性：雷对雷');
});

// ---------------------------------------------------------------------------
// 战斗集成（applyMove）
// ---------------------------------------------------------------------------

test('集成：大吃小，胜者占格，败者入死名单', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_banzhang' });
  stripOthers(state, ['red_siling', 'blue_banzhang']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.grid[5].cardId, 'red_siling');
  assert.ok(res.state.deadIds.includes('blue_banzhang'));
  assert.strictEqual(res.state.noCombatStreak, 0);
  assert.strictEqual(res.state.current, 'B');
});

test('集成：同级同归于尽，格子清空', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_siling' });
  stripOthers(state, ['red_siling', 'blue_siling']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.grid[5].cardId, null);
  assert.ok(res.state.deadIds.includes('red_siling'));
  assert.ok(res.state.deadIds.includes('blue_siling'));
});

test('集成：小攻大，进攻方阵亡、防守方守住原格', () => {
  const state = setupGame({ 0: 'red_banzhang', 5: 'blue_siling' });
  stripOthers(state, ['red_banzhang', 'blue_siling']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.grid[5].cardId, 'blue_siling');
  assert.strictEqual(res.state.grid[0].cardId, null);
  assert.ok(res.state.deadIds.includes('red_banzhang'));
});

test('集成：工兵挖雷占格；军官撞雷同归于尽', () => {
  const s1 = setupGame({ 0: 'red_gongbing', 5: 'blue_dilei' });
  stripOthers(s1, ['red_gongbing', 'blue_dilei']);
  revealAll(s1);
  const r1 = E.applyAction(s1, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(r1.ok);
  assert.strictEqual(r1.state.grid[5].cardId, 'red_gongbing');
  assert.ok(r1.state.deadIds.includes('blue_dilei'));

  const s2 = setupGame({ 0: 'red_siling', 5: 'blue_dilei' });
  stripOthers(s2, ['red_siling', 'blue_dilei']);
  revealAll(s2);
  const r2 = E.applyAction(s2, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(r2.ok);
  assert.strictEqual(r2.state.grid[5].cardId, null, '同归于尽格子清空');
  assert.ok(r2.state.deadIds.includes('red_siling'));
  assert.ok(r2.state.deadIds.includes('blue_dilei'));
});

test('集成：炸弹吃军官、军官撞炸弹、炸弹对撞均同归于尽', () => {
  const s1 = setupGame({ 0: 'red_zhadan', 5: 'blue_siling' });
  stripOthers(s1, ['red_zhadan', 'blue_siling']);
  revealAll(s1);
  const r1 = E.applyAction(s1, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(r1.ok);
  assert.strictEqual(r1.state.grid[5].cardId, null);
  assert.ok(r1.state.deadIds.includes('red_zhadan') && r1.state.deadIds.includes('blue_siling'));

  const s2 = setupGame({ 0: 'red_siling', 5: 'blue_zhadan' });
  stripOthers(s2, ['red_siling', 'blue_zhadan']);
  revealAll(s2);
  const r2 = E.applyAction(s2, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(r2.ok);
  assert.strictEqual(r2.state.grid[5].cardId, null);
  assert.ok(r2.state.deadIds.includes('red_siling') && r2.state.deadIds.includes('blue_zhadan'));
});

test('集成：地雷保留变体——军官撞雷仅进攻方阵亡', () => {
  const state = setupGame(
    { 0: 'red_siling', 5: 'blue_dilei' },
    { settings: { mineSurvivesOnOfficerCrash: true } }
  );
  stripOthers(state, ['red_siling', 'blue_dilei']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.grid[5].cardId, 'blue_dilei', '地雷保留');
  assert.ok(res.state.deadIds.includes('red_siling'));
});

// ---------------------------------------------------------------------------
// 夺旗前置与胜负
// ---------------------------------------------------------------------------

test('夺旗前置：对方未全灭时不可落子军旗格', () => {
  // 军旗 cell7(r1c2)，红司令 cell6(r1c1) 相邻，蓝地雷 cell8 仍在场
  const state = setupGame({ 6: 'red_siling', 7: 'junqi', 8: 'blue_dilei' });
  stripOthers(state, ['red_siling', 'junqi', 'blue_dilei']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 6, to: 7 });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'flag_precondition');
});

test('夺旗：对方全灭（含其地雷）后落子军旗格即获胜', () => {
  const state = setupGame({ 6: 'red_siling', 7: 'junqi', 8: 'blue_dilei' });
  stripOthers(state, ['red_siling', 'junqi', 'blue_dilei']);
  revealAll(state);
  killSide(state, 'blue'); // 蓝方 12 张全部移出（含地雷）
  assert.strictEqual(E.isSideEliminated(state, 'blue'), true);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 6, to: 7 });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.winner, 'red');
  assert.strictEqual(res.state.winReason, 'flagCaptured');
  assert.strictEqual(res.state.phase, 'finished');
});

test('夺旗前置：己方地雷残存不影响夺旗（v1.1 决议）', () => {
  const state = setupGame({ 6: 'red_siling', 7: 'junqi', 10: 'red_dilei' });
  stripOthers(state, ['red_siling', 'junqi', 'red_dilei']);
  revealAll(state);
  killSide(state, 'blue');
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 6, to: 7 });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.winner, 'red');
});

test('军旗未翻开时不可落子（不可移向暗牌）', () => {
  const state = setupGame({ 6: 'red_siling', 7: 'junqi' });
  stripOthers(state, ['red_siling', 'junqi']);
  revealAll(state);
  state.grid[7].revealed = false;
  killSide(state, 'blue');
  assert.strictEqual(E.validateMove(state, 'A', 6, 7), 'to_face_down');
});

test('无棋可走判负：无暗牌且无可移动棋子（仅剩地雷）', () => {
  const state = setupGame({ 0: 'red_siling', 12: 'blue_dilei' });
  stripOthers(state, ['red_siling', 'blue_dilei']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.state.current, 'B');
  assert.strictEqual(res.state.winner, 'red', 'B 无棋可走判负');
  assert.strictEqual(res.state.winReason, 'noMoves');
});

test('双方全灭平局', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_siling' });
  stripOthers(state, ['red_siling', 'blue_siling']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.winner, 'draw');
  assert.strictEqual(res.state.winReason, 'bothEliminated');
});

test('认输', () => {
  const state = setupGame({});
  const res = E.applyAction(state, { type: 'resign', player: 'B' });
  assert.ok(res.ok);
  assert.strictEqual(res.state.winner, 'red');
  assert.strictEqual(res.state.winReason, 'resign');
});

// ---------------------------------------------------------------------------
// 和棋保护
// ---------------------------------------------------------------------------

test('连续 N 步无战斗判和（翻牌计步，阈值可配置）', () => {
  let cur = E.createGame({ seed: 99, settings: { drawNoCombatSteps: 8 } });
  let res;
  for (let i = 0; i < 8; i++) {
    const idx = cur.grid.findIndex((c) => c.cardId && !c.revealed);
    res = E.applyAction(cur, { type: 'flip', player: cur.current, cell: idx });
    assert.ok(res.ok, `step ${i}: ${res.error}`);
    cur = res.state;
    if (cur.phase === 'finished') break;
  }
  assert.strictEqual(cur.phase, 'finished');
  assert.strictEqual(cur.winner, 'draw');
  assert.strictEqual(cur.winReason, 'noCombatDraw');
  assert.strictEqual(cur.noCombatStreak, 8);
});

test('总步数达到上限判和', () => {
  let cur = E.createGame({ seed: 99, settings: { maxSteps: 6, drawNoCombatSteps: 1000 } });
  let res;
  for (let i = 0; i < 6; i++) {
    const idx = cur.grid.findIndex((c) => c.cardId && !c.revealed);
    res = E.applyAction(cur, { type: 'flip', player: cur.current, cell: idx });
    assert.ok(res.ok, res.error);
    cur = res.state;
    if (cur.phase === 'finished') break;
  }
  assert.strictEqual(cur.phase, 'finished');
  assert.strictEqual(cur.winner, 'draw');
  assert.strictEqual(cur.winReason, 'maxStepsDraw');
});

test('空格移动累计无战斗计数', () => {
  let cur = setupGame({ 0: 'red_siling', 12: 'blue_banzhang' });
  stripOthers(cur, ['red_siling', 'blue_banzhang']);
  revealAll(cur);
  // 双方交替空移四步：A 0->5，B 12->7，A 5->0，B 7->12
  const seq = [
    ['A', 0, 5], ['B', 12, 7], ['A', 5, 0], ['B', 7, 12],
  ];
  for (const [p, f, t] of seq) {
    const r = E.applyAction(cur, { type: 'move', player: p, from: f, to: t });
    assert.ok(r.ok, `${p} ${f}->${t}: ${r.error}`);
    cur = r.state;
  }
  assert.strictEqual(cur.noCombatStreak, 4, '四步空移均计入无战斗计数');
});

test('战斗后无战斗计数清零', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_banzhang' });
  stripOthers(state, ['red_siling', 'blue_banzhang']);
  revealAll(state);
  state.noCombatStreak = 10;
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.noCombatStreak, 0, '战斗清零');
});

// ---------------------------------------------------------------------------
// 工程质量
// ---------------------------------------------------------------------------

test('纯函数性：applyAction 不修改入参状态', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_banzhang' });
  stripOthers(state, ['red_siling', 'blue_banzhang']);
  revealAll(state);
  const before = JSON.stringify(state);
  E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.strictEqual(JSON.stringify(state), before);
});

test('历史与事件：每步记录 action + events', () => {
  const state = setupGame({ 0: 'red_siling', 5: 'blue_banzhang' });
  stripOthers(state, ['red_siling', 'blue_banzhang']);
  revealAll(state);
  const res = E.applyAction(state, { type: 'move', player: 'A', from: 0, to: 5 });
  assert.strictEqual(res.state.history.length, 1);
  assert.strictEqual(res.state.history[0].action.type, 'move');
  assert.ok(res.events.some((e) => e.type === 'battle' && e.outcome === 'attackerWins'));
});

test('随机完整对局冒烟测试：连打 10 局不抛异常且有终局', () => {
  for (let seed = 1; seed <= 10; seed++) {
    let cur = E.createGame({ seed, settings: { maxSteps: 300, drawNoCombatSteps: 60 } });
    let steps = 0;
    while (cur.phase !== 'finished' && steps < 400) {
      const acts = E.getLegalActions(cur, cur.current);
      assert.ok(acts.length > 0, `seed ${seed} step ${steps} 无合法行动但未终局`);
      const act = acts[Math.floor(Math.random() * acts.length)];
      const r = E.applyAction(cur, Object.assign({ player: cur.current }, act));
      assert.ok(r.ok, `seed ${seed} step ${steps}: ${r.error}`);
      cur = r.state;
      steps++;
    }
    assert.strictEqual(cur.phase, 'finished', `seed ${seed} 未终局`);
    assert.ok(['red', 'blue', 'draw'].includes(cur.winner));
  }
});
