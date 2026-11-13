import assert from "node:assert/strict";
import { createPinia, setActivePinia } from "pinia";
import { effectScope } from "vue";
import { useBoardStore } from "../src/stores/boardStore";
import { useDrawStore } from "../src/stores/drawStore";
import { useGlobalStore } from "../src/stores/globalStore";
import { useAnimationStore } from "../src/stores/animationStore";
import { useEraser } from "../src/composables/useEraser";
import { useDrawing } from "../src/composables/useDrawing";
import { usePath } from "../src/composables/usePath";
import { useDraggable } from "../src/composables/useDraggable";
import { useItemStore } from "../src/stores/itemStore";
import { Drawing } from "../src/types/drawing";
import { FieldElement } from "../src/types/fieldElement";

// Real composables and Pinia stores; only browser event/SVG geometry is replaced.
class Target {
  listeners = new Map<string, Set<(e: any) => void>>();

  addEventListener(type: string, fn: (e: any) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: any) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  fire(type: string, event: any) {
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }
}
const doc = Object.assign(new Target(), { getElementById: () => null });
const win = Object.assign(new Target(), { innerWidth: 1440, innerHeight: 900 });
Object.assign(globalThis, {
  document: doc,
  window: win,
  requestAnimationFrame: () => 123,
  cancelAnimationFrame: () => {},
});
setActivePinia(createPinia());
const scope = effectScope();
const board = useBoardStore();
const draw = useDrawStore();
const globalStore = useGlobalStore();
const svg = Object.assign(new Target(), {
  createSVGPoint: () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  }),
  querySelector: () => null,
  getScreenCTM: () => ({ inverse: () => ({}) }),
});
board.svgElement = svg as unknown as SVGSVGElement;
board.setBoardArea({ getBBox: () => ({ x: 0, y: 0, width: 1250, height: 826 }) } as SVGGraphicsElement);
const event = (x: number, y: number, buttons = 1, pointerId = 1) =>
  ({
    clientX: x,
    clientY: y,
    buttons,
    pointerId,
    button: 0,
    type: "pointermove",
    preventDefault() {},
    stopPropagation() {},
  }) as PointerEvent;
const mode = process.argv[2];
if (mode === "eraser") {
  const eraser = scope.run(useEraser)!;
  globalStore.setCurrentTool("eraser");
  draw.drawings.add(new Drawing({ drawingType: "line", startX: 100, startY: 100, endX: 200, endY: 100 }));
  eraser.beginErasing(event(10, 10));
  doc.fire("pointerup", event(900, 900, 0));
  svg.fire("pointermove", event(150, 100, 0));
  assert.equal(draw.drawings.getDrawings().length, 1);
  eraser.beginErasing(event(10, 10));
  svg.fire("pointermove", event(150, 100, 1, 2));
  assert.equal(draw.drawings.getDrawings().length, 1, "other pointer ignored");
  svg.fire("pointermove", event(150, 100));
  assert.equal(draw.drawings.getDrawings().length, 0, "active stroke still erases");
  let unrelatedCalls = 0;
  const unrelated = () => {
    unrelatedCalls += 1;
  };
  doc.addEventListener("pointerup", unrelated);
  scope.stop();
  doc.fire("pointerup", event(1, 1, 0));
  assert.equal(unrelatedCalls, 1, "cleanup preserves other components listeners");
  assert.equal(svg.listeners.get("pointermove")?.size, 0);
} else if (mode === "path") {
  const animation = useAnimationStore();
  const player = new FieldElement({ x: 100, y: 100, elementType: "player" });
  animation.openAnimationFromBoard([player]);
  animation.addFrame();
  animation.updateElementPosition(player.id!, 300, 300);
  const path = scope.run(usePath)!;
  const action = animation.currentAnimation!.actions[0];
  path.startDragControlPoint(animation.currentFrameElements[0], {
    ...event(150, 150),
    currentTarget: { closest: () => svg },
  } as unknown as PointerEvent);
  svg.fire("pointermove", event(180, 170));
  assert.deepEqual(action.controlPoint, { x: 180, y: 170 });
  doc.fire("pointerup", event(900, 900, 0));
  svg.fire("pointermove", event(500, 500, 0));
  assert.deepEqual(action.controlPoint, { x: 180, y: 170 });
  scope.stop();
} else if (mode === "pen") {
  const drawing = scope.run(useDrawing)!;
  globalStore.setCurrentTool("shape");
  draw.drawingConfig.type = "pen";
  drawing.startDrawing(event(100, 100));
  drawing.moveDrawing(event(150, 150)); // queued RAF intentionally never executes
  doc.fire("pointerup", event(200, 200, 0));
  assert.deepEqual(draw.drawings.getDrawings()[0].pathPoints, [
    [100, 100],
    [200, 200],
  ]);
  assert.equal(globalStore.isDrawing, false);
  drawing.startDrawing(event(300, 300));
  doc.fire("pointercancel", event(900, 900, 0));
  assert.equal(draw.drawings.getDrawings().length, 1, "cancel commits no partial stroke");
  scope.stop();
  assert.equal(svg.listeners.get("pointermove")?.size, 0);
} else if (mode === "bounds") {
  const drag = scope.run(useDraggable)!;
  const player = new FieldElement({ x: 100, y: 100, elementType: "player" });
  useItemStore().addElement(player);
  globalStore.snap = true;
  drag.startDrag(player, event(100, 100), {});
  doc.fire("pointermove", event(5000, 5000));
  doc.fire("pointerup", event(5000, 5000, 0));
  assert.equal(player.x, 1226);
  assert.equal(player.y, 800);
  drag.startDrag(player, event(1226, 800), {});
  doc.fire("pointermove", event(-100, -100));
  doc.fire("pointerup", event(-100, -100, 0));
  assert.equal(player.x, 24);
  assert.equal(player.y, 24);
  drag.startDrag(player, event(24, 24), {});
  doc.fire("pointermove", event(500, 500, 0));
  doc.fire("pointerup", event(500, 500, 0));
  assert.equal(player.x, 24, "hover without pressed button never moves player");
  let clicks = 0;
  drag.startDrag(player, event(24, 24), {
    onClick: () => {
      clicks += 1;
    },
  });
  doc.fire("pointercancel", { ...event(24, 24, 0), type: "pointercancel" });
  assert.equal(clicks, 0, "pointercancel does not become a click");
  drag.startDrag(player, event(24, 24), {
    onClick: () => {
      clicks += 1;
    },
  });
  doc.fire("pointermove", event(600, 600));
  win.fire("blur", {});
  doc.fire("pointermove", event(700, 700));
  doc.fire("pointerup", event(700, 700, 0));
  assert.equal(player.x, 24, "blur cancels the pending RAF and future moves");
  assert.equal(player.isDragging, false);
  assert.equal(clicks, 0);
  assert.equal(win.listeners.get("blur")?.size, 0);
  drag.startDrag(player, event(24, 24), {});
  doc.fire("pointermove", event(500, 500));
  scope.stop();
  doc.fire("pointerup", event(500, 500, 0));
  assert.equal(player.x, 24, "unmount cancels queued movement");
  assert.equal(player.isDragging, false);
  assert.equal(win.listeners.get("blur")?.size, 0);
} else throw new Error("Unknown model test");
