<template>
  <el-drawer
    :model-value="open"
    title="战术库"
    :with-header="false"
    size="min(460px, 100vw)"
    destroy-on-close
    class="tactics-shell"
    @close="emit('close')"
  >
    <aside class="tactics-drawer" v-if="open">
      <div class="drawer-head">
        <span class="drawer-title">
          战术库
          <small>{{ tactics.length }} 套</small>
        </span>
        <button class="drawer-new" @click="onNew">
          <Plus :size="14" />
          新建空白板
        </button>
        <button class="drawer-close" @click="emit('close')" aria-label="关闭战术库" title="关闭战术库">
          <X :size="20" />
        </button>
      </div>

      <section class="current-card" aria-label="当前战术草稿">
        <div class="current-title-row">
          <span class="current-label">当前画布 · 草稿</span>
          <span v-if="currentId === null" class="current-dirty">未存档</span>
          <span v-else-if="boardDirty" class="current-dirty">● 未保存</span>
          <span v-else class="current-clean">✓ 已保存</span>
        </div>
        <div class="current-name">{{ currentTitle || "未命名草稿" }}</div>
        <div class="current-meta">{{ currentFormationLabel }}</div>
        <p class="current-hint">阵型模板只决定落位起点，拖动微调后记得保存；打开存档会整体替换当前画布。</p>
      </section>

      <div class="save-box">
        <label class="field-label">
          战术名称
          <input class="save-title" v-model="title" placeholder="如：vs 红星 · 高位逼抢" />
        </label>
        <div class="match-row">
          <label class="field-label">
            对手
            <input class="save-title match-input" v-model="opponent" placeholder="对手名称" />
          </label>
          <label class="field-label">
            日期
            <input class="save-title match-input" v-model="matchDate" type="date" />
          </label>
          <label class="field-label">
            比分
            <input class="save-title match-input" v-model="score" placeholder="0 : 0" />
          </label>
        </div>
        <div class="tag-row">
          <button
            v-for="t in allTags"
            :key="t"
            class="tag-btn"
            :class="{ active: tags.includes(t) }"
            :aria-pressed="tags.includes(t)"
            @click="toggleTag(t)"
          >
            {{ t }}
          </button>
        </div>
        <label class="field-label">
          版本备注
          <input class="save-note" v-model="note" placeholder="可选" />
        </label>
        <button class="save-btn" @click="onSave(false)" :disabled="saving">
          <Save :size="16" />
          {{ saving ? "保存中…" : "保存当前战术" }}
        </button>
        <button class="save-copy" @click="onSave(true)" :disabled="saving || currentId === null">
          <CopyPlus :size="16" aria-hidden="true" />
          另存为新战术
        </button>
        <div class="io-row">
          <button class="io-btn" @click="onExportJSON">导出JSON</button>
          <button class="io-btn" @click="triggerImport">导入JSON</button>
          <button class="io-btn" @click="runAction(onExportSVG)">导出SVG</button>
          <input
            ref="fileRef"
            type="file"
            accept="application/json,.json"
            style="display: none"
            @change="onImportFile"
          />
        </div>
        <div class="io-row">
          <button class="io-btn" @click="onBackup">备份全部</button>
          <button class="io-btn" @click="triggerRestore">恢复备份</button>
          <input
            ref="backupRef"
            type="file"
            accept="application/json,.json"
            style="display: none"
            @change="onRestoreFile"
          />
        </div>
        <div class="io-row">
          <button class="io-btn seed-btn" @click="onSeed" :disabled="importingSeeds">导入进阶预置（10 套）</button>
        </div>
      </div>

      <label class="field-label library-heading">
        已保存战术 · 存档
        <input class="drawer-search" type="search" aria-label="搜索战术" v-model="keyword" placeholder="搜索战术名称" />
      </label>
      <div class="tag-row filter">
        <button class="tag-btn" :class="{ active: filterTag === '' }" @click="filterTag = ''">全部</button>
        <button class="tag-btn" :class="{ active: onlyFav }" :aria-pressed="onlyFav" @click="onlyFav = !onlyFav">
          <Star :size="12" />
          收藏
        </button>
        <button
          v-for="t in allTags"
          :key="t"
          class="tag-btn"
          :class="{ active: filterTag === t }"
          @click="filterTag = filterTag === t ? '' : t"
        >
          {{ t }}
        </button>
      </div>

      <ul class="tactic-list">
        <li v-for="t in filtered" :key="t.id" class="tactic-item" :class="{ current: t.id === currentId }">
          <img v-if="t.thumb" :src="t.thumb" class="tactic-thumb" alt="" />
          <div v-else class="tactic-thumb empty">无图</div>
          <div class="tactic-info">
            <div class="tactic-title">{{ t.title }}</div>
            <div class="tactic-meta">{{ fmtTime(t.updatedAt) }} · {{ t.tags.join("/") || "无标签" }}</div>
            <div v-if="formationName(t.formationId)" class="tactic-formation">
              阵型：{{ formationName(t.formationId) }}
            </div>
            <div v-if="matchText(t)" class="tactic-match">{{ matchText(t) }}</div>
            <p v-if="t.snapshot.coaching?.objective" class="tactic-objective">{{ t.snapshot.coaching.objective }}</p>
            <span v-if="t.snapshot.animation" class="animation-count">
              {{ t.snapshot.animation.frames.length }} 步动画
            </span>
            <div class="tactic-actions">
              <button @click="onLoad(t.id!)">打开</button>
              <button
                v-if="(t.snapshot.animation?.frames.length ?? 0) > 1"
                @click="onPlay(t.id!)"
                title="播放战术动画"
                aria-label="播放战术动画"
              >
                <Play :size="14" />
              </button>
              <button
                @click="runAction(() => store.toggleFav(t.id!))"
                :aria-label="t.fav ? '取消收藏' : '收藏战术'"
                :title="t.fav ? '取消收藏' : '收藏战术'"
                :aria-pressed="t.fav"
              >
                <Star :size="14" :fill="t.fav ? 'currentColor' : 'none'" />
              </button>
              <button @click="toggleVersions(t.id!)" title="版本历史" aria-label="版本历史">
                <History :size="14" />
              </button>
              <button @click="runAction(() => store.requestPrint(t.id!))" title="打印战术" aria-label="打印战术">
                <Printer :size="14" />
              </button>
              <button class="danger" @click="onDelete(t.id!)" title="删除战术" aria-label="删除战术">
                <Trash2 :size="14" />
              </button>
            </div>
            <ul v-if="expanded === t.id" class="version-list">
              <li v-for="v in versions[t.id!] || []" :key="v.id" class="version-item">
                <span>{{ fmtTime(v.createdAt) }} · {{ v.note }}</span>
                <button @click="onRollback(v)">回滚</button>
              </li>
            </ul>
          </div>
        </li>
      </ul>
      <div v-if="filtered.length === 0" class="empty-tip">
        {{ tactics.length ? "没有匹配的战术" : "暂无已保存的战术" }}
      </div>
    </aside>
  </el-drawer>
