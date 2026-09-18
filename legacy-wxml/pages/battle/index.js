const E = require('../../engine/engine.js');
const C = require('../../utils/cards.js');
const AI = require('../../utils/ai.js');

const GRID = 5;

Page({
  data: {
    // 棋盘几何
    boardW: 0,
    boardH: 0,
    spacingX: 0,  // 横向交点间距（px）
    spacingY: 0,  // 纵向交点间距（px）
    cardW: 0,     // 卡宽（< spacingX，左右牌留空隙）
    cardH: 0,     // 卡高（< spacingY，上下牌留空隙、不覆盖）
    lines: [],    // 棋盘线位置
    nodes: [],    // 25 个交点（含牌、高亮、坐标）
    // 对局状态（视图快照）
    phase: '',
    mySide: null,     // 'red' | 'blue' | null（定色中）
    myTurn: false,
    redAlive: 12,
    blueAlive: 12,
    logText: '翻开任意一张牌开始定色',
    toast: '',
    resultShown: false,
    resultTitle: '',
    resultReason: '',
    resultClass: '',
  },

  // 对局内部状态（非渲染）
  state: null,
  myPlayer: 'A',       // 玩家标识
  aiPlayer: 'B',
  mode: 'ai',
  difficulty: 'normal',
  selected: -1,        // 选中交点 index
  legalTargets: {},    // to -> action
  aiTimer: null,
  toastTimer: null,
  humanPlayer: 'A',

  onLoad() {
    const app = getApp();
    const ctx = app.globalData.gameContext || { mode: 'ai', difficulty: 'normal', firstPlayer: 'A' };
    this.mode = ctx.mode;
    this.difficulty = ctx.difficulty || 'normal';
    this.humanPlayer = 'A';
    this.aiPlayer = 'B';

    const info = wx.getSystemInfoSync();
    const winW = info.windowWidth;
    const winH = info.windowHeight;
    // v1.3 牌间距约束：横纵交点间距独立计算，保证上下左右牌间都有空隙、互不覆盖
    // 纵向预算：顶栏 ~46 + 战报 ~44 + 按钮 ~48 + 页面边距 ~40
    const availW = winW - 24;
    const availH = winH - 190;
    const colPitch = availW / GRID;           // 横向交点间距
    const rowPitch = availH / GRID;           // 纵向交点间距
    // 卡宽 = 横向间距 75%；卡高按卡面比例 300x540（1:1.8）
    let cardW = colPitch * 0.75;
    let cardH = cardW * 1.8;
    // 若纵向放不下（卡高会超过纵向间距 78%），以纵向为准收缩
    const maxCardH = rowPitch * 0.78;
    if (cardH > maxCardH) {
      cardH = maxCardH;
      cardW = cardH / 1.8;
    }
    cardW = Math.round(cardW);
    cardH = Math.round(cardH);
    const spacingX = Math.round(colPitch);
    const spacingY = Math.round(rowPitch);
    const boardW = availW;
    const boardH = spacingY * GRID;
    const lines = [];
    for (let i = 0; i < GRID; i++) {
      lines.push({
        key: 'l' + i,
        hpos: Math.round(spacingY * (i + 0.5)), // 横线的 top
        vpos: Math.round(spacingX * (i + 0.5)), // 竖线的 left
      });
    }
    this.setData({ boardW, boardH, spacingX, spacingY, cardW, cardH, lines });
    this.initGame(ctx.firstPlayer === 'B' ? 'B' : 'A');
  },

  onUnload() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  },

  // ------------------------------------------------------------------ 建局

  initGame(firstPlayer) {
    const app = getApp();
    const settings = {};
    if (app.settings && app.settings.mineSurvives) settings.mineSurvivesOnOfficerCrash = true;
    this.state = E.createGame({
      firstPlayer,
      settings,
    });
    this.selected = -1;
    this.legalTargets = {};
    this.setData({
      phase: 'assigning',
      mySide: null,
      myTurn: firstPlayer === this.humanPlayer,
      redAlive: 12,
      blueAlive: 12,
      logText: '翻开任意一张牌开始定色',
      toast: '',
      resultShown: false,
    });
    this.render();
    if (this.state.current === this.aiPlayer) this.scheduleAi();
  },

  // ------------------------------------------------------------------ 渲染

  render() {
    const s = this.state;
    const nodes = [];
    for (let i = 0; i < 25; i++) {
      const r = Math.floor(i / GRID);
      const c = i % GRID;
      const x = this.data.spacingX * (c + 0.5);
      const y = this.data.spacingY * (r + 0.5);
      const cell = s.grid[i];
      const card = cell.cardId ? s.cards[cell.cardId] : null;
      let highlight = '';
      if (this.legalTargets[i]) {
        const act = this.legalTargets[i];
        const target = s.grid[i];
        if (act.type === 'move' && target.cardId) {
          const t = s.cards[target.cardId];
          highlight = t.type === 'flag' ? 'flag' : 'attack';
        } else if (act.type === 'flip') {
          highlight = 'move';
        } else {
          highlight = 'move';
        }
      }
      nodes.push({
        index: i,
        x: Math.round(x),
        y: Math.round(y),
        cardX: Math.round(x),
        cardY: Math.round(y),
        cardId: cell.cardId,
        revealed: cell.revealed,
        side: card ? card.side : null,
        name: card ? C.nameCn(card.name) : '',
        img: card ? C.cardImg(card.id) : '',
        selected: this.selected === i,
        highlight,
      });
    }
    this.setData({
      nodes,
      phase: s.phase,
      mySide: s.sides[this.humanPlayer],
      myTurn: s.phase !== 'finished' && s.current === this.humanPlayer,
      redAlive: E.aliveCount(s, 'red'),
      blueAlive: E.aliveCount(s, 'blue'),
    });
  },

  // ------------------------------------------------------------------ 交互

  onNodeTap(e) {
    const s = this.state;
    if (s.phase === 'finished') return;
    if (s.current !== this.humanPlayer) return; // 非玩家回合
    const idx = e.currentTarget.dataset.index;
    const cell = s.grid[idx];

    // 已选中己方牌 → 尝试移动到 idx / 取消
    if (this.selected >= 0) {
      if (idx === this.selected) {
        this.clearSelection();
        this.render();
        return;
      }
      const act = this.legalTargets[idx];
      if (act) {
        this.clearSelection();
        this.applyHumanAction(act);
        return;
      }
      // 未命中目标：尝试改选
    }

    // 翻牌：点暗牌
    if (cell.cardId && !cell.revealed) {
      this.clearSelection();
      this.applyHumanAction({ type: 'flip', cell: idx });
      return;
    }

    // 选牌：点己方已翻开的可移动牌
    if (cell.cardId && cell.revealed && s.phase === 'playing') {
      const card = s.cards[cell.cardId];
      if (card.side === s.sides[this.humanPlayer] && E.isMovableCard(card)) {
        this.selectPiece(idx);
        return;
      }
    }
    this.clearSelection();
    this.render();
  },

  selectPiece(idx) {
    const s = this.state;
    this.selected = idx;
    this.legalTargets = {};
    for (const act of E.getLegalActions(s, this.humanPlayer)) {
      if (act.type === 'move' && act.from === idx) {
        this.legalTargets[act.to] = act;
      }
    }
    this.render();
  },

  clearSelection() {
    this.selected = -1;
    this.legalTargets = {};
  },

  applyHumanAction(action) {
    const res = E.applyAction(this.state, { ...action, player: this.humanPlayer });
    if (!res.ok) {
      this.showToast(this.errCn(res.error));
      this.render();
      return;
    }
    this.state = res.state;
    this.handleEvents(res.events);
    this.render();
    if (this.state.phase !== 'finished' && this.state.current === this.aiPlayer) {
      this.scheduleAi();
    }
  },

  // ------------------------------------------------------------------ AI

  scheduleAi() {
    const delay = this.difficulty === 'easy' ? 700 : 900 + Math.random() * 600;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (!this.state || this.state.phase === 'finished') return;
      let action = null;
      if (this.difficulty === 'easy') {
        const acts = E.getLegalActions(this.state, this.aiPlayer);
        if (acts.length) action = acts[Math.floor(Math.random() * acts.length)];
      } else {
        action = AI.decide(this.state, this.aiPlayer);
      }
      if (!action) return;
      const res = E.applyAction(this.state, { ...action, player: this.aiPlayer });
      if (!res.ok) return;
      this.state = res.state;
      this.handleEvents(res.events);
      this.render();
    }, delay);
  },

  // ------------------------------------------------------------------ 事件/战报

  handleEvents(events) {
    const s = this.state;
    const parts = [];
    for (const ev of events) {
      if (ev.type === 'revealed') {
        parts.push(`${C.sideCn(ev.side)}翻出「${C.nameCn(ev.name)}」`);
      } else if (ev.type === 'colorAssigned') {
        parts.push(`${ev.player === this.humanPlayer ? '你' : '对方'}执${C.sideCn(ev.side)}`);
      } else if (ev.type === 'move') {
        parts.push(`${C.sideCn(ev.side)}「${C.nameCn(ev.name)}」移动`);
      } else if (ev.type === 'battle') {
        const a = `${C.sideCn(ev.attackerSide)}「${C.nameCn(ev.attackerName)}」`;
        const d = `${C.sideCn(ev.defenderSide)}「${C.nameCn(ev.defenderName)}」`;
        if (ev.outcome === 'attackerWins') parts.push(`${a}吃掉${d}`);
        else if (ev.outcome === 'defenderHolds') parts.push(`${a}进攻失败阵亡`);
        else parts.push(`${a}与${d}同归于尽`);
      } else if (ev.type === 'flagCaptured') {
        parts.push(`${C.sideCn(ev.side)}夺取军旗！`);
      } else if (ev.type === 'gameOver') {
        this.onGameOver(ev);
      }
    }
    if (parts.length) this.setData({ logText: parts.join('；') });
    // 全灭提示
    if (s.phase === 'playing') {
      const mySideStr = s.sides[this.humanPlayer];
      if (mySideStr) {
        const enemyStr = mySideStr === 'red' ? 'blue' : 'red';
        if (E.isSideEliminated(s, enemyStr)) {
          this.showToast('敌军全灭！找到军旗即可获胜');
        }
      }
    }
  },

  onGameOver(ev) {
    const s = this.state;
    const mySideStr = s.sides[this.humanPlayer];
    let title;
    let cls;
    if (ev.winner === 'draw') { title = '平 局'; cls = 'result-draw'; }
    else if (ev.winner === mySideStr) { title = '胜 利'; cls = 'result-win'; }
    else { title = '失 败'; cls = 'result-lose'; }
    const reasons = {
      flagCaptured: '夺取军旗',
      resign: '对方认输',
      noMoves: '无棋可走',
      bothEliminated: '双方全灭',
      noCombatDraw: '连续40步无战斗，判和',
      maxStepsDraw: '达到步数上限，判和',
    };
    const reason = reasons[ev.reason] || ev.reason || '';
    this.setData({
      resultShown: true,
      resultTitle: title,
      resultClass: cls,
      resultReason: reason,
    });
    // 战绩
    const app = getApp();
    app.stats.games++;
    if (ev.winner === 'draw') app.stats.draws++;
    else if (ev.winner === mySideStr) {
      app.stats.wins++;
      app.stats.streak++;
    } else {
      app.stats.streak = 0;
    }
    app.saveStats();
  },

  // ------------------------------------------------------------------ 按钮

  onResign() {
    const s = this.state;
    if (!s || s.phase === 'finished') return;
    wx.showModal({
      title: '认输',
      content: '确定认输吗？',
      success: (r) => {
        if (!r.confirm) return;
        const res = E.applyAction(s, { type: 'resign', player: this.humanPlayer });
        if (res.ok) {
          this.state = res.state;
          this.handleEvents(res.events);
          this.render();
        }
      },
    });
  },

  onRules() {
    wx.navigateTo({ url: '/pages/rules/index' });
  },

  onRestart() {
    // 轮流先手
    const nextFirst = this.state.current === 'A' ? 'B' : 'A';
    this.initGame(nextFirst);
  },

  onBackHome() {
    wx.navigateBack();
  },

  prevent() {},

  showToast(msg) {
    this.setData({ toast: msg });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ toast: '' }), 1800);
  },

  errCn(err) {
    const map = {
      not_your_turn: '还没轮到你',
      not_revealed: '该牌未翻开',
      not_your_card: '不是你的牌',
      immovable: '该牌不可移动',
      not_adjacent: '只能移动到相邻交点',
      to_own_card: '目标有自己的牌',
      to_face_down: '目标牌未翻开',
      flag_precondition: '消灭对方全部棋子后才能夺旗',
      already_revealed: '该牌已翻开',
    };
    return map[err] || ('无效操作: ' + err);
  },
});
