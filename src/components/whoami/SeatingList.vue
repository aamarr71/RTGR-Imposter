<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { t } from '@/i18n'
import type { RoomPlayerView } from '@shared/types'

/**
 * Sitzordnung der Lobby.
 *
 * Umsortieren geht per Drag-and-drop am Griff **und** über Pfeiltasten – reines
 * Drag-and-drop wäre auf Touch-Geräten und mit Tastatur nicht bedienbar. Die
 * Nummern werden nach jeder Änderung lückenlos neu vergeben.
 */
const props = defineProps<{
  players: RoomPlayerView[]
  youId: string
  canEdit: boolean
  showSubmissionState: boolean
}>()

const emit = defineEmits<{
  reorder: [orderedIds: string[]]
  remove: [playerId: string]
  makeHost: [playerId: string]
  resetTerm: [playerId: string]
}>()

/** Lokale Kopie, damit das Ziehen flüssig bleibt, ohne auf den Server zu warten. */
const local = ref<RoomPlayerView[]>([...props.players])
const dragIndex = ref<number | null>(null)
const listEl = ref<HTMLUListElement | null>(null)

watch(
  () => props.players,
  (next) => {
    if (dragIndex.value === null) local.value = [...next]
  },
  { deep: true },
)

const rows = computed(() => local.value)

function move(from: number, to: number) {
  if (to < 0 || to >= local.value.length || from === to) return
  const copy = [...local.value]
  const [item] = copy.splice(from, 1)
  if (!item) return
  copy.splice(to, 0, item)
  local.value = copy
}

function commit() {
  emit('reorder', local.value.map((player) => player.id))
}

function shift(index: number, delta: number) {
  move(index, index + delta)
  commit()
}

function onPointerDown(event: PointerEvent, index: number) {
  if (!props.canEdit) return
  dragIndex.value = index
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (dragIndex.value === null || !listEl.value) return
  const items = [...listEl.value.querySelectorAll<HTMLLIElement>('[data-row]')]
  const target = items.findIndex((item) => {
    const box = item.getBoundingClientRect()
    return event.clientY >= box.top && event.clientY <= box.bottom
  })
  if (target >= 0 && target !== dragIndex.value) {
    move(dragIndex.value, target)
    dragIndex.value = target
  }
}

function onPointerUp() {
  if (dragIndex.value === null) return
  dragIndex.value = null
  commit()
}
</script>

<template>
  <ul ref="listEl" class="seats">
    <li
      v-for="(player, index) in rows"
      :key="player.id"
      data-row
      class="seat"
      :class="{ 'is-you': player.id === youId, 'is-dragging': dragIndex === index }"
    >
      <button
        v-if="canEdit"
        class="seat__grip"
        type="button"
        :aria-label="t('whoami.lobby.reorder')"
        @pointerdown="onPointerDown($event, index)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <AppIcon name="grip" :size="18" />
      </button>

      <span class="seat__num">{{ index + 1 }}</span>

      <span class="seat__name">
        <span class="seat__nameText">{{ player.name }}</span>
        <span v-if="player.id === youId" class="seat__tag">{{ t('whoami.lobby.you') }}</span>
        <AppIcon v-if="player.isHost" name="crown" :size="14" class="seat__host" />
      </span>

      <span class="seat__state">
        <span
          v-if="showSubmissionState"
          class="seat__dot"
          :class="player.hasSubmittedTerm ? 'is-done' : 'is-open'"
          :title="player.hasSubmittedTerm ? t('whoami.lobby.termSubmitted') : t('whoami.lobby.termMissing')"
        />
        <AppIcon
          :name="player.online ? 'wifi' : 'wifi-off'"
          :size="15"
          :class="['seat__conn', { 'is-offline': !player.online }]"
        />
      </span>

      <div v-if="canEdit" class="seat__tools">
        <details class="seat__menu">
          <summary :aria-label="t('whoami.lobby.hostTools')">···</summary>
          <div class="seat__menuBody">
            <button type="button" :disabled="index === 0" @click="shift(index, -1)">
              {{ t('whoami.lobby.moveUp') }}
            </button>
            <button type="button" :disabled="index === rows.length - 1" @click="shift(index, 1)">
              {{ t('whoami.lobby.moveDown') }}
            </button>
            <button v-if="player.id !== youId" type="button" @click="emit('makeHost', player.id)">
              {{ t('whoami.lobby.makeHost') }}
            </button>
            <button v-if="player.hasSubmittedTerm" type="button" @click="emit('resetTerm', player.id)">
              {{ t('whoami.lobby.resetTerm') }}
            </button>
            <button v-if="player.id !== youId" type="button" class="is-danger" @click="emit('remove', player.id)">
              {{ t('whoami.lobby.kick') }}
            </button>
          </div>
        </details>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.seats {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.seat {
  display: grid;
  /* minmax(0, 1fr) für den Namen: sonst sprengt ein langer Name das Raster. */
  grid-template-columns: auto 22px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--s-2);
  min-height: 52px;
  padding: var(--s-2) var(--s-2) var(--s-2) var(--s-1);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  transition:
    background-color var(--t-fast) var(--e-out),
    border-color var(--t-fast) var(--e-out),
    transform var(--t-base) var(--e-out);
}

.seat.is-you {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 8%, var(--c-surface-2));
}

.seat.is-dragging {
  transform: scale(1.02);
  box-shadow: var(--sh-raised);
  border-color: var(--c-accent);
}

.seat__grip {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 44px;
  margin-left: -6px;
  color: var(--c-text-dim);
  cursor: grab;
  touch-action: none;
}

.seat__num {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--c-accent);
  text-align: center;
}

.seat__name {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
  font-weight: 550;
}

.seat__nameText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seat__tag {
  flex: none;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--c-accent);
  border: 1px solid currentcolor;
  border-radius: var(--r-pill);
}

.seat__host {
  color: var(--c-warning);
}

.seat__state {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.seat__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.seat__dot.is-done {
  background: var(--c-success);
  box-shadow: 0 0 8px var(--c-success);
}

.seat__dot.is-open {
  background: transparent;
  border: 1.5px solid var(--c-text-dim);
}

.seat__conn {
  color: var(--c-text-dim);
}

.seat__conn.is-offline {
  color: var(--c-warning);
}

.seat__tools {
  display: flex;
  align-items: center;
}

.seat__menu summary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 44px;
  font-size: var(--fs-lg);
  line-height: 1;
  color: var(--c-text-dim);
  list-style: none;
  cursor: pointer;
}

.seat__menuBody button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.seat__menu {
  position: relative;
}

.seat__menu summary::-webkit-details-marker {
  display: none;
}

.seat__menuBody {
  position: absolute;
  right: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  width: 190px;
  max-width: calc(
    100vi - var(--safe-left) - var(--safe-right) - 2 * var(--page-inline)
  );
  max-width: calc(
    100dvi - var(--safe-left) - var(--safe-right) - 2 * var(--page-inline)
  );
  padding: var(--s-1);
  background: var(--c-surface-3);
  border: 1px solid var(--c-line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--sh-card);
}

.seat__menuBody button {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 40px;
  padding: 0 var(--s-3);
  font-size: var(--fs-sm);
  text-align: left;
  color: var(--c-text);
  border-radius: var(--r-sm);
}

.seat__menuBody button:active:not(:disabled) {
  background: rgb(255 255 255 / 6%);
}

.seat__menuBody button.is-danger {
  color: var(--c-danger);
}
</style>
