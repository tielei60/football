// 8 人制阵型预设。横向攻防：自家球门在左，对方球门在右。
// 归一化坐标：nx 0~100（上边线→下边线，横跨球场），ny 0~100（自家门线→对方门线，攻防方向）。
// 映射到 SVG：x = PITCH_8V8.x + (ny / 100) * PITCH_8V8.w，y = PITCH_8V8.y + (nx / 100) * PITCH_8V8.h。
// PITCH_8V8 必须与 EightField.vue 中的 P 保持一致。

export const PITCH_8V8 = { x: 68, y: 62, w: 1115, h: 701 };

export interface FormationSpot {
  nx: number;
  ny: number;
  role: string; // GK / DF / MF / FW
}

export interface Formation {
  id: string;
  name: string;
  category: "常规" | "定位球";
  spots: FormationSpot[]; // 第 1 个为门将，共 8 个
}

export const toSvgX = (ny: number) => PITCH_8V8.x + (ny / 100) * PITCH_8V8.w;
export const toSvgY = (nx: number) => PITCH_8V8.y + (nx / 100) * PITCH_8V8.h;

export const EIGHT_FORMATIONS: Formation[] = [
  {
    id: "2-3-2",
    name: "2-3-2",
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 32, ny: 28, role: "DF" },
      { nx: 68, ny: 28, role: "DF" },
      { nx: 22, ny: 52, role: "MF" },
      { nx: 50, ny: 48, role: "MF" },
      { nx: 78, ny: 52, role: "MF" },
      { nx: 35, ny: 74, role: "FW" },
      { nx: 65, ny: 74, role: "FW" },
    ],
  },
  {
    id: "3-3-1",
    name: "3-3-1",
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 28, ny: 26, role: "DF" },
      { nx: 50, ny: 30, role: "DF" },
      { nx: 72, ny: 26, role: "DF" },
      { nx: 24, ny: 52, role: "MF" },
      { nx: 50, ny: 50, role: "MF" },
      { nx: 76, ny: 52, role: "MF" },
      { nx: 50, ny: 74, role: "FW" },
    ],
  },
  {
    id: "2-1-3-1",
    name: "2-1-3-1",
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 32, ny: 28, role: "DF" },
      { nx: 68, ny: 28, role: "DF" },
      { nx: 50, ny: 42, role: "MF" },
      { nx: 24, ny: 58, role: "MF" },
      { nx: 50, ny: 56, role: "MF" },
      { nx: 76, ny: 58, role: "MF" },
      { nx: 50, ny: 76, role: "FW" },
    ],
  },
  {
    id: "3-2-2",
    name: "3-2-2",
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 28, ny: 28, role: "DF" },
      { nx: 50, ny: 32, role: "DF" },
      { nx: 72, ny: 28, role: "DF" },
      { nx: 36, ny: 52, role: "MF" },
      { nx: 64, ny: 52, role: "MF" },
      { nx: 32, ny: 74, role: "FW" },
      { nx: 68, ny: 74, role: "FW" },
    ],
  },
  {
    id: "1-3-3-1",
    name: "1-5-1",
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 50, ny: 26, role: "DF" },
      { nx: 28, ny: 46, role: "MF" },
      { nx: 50, ny: 50, role: "MF" },
      { nx: 72, ny: 46, role: "MF" },
      { nx: 28, ny: 62, role: "MF" },
      { nx: 72, ny: 62, role: "MF" },
      { nx: 50, ny: 78, role: "FW" },
    ],
  },
  {
    id: "corner-atk",
    name: "角球·进攻",
    category: "定位球",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 88, ny: 86, role: "MF" },
      { nx: 45, ny: 80, role: "FW" },
      { nx: 55, ny: 78, role: "FW" },
      { nx: 62, ny: 82, role: "MF" },
      { nx: 50, ny: 70, role: "MF" },
      { nx: 38, ny: 64, role: "MF" },
      { nx: 66, ny: 66, role: "DF" },
    ],
  },
  {
    id: "corner-def",
    name: "角球·防守",
    category: "定位球",
    spots: [
      { nx: 50, ny: 18, role: "GK" },
      { nx: 40, ny: 26, role: "DF" },
      { nx: 50, ny: 24, role: "DF" },
      { nx: 60, ny: 26, role: "DF" },
      { nx: 34, ny: 34, role: "DF" },
      { nx: 66, ny: 34, role: "MF" },
      { nx: 50, ny: 44, role: "MF" },
      { nx: 78, ny: 60, role: "FW" },
    ],
  },
  {
    id: "freekick",
    name: "任意球",
    category: "定位球",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 55, ny: 66, role: "MF" },
      { nx: 44, ny: 58, role: "DF" },
      { nx: 52, ny: 58, role: "DF" },
      { nx: 60, ny: 58, role: "DF" },
      { nx: 38, ny: 68, role: "FW" },
      { nx: 66, ny: 70, role: "FW" },
      { nx: 50, ny: 80, role: "FW" },
    ],
  },
  {
    id: "kickoff",
    name: "开球",
    category: "定位球",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      { nx: 32, ny: 28, role: "DF" },
      { nx: 68, ny: 28, role: "DF" },
      { nx: 22, ny: 52, role: "MF" },
      { nx: 78, ny: 52, role: "MF" },
      { nx: 44, ny: 48, role: "MF" },
      { nx: 56, ny: 48, role: "FW" },
      { nx: 50, ny: 60, role: "FW" },
    ],
  },
];

export const DEFAULT_FORMATION_ID = "2-3-2";
