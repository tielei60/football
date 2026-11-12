import { ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { MATCH_FORMATIONS, MATCH_PLAYER_COUNTS, type MatchPlayerCount } from "@/data/matchFormats";

const STORAGE_KEY = "football-default-formations";

type DefaultFormationMap = Partial<Record<MatchPlayerCount, string>>;

const readStored = (): DefaultFormationMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const clean: DefaultFormationMap = {};
    for (const count of MATCH_PLAYER_COUNTS) {
      const id = parsed[String(count)];
      if (typeof id === "string" && MATCH_FORMATIONS[count].some((f) => f.id === id)) clean[count] = id;
    }
    return clean;
  } catch {
    return {};
  }
};

export const useMatchStore = defineStore("match", () => {
  const playerCount = shallowRef<MatchPlayerCount>(8);
  // 每个比赛人数的首选模板：新建空白板 / 切换人数时自动套用，持久化到本地。
  const defaultFormations = ref<DefaultFormationMap>(readStored());

  const getDefaultFormation = (count: MatchPlayerCount): string => {
    const saved = defaultFormations.value[count];
    if (saved && MATCH_FORMATIONS[count].some((f) => f.id === saved)) return saved;
    return MATCH_FORMATIONS[count][0].id;
  };

  const setDefaultFormation = (count: MatchPlayerCount, id: string) => {
    if (!MATCH_FORMATIONS[count].some((f) => f.id === id)) return;
    defaultFormations.value = { ...defaultFormations.value, [count]: id };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultFormations.value));
    } catch {
      /* 浏览器空间不足时仅本次生效，不阻断操作。 */
    }
  };

  return { playerCount, defaultFormations, getDefaultFormation, setDefaultFormation };
});
