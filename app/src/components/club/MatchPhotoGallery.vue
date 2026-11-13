<template>
  <section id="match-photos" class="club-card match-photos" aria-label="比赛照片">
    <div class="club-heading">
      <div>
        <h2>比赛照片与合影</h2>
        <p class="club-muted">封面用于比赛列表，其他照片按这里的顺序展示。</p>
      </div>
      <span v-if="dirty" class="club-tag">照片有未保存修改</span>
    </div>
    <p v-if="error" role="alert" class="club-error">{{ error }}</p>
    <p v-if="success" role="status" class="club-success">{{ success }}</p>
    <fieldset :disabled="busy || working">
      <template v-if="editable">
        <label class="photo-upload">
          添加比赛照片
          <input
            ref="fileInput"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            @change="addFiles"
          />
        </label>
        <p class="club-muted">
          最多 10 张，每张不超过 2 MiB、1600 万像素，总计不超过 16 MiB。仅支持静态
          PNG、JPEG、WebP、GIF，不支持动图。请仅上传已获授权的比赛照片，预览后点击保存才会写入。
        </p>
      </template>
      <p v-if="working" role="status">正在处理照片…</p>
      <div v-if="photos.length" class="photo-grid">
        <article v-for="(photo, index) in photos" :key="photo.key" class="photo-card">
          <button
            type="button"
            class="photo-preview"
            :aria-label="`查看第 ${index + 1} 张比赛照片`"
            @click="viewing = photo"
          >
            <img :src="photo.data || photo.url" :alt="photo.caption || `比赛照片 ${index + 1}`" loading="lazy" />
          </button>
          <span v-if="coverKey === photo.key" class="club-tag">比赛封面</span>
          <label v-if="editable">
            照片说明 {{ index + 1 }}
            <input v-model="photo.caption" maxlength="200" placeholder="例如：赛后合影（可选）" />
          </label>
          <p v-else-if="photo.caption">{{ photo.caption }}</p>
          <div v-if="editable" class="club-actions photo-actions">
            <button type="button" :aria-pressed="coverKey === photo.key" @click="coverKey = photo.key">设为封面</button>
            <button
              type="button"
              :disabled="index === 0"
              :aria-label="`前移第 ${index + 1} 张照片`"
              @click="move(index, -1)"
            >
              前移
            </button>
            <button
              type="button"
              :disabled="index === photos.length - 1"
              :aria-label="`后移第 ${index + 1} 张照片`"
              @click="move(index, 1)"
            >
              后移
            </button>
            <button type="button" :aria-label="`移除第 ${index + 1} 张照片`" @click="remove(index)">移除</button>
          </div>
        </article>
      </div>
      <p v-else class="club-empty">暂无比赛照片</p>
      <div v-if="editable" class="club-actions">
        <button type="button" :disabled="coverKey === null" @click="coverKey = null">不设置封面</button>
        <button type="button" class="primary" :disabled="!dirty || working" @click="save">保存比赛照片</button>
        <button v-if="dirty" type="button" @click="reset">撤销照片修改</button>
      </div>
    </fieldset>
    <UiDialog v-model="viewerOpen" title="比赛照片" description="点击关闭可返回比赛，不改变照片。">
      <img v-if="viewing" :src="viewing.data || viewing.url" :alt="viewing.caption || '比赛照片'" class="photo-full" />
      <p v-if="viewing?.caption">{{ viewing.caption }}</p>
    </UiDialog>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { clubApi, ClubApiError, type ClubMatch } from "@/services/clubApi";
import { confirmAction } from "@/components/ui/confirmAction";
const props = defineProps<{ match: ClubMatch; editable: boolean; busy: boolean }>();
const emit = defineEmits<{ saved: [match: ClubMatch]; dirty: [value: boolean]; busy: [value: boolean] }>();
interface PhotoDraft {
  key: string;
  id?: string;
  url: string;
  data?: string;
  caption: string;
  byteSize: number;
}
const photos = ref<PhotoDraft[]>([]);
const coverKey = ref<string | null>(null);
const baseline = ref("");
const error = ref("");
const success = ref("");
const working = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const viewing = ref<PhotoDraft | null>(null);
const viewerOpen = computed({
  get: () => viewing.value !== null,
  set: (value: boolean) => {
    if (!value) viewing.value = null;
  },
});
let generation = 0;
let nextPhotoKey = 0;
const serialize = () =>
  JSON.stringify({
    photos: photos.value.map((p) => ({ key: p.key, data: p.data, caption: p.caption })),
    coverKey: coverKey.value,
  });
