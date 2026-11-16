// The image is a snapshot at the time it is generated; match data stays on the device.
function fit(ctx, value, width) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (ctx.measureText(text).width <= width) return text;
  let result = text;
  while (result && ctx.measureText(result + '…').width > width) result = Array.from(result).slice(0, -1).join('');
  return result + '…';
}
function draw(canvas, match, replies) {
  canvas.width = 1000; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1000, 800);
  ctx.fillStyle = '#8845a0'; ctx.fillRect(0, 0, 1000, 300);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 48px sans-serif';
  const lines = [
    `时间  ${match.dateLabel}  ${match.kickoff || '时间待定'}`,
    `地点  ${match.location || '地点待定'}`,
    `比赛  ${match.competition || '球队比赛'} · 对手：${match.opponent}`,
  ];
  lines.forEach((line, i) => ctx.fillText(fit(ctx, line, 920), 40, 72 + i * 88));
  ctx.font = '38px sans-serif';
  ['参加', '待定', '请假'].forEach((label, i) => {
    const names = replies.filter(r => r.label === label).map(r => r.name);
    ctx.fillStyle = '#312b39';
    const heading = `${label}（${names.length}）：`;
    ctx.fillText(heading, 40, 375 + i * 105);
    const offset = ctx.measureText(heading).width;
    ctx.fillStyle = '#664193';
    ctx.fillText(fit(ctx, names.join('、') || '暂无', 920 - offset), 40 + offset, 375 + i * 105);
  });
  ctx.fillStyle = '#81778a'; ctx.font = '30px sans-serif';
  ctx.fillText('报名名单为分享时的快照，打开比赛查看最新情况', 40, 755);
}
module.exports = { draw, fit };
