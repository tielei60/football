<template>
  <div class="landing-page">
    <Header />
    <div id="showcase" class="showcase-section">
      <div class="showcase-container">
        <img src="/team-badge.png" class="hero-badge" alt="柏林花园FC队徽" @error="hideBadge" />
        <h1 class="title">柏林花园 FC · 8人制战术板</h1>
        <p class="showcase-subtitle">一键阵型 · 点名布阵 · 战术库与历史版本 · 投屏演示，为每一场比赛做准备</p>
        <div class="hero-ctas">
          <router-link :to="{ name: 'board' }" class="start-button">进入战术板</router-link>
          <span class="hero-note">本地运行 · 数据不出浏览器 · 可安装到平板离线使用</span>
        </div>
        <div class="showcase-image">
          <img src="/case-2.png" alt="战术板界面展示" />
        </div>
      </div>
    </div>
    <div id="features" class="features-section">
      <div class="feature-card">
        <Users class="feature-icon" :size="30" />
        <h3>8人制阵型</h3>
        <p>2-3-2 等 5 套常规 + 角球任意球定位球，一键落位，主客对抗同屏</p>
      </div>
      <div class="feature-card">
        <ClipboardList class="feature-icon" :size="30" />
        <h3>人员与名单</h3>
        <p>20 人照片名单，点名上下场，号码位置备注可改</p>
      </div>
      <div class="feature-card">
        <LibraryBig class="feature-icon" :size="30" />
        <h3>战术库</h3>
        <p>保存即版本，搜索标签收藏，缩略图 3 秒找回历史战术</p>
      </div>
      <div class="feature-card">
        <Presentation class="feature-icon" :size="30" />
        <h3>投屏与导出</h3>
        <p>全屏演示翻页，高清 PNG / SVG / JSON 导出，可打印训练单</p>
      </div>
    </div>

    <div class="faq-section" id="faq">
      <h2 class="faq-title">常见问题</h2>
      <div class="faq-grid">
        <div class="faq-item">
          <h3>如何开始布置战术？</h3>
          <p>进入战术板，点阵型一键落位，再从左侧名单点名上场，拖一拖、画两笔即可保存。</p>
        </div>
        <div class="faq-item">
          <h3>数据存在哪里？</h3>
          <p>全部存在本机浏览器（IndexedDB），不注册不上传；JSON 导出可分享给助教导入。</p>
        </div>
        <div class="faq-item">
          <h3>没网能用吗？</h3>
          <p>可以。安装为应用后离线打开，历史战术与名单都在。</p>
        </div>
      </div>
    </div>

    <Footer />
  </div>
</template>

<script setup lang="ts">
import Header from "@/components/common/Header.vue";
import Footer from "@/components/common/Footer.vue";
import { Users, ClipboardList, LibraryBig, Presentation } from "lucide-vue-next";

const hideBadge = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};
</script>

<style scoped>
.landing-page {
  height: 100%;
  background:
    radial-gradient(1000px 600px at 50% -10%, #14532d 0%, transparent 60%),
    linear-gradient(180deg, #0b2a1d 0%, #071c13 100%);
  color: var(--paper, #f8faf5);
  width: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0;
  min-height: 100vh;
  max-width: 100vw;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
}

.hero-section,
.features-section,
.faq-section {
  padding-left: 2rem;
  padding-right: 2rem;
}

.hero-section,
.features-section,
.faq-section {
  flex: 1;
}

.title {
  font-size: 3rem;
  margin: 1rem 0;
  font-weight: 800;
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.hero-badge {
  width: 120px;
  height: 120px;
  object-fit: contain;
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.4));
}

.hero-ctas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 4rem;
}

.start-button {
  display: inline-block;
  padding: 1rem 3rem;
  font-size: 1.2rem;
  font-weight: 800;
  background: var(--accent, #b4ff39);
  color: var(--pitch-900, #0b2a1d);
  border-radius: 3rem;
  text-decoration: none;
  transition: all 0.25s;
  box-shadow: 0 10px 30px rgba(180, 255, 57, 0.25);
  border: none;
  cursor: pointer;
}

.start-button:hover {
  transform: translateY(-3px);
  box-shadow: 0 15px 40px rgba(180, 255, 57, 0.35);
  background: #c9ff6b;
}

.hero-note {
  font-size: 0.85rem;
  opacity: 0.65;
}

.features-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.5rem;
  max-width: 1200px;
  margin: 4rem auto;
  padding: 0 2rem;
}

.feature-card {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(24px);
  padding: 2rem 1.5rem;
  border-radius: 1.25rem;
  text-align: center;
  transition: all 0.25s;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
}

.feature-card:hover {
  transform: translateY(-6px);
  border-color: rgba(180, 255, 57, 0.4);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.3);
}

.feature-icon {
  color: var(--accent, #b4ff39);
  margin-bottom: 1rem;
}

.feature-card h3 {
  font-size: 1.25rem;
  margin-bottom: 0.6rem;
  font-weight: 700;
}

.feature-card p {
  opacity: 0.85;
  line-height: 1.6;
  font-size: 0.95rem;
}

.faq-section {
  max-width: 1200px;
  margin: 3rem auto;
  padding: 0 2rem;
}

.faq-title {
  text-align: center;
  font-size: 2rem;
  margin-bottom: 2rem;
}

.faq-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
}

.faq-item {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(24px);
  padding: 1.75rem;
  border-radius: 1.25rem;
  transition: all 0.25s;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.faq-item:hover {
  transform: translateY(-4px);
  border-color: rgba(180, 255, 57, 0.35);
}

.faq-item h3 {
  font-size: 1.1rem;
  margin-bottom: 0.75rem;
  font-weight: 700;
  color: var(--accent, #b4ff39);
}

.faq-item p {
  opacity: 0.85;
  line-height: 1.6;
  font-size: 0.95rem;
}

/* Showcase Section */
.showcase-section {
  margin: 7rem 0 2rem;
}

.showcase-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  text-align: center;
}

.showcase-subtitle {
  font-size: 1.15rem;
  margin-bottom: 2rem;
  opacity: 0.85;
  max-width: 640px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.6;
}

.showcase-image {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px);
  border-radius: 1.5rem;
  padding: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.showcase-image img {
  width: 100%;
  height: auto;
  border-radius: 0.75rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .showcase-section {
    margin: 6rem 0 1rem;
  }

  .title {
    font-size: 2rem;
  }

  .showcase-subtitle {
    font-size: 1rem;
  }

  .showcase-image {
    padding: 0.8rem;
  }

  .features-section {
    grid-template-columns: repeat(2, 1fr);
  }

  .faq-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .features-section {
    margin: 3rem auto;
    grid-template-columns: 1fr;
    padding: 0 1rem;
  }

  .faq-section {
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .title {
    font-size: 1.75rem;
  }

  .start-button {
    font-size: 1rem;
    padding: 0.8rem 2rem;
  }

  .showcase-container {
    padding: 0 1rem;
  }
}
</style>
