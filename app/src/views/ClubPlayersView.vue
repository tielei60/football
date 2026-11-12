<template>
  <div class="club-heading">
    <div>
      <h1>球队球员</h1>
      <p class="club-muted">
        {{ players.filter((p) => p.status === "active").length }} 位在队球员 · 名单与战术板共享球员身份
      </p>
    </div>
    <button v-if="auth.isAdmin" class="primary" :disabled="busy" @click="edit()">添加球员</button>
  </div>
  <div v-if="error" class="club-error" role="alert">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy" @click="reload">重新载入球员（放弃未保存修改）</button>
  </div>
  <p v-if="success" role="status" class="club-success">{{ success }}</p>
  <form v-if="form" class="club-card" @submit.prevent="save">
    <fieldset :disabled="busy">
      <h2>{{ form.id ? "编辑球员资料" : "添加球员" }}</h2>
      <div class="club-fields">
        <label>
          姓名
          <input v-model="form.name" required maxlength="100" />
        </label>
        <label>
          球衣号码
          <input v-model="form.number" type="number" min="0" max="999" placeholder="未知" />
        </label>
        <label>
          位置（逗号分隔，可多选）
          <input v-model="positions" placeholder="例如：中后卫, 中场" list="club-position-options" />
        </label>
        <datalist id="club-position-options">
          <option v-for="position in positionOptions" :key="position" :value="position" />
        </datalist>
        <label>
          惯用脚
          <select v-model="form.preferredFoot">
            <option value="">未知</option>
            <option>右脚</option>
            <option>左脚</option>
            <option>双脚</option>
          </select>
        </label>
        <label>
          状态
          <select v-model="form.status">
            <option value="active">在队</option>
            <option value="inactive">已归档</option>
          </select>
        </label>
      </div>
      <div class="club-avatar-editor">
        <label>
          上传球员头像
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="selectAvatar" />
        </label>
        <p class="club-muted">支持 PNG、JPEG、WebP、GIF，最大 2 MiB。预览后保存才会更新；已有头像可直接保留。</p>
        <img
          v-if="form.avatar"
          :src="form.avatar"
          alt="球员头像预览"
          class="club-avatar-preview"
          referrerpolicy="no-referrer"
        />
        <p v-else class="club-muted">未设置头像</p>
        <p v-if="readingAvatar" role="status">正在读取头像…</p>
        <button type="button" :disabled="!form.avatar && !readingAvatar" @click="removeAvatar">移除头像</button>
      </div>
      <label>
        备注
        <textarea v-model="form.note" maxlength="2000" />
      </label>
      <div class="club-actions" style="margin-top: 18px">
        <button class="primary" :disabled="busy || readingAvatar">保存球员</button>
        <button type="button" @click="cancelEdit">取消</button>
      </div>
    </fieldset>
  </form>
  <form v-if="account" class="club-card" @submit.prevent="saveAccount">
    <fieldset :disabled="busy">
      <h2>{{ account.hasAccount ? "重置密码" : "创建球员账号" }} · {{ account.name }}</h2>
      <p class="club-muted">请通过可信渠道单独告知球员登录信息。重置密码会退出该球员的所有已登录设备。</p>
      <div class="club-fields">
        <label v-if="!account.hasAccount">
          用户名
          <input v-model="username" autocomplete="off" required />
        </label>
        <label>
          新密码（至少 10 位）
          <input v-model="password" type="password" minlength="10" autocomplete="new-password" required />
        </label>
      </div>
      <div class="club-actions">
        <button class="primary" :disabled="busy">{{ account.hasAccount ? "确认重置密码" : "创建账号" }}</button>
        <button
          type="button"
          @click="
            account = null;
            password = '';
          "
        >
          取消
        </button>
      </div>
    </fieldset>
  </form>
  <div class="club-card">
    <label style="max-width: 300px; margin-bottom: 18px">
      查找球员
      <input v-model="search" placeholder="姓名、号码或位置" />
    </label>
    <p v-if="loading" role="status">正在载入球员…</p>
    <ClubTableWrap v-else label="球员资料表">
      <table>
        <thead>
          <tr>
            <th>球员</th>
            <th>号码</th>
            <th>位置</th>
            <th>惯用脚</th>
            <th>状态</th>
            <th v-if="auth.isAdmin">管理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id">
            <td>
              <div class="club-player-identity">
                <img
                  v-if="p.avatar"
                  :src="p.avatar"
                  :alt="`${p.name}头像`"
                  class="club-player-avatar"
                  referrerpolicy="no-referrer"
                />
                <strong>
                  {{ p.name }}
                  <span v-if="p.id === auth.session?.user.playerId">（我）</span>
                </strong>
              </div>
              <div v-if="p.note" class="club-muted" style="font-size: 12px; white-space: normal; max-width: 260px">
                {{ p.note }}
              </div>
            </td>
            <td>{{ unknown(p.number) }}</td>
            <td>{{ p.positions.join(" / ") || "未知" }}</td>
            <td>{{ p.preferredFoot || "未知" }}</td>
            <td>
              <span class="club-tag">{{ p.status === "active" ? "在队" : "已归档" }}</span>
            </td>
            <td v-if="auth.isAdmin">
              <div class="club-actions">
                <button :disabled="busy" @click="edit(p)">编辑</button>
                <button
                  :disabled="busy"
                  @click="
                    cancelEdit();
                    account = p;
                    username = '';
                    password = '';
                    success = '';
                  "
                >
                  {{ p.hasAccount ? "重置密码" : "创建账号" }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filtered.length" class="club-empty">暂无符合条件的球员</p>
    </ClubTableWrap>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ClubTableWrap from "@/components/ClubTableWrap.vue";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, ClubApiError, unknown, type ClubPlayer } from "@/services/clubApi";

