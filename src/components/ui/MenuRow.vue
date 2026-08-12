<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'
import AppIcon, { type IconName } from './AppIcon.vue'

/** Unaufdringliche Menüzeile („Wort vorschlagen“, „Einstellungen“ …). */
defineProps<{
  label: string
  icon?: IconName
  to?: RouteLocationRaw
  hint?: string
  danger?: boolean
}>()

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    class="row"
    :class="{ 'row--danger': danger }"
    :to="to"
    :type="to ? undefined : 'button'"
    @click="emit('click')"
  >
    <AppIcon v-if="icon" :name="icon" :size="20" class="row__icon" />
    <span class="row__text">
      <span class="row__label">{{ label }}</span>
      <span v-if="hint" class="row__hint">{{ hint }}</span>
    </span>
    <slot name="trailing">
      <AppIcon v-if="to" name="chevron-right" :size="18" class="row__chevron" />
    </slot>
  </component>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  width: 100%;
  min-height: 56px;
  padding: var(--s-3) var(--s-4);
  text-align: left;
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-inset);
  transition: background-color var(--t-fast) var(--e-out), transform var(--t-fast) var(--e-out);
}

.row:active {
  background: var(--c-surface-2);
  transform: scale(0.99);
}

.row--danger {
  color: var(--c-danger);
}

.row__icon {
  color: var(--c-text-muted);
}

.row--danger .row__icon {
  color: currentcolor;
}

.row__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.row__label {
  font-weight: 550;
  overflow-wrap: anywhere;
}

.row__hint {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}

.row__chevron {
  color: var(--c-text-dim);
}

@media (max-width: 380px) {
  .row {
    min-height: 52px;
    padding-inline: var(--s-3);
  }
}
</style>
