import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { effectScope } from "vue";
import { createHarness } from "palette-script";
import { useBoardStore } from "../src/stores/boardStore";
import { useItemStore } from "../src/stores/itemStore";
import { useAnimationStore } from "../src/stores/animationStore";
import { useHistoryStore } from "../src/stores/historyStore";
// @ts-expect-error Test-only virtual module extracts the actual SFC setup script.
class Target {
  listeners = new Map<string, Set<(event: any) => void>>();

  addEventListener(type: string, fn: (event: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (event: any) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  fire(type: string, event: any) {
    this.listeners.get(type)?.forEach((fn) => fn({ ...event, type }));
  }
}
const svg = Object.assign(new Target(), {
  createSVGPoint: () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: (this.x - 80) / 0.8, y: (this.y - 40) / 0.8 };
    },
  }),
  querySelector: () => null,
  getScreenCTM: () => ({ inverse: () => ({}) }),
});
const doc = Object.assign(new Target(), { getElementById: () => svg });
const win = Object.assign(new Target(), { innerWidth: 1440, innerHeight: 1000 });
Object.assign(globalThis, { document: doc, window: win });
setActivePinia(createPinia());
const scope = effectScope();
const board = useBoardStore();
board.svgElement = svg as unknown as SVGSVGElement;
board.setBoardArea({ getBBox: () => ({ x: 0, y: 0, width: 1250, height: 826 }) } as SVGGraphicsElement);
const items = useItemStore();
const palette = scope.run(createHarness) as any;
const event = (x = 400, y = 300, pointerId = 1, buttons = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
  buttons,
  button: 0,
  stopPropagation() {},
  preventDefault() {},
});
const start = (index = 0) => palette.startDragNewItem(palette.toolItems.value[index], event(), index);
const dispatch = (type: string, e = event()) => {
  doc.fire(type, e);
  svg.fire(type, e);
};
const mode = process.argv[2];
if (mode === "cancel") {
  start();
  dispatch("pointercancel");
  assert.equal(items.items.getAll().length, 0, "cancel within board must never add a piece");
  assert.equal(items.newDraggingItem, null);
} else if (mode === "outside") {
  start();
  doc.fire("pointerup", event(-20, -20, 1, 0));
  assert.equal(items.newDraggingItem, null, "release outside SVG must remove preview");
  dispatch("pointerup", event());
  assert.equal(items.items.getAll().length, 0, "later unrelated up cannot place stale piece");
} else if (mode === "identity") {
  start();
  const previousX = items.newDraggingItem!.x;
  dispatch("pointermove", event(500, 400, 2));
  dispatch("pointerup", event(500, 400, 2, 0));
  assert.equal(items.newDraggingItem!.x, previousX);
  assert.equal(items.items.getAll().length, 0);
  dispatch("pointermove", event(500, 400, 1, 0));
  assert.equal(items.newDraggingItem, null, "hover cannot continue gesture");
  const animation = useAnimationStore();
  const history = useHistoryStore();
  const originalHistory = history.undoStack.length;
  animation.isAnimationMode = true;
  animation.isPlaying = true;
  start();
  assert.equal(items.newDraggingItem, null, "playback cannot start a palette drag");
  assert.equal(history.undoStack.length, originalHistory, "playback start pushes no history");
  animation.isPlaying = false;
  start();
  assert.ok(items.newDraggingItem);
  animation.isPlaying = true;
  dispatch("pointerup", event(480, 360, 1, 0));
  assert.equal(items.items.getAll().length, 0, "playback begun during drag prevents placement");
  assert.equal(items.newDraggingItem, null);
  assert.equal(history.undoStack.length, originalHistory);
  animation.isPlaying = false;
  animation.isAnimationMode = false;
  start();
  animation.isAnimationMode = true;
  dispatch("pointerup", event(480, 360, 1, 0));
  assert.equal(items.items.getAll().length, 0, "mode switch during drag prevents placement");
  assert.equal(items.newDraggingItem, null);
  assert.equal(history.undoStack.length, originalHistory);
  assert.equal(doc.listeners.get("pointerup")?.size, 0);
  assert.equal(doc.listeners.get("pointermove")?.size, 0);
  assert.equal(win.listeners.get("blur")?.size, 0);
} else if (mode === "blur-unmount") {
  start();
  win.fire("blur", {});
  assert.equal(items.newDraggingItem, null);
  start();
  scope.stop();
  assert.equal(items.newDraggingItem, null);
  dispatch("pointerup");
  assert.equal(items.items.getAll().length, 0);
} else if (mode === "normal") {
  start();
  dispatch("pointermove", event(480, 360));
  dispatch("pointerup", event(480, 360, 1, 0));
  start(5);
  dispatch("pointerup", event(560, 440, 1, 0));
  const pieces = items.items.getAll();
  assert.deepEqual(
    pieces.map((p) => [p.elementType, p.x, p.y]),
    [
      ["player", 500, 400],
      ["ball", 600, 500],
    ]
  );
  assert.equal(items.newDraggingItem, null);
} else throw new Error("Unknown test mode");
scope.stop();
