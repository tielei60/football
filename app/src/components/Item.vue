<!-- eslint-disable vue/no-mutating-props -->
<template>
  <g :id="`item-${item.id}`" ref="itemRef" :transform="itemTransform">
    <g v-if="item.elementType === 'player'">
      <g
        @pointerdown="handlePointerDown"
        @contextmenu.prevent
        role="button"
        :tabindex="!animationStore.isAnimationMode && !globalStore.presenting ? 0 : -1"
        :aria-label="`${item.text || '自由球员'}，号码${item.number ?? '未知'}，打开棋子详情`"
        @keydown.enter.stop.prevent="handleKeyboardOpen"
        @keydown.space.stop.prevent="handleKeyboardOpen"
      >
        <title>
          {{ item.text || "自由球员" }} · {{ item.number ?? "号码未知" }} · 档案位置：{{
            rosterPlayer?.positions?.join("、") || "未关联档案"
          }}
          · 战术职责：{{ posLabel(item.playerPosition) }}
        </title>
        <!-- 名称（教练栏开关控制） -->
        <text v-if="showNames" :x="namePosition.x" :y="namePosition.y" text-anchor="middle" class="player-name">
          {{ shortLabel(item.text, 8) }}
        </text>
        <!-- 位置（教练栏开关控制） -->
        <text
          v-if="
            showPositions &&
            (!animationStore.isAnimationMode ||
              (animationStore.canEdit && item.team !== 'away' && !globalStore.presenting))
          "
          :x="itemPosition.x"
          :y="itemPosition.y + item.r + 23"
          text-anchor="middle"
          class="player-position"
        >
          {{ shortLabel(displayedPosition, 9) }}
        </text>

        <defs>
          <clipPath :id="`avatar-clip-${item.id}`">
            <circle :cx="itemPosition.x" :cy="itemPosition.y" :r="item.r - 2" />
          </clipPath>
        </defs>

        <!-- 底色圆（无照片时的 fallback，也是职责色） -->
        <circle
          ref="circleRef"
          :cx="itemPosition.x"
          :cy="itemPosition.y"
          :r="item.r"
          :fill="item.color"
          :stroke="itemStore.numberColor(item)"
          stroke-width="4"
        ></circle>

        <!-- 有照片：圆形裁切铺满 -->
        <image
          v-if="rosterAvatar && avatarOk"
          :href="rosterAvatar"
          :x="itemPosition.x - item.r"
          :y="itemPosition.y - item.r"
          :width="item.r * 2"
          :height="item.r * 2"
          :clip-path="`url(#avatar-clip-${item.id})`"
          preserveAspectRatio="xMidYMid slice"
          pointer-events="none"
          @error="avatarOk = false"
        />
        <!-- 职责色描边环（照片模式也保留） -->
        <circle
          v-if="rosterAvatar && avatarOk"
          :cx="itemPosition.x"
          :cy="itemPosition.y"
          :r="item.r"
          fill="none"
          :stroke="item.color"
          stroke-width="4"
          pointer-events="none"
        />

        <!-- 无照片：号码居中 -->
        <text
          v-if="!(rosterAvatar && avatarOk)"
          :x="itemPosition.x"
          :y="itemPosition.y"
          text-anchor="middle"
          dominant-baseline="central"
          class="player-number"
          :style="{ fill: itemStore.numberColor(item) }"
          pointer-events="none"
        >
          {{ item.number }}
        </text>
        <!-- 有照片：号码角标 -->
        <g v-else pointer-events="none">
          <circle
            :cx="itemPosition.x + item.r * 0.7"
            :cy="itemPosition.y + item.r * 0.7"
            r="11"
            fill="#101828"
            stroke="#fff"
            stroke-width="2"
          />
          <text
            :x="itemPosition.x + item.r * 0.7"
            :y="itemPosition.y + item.r * 0.7"
            text-anchor="middle"
            dominant-baseline="central"
            class="number-badge"
          >
            {{ item.number }}
          </text>
        </g>
      </g>

      <!-- 弹窗 -->
      <foreignObject class="popup" ref="popupRef" :x="popupX" :y="popupY" width="220" height="400" v-if="showPopup">
        <div xmlns="http://www.w3.org/1999/xhtml" class="popup-content">
          <div class="popup-body">
            <div class="avatar-preview" v-if="rosterAvatar">
              <img :src="rosterAvatar" alt="" @error="hidePopupAvatar" />
            </div>
            <div class="input-group">
              <label>
                号码
                <input
                  type="number"
                  placeholder="未知"
                  aria-label="棋子号码"
                  min="0"
                  max="9999"
                  step="1"
                  v-model="numberDraft"
                  :aria-invalid="!!numberError"
                  @change="commitNumber"
                />
              </label>
              <span v-if="numberError" role="alert" class="field-error">{{ numberError }}</span>
            </div>
            <div class="input-group">
              <label>
                名称
                <input
                  type="text"
                  placeholder="仅当前棋子，可留空"
                  aria-label="棋子名称"
                  maxlength="200"
                  v-model="nameDraft"
                  :aria-invalid="!!nameError"
                  @change="commitName"
                />
              </label>
              <span v-if="nameError" role="alert" class="field-error">{{ nameError }}</span>
            </div>
            <div class="input-group">
              <span class="role-label">战术职责</span>
              <UiSelect :value="item.playerPosition" aria-label="战术职责" @change="onRoleChange" class="role-select">
                <option v-for="opt in roleOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </UiSelect>
            </div>
            <div class="input-group color">
              <input type="color" :value="item.color" aria-label="棋子颜色" @change="commitColor" @pointerdown.stop />
            </div>
            <p class="edit-scope-note">仅修改当前战术棋子，不修改球员档案。名称可留空。</p>
            <button class="delete-btn" v-if="item.id" @click="handleDelete(item.id)">删除</button>
          </div>
        </div>
      </foreignObject>
    </g>
    <g v-else>
      <!-- 足球 -->
      <!-- 扩大操作热区 -->
      <circle
        ref="circleRef"
        :cx="item.x"
        :cy="item.y"
        :r="ELEMENT_RADIUS_OBJECT.player"
        fill="transparent"
        stroke="transparent"
        role="button"
        :tabindex="!animationStore.isAnimationMode && !globalStore.presenting ? 0 : -1"
        aria-label="足球，打开棋子详情"
        @keydown.enter.stop.prevent="handleKeyboardOpen"
        @keydown.space.stop.prevent="handleKeyboardOpen"
        @pointerdown="handlePointerDown"
        @contextmenu.prevent
      />
      <!-- 保持视觉尺寸 -->
      <image
        :x="item.x - ELEMENT_RADIUS_OBJECT.ball"
        :y="item.y - ELEMENT_RADIUS_OBJECT.ball"
        :width="ELEMENT_RADIUS_OBJECT.ball * 2"
        :height="ELEMENT_RADIUS_OBJECT.ball * 2"
        :href="ballSvg"
        pointer-events="none"
      />
      <foreignObject class="popup" ref="popupRef" :x="popupX" :y="popupY" width="200" height="65" v-if="showPopup">
        <div xmlns="http://www.w3.org/1999/xhtml" class="popup-content">
          <div class="popup-body">
            <button class="delete-btn" v-if="item.id" @click="handleDelete(item.id)">删除</button>
          </div>
        </div>
      </foreignObject>
    </g>
  </g>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { FieldElement } from "../types/fieldElement";
