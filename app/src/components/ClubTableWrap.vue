<template>
  <p v-if="overflow" class="club-muted club-scroll-hint">表格还有更多列，请左右滑动或使用方向键查看。</p>
  <div ref="container" class="club-table-wrap" role="region" :aria-label="label" :tabindex="overflow ? 0 : undefined">
    <slot />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, onUpdated, ref } from "vue";

defineProps<{ label: string }>();
const container = ref<HTMLElement | null>(null);
const overflow = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  const element = container.value;
  overflow.value = !!element && element.scrollWidth > element.clientWidth + 1;
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (container.value) {
    observer.observe(container.value);
    const table = container.value.querySelector("table");
    if (table) observer.observe(table);
  }
  measure();
});
onUpdated(measure);
onUnmounted(() => observer?.disconnect());
</script>
