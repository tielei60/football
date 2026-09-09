import { EIGHT_FORMATIONS, toSvgX, toSvgY, type FormationSpot } from "./eightFormations";
import { assignPlayersToFormation, BERLIN_GARDEN_PLAYERS, posColor } from "./berlinGarden";
import { buildScenario } from "./tacticalScenarios";
import type { BoardSnapshot } from "@/db";

// 预置战术种子：纯 JSON 快照（items + drawings），导入时按标题去重。
// 坐标统一用归一化 nx（0 上边线→100 下边线）/ ny（0 自家门→100 对方门）。

export interface SeedTactic {
  id: string;
  title: string;
  tags: string[];
  formationId: string | null;
  note: string; // 要点，记为首条版本备注
  snapshot: BoardSnapshot;
}

const STARTERS = BERLIN_GARDEN_PLAYERS.slice(0, 8);
const NAMES = STARTERS.map((player) => player.name);
const X = (ny: number) => toSvgX(ny);
const Y = (nx: number) => toSvgY(nx);

const P = (tid: string, i: number | string, name: string, num: number, nx: number, ny: number, role: string) => ({
  id: `${tid}-p${i}`,
  x: X(ny),
  y: Y(nx),
  color: posColor(role),
  isDragging: false,
  creationMode: "normal",
  type: "player",
  state: "saved",
  r: 24,
  text: name,
  elementType: "player",
  number: num,
  playerPosition: role,
  team: "home",
  // 前 8 人即名单 bg-1~bg-8，写死 id，改名改号不丢照片
  rosterId: typeof i === "number" && i >= 1 && i <= 8 ? `bg-${i}` : null,
});

interface LineOpts {
  color?: string;
  dashed?: boolean;
  size?: number;
  type?: string;
}

const AR = (tid: string, i: number | string, nx1: number, ny1: number, nx2: number, ny2: number, o: LineOpts = {}) => ({
  id: `${tid}-a${i}`,
  x: 0,
  y: 0,
  color: "black",
  isDragging: false,
  creationMode: "normal",
  type: "drawing",
  state: "saved",
  startX: X(ny1),
  startY: Y(nx1),
  endX: X(ny2),
  endY: Y(nx2),
  strokeColor: o.color ?? "#1e1e1e",
  backgroundColor: "transparent",
  size: o.size ?? 3,
  dashed: !!o.dashed,
  pathPoints: [],
  drawingType: o.type ?? "arrow",
  text: "",
});

const ZONE = (tid: string, i: number, nx1: number, ny1: number, nx2: number, ny2: number) =>
  AR(tid, `z${i}`, nx1, ny1, nx2, ny2, { color: "#cf423b", size: 2, type: "rectangle" });

const LABEL = (tid: string, i: number | string, nx: number, ny: number, text: string) => ({
  id: `${tid}-t${i}`,
  x: 0,
  y: 0,
  color: "black",
  isDragging: false,
  creationMode: "normal",
  type: "drawing",
  state: "saved",
  startX: X(ny),
  startY: Y(nx),
  endX: X(ny),
  endY: Y(nx),
  strokeColor: "#0b2a1d",
  backgroundColor: "transparent",
  size: 3,
  dashed: false,
  pathPoints: [],
  drawingType: "text",
  text,
});

const spotsOf = (formationId: string, dx = 0, dy = 0): FormationSpot[] => {
  const f = EIGHT_FORMATIONS.find((x) => x.id === formationId);
  if (!f) return [];
  return f.spots.map((s) => ({ ...s, nx: s.nx + dx, ny: s.ny + dy }));
};

const lineup = (tid: string, spots: FormationSpot[]) => {
  const players = assignPlayersToFormation(STARTERS, spots);
  return spots.map((spot, index) => {
    const player = players[index];
    return P(tid, player.number, player.name, player.number, spot.nx, spot.ny, spot.role);
  });
};

