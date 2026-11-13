<template>
  <section class="venue-map-picker" aria-label="球场地图选点">
    <p class="club-muted">腾讯地图选点使用 GCJ-02；旧 WGS84 坐标不会自动转换或覆盖。不读取设备定位。</p>
    <button v-if="!opened" type="button" :disabled="disabled || loading" @click="openMap">打开地图选点</button>
    <template v-else>
      <p v-if="coordinateSystem === 'wgs84' && (latitude !== null || longitude !== null)" class="map-warning">
        原 WGS84 坐标保留。地图从全国视野打开，重新选点后才改为 GCJ-02，保存球场后生效。
      </p>
      <p class="club-muted">拖动、缩放地图后点击球场位置。地图不可用时仍可保存地址或手动填写坐标。</p>
      <p v-if="loading" role="status">正在加载腾讯地图…</p>
      <div
        v-if="configured"
        ref="mapElement"
        class="venue-map"
        :class="{ 'venue-map-disabled': disabled || !ready }"
        aria-label="腾讯球场位置地图"
      />
      <p v-if="mapError" role="status" class="map-warning">{{ mapError }}</p>
      <div class="club-actions">
        <button v-if="mapError" type="button" :disabled="disabled || loading" @click="openMap">重试加载地图</button>
        <button type="button" @click="closeMap">关闭地图</button>
      </div>
    </template>
    <p class="map-disclosure">
      仅主动打开且服务器已配置腾讯地图浏览器 Key
      时才加载官方地图服务。地图会请求当前视野范围，不发送球场名称或备注；不进行定位或地点搜索。
    </p>
    <label class="coordinate-system">
      坐标系
      <UiSelect :model-value="coordinateSystem" :disabled="disabled" @update:model-value="changeSystem">
        <option value="wgs84">WGS84（原始 / 手动坐标）</option>
        <option value="gcj02">GCJ-02（腾讯地图坐标）</option>
      </UiSelect>
    </label>
    <div class="club-fields coordinates">
      <label>
        纬度（{{ coordinateLabel }}）
        <input
          :value="latitude ?? ''"
          type="number"
          step="any"
          min="-90"
          max="90"
          :disabled="disabled"
          placeholder="例如 31.2304"
          @input="setCoordinate('latitude', $event)"
        />
      </label>
      <label>
        经度（{{ coordinateLabel }}）
        <input
          :value="longitude ?? ''"
          type="number"
          step="any"
          min="-180"
          max="180"
          :disabled="disabled"
          placeholder="例如 121.4737"
          @input="setCoordinate('longitude', $event)"
        />
      </label>
    </div>
    <button type="button" :disabled="disabled || (latitude === null && longitude === null)" @click="clear">
      清除坐标
    </button>
    <p class="club-muted">经纬度需成对填写或同时留空。切换坐标系会先清空已有值，不会把旧数值直接重标为另一坐标系。</p>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { confirmAction } from "@/components/ui/confirmAction";
import {
  getTencentMapConfig,
  loadTencentMaps,
  type CoordinateSystem,
  type TencentMap,
  type TencentMapsSDK,
  type TencentMarker,
  type TencentMapEvent,
} from "@/utils/tencentMaps";
const props = defineProps<{
  latitude: number | null;
  longitude: number | null;
  coordinateSystem: CoordinateSystem;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:latitude": [number | null];
  "update:longitude": [number | null];
  "update:coordinateSystem": [CoordinateSystem];
}>();
const opened = ref(false),
  loading = ref(false),
  configured = ref(false),
  ready = ref(false);
