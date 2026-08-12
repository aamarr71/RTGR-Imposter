<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import CheckRow from '@/components/ui/CheckRow.vue'
import SegmentedField from '@/components/ui/SegmentedField.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import TextField from '@/components/ui/TextField.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { t } from '@/i18n'
import { CATEGORIES, IMPOSTOR, PLAYER_NAME } from '@shared/config'
import { impostorCountOptions, recommendedImpostorCount } from '@shared/impostor'
import { findDuplicateNames, playerNameKey, visibleLength } from '@shared/validation'
import { analytics } from '@/services/analytics'
import { alarmSound } from '@/services/audio'
import { useImpostorStore } from '@/stores/impostor'

/**
 * Eine einzige Konfigurationsseite – ohne stille Standardwerte. Der
 * Startbutton bleibt so lange deaktiviert, bis jede nötige Entscheidung
 * getroffen wurde; die offenen Punkte stehen direkt darüber.
 */
const store = useImpostorStore()
const router = useRouter()

const playerCount = computed(() => store.config.playerNames.length)
const duplicates = computed(() => new Set(findDuplicateNames(store.config.playerNames).map(playerNameKey)))
const recommended = computed(() => recommendedImpostorCount(playerCount.value))

const impostorOptions = computed(() =>
  impostorCountOptions(playerCount.value).map((value) => ({
    value,
    label: String(value),
    badge: value === recommended.value ? 'Empfohlen' : undefined,
  })),
)

const timerOptions = computed(() =>
  IMPOSTOR.timerPresetSeconds.map((seconds) => ({
    value: seconds,
    label: `${seconds / 60} min`,
  })),
)

const customMinutes = ref(0)
const customSeconds = ref(0)
const useCustomTime = ref(false)

const selectedPreset = computed({
  get: () =>
    !useCustomTime.value && store.config.timerSeconds !== null
      ? (IMPOSTOR.timerPresetSeconds as readonly number[]).includes(store.config.timerSeconds)
        ? store.config.timerSeconds
        : null
      : null,
  set: (value: number | null) => {
    useCustomTime.value = false
    store.config.timerSeconds = value
  },
})

function applyCustomTime() {
  useCustomTime.value = true
  const total = Math.round(customMinutes.value) * 60 + Math.round(customSeconds.value)
  store.config.timerSeconds = total >= IMPOSTOR.minTimerSeconds ? total : null
}

const impostorModel = computed({
  get: () => (store.config.impostorCount > 0 ? store.config.impostorCount : null),
  set: (value: number | null) => {
    store.config.impostorCount = value ?? -1
  },
})

function nameError(index: number): string | null {
  const raw = store.config.playerNames[index] ?? ''
  if (raw.trim() === '') return null
  if (visibleLength(raw.trim()) > PLAYER_NAME.maxLength)
    return t('impostor.problem.invalid_name', { max: PLAYER_NAME.maxLength })
  if (duplicates.value.has(playerNameKey(raw))) return t('impostor.problem.duplicate_names')
  return null
}

function addPlayer() {
  if (playerCount.value >= IMPOSTOR.maxPlayers) return
  store.setPlayerCount(playerCount.value + 1)
}

function removePlayer(index: number) {
  if (playerCount.value <= IMPOSTOR.minPlayers) return
  store.config.playerNames.splice(index, 1)
}

function toggleCategory(name: (typeof CATEGORIES)[number], enabled: boolean) {
  const set = new Set(store.config.categories)
  if (enabled) set.add(name)
  else set.delete(name)
  store.config.categories = CATEGORIES.filter((category) => set.has(category))
}

const problemMessages = computed(() =>
  store.problems.map((problem) =>
    t(`impostor.problem.${problem}`, {
      min: IMPOSTOR.minPlayers,
      max: problem === 'invalid_name' ? PLAYER_NAME.maxLength : IMPOSTOR.maxPlayers,
    }),
  ),
)

