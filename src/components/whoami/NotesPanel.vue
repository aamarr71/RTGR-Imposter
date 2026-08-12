<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { WHO_AM_I } from '@shared/config'
import { t } from '@/i18n'

/**
 * Ein einziges privates Notizfeld pro Spieler.
 *
 * Gespeichert wird entprellt; bei kurzem Verbindungsverlust wird lokal
 * weitergeschrieben und beim nächsten erfolgreichen Speichern nachgezogen.
 * Diese Notizen gehen niemals in Analytics ein.
 */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ save: [content: string] }>()

const draft = ref(props.modelValue)
const state = ref<'idle' | 'pending' | 'saved'>('idle')
let timer: ReturnType<typeof setTimeout> | null = null

// Serverstand nur übernehmen, wenn gerade nichts Ungespeichertes offen ist.
watch(
  () => props.modelValue,
  (value) => {
    if (state.value === 'idle' && value !== draft.value) draft.value = value
  },
)

function onInput() {
  state.value = 'pending'
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(flush, 700)
}

function flush() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  emit('save', draft.value)
  state.value = 'saved'
  setTimeout(() => {
    if (state.value === 'saved') state.value = 'idle'
  }, 1500)
}

onBeforeUnmount(() => {
  if (state.value === 'pending') flush()
})
</script>

<template>
  <section class="notes">
    <header class="notes__head">
      <h2 class="notes__title">{{ t('whoami.game.notes') }}</h2>
      <span v-if="state === 'pending'" class="notes__state">{{ t('whoami.game.notesPending') }}</span>
      <span v-else-if="state === 'saved'" class="notes__state is-saved">
        {{ t('whoami.game.notesSaved') }}
      </span>
    </header>

    <textarea
      v-model="draft"
      class="notes__area"
      :maxlength="WHO_AM_I.notesMaxLength"
      :placeholder="t('whoami.game.notesPlaceholder')"
      rows="6"
      @input="onInput"
      @blur="state === 'pending' && flush()"
    />

    <p class="notes__privacy">{{ t('whoami.game.notesPrivate') }}</p>
  </section>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-4);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-lg);
}

.notes__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--s-3);
}

.notes__title {
  font-size: var(--fs-md);
  font-weight: 650;
}

.notes__state {
  font-size: var(--fs-xs);
  color: var(--c-text-dim);
}

.notes__state.is-saved {
  color: var(--c-success);
}

.notes__area {
  width: 100%;
  min-width: 0;
  padding: var(--s-3);
  font-size: 16px;
  line-height: 1.55;
  color: var(--c-text);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  resize: vertical;
}

.notes__area:focus {
  outline: none;
  border-color: var(--c-accent);
}

.notes__privacy {
  font-size: var(--fs-xs);
  color: var(--c-text-dim);
}
</style>
