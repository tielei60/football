const { playerInitial } = require("../utils/player-initial");
const api = require("../utils/api");
const { imageSource } = require("../utils/media");
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
function matchView(m, playerId, detail = false) {
  const mine = (m.rsvps || []).find((r) => r.playerId === playerId);
  const yesCount = (m.rsvps || []).filter((r) => r.response === "yes").length;
  return {
    id: m.id,
    date: m.date,
    kickoff: m.kickoff,
    status: m.status,
    opponent: m.opponent,
    competition: m.competition,
    format: m.format,
    side: m.side,
    location: m.location,
    venueSnapshot: detail ? m.venueSnapshot || null : null,
    analysis: detail ? m.analysis || "" : "",
    dateLabel: dateLabel(m.date),
    statusLabel: statuses[m.status] || m.status,
    scoreLabel: `${value(m.homeScore)} : ${value(m.awayScore)}`,
    response: mine?.response || "",
    responseLabel: mine ? replies[mine.response] : "未回应",
    maxParticipants: m.maxParticipants ?? null,
    signupCountLabel: m.maxParticipants == null ? String(yesCount) : `${yesCount}/${m.maxParticipants}`,
    yesCount,
    noCount: (m.rsvps || []).filter((r) => r.response === "no").length,
    maybeCount: (m.rsvps || []).filter((r) => r.response === "maybe").length,
  };
}
function fail(page, error) {
  if (page._disposed || error.staleSession === true) return;
  page.setData({ error: error.message || "暂时无法加载，请重试" });
  if ((error.status || error.statusCode) === 401) {
    const id = page.id;
    const matchId = page.route === "pages/match-detail/index" && /^\d+$/.test(String(id || "")) ? String(id) : "";
    wx.redirectTo({ url: "/pages/login/index" + (matchId ? "?matchId=" + encodeURIComponent(matchId) : "") });
  }
}
async function load(page, work) {
  const epoch = (page._epoch || 0) + 1;
  page._epoch = epoch;
  page._disposed = false;
  page.setData({ loading: true, error: "" });
  try {
    const session = await api.ensureSession();
    if (epoch !== page._epoch || page._disposed) return;
    const result = await work(session);
    if (epoch === page._epoch && !page._disposed) safeSetData(page, result);
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
  return imageSource(value);
}
function teamView(team) {
  return { id: team.id, name: team.name, crest: assetUrl(team.crest) };
}
function sessionView(session) {
  return {
    user: {
      username: session.user.username,
      role: session.user.role,
      systemAdmin: session.user.systemAdmin === true,
      mustChangePassword: session.user.mustChangePassword === true,
      playerId: session.user.playerId,
      passwordEnabled: session.user.passwordEnabled !== false,
    },
    team: { id: session.team.id, name: session.team.name },
  };
}
function safeSetData(page, data) {
  // WeChat limits each setData call to 1 MB. Fail explicitly rather than silently
  // omit records or pass oversized base64/snapshot bodies to the render bridge.
  const json = JSON.stringify(data);
  if (encodeURIComponent(json).replace(/%[A-F\d]{2}/gi, "_").length > 900000)
    throw new Error("本次记录过多，无法在小程序中完整展示，请在网页端查看。");
  page.setData(JSON.parse(json));
}
function imageError(event) {
  const target = event.currentTarget.dataset.target;
  if (target === "team") this.setData({ "team.crest": "" });
  if (target === "player") this.setData({ "player.avatar": "" });
  if (target === "list") {
    if (this._disposed || this._hidden || this.data.loading || this.data.error) return;
    const { id, src, epoch } = event.currentTarget.dataset;
    if (epoch !== this._epoch || !this._filterOwner || this._filterOwner !== api.getSession()?.token) return;
    if (id == null || typeof src !== "string" || !src) return;
    // Lists are serialized separately by setData. Update both projections by
    // identity + image source, never by an index that can change after filtering.
    const patch = {};
    for (const key of ["players", "visible"]) {
      const rows = this.data[key];
      if (!Array.isArray(rows)) continue;
      rows.forEach((row, index) => {
        if (row.id === id && row.avatar === src)
          patch[key + "[" + index + "].avatar"] = "";
      });
    }
    if (Object.keys(patch).length) this.setData(patch);
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
    id: p.id,
    name: p.name,
    number: p.number,
    positions: p.positions,
    preferredFoot: p.preferredFoot,
    status: p.status,
    membershipConfirmed: p.membershipConfirmed !== false,
    membershipLabel: p.membershipConfirmed === false ? "状态未确认" : p.status === "active" ? "在队" : "已归档",
    avatar: assetUrl(p.avatar),
    avatarGenerated: p.avatarGenerated === true,
    avatarOriginLabel: p.avatarSimulation === true || p.avatarOriginKind === "local-simulation" ? "模拟图" : p.avatarAiGenerated === true ? "AI 生成" : "生成图",
    numberLabel: value(p.number),
    numberDescription: p.number == null ? "号码未设置" : `${p.number} 号`,
    positionLabel: (p.positions || []).join(" / ") || "位置未设置",
    initial: playerInitial(p.name),
  };
}
module.exports = {
  api,
  teamView,
  sessionView,
  safeSetData,
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
