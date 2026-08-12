<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{
    label?: string
    hint?: string
    error?: string | null
    placeholder?: string
    maxlength?: number
    type?: 'text' | 'password' | 'number'
    inputmode?: 'text' | 'numeric' | 'decimal'
    autocomplete?: string
    disabled?: boolean
    multiline?: boolean
    rows?: number
    /** Zeigt „x / max“ unter dem Feld. */
    showCount?: boolean
    align?: 'start' | 'center'
    uppercase?: boolean
  }>(),
  { type: 'text', rows: 4, showCount: false, align: 'start', uppercase: false },
)

const model = defineModel<string>({ required: true })
const id = useId()
const count = computed(() => [...model.value].length)
</script>

<template>
  <div class="field" :class="{ 'has-error': !!error }">
    <label v-if="label" class="field__label" :for="id">{{ label }}</label>

    <textarea
      v-if="multiline"
      :id="id"
      v-model="model"
      class="field__input field__input--area"
      :rows="rows"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :disabled="disabled"
      :aria-invalid="!!error || undefined"
      :aria-describedby="hint || error ? `${id}-desc` : undefined"
    />
    <input
      v-else
      :id="id"
      v-model="model"
      class="field__input"
      :class="{ 'field__input--center': align === 'center', 'field__input--upper': uppercase }"
      :type="type"
      :inputmode="inputmode"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :disabled="disabled"
      :aria-invalid="!!error || undefined"
      :aria-describedby="hint || error ? `${id}-desc` : undefined"
    />

    <p v-if="error" :id="`${id}-desc`" class="field__error">{{ error }}</p>
    <p v-else-if="hint" :id="`${id}-desc`" class="field__hint">{{ hint }}</p>
    <p v-if="showCount && maxlength" class="field__count">{{ count }} / {{ maxlength }}</p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--s-2);
}

.field__label {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-muted);
}

.field__input {
  width: 100%;
  min-width: 0;
  min-height: var(--touch);
  padding: var(--s-3);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  /* 16px verhindert den Auto-Zoom von iOS Safari beim Fokussieren. */
  font-size: 16px;
  transition: border-color var(--t-fast) var(--e-out), background-color var(--t-fast) var(--e-out);
}

.field__input::placeholder {
  color: var(--c-text-dim);
}

.field__input:focus {
  outline: none;
  border-color: var(--c-accent);
  background: var(--c-surface-3);
}

.field__input:disabled {
  opacity: 0.55;
}

.field__input--area {
  min-height: 120px;
  resize: vertical;
  line-height: 1.5;
}

.field__input--center {
  text-align: center;
}

.field__input--upper {
  text-transform: uppercase;
  letter-spacing: 0.35em;
  font-weight: 700;
  font-size: 1.4rem;
  padding-left: 0.35em;
}

.has-error .field__input {
  border-color: var(--c-danger);
}

.field__hint,
.field__error,
.field__count {
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}

.field__hint {
  color: var(--c-text-muted);
}

.field__error {
  color: var(--c-danger);
}

.field__count {
  align-self: flex-end;
  color: var(--c-text-dim);
}
</style>
