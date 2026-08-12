<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SwipeRevealCard from '@/components/impostor/SwipeRevealCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { t } from '@/i18n'
import { useImpostorStore } from '@/stores/impostor'

/**
 * Rollenaufdeckung mit Übergabeschritt.
 *
 * Zwischen zwei Spielern liegt immer ein neutraler Übergabebildschirm, und die
 * Swipe-Karte wird über `:key` neu erzeugt. So kann die Rolle des vorherigen
 * Spielers beim Weitergeben nicht mehr sichtbar sein.
 */
const store = useImpostorStore()
const router = useRouter()

const revealed = ref(false)
/** Neutraler Zwischenschritt: „Weitergeben an <Name>“. */
const handingOver = ref(false)
const leaveOpen = ref(false)

const round = computed(() => store.round)
const assignment = computed(() => store.currentAssignment)
const isImpostor = computed(() => assignment.value?.role === 'impostor')
const total = computed(() => round.value?.assignments.length ?? 0)

onMounted(() => {
  if (!round.value) void router.replace({ name: 'impostor-setup' })
  else if (round.value.phase !== 'reveal') void router.replace({ name: 'impostor-round' })
})

watch(
  () => store.round?.phase,
  (phase) => {
    if (phase === 'ready') void router.replace({ name: 'impostor-round' })
  },
)

function confirm() {
  revealed.value = false
  store.confirmReveal()
  if (store.round?.phase === 'reveal') handingOver.value = true
}

function takeOver() {
  handingOver.value = false
}

function leave() {
  store.abandonRound()
  void router.replace({ name: 'impostor-setup' })
}
</script>

<template>
  <main v-if="round && assignment" class="page reveal-page">
    <AppHeader
      :title="t('impostor.reveal.title')"
      :subtitle="t('impostor.reveal.progress', { current: store.currentPlayerIndex + 1, total })"
      intercept-back
      @back="leaveOpen = true"
    />

    <!-- Übergabe: hier ist garantiert nichts Geheimes sichtbar -->
    <section v-if="handingOver" class="handover">
      <p class="handover__label">{{ t('impostor.reveal.pass') }}</p>
      <p class="handover__name">{{ assignment.playerName }}</p>
      <p class="handover__hint">{{ t('impostor.reveal.passHint') }}</p>
      <AppButton size="lg" block @click="takeOver">{{ t('impostor.reveal.ready') }}</AppButton>
    </section>

    <template v-else>
      <SwipeRevealCard
        :key="`${round.id}-${store.currentPlayerIndex}`"
        :player-name="assignment.playerName"
        @revealed="revealed = true"
      >
        <div v-if="isImpostor" class="role role--impostor">
          <p class="role__title">{{ t('impostor.reveal.role.impostor') }}</p>
          <div v-if="round.config.hintsEnabled" class="role__block">
            <p class="role__label">{{ t('impostor.reveal.role.hint') }}</p>
            <p class="role__value">{{ round.term.hintTerm }}</p>
          </div>
          <div v-if="round.config.impostorsKnowEachOther" class="role__block">
            <p class="role__label">{{ t('impostor.reveal.role.fellows') }}</p>
            <p class="role__value role__value--small">
              {{ store.currentFellows.length ? store.currentFellows.join(' · ') : t('impostor.reveal.role.fellowsNone') }}
            </p>
          </div>
        </div>

        <div v-else class="role role--crew">
          <p class="role__word">{{ round.term.displayTerm }}</p>
        </div>
      </SwipeRevealCard>

      <AppButton size="lg" block :disabled="!revealed" @click="confirm">
        <template #icon><AppIcon name="check" :size="19" /></template>
        {{ t('impostor.reveal.confirm') }}
      </AppButton>
    </template>

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
.reveal-page {
  justify-content: center;
  gap: var(--s-5);
}

.handover {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-8) var(--s-5);
  text-align: center;
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-card);
}

.handover__label {
  font-size: var(--fs-sm);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--c-text-dim);
}

.handover__name {
  font-size: var(--fs-3xl);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.handover__hint {
  margin-bottom: var(--s-4);
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.role {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-4);
  width: 100%;
  height: 100%;
  padding: var(--s-6) var(--s-4);
  justify-content: center;
  text-align: center;
  border-radius: var(--r-xl);
  border: 1px solid;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.role--crew {
  background: linear-gradient(165deg, #0f3f3a 0%, #06201f 55%, #030f10 100%);
  border-color: var(--c-impostor-deep);
  box-shadow: inset 0 0 60px rgb(42 207 185 / 12%);
}

/* Der Impostor-Moment ist bewusst rot – das ist der dramatische Bruch. */
.role--impostor {
  background: var(--g-danger);
  border-color: #7a1109;
  box-shadow: inset 0 0 70px rgb(255 59 48 / 14%);
}

.role__word {
  font-size: var(--fs-3xl);
  font-weight: 800;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.role__title {
  font-size: var(--fs-3xl);
  font-weight: 900;
  letter-spacing: 0.02em;
  color: #ff5b4f;
  text-shadow: 0 0 26px var(--c-danger-glow);
}

.role__block {
  min-width: 60%;
  padding: var(--s-2) var(--s-4);
  border-radius: var(--r-md);
  background: rgb(0 0 0 / 28%);
}

.role__label {
  font-size: var(--fs-xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 55%);
}

.role__value {
  font-size: var(--fs-xl);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.role__value--small {
  font-size: var(--fs-md);
  font-weight: 600;
}
</style>
