<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import type { RouteLocationRaw } from 'vue-router'

/**
 * Basis-Button. `primary` nutzt die Akzentfarbe des Kontexts
 * (`data-accent` am Layout), damit derselbe Button in Impostor türkis und in
 * Wer bin ich orange erscheint.
 */
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'lg' | 'sm'
    block?: boolean
    disabled?: boolean
    loading?: boolean
    to?: RouteLocationRaw
    type?: 'button' | 'submit'
  }>(),
  { variant: 'primary', size: 'md', block: false, disabled: false, loading: false, type: 'button' },
)

const emit = defineEmits<{ click: [MouseEvent] }>()

const classes = computed(() => [
  'btn',
  `btn--${props.variant}`,
  `btn--${props.size}`,
  { 'btn--block': props.block, 'is-loading': props.loading },
])

function onClick(event: MouseEvent) {
  if (props.disabled || props.loading) {
    event.preventDefault()
    return
  }
  emit('click', event)
}
</script>

<template>
  <RouterLink
    v-if="to && !disabled"
    :to="to"
    :class="classes"
    @click="onClick"
  >
    <slot name="icon" />
    <span class="btn__label"><slot /></span>
    <slot name="trailing" />
  </RouterLink>
  <button
    v-else
    :class="classes"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    @click="onClick"
  >
    <slot name="icon" />
    <span class="btn__label"><slot /></span>
    <slot name="trailing" />
  </button>
</template>

<style scoped>
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  min-height: var(--touch);
  padding: 0 var(--s-5);
  border-radius: var(--r-md);
  font-weight: 650;
  font-size: var(--fs-md);
  letter-spacing: 0.01em;
  text-align: center;
  border: 1px solid transparent;
  transition:
    transform var(--t-fast) var(--e-out),
    filter var(--t-fast) var(--e-out),
    background-color var(--t-fast) var(--e-out),
    border-color var(--t-fast) var(--e-out),
    opacity var(--t-fast) var(--e-out);
}

.btn:active:not(:disabled) {
  transform: scale(0.975);
}

.btn:disabled,
.btn.is-loading {
  opacity: 0.42;
  cursor: not-allowed;
}

.btn--sm {
  min-height: 36px;
  padding: 0 var(--s-3);
  font-size: var(--fs-sm);
  border-radius: var(--r-sm);
}

.btn--lg {
  min-height: 56px;
  font-size: var(--fs-lg);
  border-radius: var(--r-lg);
}

.btn--block {
  display: flex;
  width: 100%;
}

.btn--primary {
  color: #04120f;
  background: linear-gradient(150deg, var(--c-accent) 0%, var(--c-accent-deep) 100%);
  box-shadow: 0 10px 26px var(--c-accent-glow);
}

.btn--primary:disabled,
.btn--primary.is-loading {
  box-shadow: none;
}

.btn--secondary {
  color: var(--c-text);
  background: var(--c-surface-2);
  border-color: var(--c-line);
}

.btn--secondary:active:not(:disabled) {
  background: var(--c-surface-3);
}

.btn--ghost {
  color: var(--c-text-muted);
  background: transparent;
}

.btn--ghost:active:not(:disabled) {
  color: var(--c-text);
  background: rgb(255 255 255 / 5%);
}

.btn--danger {
  color: #fff;
  background: linear-gradient(150deg, #e8382c 0%, #99160e 100%);
  box-shadow: 0 10px 26px var(--c-danger-glow);
}

.btn__label:empty {
  display: none;
}

.btn__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 380px) {
  .btn--lg {
    min-height: 52px;
  }
}

@media (max-height: 520px) {
  .btn--lg {
    min-height: 48px;
  }
}
</style>
