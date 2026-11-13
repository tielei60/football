<script setup lang="ts">
import { ElDrawer } from "element-plus";
import "element-plus/es/components/drawer/style/css";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import { ClipboardList, X, Save } from "lucide-vue-next";
import { useCoachingStore } from "@/stores/coachingStore";
import { useHistory } from "@/composables/useHistory";
import { normalizeTrainingPlan } from "@/types/coaching";

const props = defineProps<{ open: boolean; saving: boolean }>();
const emit = defineEmits<{ close: []; save: [] }>();
const { plan } = storeToRefs(useCoachingStore());
const { pushHistory } = useHistory();
const edited = ref(false);
const durationFeedback = ref("");
const endEdit = () => {
  edited.value = false;
};
watch(() => props.open, endEdit);
const editPlan = (field: "objective" | "instructions" | "durationMinutes", event: Event) => {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  const value =
    field === "durationMinutes"
      ? normalizeTrainingPlan({ ...plan.value, durationMinutes: input.value === "" ? undefined : Number(input.value) })
          .durationMinutes
      : input.value;
  if (plan.value[field] === value) return;
  if (!edited.value) {
    pushHistory();
    edited.value = true;
  }
  plan.value = { ...plan.value, [field]: value };
};
const normalizeDuration = (event?: Event) => {
  const normalized = normalizeTrainingPlan(plan.value);
  if (JSON.stringify(normalized) !== JSON.stringify(plan.value)) {
    if (!edited.value) pushHistory();
    plan.value = normalized;
  }
  const input = event?.target;
  if (input instanceof HTMLInputElement) {
    const shown = input.value;
    const actual = String(plan.value.durationMinutes);
    durationFeedback.value = shown !== actual ? `时长范围为 1–180 分钟，已调整为 ${actual} 分钟。` : "";
    // Normalization can keep the model unchanged (e.g. 181 while it is 180).
    // Explicitly reconcile the native input rather than wait for a Vue rerender.
    input.value = actual;
  }
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
        <textarea
          :value="plan.objective"
          rows="3"
          maxlength="200"
          @input="editPlan('objective', $event)"
          @blur="endEdit"
        />
      </label>
      <label>
        训练时长（分钟）
        <input
          :value="plan.durationMinutes"
          type="number"
          min="1"
          max="180"
          step="1"
          @input="editPlan('durationMinutes', $event)"
          @blur="endEdit"
          aria-label="训练时长（分钟）"
          aria-describedby="coaching-duration-feedback"
          @change="normalizeDuration"
        />
        <small id="coaching-duration-feedback" role="status">{{ durationFeedback }}</small>
      </label>
      <label>
        执教要点
        <textarea
          :value="plan.instructions"
          rows="10"
          maxlength="4000"
          @input="editPlan('instructions', $event)"
          @blur="endEdit"
        />
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
  color: var(--color-text);
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
  color: var(--color-text-muted);
  cursor: pointer;
}
label {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 13px;
  color: var(--color-text-muted);
}
textarea,
input {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 10px 12px;
  color: var(--color-text);
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
  background: var(--color-brand);
  color: var(--color-on-brand);
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}
.save-plan:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
:is(button, input, textarea):focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}
</style>
