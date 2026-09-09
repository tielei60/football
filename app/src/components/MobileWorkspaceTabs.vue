<script setup lang="ts">
import { Users, Pencil, Film, ChevronDown } from "lucide-vue-next";
export type WorkspaceTab = "roster" | "drawing" | "animation";
defineProps<{ active: WorkspaceTab; open: boolean }>();
const emit = defineEmits<{ change: [tab: WorkspaceTab]; close: [] }>();
const tabs = [
  { id: "roster" as const, label: "阵容", icon: Users },
  { id: "drawing" as const, label: "绘图", icon: Pencil },
  { id: "animation" as const, label: "动画", icon: Film },
];
</script>

<template>
  <div v-if="open" class="mobile-panel-heading">
    <span>{{ tabs.find((tab) => tab.id === active)?.label }}</span>
    <button class="panel-close" aria-label="收起操作面板" title="收起操作面板" @click="emit('close')">
      <ChevronDown :size="22" aria-hidden="true" />
    </button>
  </div>
  <nav class="mobile-workspace-tabs" aria-label="操作分区">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      :aria-pressed="open && active === tab.id"
      :aria-expanded="open && active === tab.id"
      :aria-controls="`mobile-${tab.id}-panel`"
      :class="{ active: open && active === tab.id }"
      @click="emit('change', tab.id)"
    >
      <component :is="tab.icon" :size="18" aria-hidden="true" />
      {{ tab.label }}
    </button>
  </nav>
</template>

<style scoped>
.mobile-workspace-tabs {
  display: flex;
  background: var(--surface);
  border-block: 1px solid var(--line);
}
.mobile-workspace-tabs button {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 46px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--muted);
  font-size: 14px;
}
.mobile-workspace-tabs button.active {
  color: var(--pitch-700);
  background: var(--green-soft);
  border-bottom-color: var(--pitch-700);
  font-weight: 600;
}
.mobile-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 16px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  border-radius: 8px 8px 0 0;
  box-shadow: 0 -6px 20px #202b2914;
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
}
.panel-close {
  display: grid;
  place-items: center;
  width: 48px;
  height: 44px;
  border: 0;
  color: var(--muted);
  background: transparent;
}
.panel-close:hover,
.mobile-workspace-tabs button:active {
  background: var(--green-soft);
}
</style>