const auth = useAuthStore();
const players = ref<ClubPlayer[]>([]);
const form = ref<ClubPlayer | null>(null);
const positionOptions = [
  "门将",
  "后卫",
  "中后卫",
  "边后卫",
  "后腰",
  "中场",
  "前腰",
  "边前卫",
  "左边前",
  "右边前",
  "中锋",
  "前锋",
  "待定",
];
const positions = ref("待定");
const account = ref<ClubPlayer | null>(null);
const username = ref("");
const password = ref("");
const search = ref("");
const error = ref("");
const success = ref("");
const busy = ref(false);
const loading = ref(true);
const readingAvatar = ref(false);
let avatarSelection = 0;
let avatarReader: FileReader | undefined;
let disposed = false;
function stopAvatarRead() {
  avatarSelection += 1;
  avatarReader?.abort();
  avatarReader = undefined;
  readingAvatar.value = false;
}
function cancelEdit() {
  if (busy.value) return;
  stopAvatarRead();
  form.value = null;
}
function removeAvatar() {
  if (busy.value || !form.value) return;
  stopAvatarRead();
  form.value.avatar = null;
  error.value = "";
}
function validSignature(value: string, mime: string) {
  const bytes = atob(value.slice(value.indexOf(",") + 1, value.indexOf(",") + 33));
  if (mime === "image/png") return bytes.startsWith("\x89PNG\r\n\x1a\n");
  if (mime === "image/jpeg") return bytes.startsWith("\xff\xd8\xff");
  if (mime === "image/gif") return bytes.startsWith("GIF87a") || bytes.startsWith("GIF89a");
  return mime === "image/webp" && bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
}
function selectAvatar(event: Event) {
  if (busy.value || !form.value) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  stopAvatarRead();
  const selected = avatarSelection;
  const draft = form.value;
  input.value = "";
  error.value = "";
  success.value = "";
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    error.value = "请选择 PNG、JPEG、WebP 或 GIF 头像图片。";
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    error.value = "新头像不能超过 2 MiB，请缩小图片后重试。";
    return;
  }
  const next = new FileReader();
  avatarReader = next;
  readingAvatar.value = true;
  next.onload = () => {
    if (disposed || selected !== avatarSelection || draft !== form.value) return;
    readingAvatar.value = false;
    avatarReader = undefined;
    try {
      if (typeof next.result !== "string" || !validSignature(next.result, file.type)) throw new Error("invalid");
      draft.avatar = next.result;
    } catch {
      error.value = "图片内容与格式不符，原有头像已保留。";
    }
  };
  next.onerror = () => {
    if (disposed || selected !== avatarSelection || draft !== form.value) return;
    readingAvatar.value = false;
    avatarReader = undefined;
    error.value = "头像读取失败，请重新选择。原有头像已保留。";
  };
  next.readAsDataURL(file);
}
const filtered = computed(() =>
  players.value.filter((p) =>
    `${p.name} ${p.number ?? ""} ${p.positions.join(" ")}`.toLowerCase().includes(search.value.toLowerCase())
  )
);
async function load() {
  try {
    players.value = await clubApi<ClubPlayer[]>("/players");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function edit(p?: ClubPlayer) {
  if (busy.value) return;
  stopAvatarRead();
  account.value = null;
  password.value = "";
  form.value = p
    ? JSON.parse(JSON.stringify(p))
    : {
        id: "",
        revision: 0,
        name: "",
        number: null,
        positions: [],
        preferredFoot: "",
        status: "active",
        note: "",
        avatar: null,
        hasAccount: false,
      };
  positions.value = p?.positions.join(", ") || "待定";
  success.value = "";
}
async function save() {
  if (busy.value || readingAvatar.value || !form.value) return;
  busy.value = true;
  error.value = "";
  try {
    const p = form.value;
    await clubApi(`/players${p.id ? `/${encodeURIComponent(p.id)}` : ""}`, p.id ? "PUT" : "POST", {
      revision: p.id ? p.revision : undefined,
      name: p.name,
      number: p.number === null || String(p.number) === "" ? null : Number(p.number),
      positions: (positions.value || "待定")
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      preferredFoot: p.preferredFoot,
      status: p.status,
      note: p.note,
      avatar: p.avatar,
    });
    form.value = null;
    success.value = "球员资料已保存";
    await load();
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "球员资料已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入最新资料。"
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function saveAccount() {
  if (busy.value || !account.value) return;
  busy.value = true;
  error.value = "";
  try {
    const p = account.value;
    await clubApi(
      `/players/${encodeURIComponent(p.id)}/${p.hasAccount ? "password" : "account"}`,
      p.hasAccount ? "PUT" : "POST",
      p.hasAccount ? { newPassword: password.value } : { username: username.value, password: password.value }
    );
    success.value = p.hasAccount ? "密码已重置" : "球员账号已创建";
    account.value = null;
    password.value = "";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (busy.value) return;
  stopAvatarRead();
  busy.value = true;
  error.value = "";
  try {
    players.value = await clubApi<ClubPlayer[]>("/players");
    form.value = null;
    account.value = null;
    password.value = "";
    success.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    loading.value = false;
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  stopAvatarRead();
});
</script>

<style scoped>
.club-avatar-editor {
  margin: 18px 0;
}
.club-avatar-preview {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 12px;
  display: block;
  margin: 12px 0;
}
.club-player-identity {
  display: flex;
  align-items: center;
  gap: 10px;
}
.club-player-avatar {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
