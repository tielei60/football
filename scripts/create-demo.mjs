import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { openFootballStore } from "../server/football-store.mjs";
import { createClubStore } from "../server/club-store.mjs";
import {
  portrait,
  portraitAlternate,
  matchPhoto1,
  matchPhoto2,
} from "./demo-media.mjs";

// No destination argument is supported. In particular, FOOTBALL_DB_PATH is never read.
export function createDemo() {
  if (arguments.length)
    throw new Error("演练只能新建独立临时库，不接受任何目标路径或选项。");
  const directory = mkdtempSync(join(tmpdir(), "football-demo-"));
  const databasePath = join(directory, "demo.sqlite");
  writeFileSync(
    join(directory, ".football-demo-owned"),
    "Fictional adult football rehearsal only\n",
    { flag: "wx", mode: 0o600 },
  );
  // Reserve a brand-new file exclusively before passing it to the existing store.
  writeFileSync(databasePath, "", { flag: "wx", mode: 0o600 });
  const credentials = [
    "demo-admin",
    "demo-linyuan",
    "demo-zhouze",
    "demo-guchuan",
  ].map((username) => ({
    username,
    password: `Demo-only-${randomBytes(12).toString("hex")}`,
  }));
  const legacy = openFootballStore(databasePath);
  try {
    const club = createClubStore(legacy.database, legacy, {
      bootstrapAdmin: credentials[0],
    });
    const adminSession = club.login(credentials[0], "local-demo-seed");
    const admin = club.authenticate(adminSession.token);
    club.saveTeam(admin.team_id, {
      ...club.getTeam(admin.team_id),
      name: "青岚周末足球俱乐部（演练）",
    });
    const names = [
      "林远",
      "周泽",
      "顾川",
      "陈越",
      "宋青",
      "魏宁",
      "何舟",
      "许朗",
    ];
    const numbers = [9, 8, 1, 4, 6, 7, 11, 12];
    const seasonNumbers = [19, 8, 1, 4, 6, 7, 11, 12];
    const positions = [
      ["前锋"],
      ["中场"],
      ["门将"],
      ["中后卫"],
      ["后腰"],
      ["左边前"],
      ["中锋"],
      ["右边前"],
    ];
    const players = names.map((name, index) =>
      club.savePlayer(admin.team_id, null, {
        name,
        number: numbers[index],
        positions: positions[index],
        avatar: index === 0 ? portrait : index === 1 ? portraitAlternate : null,
        note: "虚构成年球员，仅用于演练，无真实个人资料。",
      }),
    );
    const sessions = players.slice(0, 3).map((player, index) => {
      club.createAccount(admin.team_id, player.id, credentials[index + 1]);
      return club.login(credentials[index + 1], "local-demo-seed");
    });
    let season = club.saveSeason(admin.team_id, null, {
      name: "2026–2027 周末联赛（演练）",
      startDate: "2026-08-01",
      endDate: "2027-07-31",
    });
    season = club.saveSeasonRoster(admin.team_id, season.id, {
      revision: season.revision,
      roster: players.map((player, index) => ({
        playerId: player.id,
        number: seasonNumbers[index],
      })),
    }).season;
    const venue = club.saveVenue(admin.team_id, null, {
      name: "青岚社区球场（虚构）",
      address: "仅为地图操作演练坐标，不对应实际球场，请勿前往。",
      latitude: 31.23,
      longitude: 121.47,
      note: "虚构公共场地演练资料，无真实个人地址。",
      status: "active",
    });
    const alternateVenue = club.saveVenue(admin.team_id, null, {
      name: "松风室内球场（虚构）",
      address: "演练地址，实际地点待确认",
      latitude: null,
      longitude: null,
      note: "用于演练未设置坐标时仍可选场地。",
      status: "active",
    });
    const archivedVenue = club.saveVenue(admin.team_id, null, {
      name: "旧训练场（虚构、已归档）",
      address: "仅为归档功能演练",
      latitude: null,
      longitude: null,
      note: "归档场地不能用于新关联，可由管理员恢复。",
      status: "archived",
    });
    const common = {
      seasonId: season.id,
      format: 7,
      competition: "虚构周末联赛",
      kickoff: "15:00",
      location: "青岚社区球场（虚构）",
      venueId: venue.id,
      durationMinutes: 90,
      notice:
        "虚构演练须知：提前 15 分钟集合，自备饮水和护腿板；报名状态变化请及时更新。此内容不是免责协议，也不代表已经签署任何条款。",
    };
    // Use the same public store contract as the editor, without initializing the desk.
    // Same landscape SVG coordinates as PITCH_8V8 / the 7-a-side formation picker.
    // Own goal is left; the seven-player formation occupies the home half.
    const layout = [
      [2, 135, 413, "GK"],
      [3, 269, 296, "DF"],
      [4, 269, 529, "DF"],
      [5, 414, 237, "MF"],
      [1, 414, 413, "MF"],
      [7, 414, 588, "MF"],
      [0, 559, 413, "FW"],
    ];
    const pieces = layout.map(([index, x, y, position]) => ({
      pieceId: `demo-player-${index}`,
      kind: "player",
      x,
      y,
      color: position === "GK" ? "#eab308" : "#2563eb",
      radius: 18,
      label: players[index].name,
      shirtNumber: seasonNumbers[index],
      position,
      team: "home",
      playerId: players[index].id,
    }));
    pieces.push({
      pieceId: "demo-ball",
      kind: "ball",
      x: 440,
      y: 430,
      radius: 10,
      color: "#ffffff",
    });
    const tactic = legacy.saveTactic(null, {
      note: "虚构比赛使用的原始版本",
      tactic: {
        title: "七人制 2-3-1 中路配合（演练）",
        tags: ["演练", "七人制", "传跑"],
        favorite: true,
        formationName: "2-3-1",
        thumbnail: null,
        board: {
          playerCount: 7,
          formationId: "2-3-1",
          awayFormationId: null,
          formationCustomized: false,
          pieces,
          markings: [
            {
              markingId: "demo-pass",
              kind: "arrow",
              startX: 440,
              startY: 430,
              endX: 720,
              endY: 370,
              strokeColor: "#f59e0b",
              width: 3,
              dashed: false,
            },
            {
              markingId: "demo-run",
              kind: "arrow",
              startX: 559,
              startY: 413,
              endX: 720,
              endY: 350,
              strokeColor: "#2563eb",
              width: 3,
              dashed: true,
            },
          ],
          demonstration: {
            demonstrationId: "demo-combination",
            title: "中场直传与前锋斜插（两步）",
            participants: pieces,
            stages: [
              {
                stageNumber: 0,
                title: "第一步：中场接应",
                note: "保持 2-3-1 站位。",
                durationSeconds: 2,
                positions: pieces.map(({ pieceId, x, y }) => ({
                  pieceId,
                  x,
                  y,
                })),
              },
              {
                stageNumber: 1,
                title: "第二步：直传斜插",
                note: "实线传球，虚线跑位；仅为虚构战术演示。",
                durationSeconds: 2,
                positions: pieces.map(({ pieceId, x, y }) => ({
                  pieceId,
                  x: ["demo-player-0", "demo-ball"].includes(pieceId) ? 720 : x,
                  y:
                    pieceId === "demo-player-0"
                      ? 350
                      : pieceId === "demo-ball"
                        ? 370
                        : y,
                })),
              },
            ],
            runs: [
              {
                pieceId: "demo-player-0",
                fromStage: 0,
                bend: { x: 640, y: 405 },
              },
            ],
          },
        },
      },
    });
    let away = club.saveMatch(admin, null, {
      ...common,
      opponent: "海棠周末队（虚构）",
      date: "2026-12-27",
      side: "away",
      status: "published",
      tacticIds: [tactic.tacticId],
    });
    const responses = ["yes", "no", "maybe"];
    sessions.forEach((session, index) =>
      club.saveRsvp(club.authenticate(session.token), away.id, {
        response: responses[index],
      }),
    );
    away = club.saveRoster(admin, away.id, {
      revision: away.revision,
      roster: [
        {
          playerId: players[0].id,
          position: "前锋",
          selection: "starter",
          appeared: true,
          goals: 2,
          assists: 0,
        },
        {
          playerId: players[1].id,
          position: "中场",
          selection: "bench",
          appeared: true,
          goals: 1,
          assists: 1,
        },
        {
          playerId: players[2].id,
          position: "门将",
          selection: "unknown",
          appeared: null,
          goals: null,
          assists: null,
        },
      ],
    });
    away = club.saveMatch(admin, away.id, {
      ...away,
      status: "completed",
      homeScore: 3,
      awayScore: 1,
      analysis:
        "虚构已结束比赛。报名意愿与实际出场独立：周泽报名不参加但后来替补出场；顾川出场尚未核实。",
    });
    away = club.saveMatchPhotos(admin, away.id, {
      revision: away.revision,
      photos: [
        { data: matchPhoto1, caption: "虚构赛后合影示意图 1，无真实人物" },
        { data: matchPhoto2, caption: "虚构赛后合影示意图 2，可练习调整顺序" },
      ],
      coverIndex: 0,
    });
    // The saved match keeps its original independent snapshot, not this revision.
    legacy.saveTactic(tactic.tacticId, {
      note: "赛后模板调整：历史比赛仍保留原始站位",
      tactic: {
        ...tactic,
        title: `${tactic.title} · 赛后调整`,
        board: {
          ...tactic.board,
          formationCustomized: true,
          pieces: tactic.board.pieces.map((p) =>
            p.pieceId === "demo-player-0" ? { ...p, x: 600 } : p,
          ),
        },
      },
    });
    const home = club.saveMatch(admin, null, {
      ...common,
      opponent: away.opponent,
      date: "2027-01-10",
      side: "home",
      status: "completed",
      durationMinutes: null,
      homeScore: 0,
      awayScore: null,
      analysis:
        "虚构已结束比赛：本队零进球已确认，对手比分未知，出场和个人明细未录入。",
    });
    let upcoming = club.saveMatch(admin, null, {
      ...common,
      opponent: "松风社区队（虚构）",
      date: "2027-02-07",
      side: "home",
      status: "published",
    });
    upcoming = club.saveMatchPhotos(admin, upcoming.id, {
      revision: upcoming.revision,
      photos: [{ data: matchPhoto1, caption: "虚构比赛封面，非真实照片" }],
      coverIndex: 0,
    });
    sessions.forEach((session, index) =>
      club.saveRsvp(club.authenticate(session.token), upcoming.id, {
        response: responses[index],
      }),
    );
    const draft = club.saveMatch(admin, null, {
      ...common,
      opponent: "待确认对手（虚构）",
      date: "2027-02-21",
      side: "unknown",
      status: "draft",
    });
    const cancelled = club.saveMatch(admin, null, {
      ...common,
      opponent: "雨后友谊队（虚构）",
      date: "2027-03-07",
      side: "neutral",
      status: "cancelled",
      analysis: "虚构取消场，用于验证不计入完赛及报名统计。",
    });
    for (const session of [adminSession, ...sessions])
      club.logout(session.token);
    const manifest = {
      fictional: true,
      adultsOnly: true,
      directory,
      databasePath,
      warning:
        "全部为虚构演练数据。已结束状态用于跨年统计场景，不代表真实当前赛程。凭据仅用于此独立演练库，不得用于生产或公开服务。",
      credentials: credentials.map((value, index) => ({
        ...value,
        role: index ? "player" : "admin",
        name: index ? names[index - 1] : "演练管理员",
      })),
      players,
      season,
      venues: [venue, alternateVenue, archivedVenue],
      matches: {
        away: away.id,
        home: home.id,
        upcoming: upcoming.id,
        draft: draft.id,
        cancelled: cancelled.id,
      },
      tacticsCreated: 1,
      tacticId: tactic.tacticId,
    };
    writeFileSync(
      join(directory, "demo-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return manifest;
  } finally {
    legacy.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 2) {
    console.error(
      "不接受目标路径或任何参数；仅运行 node scripts/create-demo.mjs。",
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(createDemo(), null, 2));
  }
}