import { useBoardStore } from "../stores/boardStore";
import { useAnimationStore } from "../stores/animationStore";
import { useClickOutside } from "../composables/useClickOutside";
import { useItemStore } from "../stores/itemStore";
import { useDraggable } from "../composables/useDraggable";
import ballSvg from "@/assets/icons/ball.svg";
import { ELEMENT_RADIUS_OBJECT } from "../constants";
import { useHistory } from "../composables/useHistory";
import { useGlobalStore } from "../stores/globalStore";
import { useRosterStore } from "../stores/rosterStore";
import { ROLE_OPTIONS, posColor, posLabel, resolveAvatar, resolveRosterPlayer } from "../data/berlinGarden";

const props = defineProps({
  portrait: Boolean,
  compact: Boolean,
  item: {
    type: Object as () => FieldElement,
    required: true,
  },
});
const boardStore = useBoardStore();
const { boardAreaBBox } = storeToRefs(boardStore);
const animationStore = useAnimationStore();
const itemStore = useItemStore();
const rosterStore = useRosterStore();
const { startDrag } = useDraggable();
const { pushHistory } = useHistory();
const globalStore = useGlobalStore();
const { currentTool, showNames, showPositions } = storeToRefs(globalStore);
const roleOptions = ROLE_OPTIONS;

// Position-only animation updates must not repeat roster and avatar lookups.
const playerRosterId = computed(() => props.item.rosterId);
const playerName = computed(() => props.item.text);
const playerNumber = computed(() => props.item.number);
const playerTeam = computed(() => props.item.team);
const translateMarker = computed(() => animationStore.isPlaying && props.item.elementType === "player");
const itemTransform = computed(() => {
  if (translateMarker.value) return `translate(${props.item.x} ${props.item.y})${props.portrait ? " rotate(90)" : ""}`;
  return props.portrait ? `rotate(90 ${props.item.x} ${props.item.y})` : undefined;
});

