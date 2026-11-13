<template>
  <div class="landing-page">
    <Header />
    <div id="showcase" class="showcase-section">
      <div class="showcase-container">
        <img :src="teamBadge" class="hero-badge" :alt="`${teamName}队徽`" @error="hideBadge" />
        <h1 class="title">{{ teamName }} · 足球俱乐部</h1>
        <p class="showcase-subtitle">球员、比赛、赛季与战术，一起为每一次上场做准备</p>
        <div class="hero-ctas">
          <router-link to="/club" class="start-button">
            进入俱乐部
            <span aria-hidden="true">↗</span>
          </router-link>
          <span class="hero-note">球队账号登录 · SQLite 持久化 · 球员报名与比赛统计</span>
        </div>
        <div class="showcase-image">
          <img :src="teamBadge" :alt="`${teamName}队徽`" />
        </div>
      </div>
    </div>
    <div id="features" class="features-section">
      <div class="feature-card">
        <Users class="feature-icon" :size="30" />
        <h3>比赛与报名</h3>
        <p>发布赛程，收集参赛意愿，独立确认实际出场与赛后数据</p>
      </div>
      <div class="feature-card">
        <ClipboardList class="feature-icon" :size="30" />
        <h3>人员与名单</h3>
        <p>维护球员资料、赛季名单与号码，保留比赛时的历史快照</p>
      </div>
      <div class="feature-card">
        <LibraryBig class="feature-icon" :size="30" />
        <h3>战术库</h3>
        <p>阵型、绘图与跑位动画，保存版本，按比赛保留战术快照</p>
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
          <p>
            球队资料、比赛和战术保存在部署服务器的 SQLite 数据库中。登录后按账号权限访问，请由管理员定期备份数据库。
          </p>
        </div>
        <div class="faq-item">
          <h3>没网能用吗？</h3>
          <p>登录、载入和保存资料需要连接服务器。请保持网络连接，并确认保存成功后再关闭页面。</p>
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
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const { teamName, teamBadge } = useTeamIdentity();

const hideBadge = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};
</script>

<style scoped>
.landing-page {
  width: 100%;
  min-height: 100vh;
  background: var(--color-bg);
  color: var(--color-text);
  overflow-x: hidden;
}
.showcase-section {
  margin: 4rem 0 2rem;
}
.showcase-container {
  max-width: 1080px;
  padding: 0 28px;
  margin: auto;
  text-align: center;
}
.hero-badge {
  width: 86px;
  height: 86px;
  object-fit: contain;
  padding: 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.title {
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1.25;
  font-weight: 800;
  margin: 24px 0 18px;
  letter-spacing: -1px;
  overflow-wrap: anywhere;
}
.showcase-subtitle {
  color: var(--color-text-muted);
  font-size: 16px;
  line-height: 1.8;
  margin: 0 auto 26px;
  max-width: 650px;
}
.hero-ctas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
}
.start-button {
  display: inline-flex;
  gap: 26px;
  align-items: center;
  padding: 13px 26px;
  background: var(--color-brand);
  color: var(--color-on-brand);
  border-radius: 4px;
  font-size: 15px;
  text-decoration: none;
  font-weight: 650;
}
.start-button:hover {
  background: var(--color-brand-hover);
}
.start-button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 4px;
}
.hero-note {
  color: var(--color-text-muted);
  font-size: 12px;
}
.showcase-image {
  margin: 42px auto;
  max-width: 600px;
  padding: 36px;
  border: 1px solid var(--color-border);
  background: var(--color-brand-soft);
  border-radius: 6px;
}
.showcase-image img {
  display: block;
  width: 160px;
  height: 160px;
  object-fit: contain;
  margin: auto;
}
.features-section {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  max-width: 1200px;
  padding: 0 28px;
  margin: 56px auto;
  gap: 20px;
}
.feature-card {
  border-top: 2px solid var(--color-brand);
  background: var(--color-surface);
  padding: 24px;
}
.feature-icon {
  color: var(--color-brand);
  margin-bottom: 18px;
}
.feature-card h3,
.faq-item h3 {
  font-size: 17px;
  margin: 0 0 12px;
}
.feature-card p,
.faq-item p {
  font-size: 13px;
  line-height: 1.85;
  color: var(--color-text-muted);
}
.faq-section {
  max-width: 1200px;
  padding: 0 28px;
  margin: 60px auto;
}
.faq-title {
  font-size: 25px;
  margin-bottom: 28px;
}
.faq-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
}
.faq-item {
  padding-top: 22px;
  border-top: 1px solid var(--color-border-strong);
}
@media (max-width: 900px) {
  .features-section {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .features-section,
  .faq-grid {
    grid-template-columns: 1fr;
  }
  .showcase-container,
  .features-section,
  .faq-section {
    padding-inline: 20px;
  }
  .showcase-section {
    margin-top: 2rem;
  }
}
</style>
