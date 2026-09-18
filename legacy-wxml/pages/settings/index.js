Page({
  data: {
    difficultyOptions: [
      { value: 'easy', label: '简单' },
      { value: 'normal', label: '普通' },
    ],
    difficultyIndex: 1,
    mineSurvives: false,
    sound: true,
    animation: true,
    stats: { games: 0, wins: 0, draws: 0, streak: 0 },
  },

  onShow() {
    const app = getApp();
    const s = app.settings || {};
    const idx = this.data.difficultyOptions.findIndex((o) => o.value === s.difficulty);
    this.setData({
      difficultyIndex: idx >= 0 ? idx : 1,
      mineSurvives: !!s.mineSurvives,
      sound: !!s.sound,
      animation: !!s.animation,
      stats: app.stats || this.data.stats,
    });
  },

  save() {
    const app = getApp();
    app.saveSettings();
  },

  onDifficultyChange(e) {
    const idx = Number(e.detail.value);
    const app = getApp();
    app.settings.difficulty = this.data.difficultyOptions[idx].value;
    this.setData({ difficultyIndex: idx });
    this.save();
  },

  onMineSurvivesChange(e) {
    const app = getApp();
    app.settings.mineSurvives = e.detail.value;
    this.setData({ mineSurvives: e.detail.value });
    this.save();
  },

  onSoundChange(e) {
    const app = getApp();
    app.settings.sound = e.detail.value;
    this.setData({ sound: e.detail.value });
    this.save();
  },

  onAnimationChange(e) {
    const app = getApp();
    app.settings.animation = e.detail.value;
    this.setData({ animation: e.detail.value });
    this.save();
  },

  onResetStats() {
    wx.showModal({
      title: '清空战绩',
      content: '确定清空全部战绩吗？',
      success: (r) => {
        if (!r.confirm) return;
        const app = getApp();
        app.stats = { games: 0, wins: 0, draws: 0, streak: 0 };
        app.saveStats();
        this.setData({ stats: app.stats });
      },
    });
  },
});
