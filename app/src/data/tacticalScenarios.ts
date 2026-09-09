import { Animation, AnimationAction, AnimationFrame } from "@/types/animation";
import { FieldElement } from "@/types/fieldElement";
import { toSvgX, toSvgY, PITCH_8V8 } from "./eightFormations";
import { posColor } from "./berlinGarden";
import { getDefaultControlPoint } from "@/utils/path";

type Point = [number, number]; // 纵深、横向，均为球场百分比
interface Phase {
  title: string;
  note: string;
  duration: number;
  home: Point[];
  away: Point[];
  ball: Point;
}
interface Scenario {
  id: string;
  title: string;
  objective: string;
  phases: Phase[];
}
const crossHome: Point[] = [
  [6, 50],
  [28, 28],
  [28, 72],
  [50, 18],
  [45, 50],
  [52, 82],
  [72, 35],
  [70, 64],
];
const crossAway: Point[] = [
  [95, 50],
  [81, 30],
  [81, 68],
  [61, 18],
  [64, 49],
  [66, 80],
  [34, 39],
  [37, 67],
];
const pressHome: Point[] = [
  [8, 50],
  [38, 28],
  [38, 72],
  [60, 18],
  [56, 50],
  [60, 82],
  [76, 35],
  [76, 65],
];
const pressAway: Point[] = [
  [94, 50],
  [80, 26],
  [80, 74],
  [62, 17],
  [65, 50],
  [60, 83],
  [42, 36],
  [42, 65],
];
const counterHome: Point[] = [
  [6, 50],
  [22, 25],
  [26, 50],
  [22, 75],
  [40, 22],
  [39, 52],
  [40, 80],
  [58, 50],
];
const counterAway: Point[] = [
  [94, 50],
  [65, 28],
  [65, 72],
  [48, 18],
  [47, 50],
  [48, 82],
  [28, 37],
  [28, 65],
];

