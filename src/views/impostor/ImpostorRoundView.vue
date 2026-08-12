<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useCountdown } from '@/composables/useCountdown'
import { t } from '@/i18n'
import { IMPOSTOR } from '@shared/config'
import { alarmSound } from '@/services/audio'
import { useImpostorStore } from '@/stores/impostor'
import { useSettingsStore } from '@/stores/settings'

/**
 * Rundenstart und freie Spielphase.
 *
 * Der Timer startet erst mit „Runde starten“ und wird als absoluter
 * Endzeitpunkt gespeichert – ein Reload setzt ihn nicht zurück, und ein bereits
 * abgelaufener Timer landet sofort im Alarmzustand.
 */
const store = useImpostorStore()
const settings = useSettingsStore()
const router = useRouter()

const round = computed(() => store.round)
const leaveOpen = ref(false)
let announceTimer: ReturnType<typeof setTimeout> | null = null

const startPlayerName = computed(() => {
  const index = round.value?.startPlayerIndex
  if (index === null || index === undefined) return ''
  return round.value?.assignments[index]?.playerName ?? ''
})

const timerEndsAt = computed(() => round.value?.timerEndsAt ?? null)
const countdown = useCountdown(timerEndsAt, () => store.triggerAlarm())

onMounted(() => {
  if (!round.value) {
    void router.replace({ name: 'impostor-setup' })
    return
  }
  if (round.value.phase === 'reveal') {
    void router.replace({ name: 'impostor-reveal' })
    return
  }
  if (round.value.phase === 'revealed') {
    void router.replace({ name: 'impostor-result' })
    return
  }
  // Nach einem Reload mitten in der Ansage direkt in die Spielphase wechseln.
  if (round.value.phase === 'announcing') scheduleAnnouncement()
})

onBeforeUnmount(() => {
  if (announceTimer !== null) clearTimeout(announceTimer)
  void alarmSound.stop()
})

function scheduleAnnouncement() {
  if (announceTimer !== null) clearTimeout(announceTimer)
  announceTimer = setTimeout(
    () => store.enterPlayingPhase(),
    IMPOSTOR.startPlayerAnnouncementSeconds * 1000,
  )
}

function begin() {
  void alarmSound.unlock()
  store.beginRound()
  scheduleAnnouncement()
}

/** Alarm: wiederholter Weckerton, muss aktiv beendet werden. */
watch(
  () => round.value?.timerAlarmActive,
  (active) => {
    if (active) void alarmSound.start(settings.effectiveVolume)
    else alarmSound.stop()
  },
  { immediate: true },
)

function stopAlarm() {
  store.stopAlarm()
  alarmSound.stop()
}

function reveal() {
  alarmSound.stop()
  store.revealImpostors()
  void router.replace({ name: 'impostor-result' })
}

function leave() {
  alarmSound.stop()
  store.abandonRound()
  void router.replace({ name: 'impostor-setup' })
}
</script>

<template>
  <main v-if="round" class="page round">
    <AppHeader :title="t('impostor.play.title')" intercept-back @back="leaveOpen = true" />

    <!-- Alle haben ihre Rolle gesehen -->
    <section v-if="round.phase === 'ready'" class="panel">
      <h2 class="panel__title">{{ t('impostor.ready.title') }}</h2>
      <p class="panel__body">{{ t('impostor.ready.body') }}</p>
      <AppButton size="lg" block @click="begin">{{ t('impostor.ready.start') }}</AppButton>
    </section>

    <!-- Startspieler, fünf Sekunden groß -->
    <section v-else-if="round.phase === 'announcing'" class="announce">
      <p class="announce__text">{{ t('impostor.announce.begins', { name: startPlayerName }) }}</p>
    </section>

    <!-- Freie Spielphase -->
    <section v-else class="play">
      <div v-if="round.timerAlarmActive" class="alarm">
        <p class="alarm__title">{{ t('impostor.timer.alarm') }}</p>
        <AppButton size="lg" variant="danger" block @click="stopAlarm">
          {{ t('impostor.timer.stop') }}
        </AppButton>
      </div>

      <div v-else-if="countdown.formatted.value" class="timer" :class="{ 'is-urgent': countdown.isUrgent.value }">
        <AppIcon name="clock" :size="18" />
        <span class="timer__value">{{ countdown.formatted.value }}</span>
      </div>
      <p v-else class="play__noTimer">{{ t('impostor.play.noTimer') }}</p>

      <p class="play__start">{{ t('impostor.announce.begins', { name: startPlayerName }) }}</p>
      <p class="play__hint">{{ t('impostor.play.hint') }}</p>

      <div class="play__actions">
        <AppButton size="lg" block @click="reveal">
          <template #icon><AppIcon name="eye" :size="19" /></template>
          {{ t('impostor.play.reveal') }}
        </AppButton>
        <AppButton variant="ghost" block @click="leaveOpen = true">
          {{ t('impostor.play.leave') }}
        </AppButton>
      </div>
    </section>

    <AppDialog :open="leaveOpen" :title="t('impostor.play.leaveConfirm')" @close="leaveOpen = false">
      {{ t('impostor.play.leaveBody') }}
      <template #actions>
        <AppButton variant="danger" block @click="leave">{{ t('impostor.play.leave') }}</AppButton>
        <AppButton variant="ghost" block @click="leaveOpen = false">{{ t('common.cancel') }}</AppButton>
      </template>
    </AppDialog>
  </main>
</template>

<style scoped>
.round {
  justify-content: center;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
  padding: var(--s-7) var(--s-5);
  text-align: center;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-card);
}

.panel__title {
  font-size: var(--fs-xl);
  font-weight: 700;
}

.panel__body {
  margin-bottom: var(--s-4);
  color: var(--c-text-muted);
}

.announce {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 46vh;
  min-height: 46dvh;
  text-align: center;
}

@media (max-height: 520px) {
  .announce {
    min-height: 34vh;
    min-height: 34dvh;
  }
}

.announce__text {
  font-size: var(--fs-4xl);
  font-weight: 900;
  line-height: 1.1;
  overflow-wrap: anywhere;
  animation: pop var(--t-slow) var(--e-spring);
}

.play {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-4);
  text-align: center;
}

.timer {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-3) var(--s-6);
  color: var(--c-accent);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-pill);
  box-shadow: var(--sh-raised);
}

.timer__value {
  font-size: var(--fs-3xl);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* In den letzten Sekunden pulsiert der Timer. */
.timer.is-urgent {
  color: #ff6a5e;
  border-color: rgb(255 59 48 / 45%);
  animation: pulse 1s var(--e-inout) infinite;
}

.play__noTimer {
  font-size: var(--fs-sm);
  color: var(--c-text-dim);
}

.play__start {
  font-size: var(--fs-xl);
  font-weight: 700;
}

.play__hint {
  max-width: 34ch;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.play__actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  margin-top: var(--s-5);
}

.alarm {
  display: flex;
  flex-direction: column;
  gap: var(--s-4);
  width: 100%;
  padding: var(--s-6);
  text-align: center;
  background: var(--g-danger);
  border: 1px solid #7a1109;
  border-radius: var(--r-xl);
  animation: pulse 0.9s var(--e-inout) infinite;
}

.alarm__title {
  font-size: var(--fs-2xl);
  font-weight: 800;
  color: #ff6a5e;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.86);
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.035);
  }
}

@media (prefers-reduced-motion: reduce) {
  .timer.is-urgent,
  .alarm,
  .announce__text {
    animation: none;
  }
}
</style>
