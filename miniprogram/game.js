/**
 * 《军旗》翻棋 —— 微信小游戏入口（Canvas 渲染）
 * 引擎（engine/engine.js）、AI（utils/ai.js）、卡牌工具（utils/cards.js）100% 复用原小程序版本。
 * 结构：场景管理（home / battle / rules / cards）+ requestAnimationFrame 渲染循环 + 触摸分发。
 */
'use strict';

const E = require('./engine/engine.js');
const AI = require('./utils/ai.js');
const C = require('./utils/cards.js');

// ---------------------------------------------------------------- 基础环境

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

// 开发者工具冷启动时 jsbridge 可能尚未就绪（同步调用 wx.getSystemInfoSync 会报
// "jsbridge not ready" 并中断初始化）。策略：先用保守默认值启动，就绪后自动校正。
let SYS = null;
function fetchSys() {
  try {
    const s = wx.getSystemInfoSync();
    if (s && s.windowWidth) { SYS = s; return true; }
  } catch (e) { /* jsbridge not ready，稍后重试 */ }
  return false;
}
const sysReady = fetchSys();
if (!sysReady) SYS = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 };

let DPR = SYS.pixelRatio || 1;
let W = SYS.windowWidth;
let H = SYS.windowHeight;

function applyCanvasSize() {
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(DPR, DPR);
}
applyCanvasSize();

if (!sysReady) {
  (function waitSys() {
    setTimeout(function () {
      if (fetchSys()) {
        DPR = SYS.pixelRatio || 1;
        W = SYS.windowWidth;
        H = SYS.windowHeight;
        applyCanvasSize();
      } else {
        waitSys();
      }
    }, 50);
  })();
}

// 顶部安全区：小游戏右上角有系统胶囊按钮（…/⊙），棋盘必须从其下方开始
const CAPSULE = { bottom: 0, width: 0 };
function measureCapsule() {
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    if (r && r.bottom > 0) {
      CAPSULE.bottom = Math.ceil(r.bottom);
      CAPSULE.width = Math.ceil(r.width);
    }
  } catch (e) { /* 未就绪时用兜底值 */ }
  return CAPSULE;
}
function getSafeTop() {
  const c = measureCapsule();
  return c.bottom ? c.bottom + 8 : 58; // 拿不到胶囊位置时的保守兜底
}

const GRID = 5;
const THEME = {
  bg: '#2f3b30',        // 军绿桌面
  bgDeep: '#252f26',
  line: 'rgba(216, 198, 144, 0.85)', // 棋盘线（米金）
  panel: '#3a4638',
  text: '#f2ead8',
  dim: '#b9b09a',
  red: '#c23b2e',
  redDeep: '#8e1f1f',
  blue: '#2f5f9e',
  blueDeep: '#1e3f6e',
  gold: '#d9b45b',
  green: '#3f9e3f',
};

// ---------------------------------------------------------------- 本地存储

function safeGetStorage(key, fallback) {
  try { return wx.getStorageSync(key) || fallback; } catch (e) { return fallback; }
}
const stats = safeGetStorage('stats', { games: 0, wins: 0, draws: 0, streak: 0 });
const settings = safeGetStorage('settings', {
  sound: true, animation: true, mineSurvives: false, difficulty: 'normal',
});
function saveStats() { wx.setStorageSync('stats', stats); }
function saveSettings() { wx.setStorageSync('settings', settings); }

// ---------------------------------------------------------------- 图片缓存

