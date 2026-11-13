<template>
  <span ref="root" class="ui-select" :class="attrs.class" :style="attrs.style">
    <button
      v-bind="triggerAttrs"
      :id="triggerId"
      ref="trigger"
      type="button"
      class="ui-select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :data-value="selected >= 0 ? String(options[selected]?.value) : undefined"
      :aria-controls="listId"
      :aria-activedescendant="open && active >= 0 ? `${listId}-${active}` : undefined"
      :aria-label="accessibleLabel || undefined"
      :aria-required="required || undefined"
      :aria-invalid="ariaInvalid"
      :disabled="disabled"
      @click="toggle"
      @keydown="keydown"
      @blur="onBlur"
    >
      <span class="ui-select-value">{{ selectedLabel || placeholder }}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </button>
    <select
      ref="native"
      hidden
      tabindex="-1"
      aria-hidden="true"
      data-ui-native-select="true"
      :name="name"
      :form="form"
      :required="required"
      :disabled="disabled"
      @change="nativeChange"
      @invalid.prevent="
        invalid = true;
        trigger?.focus();
      "
    >
      <slot />
    </select>
    <Teleport :to="overlayTarget">
      <div
        v-if="open"
        :id="listId"
        ref="list"
        class="ui-select-list"
        role="listbox"
        :aria-label="accessibleLabel || '选项'"
        :style="position"
        @pointerdown.stop
      >
        <div v-if="!options.length" class="ui-select-empty">暂无可选项</div>
        <div
          v-for="(option, index) in options"
          :id="`${listId}-${index}`"
          :key="index"
          role="option"
          class="ui-select-option"
          :class="{ 'is-active': active === index, 'is-disabled': option.disabled }"
          :data-value="String(option.value)"
          :aria-selected="selected === index"
          :aria-disabled="option.disabled || undefined"
          @pointerdown.prevent
          @pointermove="!option.disabled && (active = index)"
          @click="choose(index)"
        >
          <span>{{ option.label }}</span>
          <span v-if="selected === index" aria-hidden="true">✓</span>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<script lang="ts">
let nextSelectId = 0;
</script>
<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  useAttrs,
  watch,
  type CSSProperties,
} from "vue";

