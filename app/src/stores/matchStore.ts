import { shallowRef } from "vue";
import { defineStore } from "pinia";
import type { MatchPlayerCount } from "@/data/matchFormats";

export const useMatchStore = defineStore("match", () => {
  const playerCount = shallowRef<MatchPlayerCount>(8);
  return { playerCount };
});
