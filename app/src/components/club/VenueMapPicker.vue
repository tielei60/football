<template>
  <section class="venue-map-picker" aria-label="球场地图选点">
    <p class="club-muted">坐标使用 WGS84。地图只用于选择球场位置，不读取你的设备定位。</p>
    <button v-if="!opened" type="button" :disabled="disabled || loading" @click="openMap">打开地图选点</button>
    <template v-else>
      <p class="club-muted">拖动地图或使用方向键平移，点击球场位置设点。也可在下方直接填写经纬度。</p>
      <p v-if="loading" role="status">正在加载地图…</p>
      <div ref="mapElement" class="venue-map" :class="{ 'venue-map-disabled': disabled }" aria-label="球场位置地图" />
      <p v-if="mapError" role="status" class="map-warning">{{ mapError }}</p>
      <button v-if="mapError" type="button" :disabled="disabled || loading" @click="retryMap">重试加载地图</button>
    </template>
    <p class="map-disclosure">
      打开后由 OpenStreetMap 提供地图瓦片，会向其请求当前地图范围；不发送球场名称或备注。网络不可用时仍可手动录入。
    </p>
    <div class="club-fields coordinates">
      <label>
        纬度（WGS84）
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
        经度（WGS84）
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
    <p class="club-muted">经纬度需同时填写或同时留空。中国境内其他地图可能使用 GCJ-02 / BD-09，请勿直接混用。</p>
  </section>
</template>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type * as Leaflet from "leaflet";
const props = defineProps<{ latitude: number | null; longitude: number | null; disabled?: boolean }>();
const emit = defineEmits<{ "update:latitude": [number | null]; "update:longitude": [number | null] }>();
const opened = ref(false);
const loading = ref(false);
const mapError = ref("");
const mapElement = ref<HTMLDivElement>();
const map = shallowRef<Leaflet.Map>();
let leaflet: typeof Leaflet | undefined;
let marker: Leaflet.Marker | undefined;
let tiles: Leaflet.TileLayer | undefined;
let disposed = false;
function validCoordinates() {
  return (
    props.latitude !== null &&
    props.longitude !== null &&
    Number.isFinite(props.latitude) &&
    Number.isFinite(props.longitude) &&
    Math.abs(props.latitude) <= 90 &&
    Math.abs(props.longitude) <= 180
  );
}
function syncMarker() {
  if (!map.value || !leaflet) return;
  if (!validCoordinates()) {
    marker?.remove();
    marker = undefined;
    return;
  }
  const position: Leaflet.LatLngExpression = [props.latitude!, props.longitude!];
  if (marker) marker.setLatLng(position);
  else
    marker = leaflet
      .marker(position, {
        icon: leaflet.divIcon({
          className: "venue-map-pin",
          html: '<span aria-hidden="true">●</span>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        title: "已选球场位置",
        keyboard: false,
      })
      .addTo(map.value);
  if (!map.value.getBounds().contains(position)) map.value.panTo(position);
}
async function openMap() {
  if (props.disabled || loading.value) return;
  opened.value = true;
  loading.value = true;
  mapError.value = "";
  try {
    await import("leaflet/dist/leaflet.css");
    leaflet = await import("leaflet");
    await nextTick();
    if (disposed || !mapElement.value) return;
    if (!map.value) {
      const position: Leaflet.LatLngExpression = validCoordinates() ? [props.latitude!, props.longitude!] : [31, 105];
      map.value = leaflet.map(mapElement.value, {
        center: position,
        zoom: validCoordinates() ? 16 : 4,
        minZoom: 2,
        maxZoom: 19,
        scrollWheelZoom: false,
      });
      tiles = leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        })
        .on("tileerror", () => {
          mapError.value = "地图瓦片暂时无法加载；已选坐标不会丢失，可手动填写或稍后重试。";
        })
        .addTo(map.value);
      map.value.on("click", (event: Leaflet.LeafletMouseEvent) => {
        if (props.disabled) return;
        emit("update:latitude", Number(event.latlng.lat.toFixed(6)));
        emit("update:longitude", Number(event.latlng.wrap().lng.toFixed(6)));
      });
      const container = map.value.getContainer();
      container.querySelector(".leaflet-control-zoom-in")?.setAttribute("aria-label", "放大地图");
      container.querySelector(".leaflet-control-zoom-out")?.setAttribute("aria-label", "缩小地图");
    }
    map.value.invalidateSize();
    syncMarker();
  } catch {
    mapError.value = "地图暂时不可用，请使用经纬度输入，其他球场资料仍可保存。";
  } finally {
    loading.value = false;
  }
}
function retryMap() {
  if (props.disabled || loading.value) return;
  if (!map.value) return openMap();
  mapError.value = "";
  tiles?.redraw();
}
function setCoordinate(key: "latitude" | "longitude", event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value === "" ? null : input.valueAsNumber;
  if (key === "latitude") emit("update:latitude", value);
  else emit("update:longitude", value);
}
function clear() {
  emit("update:latitude", null);
  emit("update:longitude", null);
}
watch(() => [props.latitude, props.longitude], syncMarker);
onBeforeUnmount(() => {
  disposed = true;
  map.value?.remove();
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
  z-index: 0;
  background: var(--color-surface-muted);
}
.venue-map-disabled {
  pointer-events: none;
  opacity: 0.7;
}
.coordinates {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.map-disclosure {
  font-size: 12px;
  color: var(--color-text-muted);
}
.map-warning {
  color: var(--color-warning);
}
:deep(.venue-map-pin) {
  color: var(--color-brand);
  font-size: 28px;
  text-shadow:
    0 0 2px white,
    0 0 4px white;
  line-height: 28px;
  text-align: center;
}
:deep(.leaflet-control-zoom a) {
  color: var(--color-brand);
  background: var(--color-surface);
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