const GUIDES: Record<string, string> = {
  t1: "适用：对手后场短传出球，且我方体能允许连续协同压迫。\n触发：回传门将、接球背身或停球过大时，由最近前锋发起。\n执行：前锋封中放边，边中场上抢，后腰截断内线；后卫随球前提并留意身后。\n回退：第一道压迫被突破后，整体退回中场，避免逐人追球。\n观察：能否迫使对手向边线或长传解围；不把每次压迫都变成犯规。",
  t2: "适用：对手压上人数较多，我方需要利用身后空间。\n组织：三后卫横向保护禁区，中场线与后卫线保持可互相补位的距离。\n执行：断球先找前锋支点，弱侧边中场同时加速；支点一脚做球后向前跟进。\n保护：近侧边后卫接应，另外两名后卫控制中路与纵深。\n观察：第一脚向前传球是否可控；线路关闭时回做重新组织。",
  t3: "适用：对手收缩中路，边路存在一对一或二对一空间。\n组织：强侧边前卫拉宽，近侧前锋接应，远侧前锋保持后点跑动空间。\n执行：分球、下底、传中分开完成；近点、后点、禁区外三个区域分层接应。\n保护：两名后卫留在球后，中场准备处理二点球和对手反击。\n观察：包抄队员是否在出球瞬间启动；传中前先看门将与防守站位。",
  t4: "适用：前点有可利用的空间，且发球队员能够稳定送到目标区域。\n组织：近点与中路队员错时启动，远点队员观察落点后补位；禁区外保留二点球与防反队员。\n执行：以交叉跑动牵动防守，避免拉拽、推挡或阻挡防守人。\n变化：前点被封时改为短角球，接球队员面向球场。\n观察：发球时机与跑动是否同步，未争到第一点时是否能及时回收。",
  t5: "适用：对手角球，采用关键区域保护与盯人结合。\n分工：门将提前明确出击口令，近点保护队员守住线路；盯人队员同时观察球和对手。\n执行：优先争抢来球，不只盯着人；解围向边线，避免顶回禁区中路。\n保护：禁区外队员控制二点球，留一名可接应反击的出口。\n观察：对手短角球时能否及时派出两人协防。",
  t6: "适用：球的位置允许直接射门或短传配合，发球前确认裁判口令及当地竞赛规则。\n组织：两名队员站球，一人负责触球，另一人射门；前锋控制门前二点球区域。\n执行：短拨必须到射门队员习惯脚前，射门队员先观察人墙与门将。\n变化：人墙提前压出时，可短传给侧面接应点重新组织。\n保护：球后保留足够人数，避免全部队员进入禁区。",
  t7: "适用：开球后通过快速转移争取边路推进空间。\n组织：开球前除开球队员外，我方队员留在本方半场，按裁判要求站位。\n执行：第一脚回做，接球队员观察后将球转移到边路；边中场在球被踢出后启动。\n变化：对方封住边线时改由中路过渡，避免盲目长传。\n观察：第一轮进攻后是否能迅速形成稳定控球结构。",
  t8: "适用：希望通过短传控制节奏，逐步拉开对手防线。\n组织：后腰位于两名后卫前方，两侧中场拉宽，前腰与前锋避免站在同一条纵线上。\n执行：接球前观察，利用回做和第三人跑动找到空当；强侧受压时转向弱侧。\n保护：丢球后最近队员延缓，其余人封传球线路，后腰不盲目追抢。\n观察：传球后是否立即提供新的接应角度。",
  t9: "适用：需要降低对手进入禁区的次数，优先保持防守稳定。\n组织：三后卫保护门前宽度，两名中场屏蔽肋部，两名前锋交替回撤接应。\n执行：整体随球横移，近侧上抢、远侧内收；不因一次横传就全线压出。\n反击：断球优先找前锋，另一名前锋拉开接应，无法向前时保持球权。\n观察：肋部是否有人补位，弱侧是否出现无人盯防的接球队员。",
  t10: "适用：落后阶段需要增加前场接应，需结合剩余时间与球员体能判断。\n组织：一名后卫拖后，中场分层站位，两翼轮流前插，前锋固定牵制中路。\n执行：先从强侧吸引防守，再转移至弱侧；不能所有中场同时跑到球前。\n保护：至少一名中场始终靠近拖后后卫，丢球后先堵中路再回收两侧。\n观察：前场人数增加是否形成有效接应，而非挤占同一空间。",
};

