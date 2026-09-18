const C = require('../../utils/cards.js');

const NAMES = [
  ['siling', '司令'], ['junzhang', '军长'], ['shizhang', '师长'],
  ['lvzhang', '旅长'], ['tuanzhang', '团长'], ['yingzhang', '营长'],
  ['lianzhang', '连长'], ['paizhang', '排长'], ['banzhang', '班长'],
  ['gongbing', '工兵'], ['dilei', '地雷'], ['zhadan', '炸弹'],
];

Page({
  data: {
    redCards: [],
    blueCards: [],
    flag: { img: '/assets/cards/card_flag.jpg', label: '军旗' },
  },

  onLoad() {
    const redCards = NAMES.map(([key, label]) => ({
      id: 'red_' + key,
      img: '/assets/cards/card_red_' + key + '.jpg',
      label,
    }));
    const blueCards = NAMES.map(([key, label]) => ({
      id: 'blue_' + key,
      img: '/assets/cards/card_blue_' + key + '.jpg',
      label,
    }));
    this.setData({ redCards, blueCards });
  },

  onPreview(e) {
    const { img, name } = e.currentTarget.dataset;
    wx.previewImage({ urls: [img], current: img });
  },
});
