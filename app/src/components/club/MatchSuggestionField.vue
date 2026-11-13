<template>
  <div class="match-suggestion">
    <label>
      {{ label }}
      <input
        :value="modelValue"
        :required="required"
        :maxlength="maxlength"
        :placeholder="placeholder"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <UiSelect
      v-if="options.length"
      :value="options.includes(modelValue) ? modelValue : ''"
      :aria-label="`从历史选择${label}`"
      @change="choose"
    >
      <option value="">从历史记录选择，也可填写新名称</option>
      <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
    </UiSelect>
  </div>
</template>
<script setup lang="ts">
defineProps<{
  modelValue: string;
  label: string;
  options: string[];
  required?: boolean;
  maxlength?: number;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
function choose(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value) emit("update:modelValue", value);
}
</script>
<style scoped>
.match-suggestion {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.match-suggestion label {
  display: flex;
  flex-direction: column;
}
</style>