function start() {
  if (!store.canStart) return
  // Erste Nutzergeste: erlaubt iOS später den Timeralarm.
  void alarmSound.unlock()
  if (!store.createRound()) return
  void router.push({ name: 'impostor-reveal' })
}

onMounted(() => {
  void store.ensurePool()
  analytics.track('impostor_setup_opened', { mode: 'impostor' })
})
</script>

<template>
  <main class="page setup">
    <AppHeader :title="t('impostor.setup.title')" back-to="/" />

    <StatusNote v-if="store.usingOfflinePool" tone="warn" icon="wifi-off">
      {{ t('impostor.setup.pool.offline') }}
    </StatusNote>

    <!-- Spieler -->
    <AppCard :title="t('impostor.setup.players')" :hint="t('impostor.setup.count', { count: playerCount })">
      <template #action>
        <AppButton
          size="sm"
          variant="secondary"
          :disabled="playerCount >= IMPOSTOR.maxPlayers"
          @click="addPlayer"
        >
          <template #icon><AppIcon name="plus" :size="16" /></template>
          {{ t('impostor.setup.addPlayer') }}
        </AppButton>
      </template>

      <ul class="players">
        <li v-for="(_, index) in store.config.playerNames" :key="index" class="players__row">
          <span class="players__num">{{ index + 1 }}</span>
          <TextField
            v-model="store.config.playerNames[index]!"
            class="players__field"
            :placeholder="t('impostor.setup.playerPlaceholder', { number: index + 1 })"
            :maxlength="PLAYER_NAME.maxLength"
            :error="nameError(index)"
            autocomplete="off"
          />
          <button
            class="players__remove"
            type="button"
            :disabled="playerCount <= IMPOSTOR.minPlayers"
            :aria-label="t('impostor.setup.removePlayer', { name: store.config.playerNames[index] || index + 1 })"
            @click="removePlayer(index)"
          >
            <AppIcon name="x" :size="18" />
          </button>
        </li>
      </ul>
      <p class="setup__hint">
        {{ t('impostor.setup.players.hint', { min: IMPOSTOR.minPlayers, max: IMPOSTOR.maxPlayers }) }}
      </p>
    </AppCard>

    <!-- Impostor -->
    <AppCard
      :title="t('impostor.setup.impostors')"
      :hint="t('impostor.setup.impostors.recommendation', { count: playerCount, recommended })"
    >
      <SegmentedField
        v-model="impostorModel"
        :options="impostorOptions"
        :group-label="t('impostor.setup.impostors')"
      />
      <p v-if="impostorModel === null" class="setup__hint setup__hint--attention">
        {{ t('impostor.setup.impostors.choose') }}
      </p>

      <hr class="setup__rule" />

      <ToggleSwitch
        v-model="store.config.impostorsKnowEachOther"
        :label="t('impostor.setup.knowEachOther')"
        :hint="t('impostor.setup.knowEachOther.hint')"
        :disabled="(impostorModel ?? 0) < 2"
      />
    </AppCard>

    <!-- Kategorien -->
    <AppCard
      :title="t('impostor.setup.categories')"
      :hint="t('impostor.setup.categories.selected', { count: store.config.categories.length, total: CATEGORIES.length })"
    >
      <div class="setup__bulk">
        <AppButton size="sm" variant="secondary" @click="store.config.categories = [...CATEGORIES]">
          {{ t('impostor.setup.categories.selectAll') }}
        </AppButton>
        <AppButton size="sm" variant="secondary" @click="store.config.categories = []">
          {{ t('impostor.setup.categories.clearAll') }}
        </AppButton>
      </div>

      <ul>
        <li v-for="category in CATEGORIES" :key="category">
          <CheckRow
            :label="category"
            :model-value="store.config.categories.includes(category)"
            @update:model-value="toggleCategory(category, $event)"
          />
        </li>
      </ul>
      <p v-if="store.config.categories.length > 0" class="setup__hint">
        {{ t('impostor.setup.categories.available', { count: store.availableTerms }) }}
      </p>
    </AppCard>

    <!-- Hinweiswort und Timer -->
    <AppCard>
      <ToggleSwitch
        v-model="store.config.hintsEnabled"
        :label="t('impostor.setup.hints')"
        :hint="t('impostor.setup.hints.hint')"
      />
      <hr class="setup__rule" />
      <ToggleSwitch v-model="store.config.timerEnabled" :label="t('impostor.setup.timer')" />

      <div v-if="store.config.timerEnabled" class="setup__timer">
        <p class="setup__label">{{ t('impostor.setup.timer.duration') }}</p>
        <SegmentedField
          v-model="selectedPreset"
          :options="timerOptions"
          :group-label="t('impostor.setup.timer.duration')"
        />

        <details class="setup__custom" :open="useCustomTime">
          <summary>{{ t('impostor.setup.timer.custom') }}</summary>
          <div class="setup__customGrid">
            <label>
              <span>{{ t('impostor.setup.timer.minutes') }}</span>
              <input
                v-model.number="customMinutes"
                type="number"
                min="0"
                max="60"
                inputmode="numeric"
                @input="applyCustomTime"
              />
            </label>
            <label>
              <span>{{ t('impostor.setup.timer.seconds') }}</span>
              <input
                v-model.number="customSeconds"
                type="number"
                min="0"
                max="59"
                inputmode="numeric"
                @input="applyCustomTime"
              />
            </label>
          </div>
        </details>
      </div>
    </AppCard>

    <StatusNote v-if="problemMessages.length > 0" tone="warn" icon="alert">
      <span v-for="(message, index) in problemMessages" :key="index" class="setup__problem">
        {{ message }}
      </span>
    </StatusNote>
    <StatusNote v-else-if="store.availableTerms === 0" tone="error" icon="alert">
      {{ t('impostor.problem.no_terms') }}
    </StatusNote>

    <AppButton size="lg" block :disabled="!store.canStart" @click="start">
      {{ t('impostor.setup.start') }}
    </AppButton>
  </main>
