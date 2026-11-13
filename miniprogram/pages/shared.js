const api = require("../utils/api");
const statuses = {
  draft: "草稿",
  published: "待比赛",
  completed: "已完赛",
  cancelled: "已取消",
};
const replies = { yes: "参加", no: "请假", maybe: "待定" };
const value = (n) => (n == null ? "—" : n);
function dateLabel(date) {
  const parts = String(date || "")
    .split("-")
    .map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
    return "日期待定";
  return `${parts[1]}月${parts[2]}日 周${"日一二三四五六"[new Date(parts[0], parts[1] - 1, parts[2]).getDay()]}`;
}
function matchView(m, playerId) {
  const mine = (m.rsvps || []).find((r) => r.playerId === playerId);
  return {
    ...m,
    dateLabel: dateLabel(m.date),
    statusLabel: statuses[m.status] || m.status,
    scoreLabel: `${value(m.homeScore)} : ${value(m.awayScore)}`,
    response: mine?.response || "",
    responseLabel: mine ? replies[mine.response] : "未回应",
    yesCount: (m.rsvps || []).filter((r) => r.response === "yes").length,
    noCount: (m.rsvps || []).filter((r) => r.response === "no").length,
    maybeCount: (m.rsvps || []).filter((r) => r.response === "maybe").length,
  };
}
function fail(page, error) {
  if (page._disposed) return;
  page.setData({ error: error.message || "暂时无法加载，请重试" });
  if ((error.status || error.statusCode) === 401)
    wx.redirectTo({ url: "/pages/login/index" });
}
async function load(page, work) {
  const epoch = (page._epoch || 0) + 1;
  page._epoch = epoch;
  page._disposed = false;
  page.setData({ loading: true, error: "" });
  try {
    const session = await api.ensureSession();
    const result = await work(session);
    if (epoch === page._epoch && !page._disposed) page.setData(result);
  } catch (error) {
    if (epoch === page._epoch) fail(page, error);
  } finally {
    if (epoch === page._epoch && !page._disposed)
      page.setData({ loading: false });
    wx.stopPullDownRefresh();
  }
}
function unload() {
  this._disposed = true;
  this._epoch = (this._epoch || 0) + 1;
}
function openMatch(event) {
  wx.navigateTo({
    url: `/pages/match-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}`,
  });
}
function openPlayer(event) {
  wx.navigateTo({
    url: `/pages/player-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}`,
  });
}
function assetUrl(value) {
  if (typeof value !== "string") return "";
  if (
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return value;
  if (!/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(value) || value.includes(".."))
    return "";
  const base = String(require("../config").apiBaseUrl || "").replace(/\/$/, "");
  return /^https?:\/\/[^/]+$/.test(base) ? base + value : "";
}
function imageError(event) {
  const target = event.currentTarget.dataset.target;
  if (target === "team") this.setData({ "team.crest": "" });
  if (target === "player") this.setData({ "player.avatar": "" });
  if (target === "list") {
    const index = Number(event.currentTarget.dataset.index);
    if (Number.isInteger(index) && this.data.visible[index])
      this.setData({ ["visible[" + index + "].avatar"]: "" });
  }
}
function hide() {
  unload.call(this);
  const patch = { loading: true, error: "" };
  for (const key of [
    "matches",
    "players",
    "visible",
    "leaders",
    "recent",
    "seasons",
  ])
    if (key in this.data) patch[key] = [];
  for (const key of ["session", "player", "registration", "stats", "next"])
    if (key in this.data) patch[key] = null;
  if ("team" in this.data) patch.team = {};
  for (const key of ["currentPassword", "newPassword"])
    if (key in this.data) patch[key] = "";
  this.setData(patch);
}
function playerView(p) {
  return {
    ...p,
    avatar: assetUrl(p.avatar),
    numberLabel: value(p.number),
    positionLabel: (p.positions || []).join(" / ") || "位置未设置",
    initial: p.name?.slice(0, 1) || "球",
  };
}
module.exports = {
  api,
  value,
  dateLabel,
  matchView,
  playerView,
  replies,
  load,
  fail,
  unload,
  openMatch,
  openPlayer,
  assetUrl,
  imageError,
  hide,
};
