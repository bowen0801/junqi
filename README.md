# 军旗小游戏（junqi）

《军旗》纸牌游戏微信**小游戏**——5×5 交点棋盘翻棋玩法（牌放在横竖各 5 条线的交汇点上），Canvas 渲染。

## 目录结构

```
junqi/
├─ docs/                       # 文档
│  ├─ 军旗小程序需求文档.md      # 需求基线 v1.3
│  └─ 项目进度总结.md           # 进度看板（随开发实时更新）
├─ engine/                     # 规则引擎源（开发/测试根）
│  ├─ engine.js                # 纯函数规则引擎
│  └─ engine.test.js           # 35 个单元测试（node --test）
├─ assets/
│  ├─ cards/                   # 原始切图（25 卡面 PNG 原图 + 牌背）
│  ├─ brand/                   # 小程序头像
│  └─ scripts/                 # 切图/压缩/头像脚本（PIL）
├─ check.js                    # 完整性自检（node check.js，位于项目根）
├─ legacy-wxml/                # 旧 WXML 小程序版（已被 Canvas 版取代，仅存档）
└─ miniprogram/                # 微信小游戏包（开发者工具 miniprogramRoot）
   ├─ game.json                # 小游戏配置（竖屏）
   ├─ game.js                  # 小游戏入口：Canvas 渲染（首页/对战/规则/图鉴）+ 触摸分发
   ├─ engine/engine.js         # 引擎副本（require 用）
   ├─ assets/cards/            # 卡图副本（150×270 JPG）
   └─ utils/
      ├─ cards.js              # 卡牌资源/名称工具
      └─ ai.js                 # AI（简单/普通 + 收官寻旗）
```

## 开发调试

1. 微信开发者工具 → 导入项目 → 目录选 `D:\githubSVN\junqi`（compileType=game，miniprogramRoot=miniprogram/）
2. AppID：新注册的小游戏账号（类目：游戏→休闲游戏）
3. 自检：`node check.js`（60 局 AI 全流程对局 + game.js 运行时冒烟 10 局 + 卡图路径 + 旧版脚本语法）

## 核心规则速查

- 25 张牌随机背面摆在 25 个交点上；第一张翻出的红/蓝牌定翻牌者阵营
- 每回合二选一：翻任意暗牌 / 己方已翻开牌沿线走相邻交点（不斜走不连走）
- 大吃小、同级同归、炸弹碰任何牌同归、工兵挖雷、军官撞雷同归；地雷军旗不可移动
- 对方 12 张全部移出棋盘后，走到翻开的军旗交点即夺旗获胜

详细规则见 `docs/军旗小程序需求文档.md`。