</template>

<script setup lang="ts">
import { confirmAction } from "@/components/ui/confirmAction";
import { computed, onMounted, ref, watch } from "vue";
import { X, Plus, Save, Star, History, Printer, Trash2, CopyPlus, Play } from "lucide-vue-next";
import { ElMessage, ElDrawer } from "element-plus";
import "element-plus/es/components/drawer/style/css";
import { storeToRefs } from "pinia";
import { useTacticsStore } from "@/stores/tacticsStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useMatchStore } from "@/stores/matchStore";
import { findFormation } from "@/data/matchFormats";
import { TACTIC_TAGS, type VersionRecord } from "@/db";
import { prepareBoardExport } from "@/utils/boardExport";
import { inlineImages } from "@/utils/inlineImages";
import { fromBoard, toBoard } from "@/services/tacticLanguage";
import { useCoachingDeskStore } from "@/stores/coachingDeskStore";
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const { teamFileName } = useTeamIdentity();

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const saving = ref(false);
const importingSeeds = ref(false);

const store = useTacticsStore();
const { tactics, versions, currentId, currentFormationId, formationCustomized, boardDirty } = storeToRefs(store);
const matchStore = useMatchStore();
const allTags = [...TACTIC_TAGS];

const title = ref("");
const tags = ref<string[]>([]);
const note = ref("");
const opponent = ref("");
const matchDate = ref("");
const score = ref("");
const keyword = ref("");
const filterTag = ref("");
const onlyFav = ref(false);
const expanded = ref<number | null>(null);

