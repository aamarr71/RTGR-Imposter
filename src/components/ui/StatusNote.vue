<script setup lang="ts">
import AppIcon, { type IconName } from './AppIcon.vue'

withDefaults(
  defineProps<{ tone?: 'info' | 'warn' | 'error' | 'success'; icon?: IconName }>(),
  { tone: 'info' },
)
</script>

<template>
  <p class="note" :class="`note--${tone}`" role="status">
    <AppIcon v-if="icon" :name="icon" :size="16" />
    <span><slot /></span>
  </p>
</template>

<style scoped>
.note {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
  padding: var(--s-3);
  font-size: var(--fs-sm);
  border-radius: var(--r-md);
  border: 1px solid var(--c-line);
  background: var(--c-surface-2);
  color: var(--c-text-muted);
}

.note > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.note--warn {
  color: var(--c-warning);
  border-color: rgb(245 196 81 / 30%);
  background: rgb(245 196 81 / 8%);
}

.note--error {
  color: #ff8079;
  border-color: rgb(255 59 48 / 32%);
  background: rgb(255 59 48 / 9%);
}

.note--success {
  color: var(--c-success);
  border-color: rgb(42 207 185 / 30%);
  background: rgb(42 207 185 / 8%);
}
</style>
