<script setup lang="ts">
import { confirmAction } from "@/components/ui/confirmAction";
import { computed, onMounted, ref } from "vue";
import { Check, CircleAlert, Download, RefreshCw, Upload } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { useCoachingDeskStore } from "@/stores/coachingDeskStore";
import { useTacticsStore } from "@/stores/tacticsStore";
import { inspectLegacyTactics, migrateLegacyTactics } from "@/services/tacticsApi";

const desk = useCoachingDeskStore();
const legacyCount = ref(0);
const importing = ref(false);
const labels = {
  loading: "正在载入工作台",
  saved: "已保存",
  pending: "有未保存的修改",
  saving: "正在保存",
  error: "保存失败",
  conflict: "工作台已在其他页面修改",
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
    const result = await migrateLegacyTactics();
    let listRefreshFailed = false;
    try { await useTacticsStore().refresh(); } catch { listRefreshFailed = true; }
    if (result.receiptVerification === "legacy-unverified") {
      ElMessage.warning("发现旧导入记录，无法核验与本次内容是否一致。请核对服务器战术；本机数据已保留，本次未新增。");
      return;
    }
    legacyCount.value = 0;
    if (listRefreshFailed) {
      ElMessage.warning(`导入已确认（新增 ${result.importedCount} 套），但列表刷新失败。请刷新战术列表核对，不要重复导入。`);
      return;
    }
    ElMessage.success(result.importedCount ? `已导入 ${result.importedCount} 套本机战术` : "相同内容已导入，本次未新增");
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
  padding: 0 24px 6px;
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
