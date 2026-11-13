import { readFileSync } from "node:fs";
// Generated from Web eightFormations.ts + matchFormats.ts; parity tested.
const formations = JSON.parse(
  readFileSync(new URL("./native-formations.json", import.meta.url), "utf8"),
);
import { FootballError } from "./football-store.mjs";
import { tacticVersion } from "./tactic-version.mjs";
const fail = (message) => {
  throw new FootballError(400, message);
};
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v) =>
  (typeof v === "string" &&
    v.length > 0 &&
    v.length <= 128 &&
    !/[\x00-\x1f\x7f]/.test(v)) ||
  (Number.isSafeInteger(v) && v >= 0);
const shapes = new Set([
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "pen",
  "text",
]);
const fields = new Set([
  "kind",
  "x",
  "y",
  "startX",
  "startY",
  "endX",
  "endY",
  "color",
  "strokeColor",
  "backgroundColor",
  "width",
  "path",
  "dashed",
  "label",
]);
function only(v, allowed) {
  if (!object(v) || Object.keys(v).some((k) => !allowed.has(k)))
    fail("命令包含不支持的字段。");
}
function coordinate(v, max) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max)
    fail("标记和球员位置须在画布范围内。");
}
function validateFields(v) {
  for (const [k, value] of Object.entries(v)) {
    if (["x", "startX", "endX"].includes(k)) coordinate(value, 1250);
    if (["y", "startY", "endY"].includes(k)) coordinate(value, 826);
    if (k === "kind" && !shapes.has(value)) fail("不支持的标记类型。");
    if (
      k === "width" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0.5 ||
        value > 50)
    )
      fail("线宽须在 0.5–50 之间。");
    if (
      ["color", "strokeColor", "backgroundColor"].includes(k) &&
      (typeof value !== "string" ||
        !/^(?:#[a-fA-F0-9]{3}|#[a-fA-F0-9]{4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8}|transparent)$/.test(
          value,
        ))
    )
      fail("请使用有效十六进制颜色。");
    if (k === "dashed" && typeof value !== "boolean")
      fail("虚线设置须为布尔值。");
    if (k === "label" && (typeof value !== "string" || value.length > 1000))
      fail("文字标记不能超过 1000 字。");
    if (k === "path") {
      if (!Array.isArray(value) || value.length > 2000)
        fail("画笔路径点数不能超过 2000。");
      for (const point of value) {
        if (!Array.isArray(point) || point.length !== 2)
          fail("画笔路径格式不正确。");
        coordinate(point[0], 1250);
        coordinate(point[1], 826);
      }
    }
  }
}
function complete(v) {
  if (!shapes.has(v.kind)) fail("请选择支持的标记类型。");
  for (const k of ["startX", "startY", "endX", "endY"])
    if (v[k] === undefined) fail("标记须提供完整起止坐标。");
  if (v.kind === "pen" && (!Array.isArray(v.path) || v.path.length < 2))
    fail("画笔标记至少包含两个路径点。");
  if (v.kind === "text" && (typeof v.label !== "string" || !v.label.trim()))
    fail("文字标记不能为空。");
}
const pieceFields = new Set([
  "label",
  "shirtNumber",
  "position",
  "color",
  "radius",
  "team",
]);
function piecePatch(patch) {
  only(patch, pieceFields);
  if (!Object.keys(patch).length) fail("请提供球员属性。");
  for (const [k, v] of Object.entries(patch)) {
    if (
      (k === "label" || k === "position") &&
      (typeof v !== "string" || v.length > (k === "label" ? 100 : 40))
    )
      fail("球员文字过长。");
    if (
      k === "shirtNumber" &&
      v !== null &&
      (!Number.isInteger(v) || v < 0 || v > 999)
    )
      fail("号码须为 0–999 或 null。");
    if (
      k === "radius" &&
      (typeof v !== "number" || !Number.isFinite(v) || v < 5 || v > 100)
    )
      fail("球员半径须为 5–100。");
    if (k === "team" && !["home", "away"].includes(v))
      fail("请选择主队或客队。");
    if (k === "color") validateFields({ color: v });
  }
}
function stagePatch(patch, empty = false) {
  only(patch, new Set(["title", "note", "durationSeconds"]));
  if (!empty && !Object.keys(patch).length) fail("请提供阶段属性。");
  for (const [k, v] of Object.entries(patch)) {
    if (
      (k === "title" || k === "note") &&
      (typeof v !== "string" || v.length > (k === "title" ? 60 : 1000))
    )
      fail("阶段文字过长。");
    if (
      k === "durationSeconds" &&
      (typeof v !== "number" || !Number.isFinite(v) || v < 0.5 || v > 30)
    )
      fail("阶段时长须为 0.5–30 秒。");
  }
}
function demonstration(board) {
  const d = board.demonstration;
  if (
    !object(d) ||
    !Array.isArray(d.participants) ||
    d.participants.length > 128 ||
    !Array.isArray(d.stages) ||
    !d.stages.length ||
    d.stages.length > 120 ||
    !Array.isArray(d.runs)
  )
    fail("请先创建有效的演示。");
  const ids = new Set();
  for (const p of d.participants) {
    if (!object(p) || !id(p.pieceId) || ids.has(p.pieceId))
      fail("演示参与者编号异常。");
    ids.add(p.pieceId);
  }
  d.stages.forEach((s, i) => {
    if (!object(s) || s.stageNumber !== i || !Array.isArray(s.positions))
      fail("阶段编号或位置异常。");
    const seen = new Set();
    for (const p of s.positions) {
      if (!object(p) || !ids.has(p.pieceId) || seen.has(p.pieceId))
        fail("阶段参与者异常。");
      seen.add(p.pieceId);
      coordinate(p.x, 1250);
      coordinate(p.y, 826);
    }
  });
  const edges = new Map();
  for (const r of d.runs) {
    if (
      !object(r) ||
      !ids.has(r.pieceId) ||
      !Number.isInteger(r.fromStage) ||
      r.fromStage < 0 ||
      r.fromStage >= d.stages.length - 1 ||
      !object(r.bend)
    )
      fail("演示路径异常。");
    const seen = edges.get(r.fromStage) || new Set();
    if (seen.has(r.pieceId)) fail("演示路径重复。");
    seen.add(r.pieceId);
    edges.set(r.fromStage, seen);
    coordinate(r.bend.x, 1250);
    coordinate(r.bend.y, 826);
  }
  return d;
}
function stageIndex(d, n) {
  if (!Number.isInteger(n) || n < 0 || n >= d.stages.length)
    fail("阶段不存在。");
  return n;
}
function composeCommand(board, c, find) {
  if (c.type === "ensure-initial-stage") {
    only(c, new Set(["type"]));
    const d = board.demonstration;
    if (
      !object(d) ||
      !Array.isArray(d.stages) ||
      d.stages.length !== 0 ||
      !Array.isArray(d.runs) ||
      d.runs.length !== 0 ||
      !Array.isArray(d.participants)
    )
      fail("仅可为没有阶段且没有路径的既有演示建立首阶段。");
    // Do not replace the demonstration or clear anomalous orphan runs.
    d.stages = [
      {
        stageNumber: 0,
        title: "步骤 1",
        note: "",
        durationSeconds: 3,
        positions: d.participants.map((p) => ({
          pieceId: p?.pieceId,
          x: p?.x,
          y: p?.y,
        })),
      },
    ];
    demonstration(board);
    return true;
  }
  if (c.type === "update-piece" || c.type === "update-participant") {
    only(c, new Set(["type", "pieceId", "patch"]));
    piecePatch(c.patch);
    const rows =
      c.type === "update-piece"
        ? board.pieces
        : demonstration(board).participants;
    const i = find(rows, "pieceId", c.pieceId);
    if ((rows[i].kind || "player") !== "player") fail("仅可修改球员属性。");
    rows[i] = { ...rows[i], ...c.patch };
    if (c.patch.shirtNumber === null) delete rows[i].shirtNumber;
    return true;
  }
  if (c.type === "init-demonstration") {
    only(c, new Set(["type", "demonstrationId", "title"]));
    if (board.demonstration != null) fail("已有演示，请编辑现有阶段。");
    if (!id(c.demonstrationId)) fail("演示编号不正确。");
    stagePatch(c.title === undefined ? {} : { title: c.title }, true);
    const participants = structuredClone(
      board.pieces.filter((p) =>
        ["player", "ball"].includes(p.kind || "player"),
      ),
    );
    board.demonstration = {
      demonstrationId: c.demonstrationId,
      title: c.title || "",
      participants,
      stages: [
        {
          stageNumber: 0,
          title: "步骤 1",
          note: "",
          durationSeconds: 3,
          positions: participants.map((p) => ({
            pieceId: p.pieceId,
            x: p.x,
            y: p.y,
          })),
        },
      ],
      runs: [],
    };
    demonstration(board);
    return true;
  }
  if (
    ![
      "add-stage",
      "update-stage",
      "delete-stage",
      "move-participant",
      "set-run",
    ].includes(c.type)
  )
    return false;
  const d = demonstration(board);
  if (c.type === "add-stage") {
    only(c, new Set(["type", "afterStage", "stage"]));
    const n = stageIndex(d, c.afterStage);
    const patch = c.stage === undefined ? {} : c.stage;
    stagePatch(patch, true);
    if (d.stages.length >= 120) fail("最多 120 个阶段。");
    const next = structuredClone(d.stages[n]);
    d.stages.splice(n + 1, 0, { ...next, title: `步骤 ${n + 2}`, ...patch });
    d.runs = d.runs
      .filter((r) => r.fromStage !== n)
      .map((r) => ({
        ...r,
        fromStage: r.fromStage > n ? r.fromStage + 1 : r.fromStage,
      }));
    d.stages.forEach((s, i) => {
      s.stageNumber = i;
    });
  } else if (c.type === "update-stage") {
    only(c, new Set(["type", "stageNumber", "patch"]));
    const n = stageIndex(d, c.stageNumber);
    stagePatch(c.patch);
    d.stages[n] = { ...d.stages[n], ...c.patch };
  } else if (c.type === "delete-stage") {
    only(c, new Set(["type", "stageNumber"]));
    const n = stageIndex(d, c.stageNumber);
    if (d.stages.length <= 1) fail("至少保留一个阶段。");
    d.stages.splice(n, 1);
    d.runs = d.runs
      .filter((r) => r.fromStage !== n && r.fromStage !== n - 1)
      .map((r) => ({
        ...r,
        fromStage: r.fromStage > n ? r.fromStage - 1 : r.fromStage,
      }));
    d.stages.forEach((s, i) => {
      s.stageNumber = i;
    });
  } else if (c.type === "move-participant") {
    only(c, new Set(["type", "stageNumber", "pieceId", "x", "y"]));
    const n = stageIndex(d, c.stageNumber);
    find(d.participants, "pieceId", c.pieceId);
    coordinate(c.x, 1250);
    coordinate(c.y, 826);
    const i = find(d.stages[n].positions, "pieceId", c.pieceId);
    d.stages[n].positions[i] = { ...d.stages[n].positions[i], x: c.x, y: c.y };
  } else {
    only(c, new Set(["type", "fromStage", "pieceId", "bend"]));
    const n = stageIndex(d, c.fromStage);
    if (n === d.stages.length - 1) fail("最后阶段没有出发路径。");
    find(d.participants, "pieceId", c.pieceId);
    find(d.stages[n].positions, "pieceId", c.pieceId);
    find(d.stages[n + 1].positions, "pieceId", c.pieceId);
    const i = d.runs.findIndex(
      (r) => r.fromStage === n && r.pieceId === c.pieceId,
    );
    if (c.bend === null) {
      if (i >= 0) d.runs.splice(i, 1);
    } else {
      only(c.bend, new Set(["x", "y"]));
      coordinate(c.bend.x, 1250);
      coordinate(c.bend.y, 826);
      const run = {
        ...(i >= 0 ? d.runs[i] : {}),
        pieceId: c.pieceId,
        fromStage: n,
        bend: { ...(i >= 0 ? d.runs[i].bend : {}), ...c.bend },
      };
      if (i >= 0) d.runs[i] = run;
      else d.runs.push(run);
    }
  }
  return true;
}

