<template>
  <div class="changelog-page">
    <!-- Navigation Header -->
    <Header :show-full-menu="false" />

    <div class="changelog-header">
      <h1 class="changelog-title">更新记录</h1>
    </div>
    <div class="changelog-container">
      <div class="changelog-content">
        <div class="version-item" v-for="version in versions" :key="version.version">
          <div class="version-header">
            <div class="version-info">
              <h2 class="version-number">{{ version.version }}</h2>
              <span class="version-date">{{ version.date }}</span>
            </div>
          </div>

          <div class="version-content">
            <div class="changes-section" v-for="(changes, category) in version.changes" :key="category">
              <h3 class="changes-title">
                {{ getCategoryIcon(category)
                }}{{ version.customTitles ? version.customTitles : getCategoryText(category) }}
              </h3>
              <ul class="changes-list">
                <li v-for="change in changes" :key="change" class="change-item">{{ change }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import Header from "@/components/common/Header.vue";
import Footer from "@/components/common/Footer.vue";

import { versions } from "@/data/versions";

const getCategoryIcon = (category: string) => {
  const iconMap: Record<string, string> = {
    new: "✨",
    improved: "🚀",
    fixed: "🐛",
    removed: "🗑️",
  };
  return iconMap[category] || "📝";
};

const getCategoryText = (category: string) => {
  const textMap: Record<string, string> = {
    new: "新增功能",
    improved: "功能优化",
    fixed: "问题修复",
    removed: "移除功能",
  };
  return textMap[category] || category;
};
</script>

<style scoped>
.changelog-page {
  width: 100%;
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
}
.changelog-header {
  max-width: 980px;
  margin: 50px auto 30px;
  padding: 0 24px;
}
.changelog-title {
  font-size: clamp(28px, 4vw, 40px);
  letter-spacing: -1px;
}
.changelog-container {
  max-width: 980px;
  margin: auto;
  padding: 0 24px 70px;
}
.changelog-content {
  display: grid;
  gap: 25px;
}
.version-item {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}
.version-header {
  padding: 24px 28px 18px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-brand-soft);
}
.version-info {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.version-number {
  margin: 0;
  font-size: 23px;
  color: var(--color-brand);
}
.version-date {
  font-size: 12px;
  color: var(--color-text-muted);
}
.version-content {
  padding: 24px 28px;
}
.changes-section + .changes-section {
  margin-top: 24px;
}
.changes-title {
  font-size: 15px;
  margin: 0 0 12px;
}
.changes-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.change-item {
  position: relative;
  padding: 10px 0 10px 20px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}
.change-item:last-child {
  border-bottom: 0;
}
.change-item::before {
  content: "·";
  position: absolute;
  left: 2px;
  color: var(--color-brand);
  font-weight: 800;
}
@media (max-width: 600px) {
  .version-header,
  .version-content {
    padding: 20px;
  }
  .changelog-header {
    margin-top: 28px;
  }
}
</style>
