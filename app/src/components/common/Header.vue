<template>
  <header class="navbar">
    <div class="nav-container">
      <div class="nav-logo">
        <img :src="teamBadge" class="logo-badge" alt="" @error="hideBadge" />
        <span class="logo-text">{{ teamName }} · 战术板</span>
      </div>
      <nav
        id="public-navigation"
        class="nav-menu"
        aria-label="网站导航"
        :class="{ active: mobileMenuOpen }"
        @keydown.esc="mobileMenuOpen = false"
      >
        <template v-if="showFullMenu">
          <a href="#home" class="nav-link" @click="scrollToSection('home')">首页</a>
          <!-- <a href="#features" class="nav-link" @click="scrollToSection('features')">功能</a>
          <a href="#showcase" class="nav-link" @click="scrollToSection('showcase')">演示</a> -->
          <!-- <a href="#faq" class="nav-link" @click="scrollToSection('faq')">常见问题</a> -->
          <router-link :to="{ name: 'changelog' }" class="nav-link">更新记录</router-link>
        </template>
        <template v-else>
          <router-link :to="{ name: 'home' }" class="nav-link">返回首页</router-link>
        </template>
        <router-link :to="{ name: 'board' }" target="_blank" class="nav-cta">进入战术板</router-link>
      </nav>
      <button
        type="button"
        class="hamburger"
        :class="{ active: mobileMenuOpen }"
        :aria-label="mobileMenuOpen ? '关闭导航' : '打开导航'"
        :aria-expanded="mobileMenuOpen"
        aria-controls="public-navigation"
        @click="toggleMobileMenu"
      >
        <span></span>
        <span></span>
        <span></span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, defineProps } from "vue";
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const { teamName, teamBadge } = useTeamIdentity();

interface Props {
  showFullMenu?: boolean;
}

const { showFullMenu = true } = defineProps<Props>();

const mobileMenuOpen = ref(false);

const hideBadge = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};

const toggleMobileMenu = () => {
  mobileMenuOpen.value = !mobileMenuOpen.value;
};

const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(sectionId);
  if (element) {
    const headerOffset = 80;
    const elementPosition = element.offsetTop;
    const offsetPosition = elementPosition - headerOffset;

    window.scrollTo({
      top: offsetPosition,
      behavior: "smooth",
    });
  }
  mobileMenuOpen.value = false;
};
</script>

<style scoped>
/* Navigation Header */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--color-surface);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-border);
  padding: 0.8rem 0;
  transition: all 0.3s ease;
}

.nav-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  font-size: 1.25rem;
  color: var(--color-text);
}

.logo-icon {
  font-size: 1.5rem;
}

.logo-badge {
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.nav-menu {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.nav-link {
  color: var(--color-text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: all 0.3s ease;
  position: relative;
  padding: 0.5rem 0;
}

.nav-link:hover {
  color: var(--color-text);
  transform: translateY(-2px);
}

.nav-link::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 2px;
  background: var(--color-brand);
  transition: width 0.3s ease;
}

.nav-link:hover::after {
  width: 100%;
}

.nav-cta {
  padding: 0.6rem 1.4rem;
  border-radius: 2rem;
  text-decoration: none;
  font-weight: 700;
  transition: all 0.3s ease;
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.nav-cta:hover {
  transform: translateY(-2px);
  background: var(--color-brand);
}

.hamburger {
  border: 0;
  padding: 10px;
  background: transparent;
  display: none;
  flex-direction: column;
  cursor: pointer;
  gap: 4px;
}

.hamburger span {
  width: 25px;
  height: 3px;
  background: var(--color-brand);
  border-radius: 3px;
  transition: all 0.3s ease;
}

.hamburger.active span:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}

.hamburger.active span:nth-child(2) {
  opacity: 0;
}

.hamburger.active span:nth-child(3) {
  transform: rotate(-45deg) translate(7px, -6px);
}

/* Mobile Responsive */
@media (max-width: 768px) {
  .nav-container {
    padding: 0 1rem;
  }

  .hamburger {
    border: 0;
    padding: 10px;
    background: transparent;
    display: flex;
    z-index: 1001;
  }

  .nav-menu {
    position: fixed;
    top: 0;
    left: -100%;
    bottom: 0;
    width: 280px;
    background: var(--color-surface);
    backdrop-filter: blur(20px);
    flex-direction: column;
    padding: 6rem 2rem 2rem;
    gap: 2rem;
    transform: translateX(0);
    transition: left 0.3s ease;
    border-right: 1px solid var(--color-border);
    box-shadow: var(--shadow-lg);
  }

  .nav-menu:not(.active) {
    visibility: hidden;
  }

  .nav-menu.active {
    visibility: visible;
    left: 0;
  }

  .nav-link {
    font-size: 1.2rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--color-border);
  }
}

@media (max-width: 480px) {
  .nav-container {
    padding: 0 1rem;
  }

  .nav-menu {
    padding: 6rem 1.5rem 1.5rem;
    width: 260px;
  }
}
</style>
