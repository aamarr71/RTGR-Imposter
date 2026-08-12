<script setup lang="ts">
import AppIcon from './AppIcon.vue'

defineProps<{ label: string; hint?: string; disabled?: boolean }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="check" :class="{ 'is-on': model, 'is-disabled': disabled }">
    <input v-model="model" class="check__input" type="checkbox" :disabled="disabled" />
    <span class="check__box" aria-hidden="true">
      <AppIcon v-if="model" name="check" :size="15" :stroke-width="2.6" />
    </span>
    <span class="check__text">
      <span>{{ label }}</span>
      <span v-if="hint" class="check__hint">{{ hint }}</span>
    </span>
  </label>
</template>

<style scoped>
.check {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-height: var(--touch);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background-color var(--t-fast) var(--e-out);
}

.check:active {
  background: rgb(255 255 255 / 4%);
}

.check.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.check__input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.check__box {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 23px;
  height: 23px;
  color: #04120f;
  border: 1.5px solid var(--c-line-strong);
  border-radius: 7px;
  background: var(--c-surface-2);
  transition:
    background-color var(--t-fast) var(--e-out),
    border-color var(--t-fast) var(--e-out),
    transform var(--t-fast) var(--e-spring);
}

.is-on .check__box {
  background: var(--c-accent);
  border-color: var(--c-accent);
  transform: scale(1.04);
}

.check__input:focus-visible + .check__box {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}

.check__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-wrap: anywhere;
}

.check__hint {
  font-size: var(--fs-xs);
  color: var(--c-text-dim);
}
</style>
