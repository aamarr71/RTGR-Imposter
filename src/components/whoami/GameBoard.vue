<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { t } from '@/i18n'
import type { RoomBoardEntry } from '@shared/types'

/**
 * Spielansicht: alle Mitspieler in Sitzreihenfolge mit ihrem Begriff.
 *
 * Für den eigenen Platz liefert der Server `term: null` – die Ersatzanzeige
 * ist keine CSS-Maskierung, sondern der einzige Wert, den dieser Client
 * überhaupt kennt.
 */
defineProps<{ entries: RoomBoardEntry[] }>()

function placementLabel(entry: RoomBoardEntry): string {
  if (entry.roundState === 'finished' && entry.placement !== null) {
    return entry.placementAutomatic
      ? t('whoami.ranking.placeAutomatic', { place: entry.placement })
      : t('whoami.ranking.place', { place: entry.placement })
  }
  return entry.roundState === 'pending'
    ? t('whoami.ranking.pending')
    : t('whoami.ranking.active')
}
</script>

<template>
  <ul class="board">
    <li
      v-for="entry in entries"
      :key="entry.playerId"
      class="board__row"
      :class="{
        'is-self': entry.isSelf,
        'is-pending': entry.roundState === 'pending',
        'is-finished': entry.roundState === 'finished',
      }"
    >
      <span class="board__seat">{{ entry.seat }}</span>
      <span class="board__name">
        <span class="board__nameText">{{ entry.isSelf ? t('whoami.game.you') : entry.name }}</span>
        <AppIcon v-if="!entry.online" name="wifi-off" :size="14" class="board__offline" />
      </span>
      <span class="board__term" :class="{ 'is-placeholder': entry.isSelf }">
        {{ entry.isSelf ? t('whoami.game.ownTerm') : entry.term }}
      </span>
      <span class="board__status">{{ placementLabel(entry) }}</span>
    </li>
  </ul>
</template>

<style scoped>
.board {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.board__row {
  display: grid;
  grid-template-columns: 30px minmax(80px, 1fr) 1.4fr;
  align-items: center;
  gap: var(--s-3);
  min-height: 54px;
  padding: var(--s-2) var(--s-3);
  background: var(--c-surface);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
}

.board__row.is-self {
  border-color: #7b4fd8;
  background: linear-gradient(120deg, rgb(123 79 216 / 18%) 0%, var(--c-surface) 70%);
}

.board__row.is-pending {
  border-color: rgb(245 196 81 / 42%);
}

.board__row.is-finished {
  border-color: rgb(42 207 185 / 38%);
  background: rgb(42 207 185 / 6%);
}

.board__row.is-finished .board__nameText {
  color: var(--c-text-dim);
  text-decoration: line-through;
}

.board__seat {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: var(--fs-sm);
  font-weight: 800;
  color: #04120f;
  background: var(--c-accent);
  border-radius: 8px;
}

.is-self .board__seat {
  background: #9a7bea;
}

.board__name {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-width: 0;
  color: var(--c-text-muted);
  overflow-wrap: anywhere;
}

.board__offline {
  color: var(--c-warning);
}

.board__term {
  font-size: var(--fs-lg);
  font-weight: 700;
  text-align: right;
  overflow-wrap: anywhere;
}

.board__term.is-placeholder {
  font-size: var(--fs-md);
  font-weight: 600;
  font-style: italic;
  color: #c3aef5;
}

.board__status {
  grid-column: 2 / -1;
  justify-self: end;
  padding: 3px 8px;
  font-size: var(--fs-xs);
  font-weight: 700;
  color: var(--c-text-muted);
  background: var(--c-surface-3);
  border-radius: var(--r-pill);
}

.is-pending .board__status {
  color: var(--c-warning);
}

.is-finished .board__status {
  color: var(--c-success);
}

@media (max-width: 380px) {
  .board__row {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .board__term,
  .board__status {
    grid-column: 2;
    justify-self: stretch;
    text-align: left;
  }

  .board__status {
    justify-self: start;
  }
}
</style>
