<!-- 8 人制足球场（横向攻防：自家球门在左，对方球门在右），与 11 人制共用 1250x826 坐标系。
  真实 8 人制约 60x40m，攻防纵深为长轴，铺满横向画布。
  外框与 FootballField.vue 保持一致（x 68..1183, y 62..763），拖拽/边界/截图逻辑零改动。 -->
<template>
  <g id="board-area">
    <g>
      <defs>
        <linearGradient id="eight-grass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#93b49a" />
          <stop offset="0.5" stop-color="#88ad92" />
          <stop offset="1" stop-color="#81a78c" />
        </linearGradient>
        <radialGradient id="eight-vignette" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.7" stop-color="#000000" stop-opacity="0" />
          <stop offset="1" stop-color="#000000" stop-opacity="0.2" />
        </radialGradient>
      </defs>
      <!-- 外围 -->
      <path d="M1250 0H0V826H1250V0Z" :fill="C.apron" />
      <!-- 草皮底 -->
      <rect :x="P.x" :y="P.y" :width="P.w" :height="P.h" fill="url(#eight-grass)" />
      <!-- 草皮条纹（横条，沿攻防方向） -->
      <rect
        v-for="(s, i) in stripes"
        :key="i"
        :x="P.x"
        :width="P.w"
        :y="s.y"
        :height="s.h"
        fill="#ffffff"
        :opacity="i % 2 === 0 ? 0.06 : 0"
      />
      <!-- 边线 -->
      <rect :x="P.x" :y="P.y" :width="P.w" :height="P.h" fill="none" stroke="white" :stroke-width="LW" />
      <!-- 中线 -->
      <line :x1="midX" :y1="P.y" :x2="midX" :y2="P.y + P.h" stroke="white" :stroke-width="LW" />
      <!-- 中圈 + 中点 -->
      <circle :cx="midX" :cy="midY" :r="R.center" fill="none" stroke="white" :stroke-width="LW" />
      <circle :cx="midX" :cy="midY" :r="5" fill="white" />
      <!-- 左禁区 / 小禁区（自家） -->
      <rect :x="P.x" :y="midY - R.boxW / 2" :width="R.boxD" :height="R.boxW" fill="none" stroke="white" :stroke-width="LW" />
      <rect
        :x="P.x"
        :y="midY - R.goalBoxW / 2"
        :width="R.goalBoxD"
        :height="R.goalBoxW"
        fill="none"
        stroke="white"
        :stroke-width="LW"
      />
      <!-- 右禁区 / 小禁区（对方） -->
      <rect
        :x="P.x + P.w - R.boxD"
        :y="midY - R.boxW / 2"
        :width="R.boxD"
        :height="R.boxW"
        fill="none"
        stroke="white"
        :stroke-width="LW"
      />
      <rect
        :x="P.x + P.w - R.goalBoxD"
        :y="midY - R.goalBoxW / 2"
        :width="R.goalBoxD"
        :height="R.goalBoxW"
        fill="none"
        stroke="white"
        :stroke-width="LW"
      />
      <!-- 点球点 -->
      <circle :cx="P.x + R.spot" :cy="midY" r="5" fill="white" />
      <circle :cx="P.x + P.w - R.spot" :cy="midY" r="5" fill="white" />
      <!-- 点球弧（弧顶朝外，背向球门） -->
      <path :d="arcLeft" fill="none" stroke="white" :stroke-width="LW" />
      <path :d="arcRight" fill="none" stroke="white" :stroke-width="LW" />
      <!-- 角球弧 -->
      <path :d="cornerTL" fill="none" stroke="white" :stroke-width="LW" />
      <path :d="cornerTR" fill="none" stroke="white" :stroke-width="LW" />
      <path :d="cornerBL" fill="none" stroke="white" :stroke-width="LW" />
      <path :d="cornerBR" fill="none" stroke="white" :stroke-width="LW" />
      <!-- 球门（框外） -->
      <rect
        :x="P.x - R.goalD"
        :y="midY - R.goalW / 2"
        :width="R.goalD"
        :height="R.goalW"
        fill="none"
        stroke="white"
        :stroke-width="LW"
      />
      <rect
        :x="P.x + P.w"
        :y="midY - R.goalW / 2"
        :width="R.goalD"
        :height="R.goalW"
        fill="none"
        stroke="white"
        :stroke-width="LW"
      />
      <!-- 暗角 -->
      <rect :x="P.x" :y="P.y" :width="P.w" :height="P.h" fill="url(#eight-vignette)" pointer-events="none" />
    </g>
    <slot name="watermark"></slot>
    <slot></slot>
  </g>
</template>

<script setup lang="ts">
import { computed } from "vue";

// 外框与 11 人制一致，保证 boardStore 边界/截图逻辑不变
const P = { x: 68, y: 62, w: 1115, h: 701 };
const LW = 3;
// 8 人制标记尺寸（按 viewBox 等比，攻防方向为横向长轴）
const R = {
  center: 90,
  boxD: 170, // 禁区深度（横向）
  boxW: 400, // 禁区宽度（纵向）
  goalBoxD: 60,
  goalBoxW: 220,
  spot: 120, // 点球点距门线
  arc: 80,
  corner: 16,
  goalW: 120,
  goalD: 16,
};
const C = { apron: "#e5ebe7" };

const midX = P.x + P.w / 2;
const midY = P.y + P.h / 2;

// 12 条横向草皮条纹
const stripes = computed(() => {
  const n = 12;
  const h = P.h / n;
  return Array.from({ length: n }, (_, i) => ({ y: P.y + i * h, h }));
});

// 左禁区弧：圆心在点球点，弧顶朝右（背向自家球门）
const arcLeft = computed(() => {
  const cx = P.x + R.spot;
  const edgeX = P.x + R.boxD;
  const dx = edgeX - cx;
  const dy = Math.sqrt(R.arc * R.arc - dx * dx);
  return `M ${edgeX} ${midY - dy} A ${R.arc} ${R.arc} 0 0 1 ${edgeX} ${midY + dy}`;
});
// 右禁区弧：弧顶朝左
const arcRight = computed(() => {
  const cx = P.x + P.w - R.spot;
  const edgeX = P.x + P.w - R.boxD;
  const dx = cx - edgeX;
  const dy = Math.sqrt(R.arc * R.arc - dx * dx);
  return `M ${edgeX} ${midY - dy} A ${R.arc} ${R.arc} 0 0 0 ${edgeX} ${midY + dy}`;
});

const cornerTL = `M ${P.x + R.corner} ${P.y} A ${R.corner} ${R.corner} 0 0 1 ${P.x} ${P.y + R.corner}`;
const cornerTR = `M ${P.x + P.w} ${P.y + R.corner} A ${R.corner} ${R.corner} 0 0 1 ${P.x + P.w - R.corner} ${P.y}`;
const cornerBR = `M ${P.x + P.w - R.corner} ${P.y + P.h} A ${R.corner} ${R.corner} 0 0 1 ${P.x + P.w} ${P.y + P.h - R.corner}`;
const cornerBL = `M ${P.x} ${P.y + P.h - R.corner} A ${R.corner} ${R.corner} 0 0 1 ${P.x + R.corner} ${P.y + P.h}`;
</script>
