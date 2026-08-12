<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { IMPOSTOR } from '@shared/config'
import { t } from '@/i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import { haptics } from '@/services/haptics'

/**
 * Die Rollenaufdeckung: eine Namenskarte, die der Spieler nach oben zieht.
 *
 * Die Karte folgt dem Finger unmittelbar (kein Easing während der Geste), der
 * Inhalt darunter wird proportional zur Zugdistanz enthüllt. Erst bei
 * vollständiger Enthüllung gibt es kurzes haptisches Feedback und die
 * Bestätigung wird freigeschaltet; ein zu kurzer Zug federt sauber zurück.
 */
const props = defineProps<{ playerName: string; distance?: number }>()
const emit = defineEmits<{ revealed: [] }>()

const viewportHeight = ref(
  typeof window === 'undefined' ? 720 : (window.visualViewport?.height ?? window.innerHeight),
)

/**
 * Auf kurzen Phones und im Querformat verkürzt sich die Geste anhand des
 * tatsächlichen Visual Viewports. Ein explizites `distance` bleibt für Tests
 * und gezielte Varianten verbindlich.
 */
const travel = computed(
  () => props.distance ?? Math.round(Math.min(220, Math.max(100, viewportHeight.value * 0.25))),
)
const stageHeight = computed(() => travel.value + 120)

const offset = ref(0)
const dragging = ref(false)
const locked = ref(false)
const startY = ref(0)

const progress = computed(() => Math.min(1, Math.max(0, offset.value / travel.value)))
const isRevealed = computed(() => locked.value)

function syncViewportHeight() {
  viewportHeight.value = window.visualViewport?.height ?? window.innerHeight
  offset.value = locked.value ? travel.value : Math.min(offset.value, travel.value)
}

onMounted(() => {
  syncViewportHeight()
  window.addEventListener('resize', syncViewportHeight)
  window.visualViewport?.addEventListener('resize', syncViewportHeight)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewportHeight)
  window.visualViewport?.removeEventListener('resize', syncViewportHeight)
})

function onPointerDown(event: PointerEvent) {
  if (locked.value) return
  dragging.value = true
  startY.value = event.clientY
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || locked.value) return
  // Nur nach oben; leichtes Überziehen wird gekappt statt gummiartig gedehnt.
  const delta = startY.value - event.clientY
  offset.value = Math.min(travel.value, Math.max(0, delta))
}

function finishDrag() {
  if (!dragging.value) return
  dragging.value = false
  if (progress.value >= IMPOSTOR.revealThreshold) {
    offset.value = travel.value
    locked.value = true
    haptics.play('success')
    emit('revealed')
  } else {
    offset.value = 0
  }
}

/** Tastatur- und Screenreader-Pfad – ohne ihn wäre die Rolle nicht erreichbar. */
function revealDirectly() {
  if (locked.value) return
  offset.value = travel.value
  locked.value = true
  haptics.play('success')
  emit('revealed')
}
</script>

<template>
  <div class="reveal" :style="{ '--travel': `${travel}px`, '--p': progress }">
    <p class="reveal__instruction" :class="{ 'is-hidden': isRevealed }">
      {{ t('impostor.reveal.instruction') }}
    </p>

    <div class="reveal__stage" :style="{ height: `${stageHeight}px` }">
      <!-- Rolleninhalt, liegt verdeckt unter der Namenskarte -->
      <div class="reveal__content" :aria-hidden="!isRevealed">
        <slot />
      </div>

      <!-- Namenskarte -->
      <div
        class="reveal__cover"
        :class="{ 'is-dragging': dragging, 'is-open': isRevealed }"
        :style="{ transform: `translate3d(0, ${-offset}px, 0)` }"
        role="button"
        tabindex="0"
        :aria-label="t('impostor.reveal.instruction')"
        :aria-expanded="isRevealed"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="finishDrag"
        @pointercancel="finishDrag"
        @keydown.enter.prevent="revealDirectly"
        @keydown.space.prevent="revealDirectly"
      >
        <p class="reveal__name">{{ playerName }}</p>
        <div class="reveal__arrow" aria-hidden="true">
          <AppIcon name="arrow-up" :size="26" />
        </div>
        <p class="reveal__pull" aria-hidden="true">{{ t('impostor.reveal.pull') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reveal {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.reveal__instruction {
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
  transition: opacity var(--t-base) var(--e-out);
}

.reveal__instruction.is-hidden {
  opacity: 0;
}

.reveal__stage {
  position: relative;
  overflow: hidden;
  border-radius: var(--r-xl);
}

.reveal__content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-4);
  /* Kein plötzliches Einblenden: Sichtbarkeit hängt direkt an der Zugdistanz. */
  opacity: calc(0.12 + var(--p) * 0.88);
  transform: scale(calc(0.94 + var(--p) * 0.06));
  transition: opacity 40ms linear, transform 40ms linear;
}

.reveal__cover {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--s-3);
  padding: var(--s-5);
  cursor: grab;
  user-select: none;
  touch-action: none;
  background: linear-gradient(168deg, #1a2430 0%, #0d131b 55%, #080c12 100%);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-xl);
  box-shadow: var(--sh-card);
  transition:
    transform var(--t-slow) var(--e-spring),
    opacity var(--t-base) var(--e-out);
}

/* Während der Geste folgt die Karte ohne Verzögerung dem Finger. */
.reveal__cover.is-dragging {
  transition: none;
  cursor: grabbing;
}

.reveal__cover.is-open {
  opacity: 0;
  pointer-events: none;
}

.reveal__name {
  font-size: var(--fs-3xl);
  font-weight: 800;
  letter-spacing: 0.01em;
  text-align: center;
  overflow-wrap: anywhere;
}

.reveal__arrow {
  color: var(--c-accent);
  animation: nudge 1.8s var(--e-inout) infinite;
}

.reveal__pull {
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.22em;
  color: var(--c-text-dim);
}

@keyframes nudge {
  0%,
  100% {
    transform: translateY(4px);
    opacity: 0.55;
  }

  50% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reveal__arrow {
    animation: none;
  }
}
</style>
