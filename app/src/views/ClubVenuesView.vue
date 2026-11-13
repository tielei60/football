<template>
  <div class="club-heading">
    <div>
      <span class="club-eyebrow">GROUNDS / 常用球场</span>
      <h1>球场管理</h1>
      <p class="club-muted">保存常用场地，安排比赛时直接选择。旧比赛保留当时的场地资料。</p>
    </div>
    <button v-if="auth.isAdmin" class="primary" :disabled="busy" @click="edit()">新增球场</button>
  </div>
  <div v-if="error" class="club-error" role="alert">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy" @click="reload">重新载入球场</button>
  </div>
  <p v-if="success" class="club-success" role="status">{{ success }}</p>
  <form v-if="form && auth.isAdmin" ref="formElement" class="club-card" @submit.prevent="save">
    <fieldset :disabled="busy">
      <h2>{{ form.id ? "编辑球场" : "新增球场" }}</h2>
      <p class="club-muted">名称必填，地址和坐标可暂时留空。归档后不再供新比赛选择，但不删除历史。</p>
      <div class="club-fields">
        <label>
          球场名称
          <input ref="nameInput" v-model="form.name" required maxlength="150" />
        </label>
        <label>
          球场地址
          <input v-model="form.address" maxlength="500" />
        </label>
        <label>
          球场状态
          <UiSelect v-model="form.status">
            <option value="active">可使用</option>
            <option value="archived">已归档</option>
          </UiSelect>
        </label>
      </div>
      <label>
        球场备注
        <textarea v-model="form.note" maxlength="2000" rows="3" placeholder="例如入口、场地类型、停车提示" />
      </label>
      <VenueMapPicker
        :key="editorKey"
        v-model:latitude="form.latitude"
        v-model:longitude="form.longitude"
        v-model:coordinate-system="form.coordinateSystem"
        :disabled="busy"
      />
      <div class="club-actions">
        <button class="primary" :disabled="busy">{{ busy ? "保存中…" : "保存球场" }}</button>
        <button type="button" :disabled="busy" @click="cancel">取消</button>
      </div>
    </fieldset>
  </form>
  <div class="club-filterbar">
    <label>
      查找球场
      <input v-model="search" type="search" placeholder="名称或地址" />
    </label>
    <label>
      球场筛选
      <UiSelect v-model="filter">
        <option value="active">可使用</option>
        <option value="archived">已归档</option>
        <option value="">全部球场</option>
      </UiSelect>
    </label>
    <span class="club-muted">{{ filtered.length }} 处球场</span>
  </div>
  <p v-if="loading" class="club-loading" role="status">正在载入球场…</p>
  <div v-else class="club-grid">
    <article v-for="venue in filtered" :key="venue.id" class="club-card venue-card">
      <div class="club-heading">
        <h2>{{ venue.name }}</h2>
        <span class="club-tag">{{ venue.status === "active" ? "可使用" : "已归档" }}</span>
      </div>
      <p>{{ venue.address || "地址待补充" }}</p>
      <p class="club-muted">
        {{
          venue.latitude === null
            ? "坐标待补充"
            : `${venue.coordinateSystem === "gcj02" ? "GCJ-02" : "WGS84"}：${venue.latitude}, ${venue.longitude}`
        }}
      </p>
      <p v-if="venue.note" class="venue-note">{{ venue.note }}</p>
      <div v-if="auth.isAdmin" class="club-actions">
        <button :disabled="busy" @click="edit(venue)">编辑球场</button>
        <button :disabled="busy" @click="toggleStatus(venue)">
          {{ venue.status === "active" ? "归档球场" : "恢复使用" }}
        </button>
      </div>
    </article>
  </div>
  <p v-if="!loading && !filtered.length" class="club-card club-empty">
    暂无符合条件的球场{{ auth.isAdmin ? "，可新增常用场地后在比赛中选择。" : "，请联系管理员维护。" }}
  </p>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { clubApi, ClubApiError, type Venue } from "@/services/clubApi";