const T = (
  tid: string,
  title: string,
  tags: string[],
  formationId: string | null,
  note: string,
  spots: FormationSpot[],
  drawings: Record<string, unknown>[]
): SeedTactic => ({
  id: tid,
  title,
  tags,
  formationId,
  note,
  snapshot: {
    items: lineup(tid, spots),
    drawings,
    keyframes: [],
    coaching: { objective: note, instructions: GUIDES[tid] ?? note, durationMinutes: 20 },
    animation: ["t1", "t2", "t3"].includes(tid)
      ? JSON.parse(
          JSON.stringify(
            buildScenario(
              ({ t1: "press", t2: "counter", t3: "cross" } as Record<string, string>)[tid],
              NAMES.map((name, i) => ({ id: `bg-${i + 1}`, name, number: i + 1 }))
            ).toJSON()
          )
        )
      : undefined,
  },
});

export const SEED_TACTICS: SeedTactic[] = [
  T(
    "t1",
    "高位逼抢2-3-2",
    ["常规", "逼抢"],
    "2-3-2",
    "开场前15分钟高位，丢球6秒就地反抢，整体前压10米",
    spotsOf("2-3-2", 0, 6),
    [
      AR("t1", 1, 35, 80, 35, 95),
      AR("t1", 2, 65, 80, 65, 95),
      AR("t1", 3, 50, 54, 50, 66, { color: "#cf423b", dashed: true }),
      ZONE("t1", 1, 20, 58, 80, 96),
      LABEL("t1", 1, 50, 44, "整体前压，围抢持球人"),
    ]
  ),
  T(
    "t2",
    "稳守反击3-3-1",
    ["防守"],
    "3-3-1",
    "落位半场等对手犯错，断球第一时间打对方边后卫身后",
    spotsOf("3-3-1", 0, -3),
    [
      AR("t2", 1, 50, 58, 50, 92),
      AR("t2", 2, 50, 34, 50, 52, { color: "#cf423b", dashed: true }),
      LABEL("t2", 1, 50, 22, "密集落位，打身后"),
    ]
  ),
  T("t3", "边路下底传中", ["边路", "进攻"], "2-3-2", "强侧下底，弱侧前锋包抄后点，后腰跟进禁区弧", spotsOf("2-3-2"), [
    AR("t3", 1, 78, 52, 88, 78, { color: "#cf423b", dashed: true }),
    AR("t3", 2, 88, 78, 68, 80),
    AR("t3", 3, 65, 74, 72, 78, { color: "#cf423b", dashed: true }),
    AR("t3", 4, 35, 74, 50, 72, { color: "#cf423b", dashed: true }),
    LABEL("t3", 1, 58, 58, "弱侧包抄后点"),
  ]),
  T(
    "t4",
    "角球进攻·抢前点",
    ["定位球"],
    "corner-atk",
    "发前点，近端两人一挡一抢，远端埋伏补射",
    spotsOf("corner-atk"),
    [
      AR("t4", 1, 88, 86, 55, 78),
      AR("t4", 2, 50, 70, 55, 76, { color: "#cf423b", dashed: true }),
      LABEL("t4", 1, 50, 60, "前点一挡一抢"),
    ]
  ),
  T(
    "t5",
    "角球防守·人盯人",
    ["定位球", "防守"],
    "corner-def",
    "前点后点各站一人，其余人盯人，门将指挥",
    spotsOf("corner-def"),
    [ZONE("t5", 1, 30, 8, 70, 40), LABEL("t5", 1, 50, 52, "前点后点各站一人")]
  ),
  T(
    "t6",
    "任意球·双人掩护",
    ["定位球", "进攻"],
    "freekick",
    "双人站球，一拨一射或拨给后排跟进，注意人墙缝",
    spotsOf("freekick"),
    [
      AR("t6", 1, 55, 66, 38, 68),
      AR("t6", 2, 50, 80, 58, 72, { color: "#cf423b", dashed: true }),
      LABEL("t6", 1, 50, 48, "一拨一射"),
    ]
  ),
  T(
    "t7",
    "开球抢攻",
    ["定位球", "进攻"],
    "kickoff",
    "开球直接找边路，打对方立足未稳，前两分钟就抢",
    spotsOf("kickoff"),
    [
      AR("t7", 1, 44, 48, 44, 62),
      AR("t7", 2, 56, 48, 56, 62),
      AR("t7", 3, 22, 52, 22, 66, { color: "#cf423b", dashed: true }),
      LABEL("t7", 1, 50, 36, "开球直接找边路"),
    ]
  ),
  T(
    "t8",
    "控球压制2-1-3-1",
    ["进攻"],
    "2-1-3-1",
    "三角传切为主，不丢球权，丢球原地三人围抢",
    spotsOf("2-1-3-1", 0, 4),
    [
      AR("t8", 1, 24, 58, 50, 56),
      AR("t8", 2, 50, 56, 76, 58),
      AR("t8", 3, 50, 56, 50, 76, { color: "#cf423b", dashed: true }),
      LABEL("t8", 1, 50, 40, "三角传切"),
    ]
  ),
  T(
    "t9",
    "落位防守3-2-2",
    ["防守"],
    "3-2-2",
    "三后卫与双中场保护中路，两名前锋交替回撤，断球后寻找反击出口",
    spotsOf("3-2-2", 0, -3),
    [
      AR("t9", 1, 32, 68, 32, 60, { color: "#cf423b", dashed: true }),
      AR("t9", 2, 68, 68, 68, 60, { color: "#cf423b", dashed: true }),
      ZONE("t9", 1, 15, 4, 60, 55),
      LABEL("t9", 1, 50, 66, "先稳住，再反击"),
    ]
  ),
  T(
    "t10",
    "追分进攻1-5-1",
    ["常规", "进攻"],
    "1-3-3-1",
    "增加分层接应与弱侧前插，中卫拖后，中场轮流保护球后空间",
    spotsOf("1-3-3-1"),
    [
      AR("t10", 1, 28, 46, 28, 70, { color: "#cf423b", dashed: true }),
      AR("t10", 2, 72, 46, 72, 70, { color: "#cf423b", dashed: true }),
      AR("t10", 3, 50, 64, 50, 86),
      LABEL("t10", 1, 50, 34, "两翼齐飞"),
    ]
  ),
];

