<template>
  <section class="club-card" aria-label="球队资料">
    <h2>球队资料</h2>
    <p v-if="loading" role="status" class="club-loading">正在载入球队资料…</p>
    <div v-if="error" class="club-error" role="alert">
      <p>{{ error }}</p>
      <button type="button" :disabled="busy || loading" @click="load">重新载入球队（放弃未保存修改）</button>
    </div>
    <p v-if="success" class="club-success" role="status">{{ success }}</p>
    <form v-if="draft && auth.isAdmin" @submit.prevent="save">
      <fieldset :disabled="busy || loading">
        <div class="club-fields">
          <label>
            球队名称
            <input v-model="draft.name" required maxlength="200" />
          </label>
          <label>
            上传球队队徽
            <input
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              @change="selectCrest"
            />
          </label>
        </div>
        <p class="club-muted">支持 PNG、JPEG、WebP、GIF，最大 2 MiB。选择后预览，保存才会更新球队资料。</p>
        <img :src="draft.crest || defaultBadge" alt="球队队徽预览" class="club-team-crest-preview" />
        <p v-if="reading" role="status">正在读取队徽…</p>
        <p v-if="!draft.crest" class="club-muted">未设置自定义队徽，当前使用默认队徽。</p>
        <div class="club-actions">
          <button type="button" :disabled="!draft.crest && !reading" @click="removeCrest">移除自定义队徽</button>
          <button class="primary" :disabled="reading">保存球队资料</button>
        </div>
      </fieldset>
    </form>
    <div v-else-if="draft">
      <img :src="draft.crest || defaultBadge" alt="球队队徽预览" class="club-team-crest-preview" />
      <p>
        <strong>{{ draft.name }}</strong>
      </p>
      <p class="club-muted">球队资料由管理员维护。</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import defaultBadge from "@/assets/default-club-badge.svg";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, ClubApiError, type Team } from "@/services/clubApi";

const auth = useAuthStore();
const draft = ref<Team | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const loading = ref(false);
const busy = ref(false);
const reading = ref(false);
const error = ref("");
const success = ref("");
let selection = 0;
let reader: FileReader | undefined;
let disposed = false;
function cancelReading() {
  selection += 1;
  reader?.abort();
  reader = undefined;
  reading.value = false;
}
function apply(team: Team) {
  draft.value = { ...team };
  if (auth.session) auth.session.team = { ...team };
  if (fileInput.value) fileInput.value.value = "";
}
async function load() {
  if (busy.value || loading.value) return;
  cancelReading();
  loading.value = true;
  error.value = "";
  success.value = "";
  try {
    const team = await clubApi<Team>("/team");
    if (!disposed) apply(team);
  } catch (e) {
    if (!disposed) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function selectCrest(event: Event) {
  if (busy.value || loading.value || !draft.value) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  cancelReading();
  const current = selection;
  error.value = "";
  success.value = "";
  input.value = "";
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    error.value = "请选择 PNG、JPEG、WebP 或 GIF 图片。";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    error.value = "队徽图片不能超过 2 MiB，请缩小图片后重试。";
    return;
  }
  const next = new FileReader();
  reader = next;
  reading.value = true;
  next.onload = () => {
    if (disposed || current !== selection) return;
    if (draft.value && typeof next.result === "string") draft.value.crest = next.result;
    reading.value = false;
    reader = undefined;
  };
  next.onerror = () => {
    if (disposed || current !== selection) return;
    reading.value = false;
    reader = undefined;
    error.value = "图片读取失败，请重新选择。原有队徽已保留。";
  };
  next.readAsDataURL(file);
}
function removeCrest() {
  if (busy.value || loading.value || !draft.value) return;
  cancelReading();
  draft.value.crest = null;
  error.value = "";
  success.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
async function save() {
  if (busy.value || loading.value || reading.value || !draft.value) return;
  if (!draft.value.name.trim()) {
    error.value = "请输入球队名称。";
    return;
  }
  busy.value = true;
  error.value = "";
  success.value = "";
  try {
    const team = await clubApi<Team>("/team", "PUT", {
      revision: draft.value.revision,
      name: draft.value.name.trim(),
      crest: draft.value.crest,
    });
    if (!disposed) {
      apply(team);
      success.value = "球队资料已保存";
    }
  } catch (e) {
    if (!disposed)
      error.value =
        e instanceof ClubApiError && e.status === 409
          ? "球队资料已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入最新球队资料。"
          : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  cancelReading();
});
</script>

<style scoped>
.club-team-crest-preview {
  width: 96px;
  height: 96px;
  object-fit: contain;
  margin-bottom: 12px;
  padding: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  border-radius: 5px;
}
</style>