export const TACTICAL_SCENARIOS: Scenario[] = [
  {
    id: "cross",
    title: "边路下底传中",
    objective: "利用边路宽度形成传中空间，三点分层包抄，后场保持保护。",
    phases: [
      {
        title: "拉开宽度",
        note: "边前卫贴近边线，持球中场抬头观察。两名前锋错开站位，避免挤在同一条传球线上。",
        duration: 3,
        home: crossHome,
        away: crossAway,
        ball: [47, 53],
      },
      {
        title: "分球到边",
        note: "中场把球送向右边前卫的前进方向。接球队员侧身面向前场，远侧前锋暂缓进入禁区。",
        duration: 2,
        home: [
          [6, 50],
          [31, 28],
          [32, 69],
          [56, 20],
          [52, 50],
          [65, 86],
          [75, 37],
          [73, 61],
        ],
        away: [
          [95, 50],
          [82, 35],
          [82, 73],
          [63, 22],
          [66, 54],
          [69, 81],
          [38, 40],
          [40, 67],
        ],
        ball: [66, 88],
      },
      {
        title: "下底与分层跑位",
        note: "边前卫带到边线内侧，近侧前锋冲前点，远侧前锋绕到后点。中场停在禁区外接倒三角，两名后卫留在球后。",
        duration: 3,
        home: [
          [8, 50],
          [36, 30],
          [37, 66],
          [65, 22],
          [67, 51],
          [88, 86],
          [86, 35],
          [86, 66],
        ],
        away: [
          [95, 55],
          [88, 43],
          [89, 72],
          [70, 25],
          [76, 53],
          [81, 81],
          [43, 38],
          [45, 66],
        ],
        ball: [89, 88],
      },
      {
        title: "传中找后点",
        note: "观察门将位置后低平球穿过门前。远侧前锋攻击后点，近侧前锋带走盯防；不要提前停在落点等球。",
        duration: 1.5,
        home: [
          [8, 50],
          [39, 30],
          [40, 66],
          [73, 24],
          [76, 50],
          [88, 86],
          [92, 34],
          [93, 66],
        ],
        away: [
          [96, 54],
          [91, 43],
          [91, 74],
          [74, 29],
          [80, 52],
          [84, 81],
          [47, 39],
          [48, 65],
        ],
        ball: [94, 34],
      },
      {
        title: "完成射门与保护",
        note: "第一时间完成射门，其余队员准备二点球。若传中被断，最近三人延缓对手出球，后卫保持纵深保护。",
        duration: 1,
        home: [
          [8, 50],
          [41, 30],
          [42, 65],
          [77, 25],
          [78, 51],
          [86, 85],
          [94, 37],
          [93, 63],
        ],
        away: [
          [96, 49],
          [92, 44],
          [92, 71],
          [77, 29],
          [82, 52],
          [84, 80],
          [48, 40],
          [49, 66],
        ],
        ball: [99, 48],
      },
    ],
  },
  {
    id: "press",
    title: "高位逼抢",
    objective: "以回传和停球失误为触发，封中放边，围抢后快速完成进攻。",
    phases: [
      {
        title: "识别回传信号",
        note: "对手中卫背向进攻方向接球时启动。前锋先封住回传门将与横传线路，中场保持紧凑，不能各自追球。",
        duration: 3,
        home: pressHome,
        away: pressAway,
        ball: [80, 29],
      },
      {
        title: "弧线压迫到边线",
        note: "近侧前锋由内向外压迫，迫使持球人走边路。边中场前顶，后腰堵住中路接应，远侧整体内收。",
        duration: 2.5,
        home: [
          [10, 50],
          [46, 25],
          [45, 67],
          [67, 15],
          [64, 45],
          [63, 73],
          [78, 33],
          [77, 59],
        ],
        away: [
          [94, 49],
          [78, 23],
          [81, 71],
          [65, 13],
          [66, 48],
          [60, 80],
          [43, 35],
          [43, 64],
        ],
        ball: [67, 15],
      },
      {
        title: "边线形成夹击",
        note: "边中场正面延缓，前锋封回传，后腰控制内线。后卫前提看住身后接球队员，门将同时提高站位。",
        duration: 2,
        home: [
          [13, 50],
          [50, 26],
          [48, 64],
          [67, 20],
          [65, 37],
          [63, 66],
          [74, 19],
          [74, 52],
        ],
        away: [
          [94, 47],
          [79, 25],
          [81, 69],
          [66, 11],
          [67, 46],
          [60, 79],
          [43, 36],
          [43, 63],
        ],
        ball: [66, 17],
      },
      {
        title: "抢断后找中路",
        note: "抢到球后先找面向球门的队友，另一名前锋斜插身后。若无法向前，回传保住球权并重新组织。",
        duration: 2,
        home: [
          [13, 50],
          [53, 27],
          [51, 64],
          [69, 20],
          [71, 40],
          [68, 67],
          [82, 30],
          [86, 56],
        ],
        away: [
          [95, 49],
          [83, 27],
          [84, 66],
          [68, 13],
          [73, 47],
          [66, 77],
          [47, 36],
          [48, 62],
        ],
        ball: [84, 53],
      },
    ],
  },
  {
    id: "counter",
    title: "稳守反击",
    objective: "保持三后卫防线，断球后通过支点与边路纵深完成快速推进。",
    phases: [
      {
        title: "中低位保持紧凑",
        note: "三名后卫保护禁区，中场封住内线。允许对手在外线倒脚，前锋留在可接第一脚传球的位置。",
        duration: 3,
        home: counterHome,
        away: counterAway,
        ball: [46, 55],
      },
      {
        title: "断球找支点",
        note: "中场断球后第一脚向前找前锋。前锋侧身接应，弱侧中场立即向空当加速，后卫不同时压上。",
        duration: 2,
        home: [
          [7, 50],
          [26, 25],
          [29, 50],
          [26, 75],
          [45, 18],
          [45, 52],
          [47, 82],
          [59, 44],
        ],
        away: [
          [94, 50],
          [66, 28],
          [66, 72],
          [49, 18],
          [47, 57],
          [49, 82],
          [31, 37],
          [31, 65],
        ],
        ball: [58, 47],
      },
      {
        title: "支点做球与斜插",
        note: "前锋把球做向弱侧中场的跑动线路，再转身跟进。接球者先观察防守身后，避免连续横传错过反击窗口。",
        duration: 2,
        home: [
          [8, 50],
          [32, 25],
          [34, 50],
          [32, 75],
          [58, 18],
          [52, 49],
          [66, 82],
          [65, 46],
        ],
        away: [
          [94, 50],
          [72, 29],
          [72, 70],
          [57, 20],
          [55, 56],
          [56, 79],
          [35, 37],
          [35, 65],
        ],
        ball: [69, 83],
      },
      {
        title: "推进与中路接应",
        note: "边中场带球进入进攻三区，前锋冲击中路，远侧中场包抄。持球人被封堵时回做，身后至少保留三人保护。",
        duration: 3,
        home: [
          [10, 50],
          [42, 26],
          [44, 50],
          [42, 74],
          [76, 25],
          [68, 50],
          [87, 80],
          [87, 49],
        ],
        away: [
          [95, 54],
          [84, 34],
          [84, 68],
          [69, 24],
          [73, 54],
          [76, 79],
          [43, 38],
          [43, 64],
        ],
        ball: [88, 78],
      },
    ],
  },
];

