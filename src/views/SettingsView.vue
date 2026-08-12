<script setup lang="ts">
import { computed, ref } from 'vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import MenuRow from '@/components/ui/MenuRow.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { t } from '@/i18n'
import { runtimeConfig } from '@/config/runtime'
import { alarmSound } from '@/services/audio'
import { haptics } from '@/services/haptics'
import { usedTermIds } from '@/services/termPool'
import { useImpostorStore } from '@/stores/impostor'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()
const impostor = useImpostorStore()

const notice = ref<string | null>(null)
const usedCount = ref(usedTermIds().length)
const volumePercent = computed({
  get: () => Math.round(settings.timerVolume * 100),
  set: (value: number) => {
    settings.timerVolume = value / 100
  },
})

function toggleHaptics(value: boolean) {
  settings.hapticsEnabled = value
  if (value) haptics.play('tick')
}

/** Kurze Hörprobe, damit die Lautstärke einschätzbar ist. */
async function previewSound() {
  await alarmSound.unlock()
  await alarmSound.start(settings.effectiveVolume)
  setTimeout(() => alarmSound.stop(), 900)
}

function resetUsed() {
  impostor.clearUsedTerms()
  usedCount.value = 0
  notice.value = t('settings.resetUsedWords.done')
}

function resetAge() {
  settings.resetAgeConfirmation()
  notice.value = t('settings.resetAge.done')
}
</script>

<template>
  <main class="page settings">
    <AppHeader :title="t('settings.title')" back-to="/" />

    <StatusNote v-if="notice" tone="success" icon="check">{{ notice }}</StatusNote>

    <AppCard>
      <ToggleSwitch
        :model-value="settings.hapticsEnabled"
        :label="t('settings.haptics')"
        :hint="settings.hapticsSupported ? t('settings.haptics.hint') : t('settings.haptics.unsupported')"
        :disabled="!settings.hapticsSupported"
        @update:model-value="toggleHaptics"
      />
    </AppCard>

    <AppCard :title="t('settings.timerSound')" :hint="t('settings.timerSound.hint')">
      <ToggleSwitch v-model="settings.timerSoundEnabled" :label="t('settings.timerSound')" />
      <div v-if="settings.timerSoundEnabled" class="settings__volume">
        <label class="settings__volumeLabel" for="volume">{{ t('settings.timerVolume') }}</label>
        <input id="volume" v-model.number="volumePercent" type="range" min="0" max="100" step="5" />
        <span class="settings__volumeValue">{{ volumePercent }} %</span>
      </div>
      <button v-if="settings.timerSoundEnabled" class="settings__preview" type="button" @click="previewSound">
        ▸ {{ t('settings.timerSound') }}
      </button>
    </AppCard>

    <AppCard :title="t('settings.language')" :hint="t('settings.language.hint')">
      <p class="settings__static">{{ t('settings.language.de') }}</p>
    </AppCard>

    <AppCard :title="t('settings.data')">
      <nav class="settings__rows">
        <MenuRow
          :label="t('settings.resetUsedWords')"
          icon="refresh"
          :hint="t('settings.usedWordsCount', { count: usedCount })"
          @click="resetUsed"
        />
        <MenuRow :label="t('settings.resetAge')" icon="alert" @click="resetAge" />
      </nav>
    </AppCard>

    <AppCard :title="t('settings.legal')">
      <nav class="settings__rows">
        <MenuRow :label="t('settings.imprint')" icon="note" :to="{ name: 'imprint' }" />
        <MenuRow :label="t('settings.privacy')" icon="note" :to="{ name: 'privacy' }" />
      </nav>
    </AppCard>

    <p class="settings__version">{{ t('settings.version', { version: runtimeConfig.version }) }}</p>
  </main>
</template>

<style scoped>
.settings__rows {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.settings__volume {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: 'label range value';
  align-items: center;
  gap: var(--s-3);
  margin-top: var(--s-4);
}

.settings__volumeLabel {
  grid-area: label;
  min-width: 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}

.settings__volumeValue {
  grid-area: value;
  font-size: var(--fs-sm);
  font-variant-numeric: tabular-nums;
  color: var(--c-text-muted);
}

.settings__volume input[type='range'] {
  grid-area: range;
  width: 100%;
  min-width: 0;
  accent-color: var(--c-accent);
}

.settings__preview {
  min-height: var(--touch);
  margin-top: var(--s-2);
  font-size: var(--fs-sm);
  color: var(--c-accent);
}

.settings__static {
  color: var(--c-text-muted);
}

.settings__version {
  margin-top: auto;
  padding-top: var(--s-5);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-dim);
}

@media (max-width: 340px) {
  .settings__volume {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'label value'
      'range range';
  }
}
</style>