defineOptions({ inheritAttrs: false });
type Value = string | number | boolean | null;
type Option = { value: Value; label: string; disabled: boolean };
const props = withDefaults(
  defineProps<{
    modelValue?: Value;
    value?: Value;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    form?: string;
    id?: string;
    placeholder?: string;
    modelModifiers?: { number?: boolean };
  }>(),
  // Value includes boolean, so Vue otherwise casts an absent prop to false.
  // Preserve absence to allow the native-select-compatible :value fallback.
  { modelValue: undefined, value: undefined, disabled: false, required: false, placeholder: "请选择" }
);
const emit = defineEmits<{ "update:modelValue": [value: Value]; change: [event: Event]; blur: [event: FocusEvent] }>();
const attrs = useAttrs();
const ariaInvalid = computed(() => {
  if (invalid.value) return "true" as const;
  const value = attrs["aria-invalid"];
  return value === true || value === "true"
    ? ("true" as const)
    : value === "grammar" || value === "spelling"
      ? value
      : undefined;
});
const triggerAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => !["class", "style", "aria-label"].includes(key)))
);
const listId = `ui-select-list-${++nextSelectId}`;
const triggerId = computed(() => props.id || `${listId}-trigger`);
const root = ref<HTMLElement>();
const native = ref<HTMLSelectElement>();
const trigger = ref<HTMLButtonElement>();
const list = ref<HTMLElement>();
const options = ref<Option[]>([]);
const overlayTarget = ref<HTMLElement | string>("body");
const selected = ref(-1);
const active = ref(-1);
const open = ref(false);
const invalid = ref(false);
const labelText = ref("");
const accessibleLabel = computed(() => String(attrs["aria-label"] || labelText.value || ""));
const selectedLabel = computed(() => options.value[selected.value]?.label || "");
const position = ref<CSSProperties>({});
const currentValue = computed(() => (props.modelValue !== undefined ? props.modelValue : props.value));
let search = "";
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function sync() {
  if (!native.value) return;
  const next = Array.from(native.value.options).map((option) => ({
    value: "_value" in option ? (option as HTMLOptionElement & { _value: Value })._value : option.value,
    label: option.label,
    disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
  }));
  if (JSON.stringify(next) !== JSON.stringify(options.value)) options.value = next;
  const value = currentValue.value;
  let index =
    value === undefined ? native.value.selectedIndex : next.findIndex((option) => Object.is(option.value, value));
  if (index < 0 && value != null)
    index = next.findIndex((option) => option.value != null && String(option.value) === String(value));
  overlayTarget.value = root.value?.closest("dialog") || "body";
  selected.value = index;
  native.value.selectedIndex = index;
  const label =
    trigger.value?.closest("label") ||
    (props.id ? Array.from(document.querySelectorAll("label")).find((el) => el.htmlFor === props.id) : undefined);
  if (label) {
    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".ui-select").forEach((el) => el.remove());
    labelText.value = clone.textContent?.trim() || "";
  }
  if (open.value && (active.value >= next.length || next[active.value]?.disabled)) active.value = firstEnabled();
}
function firstEnabled() {
  return options.value.findIndex((option) => !option.disabled);
}
function updatePosition() {
  if (!trigger.value || !open.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const above = spaceBelow < 160 && rect.top > spaceBelow;
  const available = Math.max(60, Math.min(288, above ? rect.top - 12 : spaceBelow));
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
  position.value = {
    position: "fixed",
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    width: `${width}px`,
    maxHeight: `${available}px`,
    ...(above ? { bottom: `${window.innerHeight - rect.top + 6}px` } : { top: `${rect.bottom + 6}px` }),
  };
}
function close(restore = false) {
  open.value = false;
  search = "";
  if (restore) trigger.value?.focus();
}
async function show() {
  if (props.disabled || trigger.value?.matches(":disabled")) return;
  sync();
  active.value = selected.value >= 0 && !options.value[selected.value]?.disabled ? selected.value : firstEnabled();
  open.value = true;
  updatePosition();
  await nextTick();
  scrollActive();
}
function toggle() {
  if (open.value) close();
  else void show();
}
function scrollActive() {
  document.getElementById(`${listId}-${active.value}`)?.scrollIntoView({ block: "nearest" });
}
function choose(index: number) {
  if (
    props.disabled ||
    trigger.value?.matches(":disabled") ||
    options.value[index]?.disabled ||
    !native.value ||
    !options.value[index]
  )
    return;
  native.value.selectedIndex = index;
  native.value.dispatchEvent(new Event("change", { bubbles: true }));
  close(true);
}
function nativeChange(event: Event) {
  const index = native.value?.selectedIndex ?? -1;
  const option = options.value[index];
  if (!option) return;
  selected.value = index;
  invalid.value = false;
  const numeric = typeof option.value === "string" ? Number.parseFloat(option.value) : NaN;
  emit("update:modelValue", props.modelModifiers?.number && !Number.isNaN(numeric) ? numeric : option.value);
  emit("change", event);
}
function move(direction: number) {
  let index = active.value;
  for (let count = 0; count < options.value.length; count += 1) {
    index = (index + direction + options.value.length) % options.value.length;
    if (!options.value[index]?.disabled) {
      active.value = index;
      break;
    }
  }
  void nextTick(scrollActive);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    close();
    return;
  }
  if (event.key === "Escape") {
    if (open.value) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (!open.value) {
      void show();
      return;
    }
    if (event.key === "Enter" || event.key === " ") choose(active.value);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") move(event.key === "ArrowDown" ? 1 : -1);
    else {
      active.value =
        event.key === "Home" ? firstEnabled() : options.value.map((option) => !option.disabled).lastIndexOf(true);
      void nextTick(scrollActive);
    }
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!open.value) void show();
    search += event.key.toLocaleLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = "";
    }, 700);
    const index = options.value.findIndex(
      (option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(search)
    );
    if (index >= 0) {
      active.value = index;
      void nextTick(scrollActive);
    }
  }
}
function onBlur(event: FocusEvent) {
  emit("blur", event);
  close();
}
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node) && !list.value?.contains(event.target as Node)) close();
}
watch(currentValue, () => nextTick(sync));
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close();
  }
);
onMounted(() => {
  sync();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, true);
});
onUpdated(sync);
onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  document.removeEventListener("pointerdown", outside, true);
  window.removeEventListener("resize", updatePosition);
  window.removeEventListener("scroll", updatePosition, true);
});
</script>
