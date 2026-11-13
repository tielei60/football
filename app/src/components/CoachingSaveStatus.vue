<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, CircleAlert, Download, RefreshCw, Upload } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { confirmAction } from "@/components/ui/confirmAction";
import { useCoachingDeskStore } from "@/stores/coachingDeskStore";
import { useTacticsStore } from "@/stores/tacticsStore";
import { inspectLegacyTactics, migrateLegacyTactics } from "@/services/tacticsApi";

const desk = useCoachingDeskStore();
const legacyCount = ref(0);
const importing = ref(false);
const labels = {
  loading: "正在载入服务器草稿",
  saved: "草稿已同步到服务器",
  pending: "草稿等待同步",
  saving: "草稿同步中",
  error: "草稿同步失败",
  conflict: "服务器草稿已在其他页面修改",
};
const failed = computed(() => desk.status === "error" || desk.status === "conflict");
const savedTime = computed(() => (desk.savedAt ? new Date(desk.savedAt).toLocaleTimeString("zh-CN") : ""));
onMounted(async () => {
  try {
    legacyCount.value = await inspectLegacyTactics();
  } catch {
    /* 本机旧战术不可读时，仍可使用已保存的战术。 */
  }
});
async function retry() {
  try {
    await desk.flush();
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
async function reload() {
  if (!(await confirmAction("载入已保存的工作台将替换当前草稿。是否继续？"))) return;
  await desk.initialize();
}
async function migrate() {
  importing.value = true;
  try {
    const count = await migrateLegacyTactics();
    await useTacticsStore().refresh();
    legacyCount.value = 0;
    ElMessage.success(count ? `已导入 ${count} 套本机战术` : "本机战术已导入，无重复新增");
  } catch (error) {
    ElMessage.error((error as Error).message);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="coaching-save-status" :class="{ failed }">
    <span role="status" aria-live="polite" aria-label="保存状态" :title="desk.message || savedTime">
      <CircleAlert v-if="failed" :size="14" />
      <Check v-else-if="desk.status === 'saved'" :size="14" />
      <RefreshCw v-else :size="14" />
      {{ labels[desk.status] }}
    </span>
    <button v-if="desk.status === 'error'" @click="retry" title="重试保存" aria-label="重试保存">
      <RefreshCw :size="15" />
    </button>
    <button v-if="failed" @click="desk.downloadDraft" title="下载当前草稿" aria-label="下载当前草稿">
      <Download :size="15" />
    </button>
    <button v-if="desk.status === 'conflict'" @click="reload">载入最新工作台</button>
    <button v-if="legacyCount" :disabled="importing" @click="migrate">
      <Upload :size="14" />
      {{ importing ? "正在导入" : "导入本机战术" }}
    </button>
  </div>
</template>

<style scoped>
.coaching-save-status {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0;
  color: var(--color-success);
  font-size: 12px;
}
.coaching-save-status.failed {
  color: var(--color-danger);
}
.coaching-save-status span,
.coaching-save-status button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.coaching-save-status button {
  min-height: 28px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 3px 6px;
  color: var(--color-text);
  cursor: pointer;
}
.coaching-save-status button:hover {
  background: var(--color-info-soft);
}
.coaching-save-status button:disabled {
  opacity: 0.6;
  cursor: wait;
}
@media (max-width: 760px) {
  .coaching-save-status {
    justify-content: flex-start;
    padding-inline: 16px;
  }
}
</style>
