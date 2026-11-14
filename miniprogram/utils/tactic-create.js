const COUNTS = [5, 6, 7, 8, 9, 11];
function build(title, count, formation, key) {
  title = String(title || "").trim();
  if (!title || title.length > 300) throw Error("战术名称须为 1–300 字");
  if (!COUNTS.includes(count)) throw Error("请选择有效人数");
  const board = { pieces: [], markings: [], playerCount: count };
  if (formation) {
    if (
      typeof formation.id !== "string" ||
      !formation.id ||
      formation.id.length > 300 ||
      typeof formation.name !== "string" ||
      formation.name.length > 300 ||
      formation.playerCount !== count ||
      !Array.isArray(formation.spots) ||
      formation.spots.length !== count
    )
      throw Error("阵型与人数不匹配");
    board.formationId = formation.id;
    board.pieces = formation.spots.map((spot, i) => {
      if (
        typeof spot.role !== "string" ||
        spot.role.length > 100 ||
        !Number.isFinite(spot.x) ||
        !Number.isFinite(spot.y) ||
        spot.x < 0 ||
        spot.x > 1250 ||
        spot.y < 0 ||
        spot.y > 826
      )
        throw Error("阵型坐标无效");
      return {
        pieceId: key + "-" + i,
        kind: "player",
        team: "home",
        x: spot.x,
        y: spot.y,
        label: "主队 " + (i + 1),
        shirtNumber: i + 1,
        position: spot.role,
        color: "#8845a0",
        radius: 24,
      };
    });
  }
  return {
    title,
    tags: [],
    favorite: false,
    formationName: formation ? formation.name : null,
    thumbnail: null,
    board,
  };
}
module.exports = { COUNTS, build };
// 本地草稿只接受本页可生成的匿名模型，拒绝混入成员、图片或额外字段。
function validatePayload(payload) {
  if (
    !payload ||
    !/^[a-f0-9-]{36}$/.test(payload.requestId || "") ||
    payload.note !== ""
  )
    throw Error("创建草稿无效");
  const t = payload.tactic,
    b = t?.board;
  if (!b) throw Error("创建草稿无效");
  let f = null;
  if (b.pieces?.length)
    f = {
      id: b.formationId,
      name: t.formationName,
      playerCount: b.playerCount,
      spots: b.pieces.map((p) => ({ x: p.x, y: p.y, role: p.position })),
    };
  const canonical = {
    requestId: payload.requestId,
    tactic: build(t.title, b.playerCount, f, "native-" + payload.requestId),
    note: "",
  };
  if (JSON.stringify(payload) !== JSON.stringify(canonical))
    throw Error("创建草稿包含不支持的内容");
  return canonical;
}
module.exports.validatePayload = validatePayload;
