<script setup lang="ts">
import { computed } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { t } from '@/i18n'
import type { RoomBoardEntry } from '@shared/types'

type RankedEntry = RoomBoardEntry & { placement: number }

const props = defineProps<{
  entries: RankedEntry[]
  roundNumber: number
  isHost: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  nextRound: []
  reset: [entry: RankedEntry]
}>()

const podium = computed(() => props.entries.filter((entry) => entry.placement <= 3))
const remaining = computed(() => props.entries.filter((entry) => entry.placement > 3))
const resettable = computed(() =>
  props.entries.filter((entry) => !entry.placementAutomatic && entry.placementClaimId),
)

function termFor(entry: RankedEntry): string {
  return entry.term ?? t('whoami.result.termUnavailable')
}
</script>

<template>
  <section class="roundResult" aria-labelledby="round-result-title">
    <header class="roundResult__header">
      <p class="roundResult__eyebrow">
        <AppIcon name="check" :size="15" />
        {{ t('whoami.result.roundEnded', { number: roundNumber }) }}
      </p>
      <h2 id="round-result-title" class="roundResult__title">
        {{ t('whoami.result.title') }}
      </h2>
    </header>

    <ol class="podium" :aria-label="t('whoami.result.title')">
      <li
        v-for="entry in podium"
        :key="entry.playerId"
        class="podium__place"
        :class="`podium__place--${entry.placement}`"
      >
        <div class="podium__medal" aria-hidden="true">{{ entry.placement }}</div>
        <p class="podium__name">{{ entry.name }}</p>
        <p class="podium__term">{{ termFor(entry) }}</p>
        <div class="podium__step" aria-hidden="true">
          <span>{{ entry.placement }}</span>
        </div>
        <span class="sr-only">{{ t('whoami.result.place', { place: entry.placement }) }}</span>
      </li>
    </ol>

    <section v-if="remaining.length > 0" class="roundResult__remaining">
      <h2 class="roundResult__remainingTitle">{{ t('whoami.result.more') }}</h2>
      <ol class="resultList" :start="4">
        <li v-for="entry in remaining" :key="entry.playerId" class="resultList__row">
          <span class="resultList__place">{{ entry.placement }}.</span>
          <span class="resultList__identity">
            <strong>{{ entry.name }}</strong>
            <span>{{ termFor(entry) }}</span>
          </span>
        </li>
      </ol>
    </section>

    <AppButton
      v-if="isHost"
      size="lg"
      block
      :loading="busy"
      @click="emit('nextRound')"
    >
      <template #icon><AppIcon name="chevron-right" :size="19" /></template>
      {{ t('whoami.result.nextRound') }}
    </AppButton>
    <p v-else class="roundResult__waiting" aria-live="polite">
      <span class="roundResult__waitingDot" aria-hidden="true" />
      {{ t('whoami.result.waitingForHost') }}
    </p>

    <details v-if="isHost && resettable.length > 0" class="roundResult__correction">
      <summary>{{ t('whoami.result.correct') }}</summary>
      <ul class="roundResult__correctionList">
        <li v-for="entry in resettable" :key="entry.playerId">
          <span>{{ entry.name }}</span>
          <AppButton
            size="sm"
            variant="ghost"
            :disabled="busy"
            :aria-label="t('whoami.ranking.resetFor', { name: entry.name })"
            @click="emit('reset', entry)"
          >
            {{ t('whoami.ranking.reset') }}
          </AppButton>
        </li>
      </ul>
    </details>
  </section>
</template>

<style scoped>
.roundResult {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
  padding: clamp(20px, 6vw, 28px) var(--card-padding);
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 8%, rgb(242 140 29 / 20%), transparent 36%),
    linear-gradient(165deg, rgb(255 255 255 / 3%), transparent 52%),
    var(--c-surface);
  border: 1px solid color-mix(in srgb, var(--c-accent) 32%, var(--c-line));
  border-radius: var(--r-xl);
  box-shadow: var(--sh-card), var(--sh-inset);
}

.roundResult::before,
.roundResult::after {
  position: absolute;
  width: 7px;
  height: 7px;
  content: '';
  background: var(--c-accent);
  border-radius: 2px;
  opacity: 0.5;
  transform: rotate(24deg);
}

.roundResult::before {
  top: 76px;
  left: 9%;
}

.roundResult::after {
  top: 42px;
  right: 12%;
  background: var(--c-success);
  transform: rotate(-18deg);
}

.roundResult__header {
  position: relative;
  z-index: 1;
  text-align: center;
}

.roundResult__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: var(--s-1);
  margin-bottom: var(--s-2);
  font-size: var(--fs-sm);
  font-weight: 750;
  letter-spacing: 0.1em;
  color: var(--c-accent);
  text-transform: uppercase;
}

.roundResult__title {
  font-size: var(--fs-4xl);
  line-height: 1.05;
  letter-spacing: -0.035em;
}

