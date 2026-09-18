Page({
  data: {
    stats: { games: 0, wins: 0, draws: 0, streak: 0 },
  },

  onShow() {
    const app = getApp();
    this.setData({ stats: app.stats || this.data.stats });
  },

  onStartAI() {
    const app = getApp();
    app.globalData.gameContext = {
      mode: 'ai',
      difficulty: (app.settings && app.settings.difficulty) || 'normal',
      firstPlayer: Math.random() < 0.5 ? 'A' : 'B', // 首局随机先手；胜方每次由对战页"再来一局"轮流
    };
    wx.navigateTo({ url: '/pages/battle/index' });
  },
});