function setupCommand(tactic, c, find, resolvePlayer) {
  const board = tactic.board;
  if (c.type === "update-metadata") {
    only(c, new Set(["type", "patch"]));
    only(c.patch, new Set(["title", "tags", "favorite"]));
    if (!Object.keys(c.patch).length) fail("请提供战术信息。");
    if (
      c.patch.title !== undefined &&
      (typeof c.patch.title !== "string" ||
        !c.patch.title.trim() ||
        c.patch.title.length > 300)
    )
      fail("战术名称须为1–300字。");
    if (
      c.patch.tags !== undefined &&
      (!Array.isArray(c.patch.tags) ||
        c.patch.tags.length > 100 ||
        c.patch.tags.some((t) => typeof t !== "string" || t.length > 100))
    )
      fail("标签最多100项，每项100字。");
    if (c.patch.favorite !== undefined && typeof c.patch.favorite !== "boolean")
      fail("收藏设置须为布尔值。");
    Object.assign(tactic, structuredClone(c.patch));
    if (c.patch.title !== undefined) tactic.title = c.patch.title.trim();
    return true;
  }
  if (c.type === "add-player") {
    only(
      c,
      new Set([
        "type",
        "pieceId",
        "team",
        "x",
        "y",
        "playerId",
        ...pieceFields,
      ]),
    );
    if (
      !id(c.pieceId) ||
      board.pieces.some((p) => p.pieceId === c.pieceId) ||
      board.demonstration?.participants?.some((p) => p.pieceId === c.pieceId)
    )
      fail("新球员编号不正确或与现有/动画身份重复。");
    if (!["home", "away"].includes(c.team)) fail("请选择主队或客队。");
    coordinate(c.x, 1250);
    coordinate(c.y, 826);
    if (
      board.pieces.filter(
        (p) =>
          (p.kind || "player") === "player" &&
          (p.team === "away" ? "away" : "home") === c.team,
      ).length >= 128
    )
      fail("每方最多128个战术球员。");
    const patch = Object.fromEntries(
      Object.entries(c).filter(([k]) => pieceFields.has(k)),
    );
    piecePatch(patch);
    const piece = {
      pieceId: c.pieceId,
      kind: "player",
      x: c.x,
      y: c.y,
      ...patch,
    };
    if (c.playerId !== undefined) {
      if (
        typeof c.playerId !== "string" ||
        !c.playerId ||
        c.team !== "home" ||
        !resolvePlayer
      )
        fail("仅主队可关联本队球员。");
      if (c.label !== undefined || c.shirtNumber !== undefined)
        fail("关联球员姓名号码由球队档案提供。");
      const p = resolvePlayer(c.playerId);
      if (p.status !== "active") fail("不能添加已归档球员。");
      if (board.pieces.some((p) => p.playerId === c.playerId))
        fail("该球员已在初始阵容中。");
      piece.playerId = p.id;
      piece.label = p.name;
      if (p.number != null) piece.shirtNumber = p.number;
    }
    if (piece.shirtNumber === null) delete piece.shirtNumber;
    board.pieces.push(piece);
    board.formationCustomized = true;
    return true;
  }
  if (c.type === "remove-player") {
    only(c, new Set(["type", "pieceId", "acknowledgeAnimation"]));
    if (
      c.acknowledgeAnimation !== undefined &&
      typeof c.acknowledgeAnimation !== "boolean"
    )
      fail("请明确确认动画影响。");
    const i = find(board.pieces, "pieceId", c.pieceId);
    if ((board.pieces[i].kind || "player") !== "player") fail("仅可移除球员。");
    if (
      board.demonstration?.participants?.some((p) => p.pieceId === c.pieceId) &&
      c.acknowledgeAnimation !== true
    ) {
      const e = new FootballError(
        409,
        "该球员仍在独立演示中，请确认仅移除初始阵容，保留演示。",
      );
      e.code = "ANIMATION_IDENTITY_CONFIRMATION_REQUIRED";
      throw e;
    }
    board.pieces.splice(i, 1);
    board.formationCustomized = true;
    return true;
  }
  if (c.type === "apply-formation") {
    only(
      c,
      new Set(["type", "team", "playerCount", "formationId", "pieceIds"]),
    );
    if (!["home", "away"].includes(c.team)) fail("请选择主队或客队。");
    const f = formations.find(
      (f) => f.playerCount === c.playerCount && f.id === c.formationId,
    );
    if (!f) fail("请选择对应人数的阵型。");
    if (
      !Array.isArray(c.pieceIds) ||
      c.pieceIds.length !== c.playerCount ||
      new Set(c.pieceIds).size !== c.pieceIds.length
    )
      fail("阵容数量须匹配阵型，且不得重复。");
    const side = board.pieces.filter(
      (p) =>
        (p.kind || "player") === "player" &&
        (p.team === "away" ? "away" : "home") === c.team,
    );
    if (side.length !== c.playerCount)
      fail("请先明确增减所选方球员，使人数匹配阵型。");
    c.pieceIds.forEach((pieceId, i) => {
      const p = side[find(side, "pieceId", pieceId)],
        spot = f.spots[i];
      p.x = c.team === "away" ? 1251 - spot.x : spot.x;
      p.y = spot.y;
      p.position = spot.role;
      p.color =
        c.team === "away"
          ? "#1F2937"
          : { GK: "#F59E0B", DF: "#2495FF", MF: "#16A34A", FW: "#DC2626" }[
              spot.role
            ];
    });
    board.playerCount = c.playerCount;
    if (c.team === "home") {
      board.formationId = f.id;
      board.formationCustomized = false;
      tactic.formationName = f.id;
    } else board.awayFormationId = f.id;
    return true;
  }
  return false;
}