</template>

<style scoped>
.setup {
  padding-bottom: calc(var(--safe-bottom) + var(--s-8));
}

.players {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.players__row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) var(--touch);
  align-items: start;
  gap: var(--s-2);
}

.players__num {
  padding-top: 13px;
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-dim);
  text-align: right;
}

.players__remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch);
  height: var(--touch);
  color: var(--c-text-dim);
  border-radius: var(--r-md);
}

.players__remove:disabled {
  opacity: 0.3;
}

.players__remove:active:not(:disabled) {
  color: var(--c-danger);
  background: rgb(255 59 48 / 10%);
}

.setup__hint {
  margin-top: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.setup__hint--attention {
  color: var(--c-warning);
}

.setup__label {
  margin-bottom: var(--s-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text-muted);
}

.setup__rule {
  height: 1px;
  margin: var(--s-3) 0;
  border: none;
  background: var(--c-line);
}

.setup__bulk {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  margin-bottom: var(--s-2);
}

.setup__bulk :deep(.btn) {
  flex: 1 1 130px;
}

.setup__timer {
  margin-top: var(--s-4);
}

.setup__custom {
  margin-top: var(--s-3);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.setup__custom summary {
  min-height: var(--touch);
  display: flex;
  align-items: center;
  cursor: pointer;
}

.setup__customGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-3);
}

.setup__customGrid label {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}

.setup__customGrid input {
  width: 100%;
  min-width: 0;
  min-height: var(--touch);
  padding: var(--s-2) var(--s-3);
  font-size: 16px;
  color: var(--c-text);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
}

.setup__problem {
  display: block;
}

@media (max-width: 340px) {
  .setup__customGrid {
    grid-template-columns: 1fr;
  }
}
</style>