const rosterPlayer = computed(() =>
  resolveRosterPlayer(rosterStore.players, {
    rosterId: playerRosterId.value,
    text: playerName.value,
    number: playerNumber.value,
    team: playerTeam.value,
  })
);
const displayedPosition = computed(
  () => rosterPlayer.value?.positions?.join("、") || posLabel(props.item.playerPosition)
);

const shortLabel = (value: string | undefined, limit: number) => {
  const chars = Array.from(value || "");
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : value;
};
const nameDraft = ref("");
const numberDraft = ref<string | number>("");
const nameError = ref("");
const numberError = ref("");
const canEditPiece = () => !animationStore.isAnimationMode && !globalStore.presenting;
const commitPiece = (patch: Partial<FieldElement>) => {
  const target = props.item.id === undefined ? null : itemStore.items.findById(props.item.id);
  if (!target || !canEditPiece()) return;
  pushHistory();
  Object.assign(target, patch);
};
const commitName = () => {
  const value = nameDraft.value.trim();
  if (value.length > 200) {
    nameError.value = "名称最多 200 字，可留空；尚未保存。";
    return;
  }
  if (!canEditPiece()) return;
  if (props.item.text !== value) {
    commitPiece({ text: value });
  }
  nameDraft.value = value;
  nameError.value = "";
};
const commitNumber = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const value = input.value === "" ? undefined : Number(input.value);
  if (input.validity.badInput || (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 9999))) {
    numberError.value = "请输入 0–9999 的整数，留空表示未知；尚未保存。";
    return;
  }
  if (!canEditPiece()) return;
  if (props.item.number !== value) {
    commitPiece({ number: value });
  }
  numberError.value = "";
};
const onRoleChange = (event: Event) => {
  if (!canEditPiece()) return;
  const value = (event.target as HTMLSelectElement).value;
  if (props.item.playerPosition === value) return;
  commitPiece({ playerPosition: value, color: posColor(value || "待定") });
};
const commitColor = (event: Event) => {
  const value = (event.target as HTMLInputElement).value;
  if (!canEditPiece() || props.item.color === value) return;
  commitPiece({ color: value });
};

// 名单头像：rosterId → 姓名 → 号码三级匹配，改名改号不丢照片
const rosterAvatar = computed(() => {
  try {
    return (
      resolveAvatar(rosterStore.players, {
        rosterId: playerRosterId.value,
        text: playerName.value,
        number: playerNumber.value,
        team: playerTeam.value,
      }) ?? null
    );
  } catch {
    return null;
  }
});

// 照片加载失败则回退到号码棋子；头像地址变化时重置
const avatarOk = ref(true);
watch(rosterAvatar, () => {
  avatarOk.value = true;
});

const hidePopupAvatar = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};

const popupRef = ref(null);
const circleRef = ref(null);
const itemRef = ref(null);
const popupX = ref(200);
const popupY = ref(200);
const showPopup = ref(false);

const emit = defineEmits(["start-drag", "select-player"]);

const itemPosition = computed(() => (translateMarker.value ? { x: 0, y: 0 } : { x: props.item.x, y: props.item.y }));
const logicalNamePosition = computed(() => {
  const { x, y, r, text } = props.item;
  const top = { x, y: y - r - 10 };
  if (!animationStore.isAnimationMode) return top;
  const width = Math.max(18, String(text || "").length * 18);
  const roleVisible =
    showPositions.value && animationStore.canEdit && props.item.team !== "away" && !globalStore.presenting;
  const candidates = [
    top,
    ...(!roleVisible ? [{ x, y: y + r + 28 }] : []),
    { x: x + r + width / 2 + 12, y: y + 6 },
    { x: x - r - width / 2 - 12, y: y + 6 },
  ];
  return (
    candidates.find((label) =>
      animationStore.displayElements.every((other) => {
        if (other.id === props.item.id) return true;
        const radius = other.elementType === "ball" ? 16 : other.r + 9;
        return (
          label.x + width / 2 < other.x - radius ||
          label.x - width / 2 > other.x + radius ||
          label.y < other.y - radius ||
          label.y - 22 > other.y + radius
        );
      })
    ) ?? top
  );
});
const namePosition = computed(() => {
  const label = logicalNamePosition.value;
  if (!translateMarker.value) return label;
  return {
    x: Math.round((label.x - props.item.x) * 1000) / 1000,
    y: Math.round((label.y - props.item.y) * 1000) / 1000,
  };
});

