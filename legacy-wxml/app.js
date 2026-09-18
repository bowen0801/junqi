App({
  onLaunch() {
    // 初始化本地战绩
    const stats = wx.getStorageSync('stats') || { games: 0, wins: 0, draws: 0, streak: 0 };
    this.stats = stats;
    // 设置（音效/动效/可选规则）
    const settings = wx.getStorageSync('settings') || {
      sound: true,
      animation: true,
      mineSurvives: false,
      difficulty: 'normal',
    };
    this.settings = settings;
  },

  saveStats() {
    wx.setStorageSync('stats', this.stats);
  },

  saveSettings() {
    wx.setStorageSync('settings', this.settings);
  },

  globalData: {
    // 对局上下文：home -> battle 传参（模式、难度、先手）
    gameContext: null,
  },
});
