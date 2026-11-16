// WeChat's native picker and map use GCJ-02. Never infer/convert unknown coordinates.
function point(value) {
  return value && value.coordinateSystem === 'gcj02' &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 &&
    typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}
// 显式逻辑像素尺寸为工程选择，不是平台默认值；无有效坐标不创建标记。
function markers(value, title) {
  if (!point(value)) return [];
  return [{id:1, latitude:value.latitude, longitude:value.longitude,
    title:title === undefined ? value.name : title, width:24, height:32}];
}
function choose() {
  return new Promise((resolve, reject) => {
    const pick = () => wx.chooseLocation({
      success(result) {
        const value = { name: result.name || '', address: result.address || '', latitude: result.latitude,
          longitude: result.longitude, coordinateSystem: 'gcj02' };
        if (!point(value)) return reject(new Error('地图未返回有效位置，请重新选择。'));
        resolve(value);
      },
      fail(error) {
        if (/cancel/i.test(error.errMsg || '')) return resolve(null);
        reject(new Error('暂时无法选择位置，请检查微信位置权限和小程序位置接口配置。'));
      },
    });
    if (typeof wx.requirePrivacyAuthorize === 'function') wx.requirePrivacyAuthorize({
      success: pick,
      fail: () => reject(new Error('需同意微信位置相关隐私授权后才能地图选点。')),
    });
    else pick();
  });
}
function open(value) {
  if (!point(value)) return Promise.reject(new Error('此球场尚未设置地图位置。'));
  if (typeof wx.openLocation !== 'function') return Promise.reject(new Error('当前微信暂不支持查看位置，请在手机微信中重试。'));
  return new Promise((resolve, reject) => wx.openLocation({latitude:value.latitude, longitude:value.longitude,
    name:[value.name,value.fieldNumber].filter(Boolean).join(' · '), address:value.address || '', scale:16, success:resolve,
    fail: error => /cancel/i.test(error.errMsg || '') ? resolve() : reject(new Error('暂时无法打开微信地图，请稍后重试。'))}));
}
// Use the match's captured venue only. Current venue edits/archival must not move history.
function matchVenue(match) {
  const snapshot = match && match.venueSnapshot;
  const text = value => typeof value === 'string' ? value : '';
  const valid = !!point(snapshot);
  const title = [text(snapshot?.name), text(snapshot?.fieldNumber)].filter(Boolean).join(' · ') || '比赛球场';
  const address = text(snapshot?.address) || text(match?.location);
  return {valid, title, address, latitude:valid?snapshot.latitude:null, longitude:valid?snapshot.longitude:null,
    markers:markers(snapshot, title),
    message:valid?'比赛留存位置；如集合地点有变，请与管理员确认。':snapshot?'本场比赛未留存有效地图坐标，请联系管理员确认位置。':'本场比赛尚未关联地图位置，请联系管理员补充。'};
}
module.exports = {point, markers, choose, open, matchVenue};
