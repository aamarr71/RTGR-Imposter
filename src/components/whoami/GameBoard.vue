<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
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
const props = defineProps<{ entries: RoomBoardEntry[] }>()

/**
 * Aufdeckungen bleiben bewusst innerhalb dieser Komponenteninstanz. Dadurch
 * überleben sie normale Server-Updates, aber weder Reload noch erneutes
 * Öffnen der Runde. Jeder Spieler wird unabhängig umgeschaltet.
 */
const revealedPlayerIds = ref(new Set<string>())
const boardRoot = ref<HTMLElement | null>(null)
const visibilityAnnouncement = ref('')
let visibilityAnnouncementEpoch = 0

function canToggleTerm(entry: RoomBoardEntry): boolean {
  return !entry.isSelf && entry.roundState !== 'finished'
}

function isTermRevealed(entry: RoomBoardEntry): boolean {
  return canToggleTerm(entry) && revealedPlayerIds.value.has(entry.playerId)
}

function toggleTerm(entry: RoomBoardEntry) {
  if (!canToggleTerm(entry)) return

  const next = new Set(revealedPlayerIds.value)
  if (next.has(entry.playerId)) next.delete(entry.playerId)
  else next.add(entry.playerId)
  revealedPlayerIds.value = next
}

// Wird eine Platzierung bestätigt, ist der Begriff ohnehin dauerhaft offen.
// Ein späteres Zurücknehmen startet deshalb wieder sicher im verdeckten Zustand.
watch(
  () => props.entries.map(({ playerId, isSelf, roundState }) => ({ playerId, isSelf, roundState })),
  async (entries, previousEntries) => {
    const announcementEpoch = ++visibilityAnnouncementEpoch
    const previousByPlayer = new Map(
      (previousEntries ?? []).map((entry) => [entry.playerId, entry.roundState]),
    )
    const newlyFinished = props.entries.filter(
      (entry) =>
        !entry.isSelf &&
        entry.term !== null &&
        entry.roundState === 'finished' &&
        previousByPlayer.has(entry.playerId) &&
        previousByPlayer.get(entry.playerId) !== 'finished',
    )
    const focusedPlayerId =
      typeof document === 'undefined'
        ? null
        : ((document.activeElement as HTMLElement | null)?.dataset.termPlayer ?? null)

    const toggleableIds = new Set(
      entries
        .filter((entry) => !entry.isSelf && entry.roundState !== 'finished')
        .map((entry) => entry.playerId),
    )
    const next = new Set(
      [...revealedPlayerIds.value].filter((playerId) => toggleableIds.has(playerId)),
    )
    if (next.size !== revealedPlayerIds.value.size) revealedPlayerIds.value = next

    // Eine Host-Korrektur muss auch den zuvor angesagten Begriff wieder aus
    // dem DOM entfernen. Die Epochenprüfung verwirft verspätete Async-Fortsetzungen.
    visibilityAnnouncement.value = ''
    if (newlyFinished.length === 0) return

    // Die Live-Region erst leeren, damit auch eine spätere identische Ansage
    // (z. B. nach Rücknahme und erneuter Bestätigung) zuverlässig gesprochen wird.
    await nextTick()
    if (announcementEpoch !== visibilityAnnouncementEpoch) return

    if (focusedPlayerId && newlyFinished.some((entry) => entry.playerId === focusedPlayerId)) {
      const focusTarget = [
        ...(boardRoot.value?.querySelectorAll<HTMLElement>('[data-finished-term-player]') ?? []),
      ].find((element) => element.dataset.finishedTermPlayer === focusedPlayerId)
      focusTarget?.focus()
    }

    visibilityAnnouncement.value =
      newlyFinished.length === 1
        ? t('whoami.game.termPermanentlyVisible', {
            name: newlyFinished[0]!.name,
            term: newlyFinished[0]!.term ?? '',
          })
        : t('whoami.game.termsPermanentlyVisible', { count: newlyFinished.length })
  },
)

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
  <ul ref="boardRoot" class="board">
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
      <span v-if="entry.isSelf" class="board__term is-placeholder">
        {{ t('whoami.game.ownTerm') }}
      </span>
      <button
        v-else-if="canToggleTerm(entry)"
        class="board__term board__termToggle"
        :class="{ 'is-revealed': isTermRevealed(entry) }"
        type="button"
        :data-term-player="entry.playerId"
        :aria-pressed="isTermRevealed(entry)"
        @click="toggleTerm(entry)"
      >
        <span>{{ isTermRevealed(entry) ? entry.term : t('whoami.game.termHidden') }}</span>
        <span class="sr-only">
          {{
            t(
              isTermRevealed(entry) ? 'whoami.game.hideTermFor' : 'whoami.game.revealTermFor',
              { name: entry.name },
            )
          }}
        </span>
        <AppIcon :name="isTermRevealed(entry) ? 'eye-off' : 'eye'" :size="17" />
      </button>
      <span
        v-else
        class="board__term"
        tabindex="-1"
        :data-finished-term-player="entry.playerId"
      >
        {{ entry.term }}
      </span>
      <span class="board__status">{{ placementLabel(entry) }}</span>
    </li>
  </ul>
  <p
    class="sr-only"
    aria-live="polite"
    aria-atomic="true"
    data-term-visibility-announcement
  >
    {{ visibilityAnnouncement }}
  </p>
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

.board__termToggle {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--s-2);
  min-width: 0;
  min-height: var(--touch);
  color: var(--c-text-muted);
  border-radius: var(--r-sm);
}

.board__termToggle.is-revealed {
  color: var(--c-text);
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

@media (max-width: 420px) {
  .board__row {
    grid-template-columns: 30px minmax(0, 1fr);
  }

  .board__term,
  .board__status {
    grid-column: 2;
    justify-self: stretch;
    text-align: left;
  }

  .board__termToggle {
    justify-content: flex-start;
  }

  .board__status {
    justify-self: start;
  }
}
</style>