.podium {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: clamp(6px, 2vw, 10px);
  min-height: 244px;
  padding-top: var(--s-5);
}

.podium__place {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  animation: podium-arrive 520ms var(--e-spring) both;
}

.podium__place--1 {
  grid-column: 2;
  grid-row: 1;
  z-index: 2;
  animation-delay: 80ms;
}

.podium__place--2 {
  grid-column: 1;
  grid-row: 1;
  animation-delay: 160ms;
}

.podium__place--3 {
  grid-column: 3;
  grid-row: 1;
  animation-delay: 220ms;
}

.podium__medal {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-bottom: var(--s-2);
  font-size: var(--fs-sm);
  font-weight: 900;
  color: #241402;
  background: #e5ad4a;
  border: 2px solid rgb(255 255 255 / 42%);
  border-radius: 50%;
  box-shadow: 0 5px 16px rgb(0 0 0 / 32%);
}

.podium__place--1 .podium__medal {
  width: 38px;
  height: 38px;
  color: #2c1900;
  background: linear-gradient(145deg, #ffe18b, #f0a619);
  box-shadow: 0 0 24px rgb(242 140 29 / 38%);
}

.podium__place--2 .podium__medal {
  color: #18202a;
  background: linear-gradient(145deg, #e3e8ee, #9ba7b5);
}

.podium__place--3 .podium__medal {
  color: #2d170d;
  background: linear-gradient(145deg, #e1a078, #9f5c3b);
}

.podium__name,
.podium__term {
  width: 100%;
  padding: 0 2px;
  text-align: center;
  overflow-wrap: anywhere;
}

.podium__name {
  font-size: clamp(0.8rem, 3.5vw, 1rem);
  font-weight: 800;
  line-height: 1.2;
}

.podium__term {
  min-height: 2.6em;
  margin-top: var(--s-1);
  font-size: clamp(0.7rem, 3vw, var(--fs-sm));
  line-height: 1.3;
  color: var(--c-text-muted);
}

.podium__step {
  display: grid;
  place-items: center;
  width: 100%;
  height: 52px;
  margin-top: var(--s-2);
  color: rgb(255 255 255 / 45%);
  background: linear-gradient(180deg, rgb(242 140 29 / 23%), rgb(242 140 29 / 7%));
  border: 1px solid rgb(242 140 29 / 22%);
  border-bottom: 0;
  border-radius: var(--r-md) var(--r-md) 0 0;
}

.podium__step span {
  font-size: var(--fs-2xl);
  font-weight: 900;
}

.podium__place--1 .podium__step {
  height: 92px;
  color: var(--c-accent);
  background: linear-gradient(180deg, rgb(242 140 29 / 40%), rgb(242 140 29 / 12%));
  border-color: rgb(242 140 29 / 44%);
}

.podium__place--2 .podium__step {
  height: 66px;
}

.roundResult__remaining {
  padding-top: var(--s-4);
  border-top: 1px solid var(--c-line);
}

.roundResult__remainingTitle {
  margin-bottom: var(--s-2);
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--c-text-muted);
}

.resultList {
  display: flex;
  flex-direction: column;
}

.resultList__row {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  min-height: 50px;
  padding: var(--s-2) 0;
  border-bottom: 1px solid var(--c-line);
}

.resultList__row:last-child {
  border-bottom: 0;
}

.resultList__place {
  width: 28px;
  flex: none;
  font-weight: 850;
  color: var(--c-accent);
  text-align: center;
}

.resultList__identity {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.resultList__identity strong,
.resultList__identity span {
  overflow-wrap: anywhere;
}

.resultList__identity span {
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.roundResult__waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  min-height: 56px;
  font-weight: 650;
  color: var(--c-text-muted);
}

.roundResult__waitingDot {
  width: 8px;
  height: 8px;
  background: var(--c-accent);
  border-radius: 50%;
  box-shadow: 0 0 0 0 var(--c-accent-glow);
  animation: waiting-pulse 1.8s var(--e-out) infinite;
}

.roundResult__correction {
  color: var(--c-text-dim);
}

.roundResult__correction summary {
  width: fit-content;
  margin: 0 auto;
  padding: var(--s-2);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.roundResult__correctionList {
  margin-top: var(--s-2);
  padding: var(--s-2);
  background: rgb(0 0 0 / 14%);
  border-radius: var(--r-md);
}

.roundResult__correctionList li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-2);
  min-height: var(--touch);
  border-bottom: 1px solid var(--c-line);
}

.roundResult__correctionList li:last-child {
  border-bottom: 0;
}

@keyframes podium-arrive {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.96);
  }
}

@keyframes waiting-pulse {
  50% {
    box-shadow: 0 0 0 8px transparent;
  }
}

@media (max-width: 360px) {
  .roundResult {
    padding-right: var(--s-2);
    padding-left: var(--s-2);
  }

  .podium {
    gap: var(--s-1);
  }
}
</style>
