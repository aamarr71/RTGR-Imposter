<script setup lang="ts">
defineProps<{ label: string; hint?: string; disabled?: boolean }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="toggle" :class="{ 'is-disabled': disabled }">
    <span class="toggle__text">
      <span class="toggle__label">{{ label }}</span>
      <span v-if="hint" class="toggle__hint">{{ hint }}</span>
    </span>
    <input v-model="model" class="toggle__input" type="checkbox" :disabled="disabled" />
    <span class="toggle__track" aria-hidden="true"><span class="toggle__thumb" /></span>
  </label>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  min-height: var(--touch);
  cursor: pointer;
}

.toggle.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toggle__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
}

.toggle__label {
  font-weight: 550;
}

.toggle__hint {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.toggle__input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
}

.toggle__track {
  position: relative;
  flex: none;
  width: 52px;
  height: 31px;
  padding: 3px;
  border-radius: var(--r-pill);
  background: var(--c-surface-3);
  border: 1px solid var(--c-line);
  transition: background-color var(--t-base) var(--e-out), border-color var(--t-base) var(--e-out);
}

.toggle__thumb {
  display: block;
  width: 23px;
  height: 23px;
  border-radius: var(--r-pill);
  background: #cdd6e0;
  box-shadow: 0 2px 6px rgb(0 0 0 / 45%);
  transition: transform var(--t-base) var(--e-spring), background-color var(--t-base) var(--e-out);
}

.toggle__input:checked + .toggle__track {
  background: linear-gradient(140deg, var(--c-accent) 0%, var(--c-accent-deep) 100%);
  border-color: var(--c-accent);
}

.toggle__input:checked + .toggle__track .toggle__thumb {
  background: #fff;
  transform: translateX(21px);
}

.toggle__input:focus-visible + .toggle__track {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
}
</style>
