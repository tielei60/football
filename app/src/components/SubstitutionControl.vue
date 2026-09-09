<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowLeftRight } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { useRosterStore } from "@/stores/rosterStore";
import { useAnimationStore } from "@/stores/animationStore";

const props = defineProps<{ incomingId: string }>();
const roster = useRosterStore();
const animation = useAnimationStore();
const outgoingId = ref("");
const starters = computed(() => roster.players.filter((p) => p.fieldId !== null));
const valid = computed(() => starters.value.some((p) => p.id === outgoingId.value) && !animation.isAnimationMode);
const confirmSubstitution = () => {
  if (roster.substitute(props.incomingId, outgoingId.value)) ElMessage.success("换人完成");
  else ElMessage.warning("队员状态已变化，请重新选择");
};
</script>

<template>
  <div class="substitution-control">
    <label>
      换下队员
      <select v-model="outgoingId" aria-label="换下队员" :disabled="animation.isAnimationMode">
        <option value="" disabled>选择场上队员</option>
        <option v-for="player in starters" :key="player.id" :value="player.id">
          {{ player.number }}号 · {{ player.name }}
        </option>
      </select>
    </label>
    <button :disabled="!valid" @click="confirmSubstitution">
      <ArrowLeftRight :size="15" aria-hidden="true" />
      确认换人
    </button>
  </div>
</template>

<style scoped>
.substitution-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 4px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--muted);
}
select {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: white;
  color: var(--ink);
  padding: 6px 8px;
}
button {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  border: 1px solid var(--pitch-700);
  border-radius: 4px;
  color: var(--pitch-700);
  background: var(--green-soft);
  font-size: 12px;
}
</style>