import { useAuthStore } from "@/stores/authStore";
import { confirmAction } from "@/components/ui/confirmAction";
import VenueMapPicker from "@/components/club/VenueMapPicker.vue";
const auth = useAuthStore();
const venues = ref<Venue[]>([]);
const form = ref<Venue | null>(null);
const baseline = ref("");
const editorKey = ref(0);
const search = ref("");
const filter = ref("active");
const error = ref("");
const success = ref("");
const busy = ref(false);
const loading = ref(true);
const formElement = ref<HTMLFormElement>();
const nameInput = ref<HTMLInputElement>();
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== baseline.value);
const filtered = computed(() =>
  venues.value.filter(
    (v) =>
      (!filter.value || v.status === filter.value) &&
      `${v.name} ${v.address}`.toLowerCase().includes(search.value.trim().toLowerCase())
  )
);
async function discard() {
  return (
    !dirty.value ||
    (await confirmAction("未保存的球场修改将丢失，继续吗？", {
      title: "放弃球场修改",
      confirmText: "放弃修改",
      danger: true,
    }))
  );
}
async function edit(venue?: Venue) {
  if (busy.value || !(await discard())) return;
  editorKey.value++;
  form.value = venue
    ? JSON.parse(JSON.stringify(venue))
    : {
        id: 0,
        revision: 0,
        name: "",
        address: "",
        latitude: null,
        longitude: null,
        coordinateSystem: "wgs84",
        note: "",
        status: "active",
      };
  baseline.value = JSON.stringify(form.value);
  error.value = "";
  success.value = "";
  await nextTick();
  formElement.value?.scrollIntoView({ block: "start" });
  nameInput.value?.focus({ preventScroll: true });
}
async function cancel() {
  if (!busy.value && (await discard())) form.value = null;
}
async function load() {
  loading.value = true;
  try {
    venues.value = await clubApi<Venue[]>("/venues");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function reload() {
  if (busy.value || !(await discard())) return;
  form.value = null;
  error.value = "";
  await load();
}
async function save() {
  if (busy.value || !form.value) return;
  const v = form.value;
  if (
    (v.latitude === null) !== (v.longitude === null) ||
    (v.latitude !== null && (!Number.isFinite(v.latitude) || Math.abs(v.latitude) > 90)) ||
    (v.longitude !== null && (!Number.isFinite(v.longitude) || Math.abs(v.longitude) > 180))
  ) {
    error.value = "请填写成对的有效坐标，或同时清空经纬度。";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await clubApi<Venue>(`/venues${v.id ? `/${v.id}` : ""}`, v.id ? "PUT" : "POST", v);
    form.value = null;
    success.value = "球场资料已保存";
    await load();
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "球场已被其他操作更新，你的输入仍保留。请记录需要的内容，再重新载入。"
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function toggleStatus(venue: Venue) {
  if (busy.value || !(await discard())) return;
  if (
    !(await confirmAction(
      venue.status === "active" ? "归档后新比赛不能再选此球场，已有比赛资料不变。" : "恢复后可再次安排新比赛。",
      { title: venue.status === "active" ? "归档球场" : "恢复球场", confirmText: "确认" }
    ))
  )
    return;
  busy.value = true;
  error.value = "";
  try {
    await clubApi(`/venues/${venue.id}`, "PUT", {
      ...venue,
      status: venue.status === "active" ? "archived" : "active",
    });
    form.value = null;
    success.value = "球场状态已更新";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onBeforeRouteLeave(async () => !busy.value && (await discard()));
onMounted(() => {
  void load();
  window.addEventListener("beforeunload", beforeUnload);
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>
<style scoped>
.venue-note {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.venue-card {
  min-width: 0;
  overflow-wrap: anywhere;
}
.venue-card h2 {
  margin: 0;
}
form fieldset {
  display: grid;
  gap: 18px;
}
.club-filterbar {
  flex-wrap: wrap;
  align-items: end;
}
.club-filterbar label {
  min-width: min(220px, 100%);
}
</style>