export function readTacticCommands(store, tacticId) {
  const tactic = store.getTactic(tacticId);
  return {
    tactic,
    version: tacticVersion(tactic),
    formations: structuredClone(formations),
  };
}
export function applyTacticCommands(store, tacticId, input, resolvePlayer) {
  only(input, new Set(["version", "commands"]));
  if (
    typeof input.version !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.version)
  )
    throw new FootballError(428, "请先读取当前战术版本。");
  if (
    !Array.isArray(input.commands) ||
    !input.commands.length ||
    input.commands.length > 100
  )
    fail("每批须包含 1–100 条战术操作。");
  const current = store.getTactic(tacticId);
  if (tacticVersion(current) !== input.version)
    throw new FootballError(409, "战术已被其他页面修改，请核对后重新载入。");
  // All changes are prepared on a detached value. An invalid later command has
  // no effect; saveTactic checks expectedVersion inside its single transaction.
  const tactic = structuredClone(current);
  const board = tactic.board;
  let movedPlayer = false;
  const find = (rows, key, value) => {
    if (!id(value)) fail("对象编号不正确。");
    const matches = rows
      .map((r, i) => (r[key] === value ? i : -1))
      .filter((i) => i >= 0);
    if (matches.length !== 1) fail("对象不存在或编号重复，请重新载入。");
    return matches[0];
  };
  for (const command of input.commands) {
    if (!object(command)) fail("战术命令格式不正确。");
    if (command.type === "move-piece") {
      only(command, new Set(["type", "pieceId", "x", "y"]));
      coordinate(command.x, 1250);
      coordinate(command.y, 826);
      const i = find(board.pieces, "pieceId", command.pieceId);
      const piece = board.pieces[i];
      if (!["player", "ball"].includes(piece.kind || "player"))
        fail("仅可移动球员或足球。");
      board.pieces[i] = { ...piece, x: command.x, y: command.y };
      if ((piece.kind || "player") === "player") movedPlayer = true;
    } else if (command.type === "add-marking") {
      only(command, new Set(["type", "marking"]));
      only(command.marking, new Set(["markingId", ...fields]));
      const marking = command.marking;
      if (
        !id(marking.markingId) ||
        board.markings.some((m) => m.markingId === marking.markingId)
      )
        fail("新标记编号不正确或已存在。");
      validateFields(marking);
      complete(marking);
      if (board.markings.length >= 5000) fail("战术标记过多。");
      board.markings.push(structuredClone(marking));
    } else if (command.type === "update-marking") {
      only(command, new Set(["type", "markingId", "patch"]));
      only(command.patch, fields);
      if (!Object.keys(command.patch).length) fail("请提供要修改的标记字段。");
      validateFields(command.patch);
      const i = find(board.markings, "markingId", command.markingId);
      const updated = {
        ...board.markings[i],
        ...structuredClone(command.patch),
      };
      // Validate the changed known values while retaining legacy extension fields.
      complete(updated);
      board.markings[i] = updated;
    } else if (command.type === "delete-marking") {
      only(command, new Set(["type", "markingId"]));
      board.markings.splice(
        find(board.markings, "markingId", command.markingId),
        1,
      );
    } else if (
      !setupCommand(tactic, command, find, resolvePlayer) &&
      !composeCommand(board, command, find)
    )
      fail("不支持的战术操作。");
  }
  if (
    input.commands.some((c) => c.type === "apply-formation") &&
    board.playerCount !== (current.board.playerCount ?? 8)
  ) {
    for (const team of ["home", "away"]) {
      const members = board.pieces.filter(
        (p) =>
          (p.kind || "player") === "player" &&
          (p.team === "away" ? "away" : "home") === team,
      );
      const formationId =
        team === "home" ? board.formationId : board.awayFormationId;
      if (
        (members.length && members.length !== board.playerCount) ||
        (members.length &&
          formationId != null &&
          !formations.some(
            (f) => f.playerCount === board.playerCount && f.id === formationId,
          ))
      )
        fail("变更比赛人数时，请在同一批次明确调整双方非空阵容与阵型。");
    }
  }
  if (movedPlayer) board.formationCustomized = true;
  tactic.thumbnail = null;
  const saved = store.saveTactic(tacticId, {
    tactic,
    note: "小程序编辑战术标记与初始站位",
    expectedVersion: input.version,
  });
  return { tactic: saved, version: tacticVersion(saved) };
}
