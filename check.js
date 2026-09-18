/**
 * 小游戏代码完整性检查（node 环境模拟，位于项目根目录）
 * 1) engine/ai/cards 语法与 require 链（miniprogram/ 下的小游戏运行时代码）
 * 2) AI 决策在随机对局中全流程可用（easy/normal 双难度各跑完整对局）
 * 3) game.js 运行时冒烟：模拟 wx/Canvas 环境 + 10 局 AI 对 AI 完整对局
 * 4) legacy-wxml/ 旧版页面脚本仅做语法参考检查
 */
'use strict';
const path = require('path');
const MP = path.join(__dirname, 'miniprogram');
const LEGACY = path.join(__dirname, 'legacy-wxml');
const E = require(path.join(MP, 'engine', 'engine.js'));
const AI = require(path.join(MP, 'utils', 'ai.js'));

function playGame(difficulty, seed) {
  let s = E.createGame({ seed });
  let steps = 0;
  while (s.phase !== 'finished' && steps < 400) {
    const player = s.current;
    let action = null;
    if (difficulty === 'easy') {
      const acts = E.getLegalActions(s, player);
      if (!acts.length) break;
      action = acts[Math.floor(Math.random() * acts.length)];
    } else {
      action = AI.decide(s, player);
    }
    if (!action) break;
    const res = E.applyAction(s, { ...action, player });
    if (!res.ok) {
      console.error('AI ILLEGAL ACTION', difficulty, seed, JSON.stringify(action), res.error);
      process.exit(1);
    }
    s = res.state;
    steps++;
  }
  if (s.phase !== 'finished') {
    console.error('GAME NOT FINISHED', difficulty, seed, 'steps=', steps);
    process.exit(1);
  }
  return { reason: s.winReason, winner: s.winner, steps };
}

let results = { easy: 0, normal: 0 };
for (let seed = 1; seed <= 30; seed++) {
  const r1 = playGame('easy', seed);
  const r2 = playGame('normal', seed);
  results.easy += r1.steps;
  results.normal += r2.steps;
}
console.log('OK: 60 full games (easy 30 + normal 30) all finished legally');
console.log('avg steps easy=', (results.easy / 30).toFixed(1), 'normal=', (results.normal / 30).toFixed(1));

// legacy-wxml 旧版页面脚本语法检查（仅作参考，不参与小游戏运行）
const fs = require('fs');
const battleSrc = fs.readFileSync(path.join(LEGACY, 'pages', 'battle', 'index.js'), 'utf8');
new Function('require', 'Page', 'getApp', 'wx', battleSrc);
const cardsPageSrc = fs.readFileSync(path.join(LEGACY, 'pages', 'cards', 'index.js'), 'utf8');
new Function('require', 'Page', 'wx', cardsPageSrc);
const settingsSrc = fs.readFileSync(path.join(LEGACY, 'pages', 'settings', 'index.js'), 'utf8');
new Function('Page', 'wx', 'getApp', settingsSrc);
console.log('OK: legacy-wxml page scripts parse clean');

// 引擎导出完整性：扫描页面代码中引用的 E.<fn> / AI.<fn> / C.<fn>，逐一验证模块确实导出
function checkExportUsage(src, mod, modName) {
  const re = new RegExp('\\b' + modName + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g');
  const used = new Set();
  let m;
  while ((m = re.exec(src))) used.add(m[1]);
  for (const fn of used) {
    if (typeof mod[fn] !== 'function') {
      console.error(`MISSING EXPORT: ${modName}.${fn} is referenced but not exported (typeof=${typeof mod[fn]})`);
      process.exit(1);
    }
  }
  return used.size;
}
const n1 = checkExportUsage(battleSrc, E, 'E');
const n2 = checkExportUsage(battleSrc, AI, 'AI');
const C3 = require(path.join(MP, 'utils', 'cards.js'));
const n3 = checkExportUsage(battleSrc, C3, 'C');
console.log(`OK: all engine/AI/cards method references in battle page exist (E:${n1} AI:${n2} C:${n3})`);

// cards.js 图片路径检查
const C = require(path.join(MP, 'utils', 'cards.js'));
const deck = E.createDeck();
for (const c of deck) {
  const p = C.cardImg(c.id);
  if (!/^\/assets\/cards\/card_(red|blue|flag)[^ ]*\.jpg$/.test(p)) {
    console.error('BAD IMG PATH', c.id, p);
    process.exit(1);
  }
  const fsPath = path.join(MP, 'assets', 'cards', path.basename(p));
  if (!fs.existsSync(fsPath)) {
    console.error('MISSING FILE', c.id, fsPath);
    process.exit(1);
  }
}
console.log('OK: 25 card image paths all resolve to existing files');

// ---------------- 小游戏（game.js）检查 ----------------
// 1) game.json 合法性
const gameJson = JSON.parse(fs.readFileSync(path.join(MP, 'game.json'), 'utf8'));
if (!gameJson.deviceOrientation) {
  console.error('game.json missing deviceOrientation');
  process.exit(1);
}
console.log('OK: game.json is valid JSON with deviceOrientation');

// 2) game.js 语法 + 导出引用检查
const gameSrc = fs.readFileSync(path.join(MP, 'game.js'), 'utf8');
new Function('require', 'wx', 'requestAnimationFrame', gameSrc);
const g1 = checkExportUsage(gameSrc, E, 'E');
const g2 = checkExportUsage(gameSrc, AI, 'AI');
const g3 = checkExportUsage(gameSrc, C, 'C');
console.log(`OK: game.js parses clean; module references exist (E:${g1} AI:${g2} C:${g3})`);

// 3) game.js 运行时冒烟：模拟 wx/Canvas 环境，加载入口并用 __api 跑 AI 对 AI 完整对局
function makeMockCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === 'canvas') return { width: 0, height: 0 };
      if (k in t) return t[k];
      t[k] = function () { return { width: 10 }; };
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
global.requestAnimationFrame = () => 0;
global.wx = {
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
  createCanvas: () => ({ width: 0, height: 0, getContext: () => makeMockCtx() }),
  createImage: () => ({ onload: null, src: '' }),
  onTouchStart() {}, onTouchMove() {}, onTouchEnd() {},
  setStorageSync() {}, getStorageSync() { return ''; },
  showModal() {},
};
const G = require(path.join(MP, 'game.js'));
const api = G.__api;
if (!api || typeof api.newBattle !== 'function') {
  console.error('game.js __api missing');
  process.exit(1);
}
for (let gi = 1; gi <= 10; gi++) {
  api.newBattle(gi % 2 ? 'A' : 'B');
  let steps = 0;
  while (api.state().phase !== 'finished' && steps < 400) {
    const player = api.state().current;
    let action = AI.decide(api.state(), player);
    if (!action) {
      const acts = E.getLegalActions(api.state(), player);
      if (!acts.length) break;
      action = acts[Math.floor(Math.random() * acts.length)];
    }
    const res = api.applyAction(player, action);
    if (!res.ok) {
      console.error('GAME.JS ILLEGAL ACTION', gi, JSON.stringify(action), res.error);
      process.exit(1);
    }
    steps++;
  }
  if (api.state().phase !== 'finished') {
    console.error('GAME.JS GAME NOT FINISHED', gi, 'steps=', steps);
    process.exit(1);
  }
}
console.log('OK: game.js runtime smoke — 10 full AI-vs-AI games through canvas entry finished legally');
console.log('ALL CHECKS PASSED');
