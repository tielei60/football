/** Tencent GL is opt-in and loaded only from the documented official SDK endpoint. */
export type CoordinateSystem = "wgs84" | "gcj02";
export interface TencentLatLng {
  getLat(): number;
  getLng(): number;
}
export interface TencentMapEvent {
  latLng?: TencentLatLng;
}
export interface TencentMap {
  on(type: string, listener: (event: TencentMapEvent) => void): void;
  off(type: string, listener: (event: TencentMapEvent) => void): void;
  destroy(): void;
}
export interface TencentMarker {
  setGeometries(geometries: { id: string; position: TencentLatLng }[]): void;
  setMap(map: TencentMap | null): void;
}
export interface TencentMapsSDK {
  Map: new (element: HTMLElement, options: { center: TencentLatLng; zoom: number }) => TencentMap;
  LatLng: new (latitude: number, longitude: number) => TencentLatLng;
  MultiMarker: new (options: {
    map: TencentMap;
    geometries: { id: string; position: TencentLatLng }[];
  }) => TencentMarker;
}
export interface TencentMapConfig {
  provider: "tencent";
  enabled: boolean;
  key: string | null;
}
declare global {
  interface Window {
    TMap?: TencentMapsSDK;
  }
}
let sdkKey: string | null = null;
let sdkPromise: Promise<TencentMapsSDK> | null = null;
function aborted() {
  return new DOMException("地图加载已取消", "AbortError");
}
export async function getTencentMapConfig(signal: AbortSignal): Promise<TencentMapConfig> {
  const response = await fetch("/api/maps/config", { credentials: "same-origin", signal });
  if (!response.ok)
    throw new Error(
      response.status === 403 ? "仅管理员可以配置球场地图。" : "无法读取地图配置，请重试或手动填写坐标。"
    );
  const config = await response.json();
  if (
    config?.provider !== "tencent" ||
    typeof config.enabled !== "boolean" ||
    (config.key !== null && typeof config.key !== "string")
  )
    throw new Error("地图配置格式不正确，请联系管理员。");
  return config;
}
function sdkAvailable(): TencentMapsSDK | undefined {
  const sdk = window.TMap;
  return sdk &&
    typeof sdk.Map === "function" &&
    typeof sdk.LatLng === "function" &&
    typeof sdk.MultiMarker === "function"
    ? sdk
    : undefined;
}
export function loadTencentMaps(key: string, signal: AbortSignal): Promise<TencentMapsSDK> {
  if (signal.aborted) return Promise.reject(aborted());
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(key))
    return Promise.reject(new Error("地图浏览器 Key 格式不正确，请联系管理员。"));
  // An already executing script must never be silently reused for a different key.
  if (sdkKey && sdkKey !== key) return Promise.reject(new Error("地图配置已变更，请刷新页面后重试。"));
  sdkKey = key;
  if (!sdkPromise) {
    const existing = sdkAvailable();
    sdkPromise = existing
      ? Promise.resolve(existing)
      : new Promise<TencentMapsSDK>((resolve, reject) => {
          const script = document.createElement("script");
          const url = new URL("https://map.qq.com/api/gljs");
          url.searchParams.set("v", "1.exp");
          url.searchParams.set("key", key);
          script.src = url.toString();
          script.async = true;
          script.dataset.footballTencentMaps = "true";
          const timer = window.setTimeout(() => finish(new Error("地图组件加载超时，请重试或手动填写坐标。")), 12000);
          let settled = false;
          function finish(error?: Error) {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            script.onload = null;
            script.onerror = null;
            const sdk = sdkAvailable();
            if (error || !sdk) {
              script.remove();
              reject(error || new Error("地图组件未正确加载，请重试。"));
            } else resolve(sdk);
          }
          script.onload = () => finish();
          script.onerror = () => finish(new Error("地图组件暂时无法加载，请重试或手动填写坐标。"));
          document.head.append(script);
        }).catch((error) => {
          sdkPromise = null;
          throw error;
        });
  }
  const pending = sdkPromise;
  return new Promise<TencentMapsSDK>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(aborted());
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (sdk) => {
        cleanup();
        if (signal.aborted) reject(aborted());
        else resolve(sdk);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
