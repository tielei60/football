import { PITCH_8V8 } from "@/data/eightFormations";
import { useItemStore } from "@/stores/itemStore";
import { useDrawStore } from "@/stores/drawStore";
import { useHistory } from "@/composables/useHistory";

const FLAG_KEY = "bg-board-version";
const CURRENT_VERSION = 2; // 1=竖向攻防坐标，2=横向攻防坐标

// 同一外框内转置：(x, y) -> (按 ny 映射的 x, 按 nx 映射的 y)
const transpose = (x: number, y: number) => ({
  x: PITCH_8V8.x + ((y - PITCH_8V8.y) / PITCH_8V8.h) * PITCH_8V8.w,
  y: PITCH_8V8.y + ((x - PITCH_8V8.x) / PITCH_8V8.w) * PITCH_8V8.h,
});

// 旧版特征：有人贴着顶部边线（竖向攻防的门将位），且左侧门将区没人。
// 新版门将应在左侧（x 贴近 P.x），据此区分，避免对新坐标重复转置。
const looksLikeVerticalLayout = () => {
  const itemStore = useItemStore();
  const players = itemStore.items
    .findByCreationMode("normal")
    .filter((el) => el.elementType === "player");
  if (players.length === 0) return false;
  const midX = PITCH_8V8.x + PITCH_8V8.w / 2;
  const hasTopKeeper = players.some(
    (p) => p.y < PITCH_8V8.y + 130 && Math.abs(p.x - midX) < 260
  );
  const hasLeftKeeper = players.some((p) => p.x < PITCH_8V8.x + 220);
  return hasTopKeeper && !hasLeftKeeper;
};

export function migrateBoardIfNeeded() {
  let saved = 0;
  try {
    saved = Number(localStorage.getItem(FLAG_KEY) || 0);
  } catch {
    saved = CURRENT_VERSION;
  }
  if (saved >= CURRENT_VERSION) return;
  try {
    localStorage.setItem(FLAG_KEY, String(CURRENT_VERSION));
  } catch {
    /* 忽略 */
  }
  if (!looksLikeVerticalLayout()) return;

  const itemStore = useItemStore();
  const drawStore = useDrawStore();
  const { pushHistory } = useHistory();
  pushHistory();

  itemStore.items.getAll().forEach((el) => {
    const p = transpose(el.x, el.y);
    el.x = p.x;
    el.y = p.y;
  });
  drawStore.drawings.getDrawings().forEach((d) => {
    const s = transpose(d.startX, d.startY);
    const e = transpose(d.endX, d.endY);
    d.startX = s.x;
    d.startY = s.y;
    d.endX = e.x;
    d.endY = e.y;
    if (d.pathPoints) {
      d.pathPoints = d.pathPoints.map(([px, py]) => {
        const p = transpose(px, py);
        return [p.x, p.y] as [number, number];
      });
    }
  });
}