const mapError = ref("");
const mapElement = ref<HTMLDivElement>();
const coordinateLabel = computed(() => (props.coordinateSystem === "gcj02" ? "GCJ-02" : "WGS84"));
let sdk: TencentMapsSDK | undefined;
let map: TencentMap | undefined;
let marker: TencentMarker | undefined;
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let disposed = false;
let listeners: [string, (event: TencentMapEvent) => void][] = [];
function validGcjCoordinates() {
  return (
    props.coordinateSystem === "gcj02" &&
    props.latitude !== null &&
    props.longitude !== null &&
    Number.isFinite(props.latitude) &&
    Number.isFinite(props.longitude) &&
    Math.abs(props.latitude) <= 90 &&
    Math.abs(props.longitude) <= 180
  );
}
function syncMarker() {
  if (!map || !sdk || !marker) return;
  marker.setGeometries(
    validGcjCoordinates() ? [{ id: "venue", position: new sdk.LatLng(props.latitude!, props.longitude!) }] : []
  );
}
function cleanup() {
  generation++;
  controller?.abort();
  controller = undefined;
  if (timer) clearTimeout(timer);
  timer = undefined;
  for (const [event, listener] of listeners) {
    try {
      map?.off(event, listener);
    } catch {
      /* a failed SDK may already be destroyed */
    }
  }
  listeners = [];
  try {
    marker?.setMap(null);
  } catch {
    /* release any remaining instance below */
  }
  marker = undefined;
  try {
    map?.destroy();
  } catch {
    /* an initialization failure may already dispose it */
  }
  map = undefined;
  ready.value = false;
}
function closeMap() {
  cleanup();
  opened.value = false;
  configured.value = false;
  loading.value = false;
  mapError.value = "";
}
async function openMap() {
  if (props.disabled || loading.value || disposed) return;
  cleanup();
  opened.value = true;
  configured.value = false;
  loading.value = true;
  mapError.value = "";
  const token = generation;
  const attempt = new AbortController();
  controller = attempt;
  timer = setTimeout(() => {
    if (token !== generation) return;
    cleanup();
    loading.value = false;
    mapError.value = "地图加载超时，请重试或手动填写坐标。";
  }, 25000);
  try {
    const config = await getTencentMapConfig(attempt.signal);
    if (token !== generation || disposed) return;
    if (!config.enabled || !config.key) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      mapError.value = "腾讯地图尚未配置浏览器 Key。仍可保存球场地址、手动坐标；请由部署管理员配置后重试。";
      loading.value = false;
      return;
    }
    sdk = await loadTencentMaps(config.key, attempt.signal);
    if (token !== generation || disposed) return;
    if (props.disabled) {
      cleanup();
      loading.value = false;
      return;
    }
    configured.value = true;
    await nextTick();
    if (token !== generation || disposed || !mapElement.value) return;
    const center = validGcjCoordinates() ? new sdk.LatLng(props.latitude!, props.longitude!) : new sdk.LatLng(35, 105);
    map = new sdk.Map(mapElement.value, { center, zoom: validGcjCoordinates() ? 16 : 4 });
    const onTiles = () => {
      if (token !== generation || disposed) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      ready.value = true;
      loading.value = false;
      mapError.value = "";
    };
    const onContextLost = () => {
      if (token !== generation || disposed) return;
      cleanup();
      loading.value = false;
      mapError.value = "地图图形环境暂时不可用，请重试或使用手动坐标。";
    };
    const onClick = (event: TencentMapEvent) => {
      if (token !== generation || disposed || props.disabled || !ready.value || !event.latLng) return;
      const latitude = event.latLng.getLat(),
        longitude = event.latLng.getLng();
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        return;
      emit("update:coordinateSystem", "gcj02");
      emit("update:latitude", Number(latitude.toFixed(6)));
      emit("update:longitude", Number(longitude.toFixed(6)));
    };
    listeners = [
      ["tilesloaded", onTiles],
      ["context_lost", onContextLost],
      ["click", onClick],
    ];
    for (const [event, listener] of listeners) map.on(event, listener);
    marker = new sdk.MultiMarker({ map, geometries: [] });
    syncMarker();
  } catch (error) {
    if (token !== generation || disposed) return;
    cleanup();
    loading.value = false;
    mapError.value = error instanceof Error ? error.message : "腾讯地图暂时不可用，请手动填写坐标。";
  }
}
function setCoordinate(key: "latitude" | "longitude", event: Event) {
  if (props.disabled) return;
  const input = event.target as HTMLInputElement;
  const value = input.value === "" ? null : input.valueAsNumber;
  if (key === "latitude") emit("update:latitude", value);
  else emit("update:longitude", value);
}
function clear() {
  if (props.disabled) return;
  emit("update:latitude", null);
  emit("update:longitude", null);
}
async function changeSystem(value: unknown) {
  if (props.disabled || (value !== "wgs84" && value !== "gcj02") || value === props.coordinateSystem) return;
  const token = generation;
  if (
    (props.latitude !== null || props.longitude !== null) &&
    !(await confirmAction("不同坐标系不能直接混用。切换将清空当前经纬度，再重新填写或选点。", {
      title: "切换坐标系并清空？",
      confirmText: "清空并切换",
      cancelText: "保留原坐标",
      danger: true,
    }))
  )
    return;
  if (disposed || props.disabled || token !== generation) return;
  clear();
  emit("update:coordinateSystem", value);
}
watch(() => [props.latitude, props.longitude, props.coordinateSystem], syncMarker);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && loading.value) {
      cleanup();
      loading.value = false;
      mapError.value = "地图加载已暂停，保存完成后可重试。";
    }
  }
);
onBeforeUnmount(() => {
  disposed = true;
  cleanup();
});
</script>
<style scoped>
.venue-map-picker {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.venue-map-picker > button {
  justify-self: start;
}
.venue-map {
  height: 360px;
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-muted);
}
.venue-map-disabled {
  pointer-events: none;
  opacity: 0.7;
}
.coordinates {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.coordinate-system {
  display: flex;
  flex-direction: column;
  max-width: 420px;
}
.map-disclosure {
  font-size: 12px;
  color: var(--color-text-muted);
}
.map-warning {
  color: var(--color-warning);
}
@media (max-width: 600px) {
  .coordinates {
    grid-template-columns: 1fr;
  }
  .venue-map {
    height: 280px;
  }
}
</style>