const reportError = (error: unknown) => ElMessage.error(error instanceof Error ? error.message : "操作失败，请重试");
const runAction = async (action: () => Promise<unknown>) => {
  try {
    await action();
  } catch (error) {
    reportError(error);
  }
};
onMounted(() => {
  if (!store.ready) void runAction(store.refresh);
});

const toggleTag = (t: string) => {
  tags.value = tags.value.includes(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t];
};

const syncForm = () => {
  const current = store.tactics.find((t) => t.id === store.currentId);
  title.value = current?.title || "";
  tags.value = [...(current?.tags || [])];
  opponent.value = current?.match?.opponent || "";
  matchDate.value = current?.match?.date || "";
  score.value = current?.match?.score || "";
  note.value = "";
};

const onLoad = async (id: number) => {
  try {
    await store.loadTactic(id);
    syncForm();
  } catch (error) {
    reportError(error);
  }
};

const onPlay = async (id: number) => {
  try {
    await store.loadTactic(id);
    syncForm();
    const animation = useAnimationStore();
    animation.openAnimation();
    animation.startAutoPlay();
    emit("close");
  } catch (error) {
    reportError(error);
  }
};

const onRollback = async (version: VersionRecord) => {
  try {
    await store.rollback(version);
    syncForm();
    ElMessage.success("已恢复历史版本，保存后更新战术");
  } catch (error) {
    reportError(error);
  }
};