// 计算弹窗位置
const calculatePopupPosition = () => {
  if (!boardAreaBBox.value) return;
  const svgRect = boardAreaBBox.value;
  const buttonBBox = (circleRef.value as unknown as SVGCircleElement).getBBox();
  const popupBBox = (popupRef.value as unknown as SVGForeignObjectElement).getBBox();
  // 默认右方
  popupX.value = buttonBBox.x + buttonBBox.width + 10;
  popupY.value = buttonBBox.y;

  // 检查是否超出右边
  if (popupX.value + popupBBox.width > svgRect.right) {
    // 尝试左方
    popupX.value = buttonBBox.x - popupBBox.width - 10;
    popupY.value = buttonBBox.y;
  }

  // 检查是否超出下方
  if (popupY.value + popupBBox.height > svgRect.bottom) {
    // 尝试上方
    popupY.value = buttonBBox.y - popupBBox.height - 10;
  }

  // 检查是否超出上方
  if (popupY.value < svgRect.top) {
    // 尝试下方
    popupY.value = buttonBBox.y + buttonBBox.height + 10;
  }
};

const handleDragMove = (x: number, y: number) => {
  closePopup();
};

const handlePointerDown = (event: PointerEvent) => {
  if (animationStore.isAnimationMode && !animationStore.canEdit) return;
  if (currentTool.value === "shape" || currentTool.value === "text") {
    // 绘画/文字模式下元素不支持拖动、点击等操作
    return;
  }
  event.preventDefault();
  itemStore.moveItemToLast(props.item);
  startDrag(props.item, event, { onDragMove: handleDragMove, onClick: handleClickItem, onDragStart: pushHistory });
};

const handleKeyboardOpen = () => {
  if (canEditPiece()) handleClickItem();
};

const handleClickItem = () => {
  if (animationStore.isAnimationMode) return;
  if (props.compact && rosterPlayer.value) {
    closePopup();
    emit("select-player", rosterPlayer.value.id);
    return;
  }
  if (!showPopup.value) {
    nameDraft.value = props.item.text || "";
    numberDraft.value = props.item.number ?? "";
    nameError.value = "";
    numberError.value = "";
  }
  showPopup.value = !showPopup.value;
  nextTick(() => {
    if (showPopup.value) {
      calculatePopupPosition();
    }
  });
};

const closePopup = () => {
  showPopup.value = false;
};
watch(() => [animationStore.isAnimationMode, globalStore.presenting], closePopup);

const handleDelete = (id: string | number) => {
  pushHistory();
  itemStore.deleteElement(id);
};

useClickOutside({
  targetRef: itemRef,
  onClickOutside: closePopup,
});
</script>

<style lang="scss" scoped>
.field-error {
  display: block;
  font-size: 12px;
  color: var(--color-danger, #a32940);
}
.edit-scope-note {
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-text-muted);
  margin: 6px 0;
}
g[role="button"]:focus-visible {
  outline: none;
}
circle[role="button"]:focus-visible {
  outline: none;
  stroke: var(--color-brand);
  stroke-width: 3;
}
g[role="button"]:focus-visible > circle {
  stroke: var(--color-brand);
  stroke-width: 5;
}
.popup {
  pointer-events: all;
  background: var(--paper);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;

  .popup-content {
    height: 100%;
    overflow-y: auto;
    background: var(--paper);
    border-radius: 14px;
  }

  .popup-body {
    padding: 16px;

    .avatar-preview {
      display: flex;
      justify-content: center;
      margin-bottom: 12px;

      img {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid var(--pitch-500);
      }
    }

    .input-group {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      align-items: stretch;

      label {
        width: 100%;
        color: var(--color-text-muted);
        font-size: 14px;
      }

      input {
        padding: 6px 12px;
        border: 1px solid var(--pitch-500);
        border-radius: 6px;
        transition: all 0.2s;
        font-size: 20px;
        width: 100%;
        text-align: center;

        &:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--color-brand-soft);
        }
      }

      .role-select {
        padding: 6px 12px;
        border: 1px solid var(--pitch-500);
        border-radius: 6px;
        font-size: 20px;
        width: 100%;
        text-align: center;
        background: var(--color-surface);

        &:focus {
          outline: none;
          box-shadow: 0 0 0 2px var(--color-brand-soft);
        }
      }

      &.color {
        input {
          padding: 0;
        }
      }
    }

    .delete-btn {
      width: 100%;
      font-size: 20px;
      padding: 4px 12px;
      color: var(--color-on-brand);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      background: var(--error-color);

      &:hover {
        background: var(--error-hover-color);
      }
    }
  }
}
.player-position,
.player-name {
  fill: var(--text-dark-color);
  font-size: 18px;
  user-select: none;
  font-weight: 600;
}

.player-number {
  font-size: 20px;
  font-weight: bold;
  user-select: none;
  cursor: pointer;
}

.number-badge {
  font-size: 13px;
  font-weight: 800;
  fill: var(--color-on-brand);
  user-select: none;
}
</style>
