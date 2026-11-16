// 仅展示投影。homeScore/awayScore 与原统计口径一致：我方/对方，不因主客场翻转。
module.exports = function resultView(match) {
  if (match.status !== "completed" || !Number.isFinite(match.homeScore) || !Number.isFinite(match.awayScore))
    return { resultLabel: "比分未完整记录", resultTone: "unknown" };
  if (match.homeScore > match.awayScore) return { resultLabel: "胜", resultTone: "win" };
  if (match.homeScore < match.awayScore) return { resultLabel: "负", resultTone: "loss" };
  return { resultLabel: "平", resultTone: "draw" };
};
