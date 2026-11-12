import { useItemStore } from "@/stores/itemStore";
import { useRosterStore } from "@/stores/rosterStore";
import { useBoardStore } from "@/stores/boardStore";
import { useDrawStore } from "@/stores/drawStore";
import { FieldElement } from "@/types/fieldElement";
import { useHistory } from "@/composables/useHistory";
import { assignPlayersToFormation, posColor } from "@/data/berlinGarden";
import { PITCH_8V8, toSvgX, toSvgY } from "@/data/eightFormations";
import { MATCH_FORMATIONS, type MatchPlayerCount } from "@/data/matchFormats";
import { useMatchStore } from "@/stores/matchStore";
import { useTacticsStore } from "@/stores/tacticsStore";

// 对手统一深色，与主队照片/彩色棋子一眼区分
const AWAY_COLOR = "#1F2937";

// 棋子最小间距（直径 48 + 号码角标余量），落位后自动顶开重叠
const MIN_DIST = 56;

const midSvgX = PITCH_8V8.x + PITCH_8V8.w / 2;
// 镜像：对手攻反方向（自家球门在右），沿中线翻转
const mirrorX = (x: number) => 2 * midSvgX - x;

export function useFormation() {
  const itemStore = useItemStore();
  const rosterStore = useRosterStore();
  const boardStore = useBoardStore();
  const { pushHistory } = useHistory();
  const match = useMatchStore();

  const normalPlayers = () => itemStore.items.findByCreationMode("normal").filter((el) => el.elementType === "player");

  const homePlayers = () => normalPlayers().filter((el) => el.team !== "away");
  const awayPlayers = () => normalPlayers().filter((el) => el.team === "away");

  // 两两顶开：间距不足 MIN_DIST 的棋子沿连线推开，用于落位后整理与存量修复
  const separate = (els: FieldElement[]) => {
    let moved = false;
    for (let pass = 0; pass < 10; pass++) {
      let passMoved = false;
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i];
          const b = els[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          if (d >= MIN_DIST) continue;
          passMoved = true;
          const ux = d === 0 ? 1 : dx / d;
          const uy = d === 0 ? 0 : dy / d;
          const push = (MIN_DIST - d) / 2 + 1;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
      moved = moved || passMoved;
      if (!passMoved) break;
    }
    if (moved) {
      els.forEach((el) => {
        const c = boardStore.clampPosition(el.x, el.y, "player");
        el.x = c.x;
        el.y = c.y;
      });
    }
    return moved;
  };

  // 攻防翻转：全部球员 + 线条沿中线镜像（换边讲解），一次历史可撤销。
  // 名单关联按 id，不受影响；动画帧是独立时间轴，不翻。
  const flipBoard = () => {
    const drawStore = useDrawStore();
    pushHistory();
    itemStore.items.getAll().forEach((el) => {
      el.x = mirrorX(el.x);
    });
    drawStore.drawings.getDrawings().forEach((d) => {
      d.startX = mirrorX(d.startX);
      d.endX = mirrorX(d.endX);
      if (d.pathPoints) {
        d.pathPoints = d.pathPoints.map(([px, py]) => [mirrorX(px), py] as [number, number]);
      }
    });
  };

  // 整理当前场上重叠（启动时修复存量），有移动才记历史。
  // 启动修复不属于用户编辑，事后清脏，避免首屏即显示“未保存”。
  const tidyCurrentBoard = () => {
    const els = normalPlayers();
    if (els.length < 2) return;
    const overlap = els.some((a, i) => els.slice(i + 1).some((b) => Math.hypot(b.x - a.x, b.y - a.y) < MIN_DIST));
    if (!overlap) return;
    pushHistory();
    separate(els);
    const tactics = useTacticsStore();
    tactics.markBoardClean(tactics.currentFormationId);
  };

  // 一键落位（人-位稳定版）：保留已选阵容，缺员时再从健康替补中补足；
  // 已在场人员按当前位置就近落位（同模板重复点击无变化），只有替补补入才按位置贪心匹配。
  // 原地更新棋子（保留 id），动画帧与名单关联不受影响；多余棋子下场。
  const applyFormation = (formationId: string, recordHistory = true) => {
    const formation = MATCH_FORMATIONS[match.playerCount].find((f) => f.id === formationId);
    if (!formation) return;

    const healthy = rosterStore.players.filter((p) => !p.status || p.status === "ok");
    const onField = homePlayers();
    const ownerOf = (el: FieldElement) => healthy.find((p) => p.id === el.rosterId || p.fieldId === el.id);
    const selected = onField
      .map((el) => ({ el, player: ownerOf(el) }))
      .filter((entry): entry is { el: FieldElement; player: (typeof healthy)[number] } => !!entry.player);
    const squad = [...new Map([...selected.map((s) => s.player), ...healthy].map((p) => [p.id, p])).values()].slice(
      0,
      match.playerCount
    );
    const squadIds = new Set(squad.map((p) => p.id));
    if (recordHistory) pushHistory();

    const spots = formation.spots.map((spot, index) => ({ spot, index, x: toSvgX(spot.ny), y: toSvgY(spot.nx) }));
    const free = new Set(spots.map((s) => s.index));
    const takeNearest = (x: number, y: number) => {
      let best = -1;
      let bestDist = Infinity;
      for (const index of free) {
        const dist = Math.hypot(spots[index].x - x, spots[index].y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      }
      if (best >= 0) free.delete(best);
      return best;
    };
    const assigned = new Map<string, (typeof spots)[number]>();
    for (const { el, player } of selected) {
      if (!squadIds.has(player.id) || assigned.has(player.id)) continue;
      const index = takeNearest(el.x, el.y);
      if (index >= 0) assigned.set(player.id, spots[index]);
    }
    // 替补按位置补剩余站位（保持模板站位顺序）
    const remaining = spots.filter((s) => free.has(s.index));
    const fillins = squad.filter((p) => !assigned.has(p.id));
    assignPlayersToFormation(fillins, remaining.map((s) => s.spot)).forEach((player, i) => {
      const slot = remaining[i];
      if (slot) {
        assigned.set(player.id, slot);
        free.delete(slot.index);
      }
    });

    const covered = new Set<string | number>();
    for (const { el, player } of selected) {
      const slot = assigned.get(player.id);
      covered.add(el.id);
      if (!slot) {
        itemStore.deleteElement(el.id);
        if (player.fieldId === el.id) player.fieldId = null;
        continue;
      }
      el.x = slot.x;
      el.y = slot.y;
      el.color = posColor(slot.spot.role);
      el.playerPosition = slot.spot.role;
    }
    // 无归属的老棋子（认领不到健康队员）按模板重建时清掉，保持恰好 N 人
    for (const el of onField) {
      if (!covered.has(el.id)) itemStore.deleteElement(el.id);
    }
    squad.forEach((player) => {
      if (player.fieldId !== null && covered.has(player.fieldId)) return;
      const slot = assigned.get(player.id);
      if (!slot) return;
      const el = new FieldElement({
        x: slot.x,
        y: slot.y,
        color: posColor(slot.spot.role),
        number: player.number,
        text: player.name,
        playerPosition: slot.spot.role,
        elementType: "player",
        team: "home",
        rosterId: player.id,
      });
      itemStore.addElement(el);
      player.fieldId = el.id;
    });
    separate(normalPlayers());
    useTacticsStore().applyFormationState(formationId);
  };

  // 对手一键摆阵：深色棋子 + 镜像站位，可与主队阵型不同
  const applyOpponent = (formationId: string, recordHistory = true) => {
    const formation = MATCH_FORMATIONS[match.playerCount].find((f) => f.id === formationId);
    if (!formation) return;

    if (recordHistory) pushHistory();
    awayPlayers().forEach((el) => itemStore.deleteElement(el.id));

    formation.spots.forEach((spot, i) => {
      itemStore.addElement(
        new FieldElement({
          x: mirrorX(toSvgX(spot.ny)),
          y: toSvgY(spot.nx),
          color: AWAY_COLOR,
          number: i + 1,
          text: "",
          playerPosition: spot.role,
          elementType: "player",
          team: "away",
        })
      );
    });
    separate(normalPlayers());
    const tactics = useTacticsStore();
    tactics.applyFormationState(tactics.currentFormationId, formationId, false);
  };

  const clearOpponents = () => {
    if (awayPlayers().length === 0) return;
    pushHistory();
    awayPlayers().forEach((el) => itemStore.deleteElement(el.id));
    const tactics = useTacticsStore();
    tactics.applyFormationState(tactics.currentFormationId, null, false);
  };

  // 首次打开且场上无主队球员时，自动落默认阵型；返回落位的模板 id。
  const seedDefaultFormation = (): string | null => {
    if (homePlayers().length === 0) {
      const id = useMatchStore().getDefaultFormation(useMatchStore().playerCount);
      applyFormation(id);
      return id;
    }
    rosterStore.syncFromBoard();
    return null;
  };

  const changePlayerCount = (count: MatchPlayerCount) => {
    if (count === match.playerCount || !MATCH_FORMATIONS[count]) return;
    pushHistory();
    const hadOpponents = awayPlayers().length > 0;
    match.playerCount = count;
    const id = useMatchStore().getDefaultFormation(count);
    applyFormation(id, false);
    if (hadOpponents) applyOpponent(id, false);
  };

  return {
    applyFormation,
    applyOpponent,
    changePlayerCount,
    clearOpponents,
    seedDefaultFormation,
    tidyCurrentBoard,
    flipBoard,
  };
}
