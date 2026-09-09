<template>
  <g ref="container" v-if="drawing.drawingType !== 'text'"></g>
  <g
    v-else
    @dblclick="startEdit"
    class="text-drawing"
    :transform="portrait ? `rotate(90 ${drawing.startX} ${drawing.startY})` : undefined"
  >
    <text
      v-if="!editing"
      :x="drawing.startX"
      :y="drawing.startY"
      :fill="drawing.strokeColor"
      :font-size="fontSize"
      font-weight="700"
    >
      {{ drawing.text }}
    </text>
    <foreignObject v-else :x="drawing.startX" :y="drawing.startY - fontSize" width="220" :height="fontSize + 16">
      <input
        ref="inputRef"
        v-model="draft"
        class="text-input"
        :style="{ fontSize: fontSize + 'px' }"
        @keydown.enter="commit"
        @blur="commit"
        @pointerdown.stop
      />
    </foreignObject>
  </g>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import rough from "roughjs";
import type { Drawing } from "@/types/drawing";
import { renderShape, textFontSize } from "@/utils/drawing";
import { useHistory } from "@/composables/useHistory";

const props = defineProps<{
  portrait?: boolean;
  drawing: Drawing;
}>();

const container = ref<any>(null);
const { pushHistory } = useHistory();

const drawShape = () => {
  if (props.drawing.drawingType === "text") return;
  if (!container.value) return;

  // 清除现有内容
  container.value.innerHTML = "";

  const rc = rough.svg(container.value);

  const renderRoughDrawingVriable = {
    startX: props.drawing.startX,
    startY: props.drawing.startY,
    endX: props.drawing.endX,
    endY: props.drawing.endY,
    pathPoints: props.drawing.pathPoints,
  };

  const styleConfig = {
    strokeColor: props.drawing.strokeColor || "",
    backgroundColor: props.drawing.backgroundColor || "",
    size: props.drawing.size,
    dashed: props.drawing.dashed,
  };

  const roughElement = renderShape(rc, props.drawing.drawingType, renderRoughDrawingVriable, styleConfig);

  if (roughElement) {
    container.value.appendChild(roughElement);
  }
};

// ---- 文字标注：双击原地编辑 ----
const editing = ref(false);
const draft = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const fontSize = computed(() => textFontSize({ strokeColor: "", backgroundColor: "", size: props.drawing.size }));

const startEdit = () => {
  draft.value = props.drawing.text || "";
  editing.value = true;
  nextTick(() => inputRef.value?.focus());
};

const commit = () => {
  if (!editing.value) return;
  editing.value = false;
  const value = draft.value.trim();
  if (value && value !== props.drawing.text) {
    pushHistory();
    props.drawing.text = value;
  }
};

onMounted(drawShape);

watch(() => props.drawing, drawShape, { deep: true });
</script>

<style scoped>
.text-drawing {
  cursor: text;
}
.text-input {
  width: 100%;
  border: 2px solid #15803d;
  border-radius: 6px;
  padding: 2px 8px;
  outline: none;
  background: #fff;
  font-weight: 700;
}
</style>
