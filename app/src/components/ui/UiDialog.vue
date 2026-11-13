<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="ui-dialog"
      :aria-labelledby="titleId"
      :aria-describedby="description ? descriptionId : undefined"
      @cancel.prevent="cancel"
      @close="onClose"
      @click="backdrop"
    >
      <header class="ui-dialog-header">
        <h2 :id="titleId">{{ title }}</h2>
        <button type="button" class="ui-dialog-close" aria-label="关闭弹窗" @click="cancel">×</button>
      </header>
      <p v-if="description" :id="descriptionId" class="ui-dialog-description">{{ description }}</p>
      <div class="ui-dialog-content"><slot /></div>
      <footer v-if="$slots.footer" class="ui-dialog-footer"><slot name="footer" /></footer>
    </dialog>
  </Teleport>
</template>
<script lang="ts">
let nextDialogId = 0;
</script>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = withDefaults(
  defineProps<{ modelValue: boolean; title: string; description?: string; closeOnBackdrop?: boolean }>(),
  { closeOnBackdrop: false }
);
const emit = defineEmits<{ "update:modelValue": [value: boolean]; cancel: [] }>();
const id = ++nextDialogId;
const titleId = `ui-dialog-title-${id}`;
const descriptionId = `ui-dialog-description-${id}`;
const dialog = ref<HTMLDialogElement>();
let previousFocus: HTMLElement | null = null;
async function sync() {
  await nextTick();
  if (props.modelValue && !dialog.value?.open) {
    previousFocus = document.activeElement as HTMLElement;
    dialog.value?.showModal();
    (dialog.value?.querySelector("[autofocus]") as HTMLElement | null)?.focus();
  } else if (!props.modelValue && dialog.value?.open) dialog.value.close();
}
function cancel() {
  emit("cancel");
  emit("update:modelValue", false);
}
function onClose() {
  if (props.modelValue) emit("update:modelValue", false);
  if (previousFocus?.isConnected) previousFocus.focus();
}
function backdrop(event: MouseEvent) {
  if (props.closeOnBackdrop && event.target === dialog.value) {
    const rect = dialog.value.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      cancel();
  }
}
watch(() => props.modelValue, sync);
onMounted(sync);
onBeforeUnmount(() => {
  dialog.value?.close();
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>