// ---- 一键动态演示：边路下底套路，3 帧 ----
// 每帧 8 个站位（顺序=名单前 8 人：门将/后卫×2/中场×3/前锋×2）
export interface DemoSpot {
  nx: number;
  ny: number;
  role: string;
}

export const DEMO_TITLE = "边路下底传中（动态演示）";
export const DEMO_FRAMES: DemoSpot[][] = [
  spotsOf("2-3-2"),
  [
    { nx: 50, ny: 6, role: "GK" },
    { nx: 32, ny: 28, role: "DF" },
    { nx: 68, ny: 28, role: "DF" },
    { nx: 22, ny: 52, role: "MF" },
    { nx: 56, ny: 56, role: "MF" },
    { nx: 86, ny: 74, role: "MF" },
    { nx: 48, ny: 70, role: "FW" },
    { nx: 72, ny: 68, role: "FW" },
  ],
  [
    { nx: 50, ny: 6, role: "GK" },
    { nx: 32, ny: 28, role: "DF" },
    { nx: 68, ny: 28, role: "DF" },
    { nx: 34, ny: 60, role: "MF" },
    { nx: 56, ny: 56, role: "MF" },
    { nx: 88, ny: 80, role: "MF" },
    { nx: 62, ny: 72, role: "FW" },
    { nx: 80, ny: 74, role: "FW" },
  ],
];

// 演示对手：静态深位防守（省出通道给主队跑位，飞行不交叉；端点再松弛保底）
const AWAY_STATIC: DemoSpot[] = [
  { nx: 50, ny: 94, role: "GK" },
  { nx: 32, ny: 80, role: "DF" },
  { nx: 68, ny: 80, role: "DF" },
  { nx: 22, ny: 56, role: "MF" },
  { nx: 50, ny: 60, role: "MF" },
  { nx: 70, ny: 58, role: "MF" },
  { nx: 35, ny: 34, role: "FW" },
  { nx: 65, ny: 34, role: "FW" },
];
export const DEMO_AWAY_FRAMES: DemoSpot[][] = [AWAY_STATIC, AWAY_STATIC, AWAY_STATIC];

// 演示用球：中场→边锋脚下→包抄点
export const DEMO_BALL_FRAMES: { nx: number; ny: number }[] = [
  { nx: 50, ny: 60 },
  { nx: 86, ny: 76 },
  { nx: 81, ny: 75 },
];
