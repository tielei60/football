import type { Page } from "@playwright/test";

/** Offline SDK contract fixture, not evidence of Tencent service availability. */
export async function mockTencentMap(page: Page, mode: "ready" | "script-error" | "no-tiles" | "disabled" = "ready") {
  const state = { sdkRequests: 0, unexpectedRequests: [] as string[] };
  await page.addInitScript(() => {
    (window as any).__mapFixtureIntrinsics = { Map, Set };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition() {
          throw new Error("Map flow must not request device location");
        },
        watchPosition() {
          throw new Error("Map flow must not watch device location");
        },
      },
    });
  });
  await page.route("**/api/maps/config", (route) =>
    route.fulfill({
      json: {
        provider: "tencent",
        enabled: mode !== "disabled",
        key: mode === "disabled" ? null : "fictional-test-key",
      },
    })
  );
  // Block every external request, including any SDK follow-up request.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::|\/)|localhost(?::|\/))/, async (route) => {
    if (!route.request().url().startsWith("https://map.qq.com/api/gljs?")) {
      state.unexpectedRequests.push(route.request().url());
      return route.abort();
    }
    state.sdkRequests += 1;
    if (mode === "script-error") return route.abort("internetdisconnected");
    return route.fulfill({
      contentType: "application/javascript",
      body: `
        (() => {
        window.__mapFixture = { maps: [], markers: [], destroyed: 0 };
        class LatLng {
          constructor(lat, lng) { this.lat = lat; this.lng = lng; }
          getLat() { return this.lat; }
          getLng() { return this.lng; }
        }
        class Map {
          constructor(element, options) {
            this.element = element; this.options = options; this.handlers = {};
            window.__mapFixture.maps.push(this);
            element.dataset.sdkFixture = "tencent-offline";
            this.click = () => this.emit("click", { latLng: new LatLng(31.234567, 121.456789) });
            element.addEventListener("click", this.click);
            ${mode === "no-tiles" ? "" : 'setTimeout(() => this.emit("tilesloaded", {}), 50);'}
          }
          on(name, handler) { (this.handlers[name] ||= []).push(handler); return this; }
          off(name, handler) { this.handlers[name] = (this.handlers[name] || []).filter(h => h !== handler); return this; }
          emit(name, event) { (this.handlers[name] || []).forEach(h => h(event)); }
          setCenter(center) { this.center = center; }
          getCenter() { return this.center || this.options.center; }
          setZoom(zoom) { this.zoom = zoom; }
          getZoom() { return this.zoom || this.options.zoom; }
          resize() {}
          destroy() { this.destroyed = true; window.__mapFixture.destroyed++; this.element.removeEventListener("click", this.click); this.handlers = {}; }
        }
        class MultiMarker {
          constructor(options) { this.options = options; this.geometries = options.geometries || []; window.__mapFixture.markers.push(this); }
          setGeometries(geometries) { this.geometries = geometries; }
          updateGeometries(geometries) { this.geometries = geometries; }
          setMap(map) { this.map = map; }
          destroy() { this.destroyed = true; }
        }
        window.TMap = { Map, LatLng, MultiMarker, MarkerStyle: class { constructor(options) { this.options = options; } } };
        })();
      `,
    });
  });
  return state;
}
