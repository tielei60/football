<script setup lang="ts">
import { ElDrawer } from "element-plus";
import "element-plus/es/components/drawer/style/css";
import { storeToRefs } from "pinia";
import { ClipboardList, X, Save } from "lucide-vue-next";
import { useCoachingStore } from "@/stores/coachingStore";
import { useHistory } from "@/composables/useHistory";
import { normalizeTrainingPlan } from "@/types/coaching";

defineProps<{ open: boolean; saving: boolean }>();
const emit = defineEmits<{ close: []; save: [] }>();
const { plan } = storeToRefs(useCoachingStore());
const { pushHistory } = useHistory();
const normalizeDuration = () => {
  plan.value = normalizeTrainingPlan(plan.value);
};
</script>

<template>
  <el-drawer
    :model-value="open"
    title="训练计划"
    :with-header="false"
    size="min(420px, 100vw)"
    destroy-on-close
    class="coaching-shell"
    @close="emit('close')"
  >
    <section class="coaching-panel">
      <header>
        <h2>
          <ClipboardList :size="21" aria-hidden="true" />
          训练计划
        </h2>
        <button class="close-plan" aria-label="关闭训练计划" title="关闭训练计划" @click="emit('close')">
          <X :size="20" />
        </button>
      </header>
      <label>
        训练目标
        <textarea v-model="plan.objective" rows="3" maxlength="200" @focus="pushHistory" />
      </label>
      <label>
        训练时长（分钟）
        <input
          v-model.number="plan.durationMinutes"
          type="number"
          min="1"
          max="180"
          step="1"
          @focus="pushHistory"
          @change="normalizeDuration"
        />
      </label>
      <label>
        执教要点
        <textarea v-model="plan.instructions" rows="10" maxlength="4000" @focus="pushHistory" />
      </label>
      <button
        class="save-plan"
        :disabled="saving"
        @click="
          normalizeDuration();
          emit('save');
        "
      >
        <Save :size="16" aria-hidden="true" />
        {{ saving ? "保存中…" : "保存战术" }}
      </button>
    </section>
  </el-drawer>
</template>

<style scoped>
.coaching-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  color: #202b29;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
h2 {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 20px;
  margin: 0;
}
.close-plan {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  background: transparent;
  color: #65716e;
  cursor: pointer;
}
label {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 13px;
  color: #65716e;
}
textarea,
input {
  width: 100%;
  min-height: 40px;
  border: 1px solid #dce3df;
  border-radius: 5px;
  padding: 10px 12px;
  color: #202b29;
  font: 14px/1.6 var(--font-stack);
}
textarea {
  resize: vertical;
}
input {
  max-width: 140px;
}
.save-plan {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  background: #26715a;
  color: white;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}
.save-plan:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
:is(button, input, textarea):focus-visible {
  outline: 2px solid #287fbc;
  outline-offset: 3px;
}
</style>
