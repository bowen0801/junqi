/**
 * 卡牌资源与名称工具
 */
'use strict';

const IMG_BASE = '/assets/cards/';

/** cardId -> 图片路径 */
function cardImg(cardId) {
  if (cardId === 'junqi') return IMG_BASE + 'card_flag.jpg';
  return IMG_BASE + 'card_' + cardId + '.jpg';
}

/** card.name(拼音key) -> 中文名 */
const NAME_CN = {
  siling: '司令', junzhang: '军长', shizhang: '师长', lvzhang: '旅长',
  tuanzhang: '团长', yingzhang: '营长', lianzhang: '连长', paizhang: '排长',
  banzhang: '班长', gongbing: '工兵', dilei: '地雷', zhadan: '炸弹', junqi: '军旗',
};

function nameCn(nameKey) {
  return NAME_CN[nameKey] || nameKey;
}

function sideCn(side) {
  return side === 'red' ? '红方' : side === 'blue' ? '蓝方' : '中立';
}

module.exports = { cardImg, nameCn, sideCn, NAME_CN };
