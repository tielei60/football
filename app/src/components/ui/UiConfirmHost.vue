<template>
  <UiDialog
    v-if="current"
    :model-value="true"
    :title="current.options.title || '请确认操作'"
    :description="current.message"
    @update:model-value="
      (value) => {
        if (!value) answerConfirmation(false);
      }
    "
  >
    <template #footer>
      <button type="button" class="ui-button" autofocus @click="answerConfirmation(false)">
        {{ current.options.cancelText || "取消" }}
      </button>
      <button
        type="button"
        class="ui-button"
        :class="current.options.danger ? 'ui-button-danger' : 'ui-button-primary'"
        @click="answerConfirmation(true)"
      >
        {{ current.options.confirmText || "确认" }}
      </button>
    </template>
  </UiDialog>
</template>
<script setup lang="ts">
import UiDialog from "./UiDialog.vue";
import { activeConfirmation as current, answerConfirmation } from "./confirmAction";
</script>