const dirty = computed(() => serialize() !== baseline.value);
watch(dirty, (value) => emit("dirty", value));
function sync() {
  generation++;
  photos.value = (props.match.photos || []).map((p) => ({
    key: p.id,
    id: p.id,
    url: p.url,
    caption: p.caption,
    byteSize: p.byteSize,
  }));
  coverKey.value = photos.value.find((p) => p.url === props.match.coverPhotoUrl)?.key ?? null;
  baseline.value = serialize();
  error.value = "";
  if (fileInput.value) fileInput.value.value = "";
}
watch(() => props.match.id, sync, { immediate: true });
watch(
  () => props.match.photos,
  () => {
    if (!dirty.value && !working.value) sync();
  }
);
onUnmounted(() => {
  generation++;
});
function move(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= photos.value.length) return;
  [photos.value[index], photos.value[target]] = [photos.value[target], photos.value[index]];
}
function remove(index: number) {
  const [removed] = photos.value.splice(index, 1);
  if (removed?.key === coverKey.value) coverKey.value = null;
}
async function reset() {
  if (await confirmAction("撤销尚未保存的照片、顺序和封面修改？", { title: "撤销照片修改", confirmText: "撤销修改" }))
    sync();
}
async function addFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length || working.value || props.busy) return;
  error.value = "";
  success.value = "";
  if (photos.value.length + files.length > 10) {
    error.value = "每场比赛最多保存 10 张照片。";
    return;
  }
  if (
    files.some(
      (f) =>
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(f.type) || f.size > 2 * 1024 * 1024 || !f.size
    )
  ) {
    error.value = "请选择不超过 2 MiB 的静态 PNG、JPEG、WebP 或 GIF 图片。";
    return;
  }
  if (
    photos.value.reduce((sum, p) => sum + (p.byteSize || 0), 0) + files.reduce((sum, f) => sum + f.size, 0) >
    16 * 1024 * 1024
  ) {
    error.value = "比赛照片总量不能超过 16 MiB。";
    return;
  }
  const token = ++generation;
  working.value = true;
  emit("busy", true);
  try {
    const additions = await Promise.all(
      files.map(async (file) => {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("照片读取失败，请重试。"));
          reader.readAsDataURL(file);
        });
        await new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () =>
            image.width * image.height > 16000000 ? reject(new Error("照片像素过大，请缩小后上传。")) : resolve();
          image.onerror = () => reject(new Error("无法解码照片，请检查图片内容。"));
          image.src = data;
        });
        return { key: `new-photo-${++nextPhotoKey}`, data, url: "", caption: "", byteSize: file.size };
      })
    );
    if (token !== generation) return;
    photos.value.push(...additions);
    if (photos.value.length === additions.length && coverKey.value === null) coverKey.value = additions[0]?.key ?? null;
  } catch (e) {
    if (token === generation) error.value = (e as Error).message;
  } finally {
    if (token === generation) {
      working.value = false;
      emit("busy", false);
    }
  }
}
async function save() {
  if (working.value || props.busy || !dirty.value) return;
  working.value = true;
  emit("busy", true);
  error.value = "";
  success.value = "";
  try {
    const updated = await clubApi<ClubMatch>(`/matches/${props.match.id}/photos`, "PUT", {
      revision: props.match.revision,
      photos: photos.value.map((p) => ({ ...(p.id ? { id: p.id } : { data: p.data }), caption: p.caption })),
      coverIndex: coverKey.value === null ? null : photos.value.findIndex((p) => p.key === coverKey.value),
    });
    photos.value = updated.photos.map((p) => ({
      key: p.id,
      id: p.id,
      url: p.url,
      caption: p.caption,
      byteSize: p.byteSize,
    }));
    coverKey.value = photos.value.find((p) => p.url === updated.coverPhotoUrl)?.key ?? null;
    baseline.value = serialize();
    emit("saved", updated);
    success.value = "比赛照片已保存";
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "比赛已被其他操作更新，照片修改仍保留。请先保留需要的照片，再重新载入比赛。"
        : (e as Error).message;
  } finally {
    working.value = false;
    emit("busy", false);
  }
}
</script>
<style scoped>
.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
  gap: 18px;
  margin: 20px 0;
}
.photo-card {
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 10px;
}
.photo-preview {
  display: block;
  padding: 0;
  width: 100%;
  overflow: hidden;
  background: var(--color-surface-muted);
}
.photo-preview img {
  width: 100%;
  height: 180px;
  display: block;
  object-fit: cover;
}
.photo-actions {
  gap: 6px;
}
.photo-actions button {
  font-size: 12px;
  padding: 7px 9px;
}
.photo-full {
  max-width: 100%;
  max-height: 65vh;
  object-fit: contain;
  display: block;
  margin: auto;
}
.photo-upload {
  max-width: 480px;
}
</style>