const onSave = async (asNew = false) => {
  if (saving.value) return;
  saving.value = true;
  const formContent = () =>
    JSON.stringify([title.value, tags.value, note.value, opponent.value, matchDate.value, score.value]);
  const submittedForm = formContent();
  try {
    const current = store.tactics.find((t) => t.id === store.currentId);
    let name = title.value.trim() || current?.title || `战术 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    if (asNew && name === current?.title) name += "（副本）";
    await store.saveTactic(
      name,
      tags.value,
      // 阵型取当前画布模板血缘（含已微调），不再沿用存档旧值。
      store.currentFormationId ?? current?.formationId ?? null,
      note.value.trim(),
      {
        opponent: opponent.value,
        date: matchDate.value,
        score: score.value,
      },
      asNew
    );
    await useCoachingDeskStore().flush();
    if (formContent() === submittedForm) syncForm();
    ElMessage.success(asNew ? "已另存为新战术" : "战术已保存");
  } catch (error) {
    reportError(error);
  } finally {
    saving.value = false;
  }
};

// Initialize on route re-entry as well as first asynchronous refresh. Drawer
// visibility and background list refreshes must not overwrite unsaved form edits.
watch(
  () => [store.currentId, store.ready] as const,
  () => {
    if (!saving.value) syncForm();
  },
  { immediate: true }
);

const matchText = (t: { match?: { opponent?: string; date?: string; score?: string } }) => {
  const parts = [t.match?.opponent, t.match?.date, t.match?.score].filter(Boolean);
  return parts.length ? parts.join(" · ") : "";
};

// 草稿卡与存档列表共用：模板血缘 → 展示名，无血缘显示自定义站位。
const formationName = (id: string | null) => (id ? (findFormation(id)?.name ?? id) : "");
const currentTitle = computed(() => store.tactics.find((t) => t.id === store.currentId)?.title || "");
const currentFormationLabel = computed(() => {
  const id = currentFormationId.value;
  const name = id ? (findFormation(id)?.name ?? id) : "自定义站位";
  const suffix = id && formationCustomized.value ? "·已微调" : "";
  const isDefault = !!id && id === matchStore.getDefaultFormation(matchStore.playerCount);
  return `模板：${name}${suffix}${isDefault ? "（默认）" : ""}`;
});

const onNew = async () => {
  if (await confirmAction("清空当前画布新建？（已保存的战术不受影响）")) store.newBoard();
};

const onDelete = async (id: number) => {
  if (await confirmAction("删除这套战术及其全部历史版本？")) await runAction(() => store.deleteTactic(id));
};

const toggleVersions = async (id: number) => {
  if (expanded.value === id) {
    expanded.value = null;
    return;
  }
  await runAction(async () => {
    await store.loadVersions(id);
    expanded.value = id;
  });
};

const filtered = computed(() => {
  const kw = keyword.value.trim();
  return tactics.value.filter((t) => {
    if (onlyFav.value && !t.fav) return false;
    if (filterTag.value && !t.tags.includes(filterTag.value)) return false;
    if (kw && !t.title.includes(kw)) return false;
    return true;
  });
});

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

// ---- JSON / SVG 导入导出 ----
const fileRef = ref<HTMLInputElement | null>(null);
const backupRef = ref<HTMLInputElement | null>(null);

const download = (name: string, href: string) => {
  const link = document.createElement("a");
  link.download = name;
  link.href = href;
  link.click();
};

const stamp = () => new Date().toISOString().slice(0, 10);

const onBackup = async () => {
  await runAction(async () => {
    const json = await store.exportBackup();
    const count = store.tactics.length;
    if (count === 0) {
      alert("战术库是空的，无需备份");
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    download(`${teamFileName.value}_战术库备份_${stamp()}.json`, url);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
};

const triggerRestore = () => backupRef.value?.click();

const onRestoreFile = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const result = await store.importBackup(JSON.parse(await file.text()));
    if (result.receiptVerification === "legacy-unverified") {
      alert("发现旧导入记录，无法核验与本次文件是否一致。请核对服务器战术；本次未新增，未确认完整恢复。");
      return;
    }
    if (result.listRefreshFailed) {
      alert(`导入已确认（新增 ${result.importedCount} 套），但列表刷新失败。请刷新战术列表核对，不要重复恢复。`);
      return;
    }
    alert(result.importedCount ? `恢复成功，共导入 ${result.importedCount} 套战术（追加，不覆盖现有）` : "相同内容已导入，本次未新增");
  } catch (error) {
    reportError(error);
  } finally {
    (e.target as HTMLInputElement).value = "";
  }
};

const onSeed = async () => {
  if (importingSeeds.value) return;
  importingSeeds.value = true;
  try {
    await runAction(async () => {
      const count = await store.importSeedTactics();
      alert(count > 0 ? `已导入 ${count} 套预置战术` : "预置战术已全部导入，无新增");
    });
  } finally {
    importingSeeds.value = false;
  }
};

const onExportJSON = () => {
  const snapshot = store.snapshotBoard();
  const current = store.tactics.find((t) => t.id === store.currentId);
  const payload = {
    title: title.value.trim() || current?.title || `战术 ${stamp()}`,
    tags: tags.value.length ? tags.value : current?.tags || [],
    match: current?.match,
    exportedAt: Date.now(),
    board: toBoard(snapshot),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  download(`${teamFileName.value}_战术_${stamp()}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

const triggerImport = () => fileRef.value?.click();

const onImportFile = async (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || (!payload.board && !payload.snapshot))
      throw new Error("不是有效的战术文件");
    const name = typeof payload.title === "string" && payload.title ? payload.title : file.name.replace(/\.json$/i, "");
    const tagList = Array.isArray(payload.tags) ? payload.tags.filter((t: unknown) => typeof t === "string") : [];
    await store.importTactic(name, tagList, payload.board ? fromBoard(payload.board) : payload.snapshot, payload.match);
  } catch (error) {
    reportError(error);
  } finally {
    (e.target as HTMLInputElement).value = "";
  }
};

const onExportSVG = async () => {
  const area = document.getElementById("board-area") as unknown as SVGGraphicsElement | null;
  if (!area) return;
  const { bounds: bbox, content: cloned } = prepareBoardExport(area);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(bbox.width));
  svg.setAttribute("height", String(bbox.height));
  svg.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  await inlineImages(cloned);
  svg.appendChild(cloned);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  download(`${teamFileName.value}_战术_${stamp()}.svg`, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};
</script>

<style lang="scss" scoped>
.tactics-drawer {
  width: 100%;
  background: var(--color-surface);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 0;
  overflow-y: auto;
  font-size: 13px;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--pitch-900);
}

.drawer-new {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.save-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--color-surface);
  padding: 4px 0 20px;
  border-bottom: 1px solid var(--color-border);
}

