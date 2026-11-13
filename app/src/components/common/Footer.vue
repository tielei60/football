<template>
  <footer class="footer">
    <img :src="teamBadge" class="footer-badge" alt="" @error="hideBadge" />
    <span>{{ teamName }} · 战术板 — 数据保存在球队服务</span>
  </footer>
</template>

<script setup lang="ts">
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const { teamName, teamBadge } = useTeamIdentity();

const hideBadge = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};
</script>

<style scoped>
.footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 1.5rem 1rem 2rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg);
}

.footer-badge {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
</style>
