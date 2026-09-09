import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  AnimationFrame,
  AnimationAction,
  Animation,
  restoreAnimation,
  type AnimationSnapshot,
} from "../types/animation";
import { FieldElement } from "../types/fieldElement";
import { getDefaultControlPoint, getCatmullRomPath } from "../utils/path";
import { buildScenario } from "../data/tacticalScenarios";
import { useBoardStore } from "./boardStore";
import { useGlobalStore } from "./globalStore";

export const useAnimationStore = defineStore(
  "animation",
  () => {
    const boardStore = useBoardStore();
    const globalStore = useGlobalStore();
    const isAnimationMode = ref(false);
    const animations = ref<Animation[]>([]);
    const currentAnimation = ref<Animation | null>(null);
    const currentAnimationId = ref<string | number | null>(null);
    const currentFrameIndex = ref(0);
    const isPlaying = ref(false);
    const frameTime = ref(3);
    const loop = ref(false);
    const showTrails = ref(true);
    const progress = ref(1);
    let playbackTimer: number | null = null;
    let lastTick = 0;

    const currentAnimationFrameCount = computed(() => currentAnimation.value?.frames.length ?? 0);
    const currentFrameElements = computed(
      () => currentAnimation.value?.getFrameElements(currentFrameIndex.value) ?? []
    );
    const currentFrameElementsIds = computed(() => currentFrameElements.value.map((el) => el.id));
    const demoLabels = computed(() => currentAnimation.value?.frames.map((f, i) => f.title || `步骤 ${i + 1}`) ?? []);
    const frameDuration = (index: number) =>
      Math.max(0.5, Math.min(30, currentAnimation.value?.frames[index]?.duration ?? 3));
    const frameStarts = computed(() => {
      let time = 0;
      return (currentAnimation.value?.frames ?? []).map((_, i) => {
        if (i > 0) time += frameDuration(i);
        return time;
      });
    });
    const totalDuration = computed(() => frameStarts.value[frameStarts.value.length - 1] ?? 0);
    const playhead = computed(() =>
      currentFrameIndex.value === 0
        ? 0
        : (frameStarts.value[currentFrameIndex.value - 1] ?? 0) +
          frameDuration(currentFrameIndex.value) * progress.value
    );
    const isAtKeyframe = computed(() => progress.value === 1 || currentFrameIndex.value === 0);
    const canEdit = computed(() => !isPlaying.value && isAtKeyframe.value);

    // 浏览器原生 SVG 路径采样与画布轨迹共用同一条曲线，计时由单一播放头驱动。
    const transitionPaths = computed(() => {
      const animation = currentAnimation.value;
      if (!animation || currentFrameIndex.value === 0) return [];
      return currentFrameElements.value.flatMap((to) => {
        const from = animation.getElementInFrame(to.id!, currentFrameIndex.value - 1);
        if (!from || (from.x === to.x && from.y === to.y)) return [];
        const action = animation.actions.find(
          (a) => a.animationElementId === to.id && a.startFrame === currentFrameIndex.value - 1
        );
        const d = getCatmullRomPath([
          from,
          action?.controlPoint ?? getDefaultControlPoint(from.x, from.y, to.x, to.y),
          to,
        ]);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        return [
          {
            id: to.id!,
            d,
            path,
            length: path.getTotalLength(),
            ball: to.elementType === "ball",
            away: to.team === "away",
          },
        ];
      });
    });
    const displayElements = computed(() => {
      if (isAtKeyframe.value) return currentFrameElements.value;
      return currentFrameElements.value.map((el) => {
        const route = transitionPaths.value.find((p) => p.id === el.id);
        if (!route) return el;
        const point = route.path.getPointAtLength(route.length * progress.value);
        return { ...el, x: point.x, y: point.y } as FieldElement;
      });
    });
    const haveActionPrevFrameElements = computed(() => {
      if (!currentAnimation.value || currentFrameIndex.value === 0) return [];
      return currentAnimation.value
        .getFrameElements(currentFrameIndex.value - 1)
        .filter((el) => transitionPaths.value.some((p) => p.id === el.id));
    });

    const stopAutoPlay = () => {
      if (playbackTimer !== null) cancelAnimationFrame(playbackTimer);
      playbackTimer = null;
      isPlaying.value = false;
    };
    const setPlayhead = (seconds: number) => {
      const time = Math.max(0, Math.min(totalDuration.value, Number.isFinite(seconds) ? seconds : 0));
      if (time === 0) {
        currentFrameIndex.value = 0;
        progress.value = 1;
        return;
      }
      const index = frameStarts.value.findIndex((end, i) => i > 0 && time <= end);
      currentFrameIndex.value = index < 0 ? Math.max(0, currentAnimationFrameCount.value - 1) : index;
      progress.value = Math.min(
        1,
        (time - (frameStarts.value[currentFrameIndex.value - 1] ?? 0)) / frameDuration(currentFrameIndex.value)
      );
    };
    const seek = (seconds: number) => {
      stopAutoPlay();
      setPlayhead(seconds);
    };
    const tick = (now: number) => {
      if (!isPlaying.value) return;
      const next = playhead.value + (Math.max(0, now - lastTick) / 1000) * (3 / frameTime.value);
      lastTick = now;
      if (next >= totalDuration.value) {
        if (loop.value && totalDuration.value > 0) setPlayhead(next % totalDuration.value);
        else {
          setPlayhead(totalDuration.value);
          stopAutoPlay();
          return;
        }
      } else setPlayhead(next);
      playbackTimer = requestAnimationFrame(tick);
    };
    const startAutoPlay = () => {
      if (currentAnimationFrameCount.value < 2 || playbackTimer !== null) return;
      if (playhead.value >= totalDuration.value) setPlayhead(0);
      isPlaying.value = true;
      lastTick = performance.now();
      playbackTimer = requestAnimationFrame(tick);
    };
    const togglePlayback = () => (isPlaying.value ? stopAutoPlay() : startAutoPlay());
    const switchFrame = (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= currentAnimationFrameCount.value) return;
      stopAutoPlay();
      currentFrameIndex.value = index;
      progress.value = 1;
    };
    const playNextFrame = () =>
      switchFrame(Math.min(currentAnimationFrameCount.value - 1, currentFrameIndex.value + 1));
    const activate = (animation: Animation) => {
      stopAutoPlay();
      currentAnimation.value = animation;
      animations.value = [animation];
      currentAnimationId.value = animation.id;
      currentFrameIndex.value = 0;
      progress.value = 1;
    };
    const openAnimation = () => {
      if (!currentAnimation.value)
        activate(
          restoreAnimation(animations.value[animations.value.length - 1]?.toJSON()) ?? new Animation("自定义战术")
        );
      stopAutoPlay();
      isAnimationMode.value = true;
      globalStore.setCurrentTool("select");
      boardStore.resetSvgElement();
    };
    const openAnimationFromBoard = (items: FieldElement[]) => {
      if (!currentAnimation.value) {
        const animation = new Animation("自定义战术");
        animation.frames[0].title = "初始站位";
        items.forEach((el) => {
          const copy = el.cloneIncludingId();
          animation.addSharedElement(copy.id!, copy);
          animation.frames[0].elements.push({ id: copy.id!, x: copy.x, y: copy.y });
        });
        activate(animation);
      }
      openAnimation();
    };
    const loadDemoAnimation = (squad: { id?: string; name: string; number: number }[], scenario = "cross") => {
      activate(buildScenario(scenario, squad));
      openAnimation();
    };
    const exitAnimation = () => {
      stopAutoPlay();
      isAnimationMode.value = false;
      boardStore.resetSvgElement();
    };
    const getSnapshot = (): AnimationSnapshot | undefined =>
      currentAnimation.value ? JSON.parse(JSON.stringify(currentAnimation.value.toJSON())) : undefined;
    const loadSnapshot = (data?: unknown) => {
      exitAnimation();
      const animation = restoreAnimation(data);
      if (animation) activate(animation);
      else {
        currentAnimation.value = null;
        currentAnimationId.value = null;
        animations.value = [];
        currentFrameIndex.value = 0;
        progress.value = 1;
      }
    };
    const reindex = () =>
      currentAnimation.value?.frames.forEach((frame, index) => {
        frame.frameNumber = index;
      });
    const rebuildTransition = (index: number, elementId?: string | number) => {
      const animation = currentAnimation.value;
      if (!animation || index < 0 || index >= animation.frames.length - 1) return;
      animation.actions = animation.actions.filter(
        (a) => a.startFrame !== index || (elementId !== undefined && a.animationElementId !== elementId)
      );
      animation.frames[index + 1].elements.forEach((to) => {
        if (elementId !== undefined && to.id !== elementId) return;
        const from = animation.getElementInFrame(to.id, index);
        if (from && (from.x !== to.x || from.y !== to.y))
          animation.actions.push(new AnimationAction(to.id, index, getDefaultControlPoint(from.x, from.y, to.x, to.y)));
      });
    };
    const updateElementPosition = (id: string | number, x?: number, y?: number) => {
      if (!canEdit.value) return;
      const point = currentAnimation.value?.frames[currentFrameIndex.value]?.elements.find((el) => el.id === id);
      if (!point) return;
      point.x = x ?? point.x;
      point.y = y ?? point.y;
      rebuildTransition(currentFrameIndex.value - 1, id);
      rebuildTransition(currentFrameIndex.value, id);
    };
    const addElement = (item: FieldElement) => {
      if (!currentAnimation.value || !canEdit.value) return;
      currentAnimation.value.addSharedElement(item.id!, item);
      currentAnimation.value.frames[currentFrameIndex.value].elements.push({ id: item.id!, x: item.x, y: item.y });
    };
    const addFrame = () => {
      const animation = currentAnimation.value;
      if (!animation || !canEdit.value || animation.frames.length >= 120) return;
      const index = currentFrameIndex.value + 1;
      const frame = new AnimationFrame(
        index,
        animation.frames[index - 1].elements.map((p) => ({ ...p }))
      );
      Object.assign(frame, { title: `步骤 ${index + 1}`, note: "", duration: 3 });
      animation.actions.forEach((a) => {
        if (a.startFrame >= index - 1) a.startFrame++;
      });
      animation.frames.splice(index, 0, frame);
      reindex();
      switchFrame(index);
    };
    const deleteFrame = (index = currentFrameIndex.value) => {
      const animation = currentAnimation.value;
      if (!animation || animation.frames.length <= 1 || !canEdit.value || index < 0 || index >= animation.frames.length)
        return;
      animation.frames.splice(index, 1);
      animation.actions = animation.actions.filter((a) => a.startFrame !== index && a.startFrame !== index - 1);
      animation.actions.forEach((a) => {
        if (a.startFrame > index) a.startFrame--;
      });
      reindex();
      rebuildTransition(index - 1);
      switchFrame(Math.min(index, animation.frames.length - 1));
    };
    const deleteLastFrame = () => deleteFrame(currentAnimationFrameCount.value - 1);
    const updateFrame = (patch: Partial<Pick<AnimationFrame, "title" | "note" | "duration">>) => {
      if (!canEdit.value) return;
      const frame = currentAnimation.value?.frames[currentFrameIndex.value];
      if (!frame) return;
      if (patch.title !== undefined) frame.title = patch.title.slice(0, 60);
      if (patch.note !== undefined) frame.note = patch.note.slice(0, 1000);
      if (patch.duration !== undefined)
        frame.duration = Number.isFinite(patch.duration) ? Math.max(0.5, Math.min(30, patch.duration)) : 3;
    };
    const getElementAnimationAction = (id: string | number, index: number) =>
      currentAnimation.value?.actions.find((a) => a.animationElementId === id && a.startFrame === index - 1) ?? null;
    const prevFrameElement = (item: FieldElement) =>
      currentAnimation.value?.getElementInFrame(item.id!, currentFrameIndex.value - 1) ?? null;

    // 高频播放进度不进入 Pinia 持久化状态，避免每一帧都触发本地存储。
    return {
      isAnimationMode,
      animations,
      currentAnimation,
      currentAnimationId,
      currentFrameIndex,
      isPlaying,
      frameTime,
      loop,
      showTrails,
      progress: computed(() => progress.value),
      currentAnimationFrameCount,
      currentFrameElements,
      currentFrameElementsIds,
      demoLabels,
      frameStarts,
      totalDuration,
      playhead,
      isAtKeyframe,
      canEdit,
      displayElements,
      transitionPaths,
      haveActionPrevFrameElements,
      openAnimation,
      openAnimationFromBoard,
      loadDemoAnimation,
      exitAnimation,
      getSnapshot,
      loadSnapshot,
      switchFrame,
      seek,
      playNextFrame,
      startAutoPlay,
      stopAutoPlay,
      togglePlayback,
      addFrame,
      deleteFrame,
      deleteLastFrame,
      updateFrame,
      updateElementPosition,
      addElement,
      getElementAnimationAction,
      prevFrameElement,
    };
  },
  {
    persist: {
      pick: ["currentAnimation", "frameTime", "loop", "showTrails"],
      serializer: {
        serialize: JSON.stringify,
        deserialize: (value) => {
          const data = JSON.parse(value);
          return { ...data, currentAnimation: data.currentAnimation ?? data.animations?.[data.animations.length - 1] };
        },
      },
      afterHydrate: ({ store }) => {
        const data = store.currentAnimation ?? store.animations?.[store.animations.length - 1];
        store.loadSnapshot(data);
        if (![1.5, 3, 6].includes(store.frameTime)) store.frameTime = 3;
      },
    },
  }
);
