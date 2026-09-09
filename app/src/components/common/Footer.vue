<template>
  <footer class="footer">
    <img src="/team-badge.png" class="footer-badge" alt="" @error="hideBadge" />
    <span>柏林花园 FC · 8人制战术板 — 数据仅存于本机浏览器</span>
  </footer>
</template>

<script setup lang="ts">
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
  opacity: 0.65;
  color: var(--paper, #f8faf5);
}

.footer-badge {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
</style>
