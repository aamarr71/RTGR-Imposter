<script setup lang="ts">
import { onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * Modaler Dialog auf Basis von `<dialog>`: bekommt Fokusfalle, Escape und
 * Backdrop kostenlos vom Browser.
 */
const props = defineProps<{ open: boolean; title?: string; dismissible?: boolean }>()
const emit = defineEmits<{ close: [] }>()

const el = ref<HTMLDialogElement | null>(null)
const titleId = useId()

watch(
  () => props.open,
  (open) => {
    const dialog = el.value
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  },
  { flush: 'post' },
)

function onCancel(event: Event) {
  event.preventDefault()
  if (props.dismissible !== false) emit('close')
}

onBeforeUnmount(() => el.value?.close())
</script>

<template>
  <dialog
    ref="el"
    class="dialog"
    :aria-labelledby="title ? titleId : undefined"
    @cancel="onCancel"
    @close="emit('close')"
  >
    <div class="dialog__inner">
      <h2 v-if="title" :id="titleId" class="dialog__title">{{ title }}</h2>
      <div class="dialog__body"><slot /></div>
      <div class="dialog__actions"><slot name="actions" /></div>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  inset-inline-start: max(var(--safe-left), var(--page-inline));
  inset-inline-end: max(var(--safe-right), var(--page-inline));
  width: 420px;
  max-width: calc(
    100% - max(var(--safe-left), var(--page-inline)) -
      max(var(--safe-right), var(--page-inline))
  );
  margin-inline: auto;
  max-height: calc(
    100vh - var(--safe-top) - var(--safe-bottom) - 2 * var(--page-top)
  );
  max-height: calc(
    100svh - var(--safe-top) - var(--safe-bottom) - 2 * var(--page-top)
  );
  max-height: calc(
    100dvh - var(--safe-top) - var(--safe-bottom) - 2 * var(--page-top)
  );
  padding: 0;
  overflow: hidden;
  color: var(--c-text);
  background: var(--c-surface);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-card);
}

.dialog::backdrop {
  background: rgb(3 6 10 / 72%);
  backdrop-filter: blur(3px);
}

.dialog[open] {
  animation: dialog-in var(--t-base) var(--e-out);
}

.dialog__inner {
  max-height: inherit;
  padding: var(--card-padding);
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.dialog__title {
  font-size: var(--fs-lg);
  font-weight: 700;
}

.dialog__body {
  font-size: var(--fs-md);
  color: var(--c-text-muted);
}

.dialog__actions {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.dialog__actions:empty {
  display: none;
}

@keyframes dialog-in {
  from {
    opacity: 0;
    transform: translate3d(0, 10px, 0) scale(0.97);
  }
}
</style>
