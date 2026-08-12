<script setup lang="ts">
import { useRouter } from 'vue-router'
import { t } from '@/i18n'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    /** Wenn gesetzt, wird statt `router.back()` diese Route angesteuert. */
    backTo?: string
    /** Der Aufrufer übernimmt das Zurück selbst (z. B. für Verlassen-Dialog). */
    interceptBack?: boolean
    hideBack?: boolean
  }>(),
  { interceptBack: false, hideBack: false },
)

const emit = defineEmits<{ back: [] }>()
const router = useRouter()

function goBack() {
  if (props.interceptBack) {
    emit('back')
    return
  }
  if (props.backTo) {
    void router.push(props.backTo)
    return
  }
  if (window.history.state?.back) router.back()
  else void router.push('/')
}
</script>

<template>
  <header class="head">
    <button
      v-if="!hideBack"
      class="head__back"
      type="button"
      :aria-label="t('common.back')"
      @click="goBack"
    >
      <AppIcon name="arrow-left" :size="21" />
    </button>
    <div v-else class="head__spacer" />

    <div class="head__mid">
      <h1 v-if="title" class="head__title">{{ title }}</h1>
      <p v-if="subtitle" class="head__sub">{{ subtitle }}</p>
    </div>

    <div class="head__end">
      <slot name="action" />
    </div>
  </header>
</template>

<style scoped>
.head {
  display: grid;
  grid-template-columns: var(--touch) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--s-2);
  min-height: var(--touch);
}

.head__mid {
  min-width: 0;
}

.head__back,
.head__spacer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch);
  height: var(--touch);
  margin-left: calc(var(--s-2) * -1);
  border-radius: var(--r-pill);
  color: var(--c-text-muted);
  transition: background-color var(--t-fast) var(--e-out), color var(--t-fast) var(--e-out);
}

.head__back:active {
  color: var(--c-text);
  background: rgb(255 255 255 / 7%);
}

.head__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: 0.01em;
  overflow-wrap: anywhere;
}

.head__sub {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}

.head__end {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--s-2);
  min-height: var(--touch);
}
</style>