const IMG_CACHE = {};
function imgSrc(cardId) { return C.cardImg(cardId).replace(/^\//, ''); }
function getImg(cardId) {
  if (!IMG_CACHE[cardId]) {
    const img = wx.createImage();
    img.onload = () => { img._ok = true; };
    IMG_CACHE[cardId] = img;
    img.src = imgSrc(cardId);
  }
  return IMG_CACHE[cardId];
}
(function preloadCards() {
  for (const key of Object.keys(C.NAME_CN)) {
    getImg('red_' + key);
    getImg('blue_' + key);
  }
  getImg('junqi');
})();

// ---------------------------------------------------------------- 绘制工具

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStar(cx, cy, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const a2 = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a2) * r * 0.42, cy + Math.sin(a2) * r * 0.42);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function text(str, x, y, font, color, align) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function inRect(x, y, r) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function drawBtn(b, primary) {
  ctx.globalAlpha = 1;
  rr(b.x, b.y, b.w, b.h, 10);
  if (primary) {
    ctx.fillStyle = THEME.gold; ctx.fill();
    text(b.label, b.x + b.w / 2, b.y + b.h / 2, 'bold 17px sans-serif', '#3a2c10', 'center');
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
    ctx.strokeStyle = THEME.gold; ctx.lineWidth = 1.5; ctx.stroke();
    text(b.label, b.x + b.w / 2, b.y + b.h / 2, '17px sans-serif', THEME.text, 'center');
  }
}

// ---------------------------------------------------------------- 场景状态

let scene = 'home';

// ---------------------------------------------------------------- 主页

function homeButtons() {
  const bw = Math.min(W - 80, 300);
  const x = (W - bw) / 2;
  const y0 = H * 0.40;
  const bh = 54, gap = 16;
  return {
    start: { x, y: y0, w: bw, h: bh, label: '开始游戏（人机）' },
    diff: { x, y: y0 + (bh + gap), w: bw, h: 44, label: '难度：' + (settings.difficulty === 'easy' ? '简单' : '普通') + '（点击切换）' },
    rules: { x, y: y0 + 2 * (bh + gap) - 10, w: bw, h: 44, label: '规则说明' },
    cards: { x, y: y0 + 2 * (bh + gap) + 44 - 10 + 12, w: bw, h: 44, label: '卡牌图鉴' },
  };
}

function renderHome(now) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  // 标题区
  drawStar(W / 2, H * 0.14, 30 + Math.sin(now / 600) * 2, THEME.gold);
  text('军 旗 翻 棋', W / 2, H * 0.14 + 68, 'bold 34px sans-serif', THEME.text, 'center');
  text('经典纸牌 · 5×5 翻棋对战', W / 2, H * 0.14 + 104, '14px sans-serif', THEME.dim, 'center');
  // 按钮
  const bs = homeButtons();
  drawBtn(bs.start, true);
  drawBtn(bs.diff);
  drawBtn(bs.rules);
  drawBtn(bs.cards);
  // 战绩
  text('战绩：' + stats.wins + ' 胜 / ' + (stats.games - stats.wins - stats.draws) + ' 负 / ' + stats.draws + ' 和',
    W / 2, H - 90, '14px sans-serif', THEME.dim, 'center');
  if (stats.streak >= 2) text('当前 ' + stats.streak + ' 连胜！', W / 2, H - 64, 'bold 14px sans-serif', THEME.gold, 'center');
}

// ---------------------------------------------------------------- 规则页

const RULE_LINES = [
  ['# 目标', true],
  ['消灭对方全部12张牌后，走到翻开的军旗上，夺旗获胜。', false],
  ['# 开局与定色', true],
  ['25张牌随机背面盖满5×5棋盘。先手翻出的第一张红/蓝牌', false],
  ['即为其阵营（翻到军旗不算，正常换人继续翻）。', false],
  ['# 每回合（二选一）', true],
  ['1. 翻牌：翻开任意一张暗牌；', false],
  ['2. 移动：将己方已翻开的牌沿线移动到相邻交点', false],
  ['（上下左右一格）。目标为空格则落子；目标为敌方', false],
  ['已翻开的牌则触发战斗。', false],
  ['# 战斗结算', true],
  ['· 军官相遇：大吃小，胜者占格；同级同归于尽。', false],
  ['· 炸弹：与任何牌同归于尽（司令也不例外）。', false],
  ['· 工兵：可以挖掉地雷（工兵胜，地雷移除）。', false],
  ['· 军官撞地雷：同归于尽。', false],
  ['· 地雷、军旗翻开后不可移动。', false],
  ['# 夺旗条件', true],
  ['只有对方12张牌全部被消灭后，才能走上军旗所在的', false],
  ['交点，落子即胜。若军旗尚未翻开，须先翻牌找到它。', false],
  ['# 判负与和棋', true],
  ['· 无牌可翻且无棋可动：判负；', false],
  ['· 双方全灭：平局；', false],
  ['· 连续40步无战斗或总步数达150步：判和。', false],
];

