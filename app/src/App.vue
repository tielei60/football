<template>
  <div class="wrapper" :class="[`device-${deviceType}`, `orientation-${orientation}`]">
    <Debug v-if="isDev && showDebug" />
    <RouterView v-if="desk.ready" />
    <main v-else class="coaching-startup" aria-live="polite">
      <img src="/team-badge.png" alt="柏林花园 FC" width="64" height="64" />
      <h1>教练工作台</h1>
      <p>{{ desk.status === 'loading' ? '正在载入战术与球队名单' : desk.message }}</p>
      <button v-if="desk.status !== 'loading'" @click="desk.initialize">重新连接</button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onMounted, onUnmounted } from "vue";
import { useCoachingDeskStore } from "./stores/coachingDeskStore";
import { useGlobalStore } from "./stores/globalStore";
import Debug from "@/components/common/Debug.vue";

const isDev = import.meta.env.DEV;
const showDebug = new URLSearchParams(window.location.search).has('debug');

const desk = useCoachingDeskStore();
const globalStore = useGlobalStore();
const { orientation, deviceType } = storeToRefs(globalStore);

onMounted(() => {
  void desk.initialize();
  window.addEventListener("resize", globalStore.updateOrientation);
});

onUnmounted(() => {
  window.removeEventListener("resize", globalStore.updateOrientation);
});
</script>

<style lang="scss">
.coaching-startup {
  margin: auto;
  max-width: 440px;
  padding: 24px;
  text-align: center;
  color: #263b36;
  h1 { font-size: 24px; }
  p { font-size: 14px; line-height: 1.6; }
  button { background: #247354; color: white; border: 0; border-radius: 4px; padding: 10px 18px; cursor: pointer; }
}
.wrapper {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  position: relative;

  .header {
    position: relative;
    height: 50px;
    line-height: 50px;
    color: #ffffff;
    padding: 0 25px;
    background-color: #738554;
  }

  .board {
    display: flex;
    flex-direction: column;
    background-color: transparent;
    position: relative;
    margin: auto;
    width: min(96%, 1600px);
    user-select: none;
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    /* 禁用移动端的长按菜单 */
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
  }
}
.device-mobile {
  .board {
    width: 80%;
  }
}
.orientation-portrait {
  .board {
    width: 100%;
  }
}

.device-mobile.orientation-landscape {
  .board {
    width: 65%;
  }
}
</style>
