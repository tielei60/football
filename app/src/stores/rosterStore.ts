import { ref, watch } from "vue";
import { nanoid } from "nanoid";
import { defineStore } from "pinia";
import {
  avatarPath,
  normalizePlayerPositions,
  posColor,
  primaryRole,
  type PlayerStatus,
  type TeamPlayer,
} from "@/data/berlinGarden";
import { FieldElement } from "@/types/fieldElement";
import { useItemStore } from "@/stores/itemStore";
import { useHistory } from "@/composables/useHistory";
import { PITCH_8V8 } from "@/data/eightFormations";

export interface RosterEntry extends TeamPlayer {
  fieldId: string | number | null; // 对应场上 FieldElement.id，为 null 表示在替补席
}

// 老缓存缺字段统一补齐
const fillDefaults = (list: RosterEntry[]) => {
  list.forEach((p) => {
    if (!p.avatar && /^bg-\d{1,2}$/.test(p.id)) p.avatar = avatarPath(p.id);
    if (!p.status) p.status = "ok";
    const legacy = p as RosterEntry & { pos?: string };
    p.positions = normalizePlayerPositions(p.positions ?? legacy.pos);
    delete legacy.pos;
  });
};

// 替补席落点：下边线内侧沿横向排开（真实替补席观感），避免与阵型重叠
const benchPos = (index: number) => ({
  x: PITCH_8V8.x + 80 + index * 70,
  y: PITCH_8V8.y + PITCH_8V8.h - 55,
});

export const useRosterStore = defineStore(
  "roster",
  () => {
    const players = ref<RosterEntry[]>([]);
    const itemStore = useItemStore();
    const { pushHistory } = useHistory();

    // 老版本本地缓存缺字段，启动时补齐（仅初始 20 人补头像；状态一律默认健康）
    fillDefaults(players.value);

    const onPitch = (entry: RosterEntry) => entry.fieldId !== null;

    const syncFromBoard = () => {
      const elements = itemStore.items
        .findByCreationMode("normal")
        .filter((el) => el.elementType === "player" && el.team !== "away");
      players.value.forEach((p) => {
        const element = elements.find((el) => el.rosterId === p.id || (!el.rosterId && el.id === p.fieldId));
        p.fieldId = element?.id ?? null;
      });
    };
    watch(() => itemStore.items.findByCreationMode("normal").map((el) => [el.id, el.rosterId]), syncFromBoard, {
      deep: true,
    });

    const substitute = (incomingId: string, outgoingId: string) => {
      syncFromBoard();
      const incoming = players.value.find((p) => p.id === incomingId);
      const outgoing = players.value.find((p) => p.id === outgoingId);
      if (
        !incoming ||
        !outgoing ||
        incoming.fieldId !== null ||
        outgoing.fieldId === null ||
        (incoming.status && incoming.status !== "ok")
      )
        return false;
      const element = itemStore.items.findById(outgoing.fieldId);
      if (!element || element.team === "away" || element.elementType !== "player") return false;
      pushHistory();
      element.rosterId = incoming.id;
      element.text = incoming.name;
      element.number = incoming.number ?? undefined;
      incoming.fieldId = element.id;
      outgoing.fieldId = null;
      return true;
    };

    const playerOn = (id: string, x?: number, y?: number) => {
      const entry = players.value.find((p) => p.id === id);
      if (!entry || entry.fieldId !== null) return false;
      if (entry.status && entry.status !== "ok") return false; // 伤停禁上场
      pushHistory();
      const idx = players.value.filter((p) => p.fieldId !== null).length;
      const el = new FieldElement({
        x: x ?? benchPos(idx).x,
        y: y ?? benchPos(idx).y,
        color: posColor(primaryRole(entry.positions)),
        number: entry.number ?? undefined,
        text: entry.name,
        playerPosition: primaryRole(entry.positions),
        elementType: "player",
        rosterId: entry.id,
      });
      itemStore.addElement(el);
      entry.fieldId = el.id;
      return true;
    };

    const playerOff = (id: string) => {
      const entry = players.value.find((p) => p.id === id);
      if (!entry || entry.fieldId === null) return;
      pushHistory();
      itemStore.deleteElement(entry.fieldId);
      entry.fieldId = null;
    };

    const updatePlayer = (id: string, patch: Partial<TeamPlayer>) => {
      const entry = players.value.find((p) => p.id === id);
      if (!entry) return;
      pushHistory();
      Object.assign(entry, patch);
      // 同步场上元素显示
      if (entry.fieldId !== null) {
        const el = itemStore.items.findById(entry.fieldId);
        if (el) {
          if (patch.name !== undefined) el.text = patch.name;
          if (patch.number !== undefined) el.number = patch.number ?? undefined;
          if (patch.positions !== undefined) {
            const role = primaryRole(patch.positions);
            el.playerPosition = role;
            el.color = posColor(role);
          }
        }
      }
    };

    const removePlayer = (id: string) => {
      const entry = players.value.find((p) => p.id === id);
      if (!entry) return;
      pushHistory();
      if (entry.fieldId !== null) itemStore.deleteElement(entry.fieldId);
      players.value = players.value.filter((p) => p.id !== id);
    };

    const addPlayer = (name: string) => {
      const clean = name.trim();
      if (!clean) return null;
      pushHistory();
      const maxNumber = players.value.reduce((m, p) => Math.max(m, p.number ?? 0), 0);
      const entry: RosterEntry = {
        id: `bg-${nanoid()}`,
        name: clean,
        number: maxNumber < 9999 ? maxNumber + 1 : null,
        positions: ["待定"],
        foot: "",
        status: "ok",
        note: "",
        avatar: undefined,
        fieldId: null,
      };
      players.value.push(entry);
      return entry.id;
    };

    // 设伤停状态：切伤/停且在场则自动下场，与下场共用一次历史
    const setStatus = (id: string, status: PlayerStatus) => {
      const entry = players.value.find((p) => p.id === id);
      if (!entry || entry.status === status) return;
      pushHistory();
      entry.status = status;
      if (status !== "ok" && entry.fieldId !== null) {
        itemStore.deleteElement(entry.fieldId);
        entry.fieldId = null;
      }
    };

    return {
      players,
      onPitch,
      syncFromBoard,
      playerOn,
      playerOff,
      substitute,
      updatePlayer,
      addPlayer,
      removePlayer,
      setStatus,
    };
  },
  {
    persist: {
      // localStorage 恢复会覆盖 setup 时的补丁，老缓存没有 avatar 字段，
      // 必须在水合后补齐，否则头像 v-if 永远为假
      afterHydrate: (ctx) => {
        fillDefaults(ctx.store.players as RosterEntry[]);
      },
    },
  }
);