const rules = { scrollY: 0, dragY: 0, startY: 0, dragging: false, moved: false };

function renderRules() {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  const back = { x: 12, y: 14, w: 64, h: 36, label: '‹ 返回' };
  drawBtn(back);
  text('规则说明', W / 2, 32, 'bold 20px sans-serif', THEME.text, 'center');
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 60, W, H - 60);
  ctx.clip();
  let y = 80 + rules.scrollY;
  for (const [line, isHead] of RULE_LINES) {
    text(line, 24, y, isHead ? 'bold 16px sans-serif' : '15px sans-serif',
      isHead ? THEME.gold : THEME.text, 'left');
    y += isHead ? 34 : 26;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 图鉴页

const GALLERY = (function () {
  const order = ['siling', 'junzhang', 'shizhang', 'lvzhang', 'tuanzhang', 'yingzhang',
    'lianzhang', 'paizhang', 'banzhang', 'gongbing', 'dilei', 'zhadan'];
  const items = [{ id: 'junqi', label: '军旗', note: '中立' }];
  for (const k of order) items.push({ id: 'red_' + k, label: C.nameCn(k), note: '红方' });
  for (const k of order) items.push({ id: 'blue_' + k, label: C.nameCn(k), note: '蓝方' });
  return items;
})();

const gallery = { scrollY: 0, startY: 0, dragging: false, moved: false };

function galleryMetrics() {
  const cols = 4;
  const pad = 16, gap = 12;
  const tw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const th = tw * 1.8;
  return { cols, pad, gap, tw, th, rowH: th + 30 };
}

function renderGallery() {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  const back = { x: 12, y: 14, w: 64, h: 36, label: '‹ 返回' };
  drawBtn(back);
  text('卡牌图鉴', W / 2, 32, 'bold 20px sans-serif', THEME.text, 'center');
  const m = galleryMetrics();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 60, W, H - 60);
  ctx.clip();
  for (let i = 0; i < GALLERY.length; i++) {
    const it = GALLERY[i];
    const r = Math.floor(i / m.cols);
    const c = i % m.cols;
    const x = m.pad + c * (m.tw + m.gap);
    const y = 70 + r * m.rowH + gallery.scrollY;
    if (y < 40 || y > H) continue;
    const img = getImg(it.id);
    if (img._ok) ctx.drawImage(img, x, y, m.tw, m.th);
    else {
      ctx.fillStyle = THEME.panel; rr(x, y, m.tw, m.th, 6); ctx.fill();
    }
    text(it.label, x + m.tw / 2, y + m.th + 12, '13px sans-serif', THEME.text, 'center');
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 对战

let B = null; // 对局上下文

function newBattle(firstPlayer) {
  B = {
    state: E.createGame({
      firstPlayer,
      settings: settings.mineSurvives ? { mineSurvivesOnOfficerCrash: true } : {},
    }),
    human: 'A', ai: 'B',
    selected: -1,
    legal: {},
    anims: [],
    logText: '翻开任意一张牌开始定色',
    toast: '', toastT0: 0,
    over: null,
    first: firstPlayer,
    aiTimer: null,
  };
  // 棋盘几何（v1.3：横纵间距独立，牌间留空隙不覆盖；顶部避开胶囊按钮）
  const topBarH = getSafeTop(), logH = 38, btnH = 48;
  const availW = W - 16;
  const availH = H - topBarH - logH - btnH - 18;
  const colPitch = availW / GRID;
  const rowPitch = availH / GRID;
  let cardW = colPitch * 0.75;
  let cardH = cardW * 1.8;
  if (cardH > rowPitch * 0.78) { cardH = rowPitch * 0.78; cardW = cardH / 1.8; }
  B.g = {
    topBarH, boardX: 8, boardY: topBarH, availW, colPitch, rowPitch,
    cardW: Math.round(cardW), cardH: Math.round(cardH),
    logY: topBarH + rowPitch * GRID + 4,
    btnY: topBarH + rowPitch * GRID + logH,
  };
  scene = 'battle';
}

function nodeCenter(i) {
  const g = B.g;
  return {
    x: g.boardX + g.colPitch * ((i % GRID) + 0.5),
    y: g.boardY + g.rowPitch * (Math.floor(i / GRID) + 0.5),
  };
}

function battleButtons() {
  const g = B.g;
  const bw = (W - 16 - 16) / 3;
  return {
    resign: { x: 8, y: g.btnY, w: bw, h: 44, label: '认输' },
    rules: { x: 8 + bw + 8, y: g.btnY, w: bw, h: 44, label: '规则' },
    home: { x: 8 + 2 * (bw + 8), y: g.btnY, w: bw, h: 44, label: '首页' },
  };
}

function battleOverlayButtons() {
  const bw = 150, bh = 46;
  const cx = W / 2, cy = H * 0.56;
  return {
    again: { x: cx - bw - 10, y: cy + 60, w: bw, h: bh, label: '再来一局' },
    home: { x: cx + 10, y: cy + 60, w: bw, h: bh, label: '返回首页' },
  };
}

function drawCardFace(cx, cy, cardId, card, lift) {
  const g = B.g;
  const w = g.cardW, h = g.cardH;
  const x = cx - w / 2;
  const y = cy - h / 2 - (lift || 0);
  const img = getImg(cardId);
  if (img._ok) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    // 兜底：纯色卡面 + 名字
    const deep = card && card.side === 'blue' ? THEME.blueDeep : THEME.redDeep;
    rr(x, y, w, h, 6);
    ctx.fillStyle = deep; ctx.fill();
    ctx.strokeStyle = THEME.gold; ctx.lineWidth = 1.5; ctx.stroke();
    if (card) text(C.nameCn(card.name), cx, y + h / 2, 'bold 15px sans-serif', THEME.text, 'center');
  }
}

function drawCardBack(cx, cy, scale) {
  const g = B.g;
  const w = g.cardW * (scale == null ? 1 : scale);
  const h = g.cardH * (scale == null ? 1 : scale);
  const x = cx - w / 2, y = cy - h / 2;
  rr(x, y, w, h, 6);
  ctx.fillStyle = THEME.redDeep; ctx.fill();
  ctx.strokeStyle = THEME.gold; ctx.lineWidth = 1.5; ctx.stroke();
  drawStar(cx, cy, Math.min(w, h) * 0.16, THEME.gold);
}

const FLIP_MS = 280, SLIDE_MS = 180, BOOM_MS = 340;

function pushAnims(events) {
  for (const ev of events) {
    if (ev.type === 'revealed') {
      B.anims.push({ type: 'flip', cell: ev.cell, cardId: ev.cardId, t0: Date.now() });
    } else if (ev.type === 'move') {
      B.anims.push({ type: 'slide', from: ev.from, to: ev.to, cardId: ev.cardId, t0: Date.now() });
    } else if (ev.type === 'battle') {
      B.anims.push({ type: 'boom', cell: ev.to, t0: Date.now() });
    } else if (ev.type === 'flagCaptured') {
      B.anims.push({ type: 'win', cell: ev.cell, t0: Date.now() });
    }
  }
}

function pruneAnims(now) {
  if (!B || !B.anims.length) return;
  B.anims = B.anims.filter((a) => {
    const d = a.type === 'flip' ? FLIP_MS : a.type === 'slide' ? SLIDE_MS : BOOM_MS;
    return now - a.t0 < d;
  });
}

function renderBattle(now) {
  const s = B.state;
  const g = B.g;
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- 顶栏
  ctx.fillStyle = THEME.bgDeep;
  ctx.fillRect(0, 0, W, g.topBarH);
  const mySide = s.sides[B.human];
  // 蓝色计分右对齐时避开右上角胶囊按钮的水平区域
  const blueRight = W - 14 - (CAPSULE.width ? CAPSULE.width + 12 : 0);
  text('红 ' + E.aliveCount(s, 'red'), 14, g.topBarH / 2, 'bold 15px sans-serif', '#e88', 'left');
  text('蓝 ' + E.aliveCount(s, 'blue'), blueRight, g.topBarH / 2, 'bold 15px sans-serif', '#8af', 'right');
  let centerTxt = '定色阶段';
  if (s.phase === 'finished') centerTxt = '对局结束';
  else if (s.phase === 'playing') centerTxt = s.current === B.human ? '你的回合' : '对方思考中…';
  if (mySide) centerTxt += '·执' + (mySide === 'red' ? '红' : '蓝');
  // 中间状态文字自动缩字号，保证不与左右计分重叠
  ctx.font = 'bold 15px sans-serif';
  const scoreW = Math.max(ctx.measureText('红 12').width, ctx.measureText('蓝 12').width);
  const maxCW = Math.max(60, (blueRight - 14) - 2 * (scoreW + 16));
  let cpx = 15;
  while (cpx > 10) {
    ctx.font = cpx + 'px sans-serif';
    if (ctx.measureText(centerTxt).width <= maxCW) break;
    cpx--;
  }
  text(centerTxt, W / 2, g.topBarH / 2, cpx + 'px sans-serif', THEME.text, 'center');

  // ---- 棋盘线（横竖各5条）
  ctx.strokeStyle = THEME.line;
  ctx.lineWidth = 2;
  for (let i = 0; i < GRID; i++) {
    const y = g.boardY + g.rowPitch * (i + 0.5);
    ctx.beginPath();
    ctx.moveTo(g.boardX, y);
    ctx.lineTo(g.boardX + g.availW, y);
    ctx.stroke();
    const x = g.boardX + g.colPitch * (i + 0.5);
    ctx.beginPath();
    ctx.moveTo(x, g.boardY);
    ctx.lineTo(x, g.boardY + g.rowPitch * GRID);
    ctx.stroke();
  }

  // ---- 高亮（整格底色闪烁，画在牌上方、半透明）
  const blink = 0.30 + 0.22 * Math.abs(Math.sin(now / 260));
  for (const key of Object.keys(B.legal)) {
    const idx = Number(key);
    const act = B.legal[idx];
    const cell = s.grid[idx];
    let color = THEME.green;
    if (act.type === 'move' && cell.cardId) {
      const t = s.cards[cell.cardId];
      color = t.type === 'flag' ? THEME.gold : '#d85a30';
    }
    const p = nodeCenter(idx);
    ctx.globalAlpha = blink;
    ctx.fillStyle = color;
    rr(p.x - g.colPitch / 2 + 2, p.y - g.rowPitch / 2 + 2, g.colPitch - 4, g.rowPitch - 4, 8);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, blink + 0.3);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- 牌
  for (let i = 0; i < 25; i++) {
    const cell = s.grid[i];
    if (!cell.cardId) continue;
    const card = s.cards[cell.cardId];
    const p = nodeCenter(i);
    // 滑动动画中的目标格暂不绘制（由幽灵牌绘制）
    const sliding = B.anims.find((a) => a.type === 'slide' && a.to === i);
    if (sliding) continue;
    // 翻牌动画（中点前画牌背、中点后画牌面，横向缩放模拟翻转）
    const flip = B.anims.find((a) => a.type === 'flip' && a.cell === i);
    if (flip) {
      const t = (now - flip.t0) / FLIP_MS;
      const sx = Math.abs(1 - 2 * t);
      ctx.save();
      ctx.translate(p.x, 0);
      ctx.scale(Math.max(sx, 0.05), 1);
      if (t < 0.5) drawCardBack(0, p.y);
      else drawCardFace(0, p.y, cell.cardId, card, 0);
      ctx.restore();
      continue;
    }
    if (cell.revealed) {
      const isSel = B.selected === i;
      drawCardFace(p.x, p.y, cell.cardId, card, isSel ? 8 : 0);
      if (isSel) {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = THEME.gold;
        ctx.lineWidth = 2.5;
        rr(p.x - g.cardW / 2 - 2, p.y - g.cardH / 2 - 10, g.cardW + 4, g.cardH + 4, 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      drawCardBack(p.x, p.y);
    }
  }

  // ---- 幻影滑动的牌
  for (const a of B.anims) {
    if (a.type !== 'slide') continue;
    const t = Math.min(1, (now - a.t0) / SLIDE_MS);
    const ease = 1 - (1 - t) * (1 - t);
    const p1 = nodeCenter(a.from);
    const p2 = nodeCenter(a.to);
    const x = p1.x + (p2.x - p1.x) * ease;
    const y = p1.y + (p2.y - p1.y) * ease;
    const cell = { cardId: a.cardId };
    drawCardFace(x, y, a.cardId, s.cards[a.cardId], 10);
    void cell;
  }

  // ---- 爆炸/胜利特效
  for (const a of B.anims) {
    if (a.type !== 'boom' && a.type !== 'win') continue;
    const t = (now - a.t0) / BOOM_MS;
    const p = nodeCenter(a.cell);
    ctx.globalAlpha = 1 - t;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (a.type === 'win' ? 30 : 16) + t * 40, 0, Math.PI * 2);
    ctx.strokeStyle = a.type === 'win' ? THEME.gold : '#ff7a45';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- 战报条
  text(B.logText.length > 26 ? B.logText.slice(0, 25) + '…' : B.logText,
    W / 2, g.logY + 16, '13px sans-serif', THEME.dim, 'center');

  // ---- 按钮
  const bs = battleButtons();
  drawBtn(bs.resign);
  drawBtn(bs.rules);
  drawBtn(bs.home);

  // ---- 结算浮层
  if (B.over) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, W, H);
    const pw = W - 60, ph = 220, px = 30, py = H * 0.56 - 110;
    rr(px, py, pw, ph, 14);
    ctx.fillStyle = THEME.panel; ctx.fill();
    ctx.strokeStyle = THEME.gold; ctx.lineWidth = 2; ctx.stroke();
    const col = B.over.cls === 'win' ? THEME.gold : B.over.cls === 'draw' ? THEME.dim : '#e88';
    text(B.over.title, W / 2, py + 66, 'bold 40px sans-serif', col, 'center');
    text(B.over.reason, W / 2, py + 118, '14px sans-serif', THEME.text, 'center');
    const ob = battleOverlayButtons();
    drawBtn(ob.again, true);
    drawBtn(ob.home);
  }

  // ---- Toast
  if (B.toast && now - B.toastT0 < 1800) {
    ctx.globalAlpha = 1;
    rr(W / 2 - 130, H * 0.18, 260, 40, 10);
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill();
    text(B.toast, W / 2, H * 0.18 + 20, '14px sans-serif', '#fff', 'center');
  }
}

// ---------------------------------------------------------------- 事件与战报

function showToast(msg) {
  B.toast = msg;
  B.toastT0 = Date.now();
}

function handleEvents(events) {
  const s = B.state;
  const parts = [];
  for (const ev of events) {
    if (ev.type === 'revealed') {
      parts.push(C.sideCn(ev.side) + '翻出「' + C.nameCn(ev.name) + '」');
    } else if (ev.type === 'colorAssigned') {
      parts.push((ev.player === B.human ? '你' : '对方') + '执' + C.sideCn(ev.side));
    } else if (ev.type === 'move') {
      parts.push(C.sideCn(ev.side) + '「' + C.nameCn(ev.name) + '」移动');
    } else if (ev.type === 'battle') {
      const a = C.sideCn(ev.attackerSide) + '「' + C.nameCn(ev.attackerName) + '」';
      const d = C.sideCn(ev.defenderSide) + '「' + C.nameCn(ev.defenderName) + '」';
      if (ev.outcome === 'attackerWins') parts.push(a + '吃掉' + d);
      else if (ev.outcome === 'defenderHolds') parts.push(a + '进攻失败阵亡');
      else parts.push(a + '与' + d + '同归于尽');
    } else if (ev.type === 'flagCaptured') {
      parts.push(C.sideCn(ev.side) + '夺取军旗！');
    } else if (ev.type === 'gameOver') {
      onGameOver(ev);
    }
  }
  if (parts.length) B.logText = parts.join('；');
  if (s.phase === 'playing') {
    const mySide = s.sides[B.human];
    if (mySide) {
      const enemy = mySide === 'red' ? 'blue' : 'red';
      if (E.isSideEliminated(s, enemy)) showToast('敌军全灭！找到军旗即可获胜');
    }
  }
}

function onGameOver(ev) {
  const s = B.state;
  const mySide = s.sides[B.human];
  let title, cls;
  if (ev.winner === 'draw') { title = '平 局'; cls = 'draw'; }
  else if (ev.winner === mySide) { title = '胜 利'; cls = 'win'; }
  else { title = '失 败'; cls = 'lose'; }
  const reasons = {
    flagCaptured: '夺取军旗', resign: '对方认输', noMoves: '无棋可走',
    bothEliminated: '双方全灭', noCombatDraw: '连续40步无战斗，判和', maxStepsDraw: '达到步数上限，判和',
  };
  B.over = { title, cls, reason: reasons[ev.reason] || ev.reason || '' };
  stats.games++;
  if (ev.winner === 'draw') stats.draws++;
  else if (ev.winner === mySide) { stats.wins++; stats.streak++; }
  else stats.streak = 0;
  saveStats();
}

function errCn(err) {
  const map = {
    not_your_turn: '还没轮到你', not_revealed: '该牌未翻开', not_your_card: '不是你的牌',
    immovable: '该牌不可移动', not_adjacent: '只能移动到相邻交点', to_own_card: '目标有自己的牌',
    to_face_down: '目标牌未翻开', flag_precondition: '消灭对方全部棋子后才能夺旗',
    already_revealed: '该牌已翻开',
  };
  return map[err] || ('无效操作: ' + err);
}

// ---------------------------------------------------------------- 行动

function applyAction(player, action) {
  if (!B || !B.state || B.state.phase === 'finished') return { ok: false, error: 'finished' };
  const res = E.applyAction(B.state, Object.assign({}, action, { player }));
  if (!res.ok) return res;
  B.state = res.state;
  handleEvents(res.events);
  pushAnims(res.events);
  if (B.state.phase !== 'finished' && B.state.current === B.ai) scheduleAi();
  return res;
}

function scheduleAi() {
  const delay = settings.difficulty === 'easy' ? 700 : 900 + Math.random() * 600;
  if (B.aiTimer) clearTimeout(B.aiTimer);
  B.aiTimer = setTimeout(() => {
    B.aiTimer = null;
    if (!B || !B.state || B.state.phase === 'finished' || B.state.current !== B.ai) return;
    let action = null;
    if (settings.difficulty === 'easy') {
      const acts = E.getLegalActions(B.state, B.ai);
      if (acts.length) action = acts[Math.floor(Math.random() * acts.length)];
    } else {
      action = AI.decide(B.state, B.ai);
    }
    if (!action) return;
    applyAction(B.ai, action);
  }, delay);
}

// ---------------------------------------------------------------- 交互（触摸）

function battleTap(x, y) {
  const s = B.state;
  // 结算浮层
  if (B.over) {
    const ob = battleOverlayButtons();
    if (inRect(x, y, ob.again)) {
      newBattle(B.first === 'A' ? 'B' : 'A'); // 轮流先手
      return;
    }
    if (inRect(x, y, ob.home)) { B = null; scene = 'home'; return; }
    return;
  }
  const bs = battleButtons();
  if (inRect(x, y, bs.resign)) {
    if (s.phase !== 'finished') {
      wx.showModal({
        title: '认输', content: '确定认输吗？',
        success: (r) => { if (r.confirm) applyAction(B.human, { type: 'resign' }); },
      });
    }
    return;
  }
  if (inRect(x, y, bs.rules)) { scene = 'rules'; return; }
  if (inRect(x, y, bs.home)) { B = null; scene = 'home'; return; }

  if (s.phase === 'finished') return;
  if (s.current !== B.human) return;
  if (B.anims.length) return; // 动画播放中不响应

  // 命中交点
  const g = B.g;
  const c = Math.floor((x - g.boardX) / g.colPitch);
  const r = Math.floor((y - g.boardY) / g.rowPitch);
  if (c < 0 || c >= GRID || r < 0 || r >= GRID) return;
  const idx = r * GRID + c;
  const cell = s.grid[idx];

  // 已选中 → 移动 / 取消 / 改选
  if (B.selected >= 0) {
    if (idx === B.selected) { B.selected = -1; B.legal = {}; return; }
    const act = B.legal[idx];
    if (act) {
      B.selected = -1; B.legal = {};
      applyAction(B.human, act);
      return;
    }
  }
  // 点暗牌 → 翻牌
  if (cell.cardId && !cell.revealed) {
    B.selected = -1; B.legal = {};
    applyAction(B.human, { type: 'flip', cell: idx });
    return;
  }
  // 点己方已翻开的可移动牌 → 选中
  if (cell.cardId && cell.revealed && s.phase === 'playing') {
    const card = s.cards[cell.cardId];
    if (card.side === s.sides[B.human] && E.isMovableCard(card)) {
      B.selected = idx;
      B.legal = {};
      for (const act of E.getLegalActions(s, B.human)) {
        if (act.type === 'move' && act.from === idx) B.legal[act.to] = act;
      }
      if (!Object.keys(B.legal).length) {
        // 无处可去：显示提示但保持选中态供取消
      }
      return;
    }
  }
  B.selected = -1;
  B.legal = {};
}

function onTap(x, y) {
  if (scene === 'home') {
    const bs = homeButtons();
    if (inRect(x, y, bs.start)) { newBattle('A'); return; }
    if (inRect(x, y, bs.diff)) {
      settings.difficulty = settings.difficulty === 'easy' ? 'normal' : 'easy';
      saveSettings();
      return;
    }
    if (inRect(x, y, bs.rules)) { scene = 'rules'; rules.scrollY = 0; return; }
    if (inRect(x, y, bs.cards)) { scene = 'cards'; gallery.scrollY = 0; return; }
    return;
  }
  if (scene === 'battle' && B) { battleTap(x, y); return; }
  if (scene === 'rules' || scene === 'cards') {
    const back = { x: 12, y: 14, w: 64, h: 36 };
    if (inRect(x, y, back)) scene = B ? 'battle' : 'home';
  }
}

// 滚动（规则/图鉴）
let touchStart = null;
wx.onTouchStart((e) => {
  const t = e.touches[0];
  if (!t) return;
  touchStart = { x: t.clientX, y: t.clientY, t: Date.now(), moved: false };
  if (scene === 'rules') { rules.dragging = true; rules.startY = t.clientY; rules.dragY = rules.scrollY; }
  if (scene === 'cards') { gallery.dragging = true; gallery.startY = t.clientY; gallery.dragY = gallery.scrollY; }
  // 主页/对战：立即响应
  if (scene === 'home') onTap(t.clientX, t.clientY);
  else if (scene === 'battle' && B) onTap(t.clientX, t.clientY);
});

wx.onTouchMove((e) => {
  const t = e.touches[0];
  if (!t || !touchStart) return;
  if (Math.abs(t.clientY - touchStart.y) > 6 || Math.abs(t.clientX - touchStart.x) > 6) touchStart.moved = true;
  if (scene === 'rules' && rules.dragging) {
    rules.scrollY = rules.dragY + (t.clientY - rules.startY);
    const minY = Math.min(0, H - 60 - RULE_LINES.length * 30 - 80);
    rules.scrollY = Math.max(minY, Math.min(0, rules.scrollY));
  }
  if (scene === 'cards' && gallery.dragging) {
    gallery.scrollY = gallery.dragY + (t.clientY - gallery.startY);
    const m = galleryMetrics();
    const rows = Math.ceil(GALLERY.length / m.cols);
    const minY = Math.min(0, H - 70 - rows * m.rowH);
    gallery.scrollY = Math.max(minY, Math.min(20, gallery.scrollY));
  }
});

wx.onTouchEnd((e) => {
  const t = e.changedTouches && e.changedTouches[0];
  rules.dragging = false;
  gallery.dragging = false;
  if (!t || !touchStart) return;
  const quick = Date.now() - touchStart.t < 500 && !touchStart.moved;
  if (quick && (scene === 'rules' || scene === 'cards')) onTap(t.clientX, t.clientY);
  touchStart = null;
});

// ---------------------------------------------------------------- 渲染循环

function loop() {
  const now = Date.now();
  if (B) pruneAnims(now);
  if (scene === 'home') renderHome(now);
  else if (scene === 'battle' && B) renderBattle(now);
  else if (scene === 'rules') renderRules();
  else if (scene === 'cards') renderGallery();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- 测试接口（Node 自检用；小游戏环境无副作用）

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    __api: {
      newBattle,
      applyAction,
      state: () => B && B.state,
      setScene: (s) => { scene = s; },
    },
  };
}