// 沿用画板的成对分离规则，为示意棋子留出可读间距，不改变阵型与攻防方向。
function layoutPhase(phase: Phase) {
  const players = [...phase.home, ...phase.away].map(([depth, width]) => ({ x: toSvgX(depth), y: toSvgY(width) }));
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i],
          b = players[j];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          distance = Math.hypot(dx, dy);
        if (distance >= 72) continue;
        const ux = distance ? dx / distance : 1,
          uy = distance ? dy / distance : 0;
        const offset = (72 - distance) / 2 + 0.5;
        a.x -= ux * offset;
        a.y -= uy * offset;
        b.x += ux * offset;
        b.y += uy * offset;
      }
    players.forEach((p) => {
      p.x = Math.max(PITCH_8V8.x + 24, Math.min(PITCH_8V8.x + PITCH_8V8.w - 24, p.x));
      p.y = Math.max(PITCH_8V8.y + 24, Math.min(PITCH_8V8.y + PITCH_8V8.h - 24, p.y));
    });
  }
  const ball = { x: toSvgX(phase.ball[0]), y: toSvgY(phase.ball[1]) };
  const carrier = players.find((p) => Math.hypot(p.x - ball.x, p.y - ball.y) < 36);
  if (carrier) {
    ball.x = carrier.x + (carrier.x > toSvgX(92) ? -32 : 32);
    ball.y = carrier.y + 18;
  }
  return [...players, ball];
}

export function buildScenario(id: string, squad: { id?: string; name: string; number: number }[]): Animation {
  const scenario = TACTICAL_SCENARIOS.find((s) => s.id === id) ?? TACTICAL_SCENARIOS[0];
  const animation = new Animation(scenario.title, []);
  const roles =
    id === "counter"
      ? ["GK", "DF", "DF", "DF", "MF", "MF", "MF", "FW"]
      : ["GK", "DF", "DF", "MF", "MF", "MF", "FW", "FW"];
  scenario.phases.forEach((phase, fi) => {
    const frame = new AnimationFrame(fi);
    Object.assign(frame, { title: phase.title, note: phase.note, duration: phase.duration });
    animation.frames.push(frame);
    const points = layoutPhase(phase);
    points.forEach(({ x, y }, i) => {
      const id = `scenario-${i}`;
      if (fi === 0) {
        const home = i < 8;
        const role = home ? roles[i] : ["GK", "DF", "DF", "MF", "MF", "MF", "FW", "FW"][i - 8];
        animation.addSharedElement(
          id,
          new FieldElement({
            id,
            x,
            y,
            elementType: i === 16 ? "ball" : "player",
            r: i === 16 ? 13 : 18,
            team: home ? "home" : "away",
            text: home ? (squad[i]?.name ?? `队员${i + 1}`) : "",
            number: home ? (squad[i]?.number ?? i + 1) : i - 7,
            rosterId: home ? squad[i]?.id : undefined,
            playerPosition: role,
            color: home ? posColor(role) : "#434b57",
          })
        );
      }
      frame.elements.push({ id, x, y });
      if (fi > 0) {
        const previous = animation.frames[fi - 1].elements[i];
        if (previous.x !== x || previous.y !== y)
          animation.actions.push(new AnimationAction(id, fi - 1, getDefaultControlPoint(previous.x, previous.y, x, y)));
      }
    });
  });
  return animation;
}
