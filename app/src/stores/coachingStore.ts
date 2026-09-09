import { ref } from "vue";
import { defineStore } from "pinia";
import { normalizeTrainingPlan } from "@/types/coaching";

export const useCoachingStore = defineStore(
  "coaching",
  () => {
    const plan = ref(normalizeTrainingPlan());
    return { plan };
  },
  {
    persist: {
      afterHydrate: ({ store }) => {
        store.plan = normalizeTrainingPlan(store.plan);
      },
    },
  }
);