.current-card {
  background: var(--color-brand-soft);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.current-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.current-label {
  font-weight: 700;
  font-size: 13px;
  color: var(--color-text);
}

.current-dirty {
  color: var(--color-warning);
  font-size: 12px;
  font-weight: 700;
}

.current-clean {
  color: var(--color-brand);
  font-size: 12px;
  font-weight: 700;
}

.current-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.current-meta {
  font-size: 12px;
  color: var(--color-brand);
  font-weight: 700;
}

.current-hint {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.tactic-formation {
  font-size: 12px;
  color: var(--pitch-700);
}

.save-title,
.save-note,
.drawer-search {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}

.tag-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-btn {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tag-btn.active {
  background: var(--pitch-700);
  border-color: var(--pitch-700);
  color: var(--color-on-brand);
}

.save-btn {
  background: var(--pitch-700);
  color: var(--color-on-brand);
  border: none;
  border-radius: 8px;
  padding: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.io-row {
  display: flex;
  gap: 6px;
}

.io-btn {
  flex: 1;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 8px;
  padding: 6px 4px;
  font-size: 12px;
  cursor: pointer;
}

.io-btn:hover {
  border-color: var(--pitch-500);
  color: var(--pitch-700);
}

.seed-btn {
  border-color: var(--pitch-500);
  color: var(--pitch-700);
  font-weight: 700;
}

.tactic-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tactic-item {
  display: flex;
  gap: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px;
  transition: all 0.15s;
}

.tactic-item:hover {
  box-shadow: var(--shadow-md);
}

.tactic-item.current {
  border-color: var(--pitch-500);
  box-shadow: 0 0 0 1px var(--pitch-500);
}

.tactic-thumb {
  width: 96px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
  background: var(--color-bg);
}

.tactic-thumb.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-muted);
}

.tactic-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tactic-title {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tactic-meta {
  font-size: 12px;
  opacity: 0.6;
}

.tactic-match {
  font-size: 12px;
  color: var(--pitch-700);
  font-weight: 700;
}
.tactic-objective {
  margin: 3px 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.animation-count {
  color: var(--color-focus);
  font-size: 11px;
}

.match-row {
  display: flex;
  gap: 6px;
}

.match-input {
  flex: 1;
  min-width: 0;
}

.tactic-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tactic-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 30px;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.tactic-actions button.danger {
  color: var(--color-danger);
  border-color: var(--color-danger-border);
}

.version-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 6px;
  background: var(--color-brand-soft);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.version-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.version-item button {
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  border-radius: 6px;
  padding: 1px 8px;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.empty-tip {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 12px 0;
}
.drawer-title {
  font-size: 20px;
  color: var(--color-text);
}
.drawer-title small {
  font-size: 12px;
  font-weight: 400;
  color: var(--color-text-muted);
  margin-left: 6px;
}
.drawer-new {
  margin-left: auto;
  display: flex;
  gap: 5px;
  align-items: center;
  min-height: 34px;
}
.drawer-close {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  width: 36px;
  height: 36px;
  margin-left: 8px;
  cursor: pointer;
}
.field-label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--color-text-muted);
  min-width: 0;
}
.field-label input {
  width: 100%;
  min-height: 38px;
  color: var(--color-text);
}
.match-row {
  display: grid;
  grid-template-columns: 1fr 1.35fr 0.7fr;
}
.save-btn {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  background: var(--color-brand);
}
.save-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-brand);
  font-size: 13px;
  cursor: pointer;
}
.save-copy:hover:not(:disabled) {
  background: var(--color-brand-soft);
}
.save-copy:disabled,
.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tag-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.tag-btn.active {
  background: var(--color-brand);
  border-color: var(--color-brand);
}
.library-heading {
  color: var(--color-text);
  font-weight: 650;
  gap: 12px;
}
.tactic-thumb {
  width: 106px;
  height: 76px;
}
.tactic-meta {
  opacity: 1;
  color: var(--color-text-muted);
}
@media (max-width: 500px) {
  .tactic-actions button {
    min-height: 38px;
    min-width: 36px;
  }
  .tactic-thumb {
    width: 84px;
    height: 64px;
  }
}
</style>
