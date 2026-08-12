<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import GameBoard from '@/components/whoami/GameBoard.vue'
import NotesPanel from '@/components/whoami/NotesPanel.vue'
import RoomQrCode from '@/components/whoami/RoomQrCode.vue'
import SeatingList from '@/components/whoami/SeatingList.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import StatusNote from '@/components/ui/StatusNote.vue'
import TextField from '@/components/ui/TextField.vue'
import { t, tDynamic } from '@/i18n'
import { WHO_AM_I } from '@shared/config'
import { normalizeRoomCode } from '@shared/validation'
import { roomDeepLink } from '@/config/runtime'
import { useRoomStore } from '@/stores/room'
import type { RoomBoardEntry } from '@shared/types'

/**
 * Der Raum in allen Phasen: Lobby mit Sitzordnung und Begriffseingabe,
 * laufende Runde mit Spielansicht und privaten Notizen.
 */
const props = defineProps<{ code: string }>()
const room = useRoomStore()
const router = useRouter()

const code = computed(() => normalizeRoomCode(props.code))
const view = computed(() => room.view)
const showQr = ref(true)
const termDraft = ref('')
const editingTerm = ref(false)
type ConfirmationAction = () => boolean | void | Promise<boolean | void>

const confirm = ref<{ title: string; action: ConfirmationAction } | null>(null)
const confirmBusy = ref(false)
const copied = ref(false)
const roomRoot = ref<HTMLElement | null>(null)
const approvalHeading = ref<HTMLElement | null>(null)
const approvalAnnouncement = ref('')

const selfBoardEntry = computed(() => view.value?.board?.find((entry) => entry.isSelf) ?? null)
const pendingPlayers = computed(() =>
  (view.value?.board ?? []).filter((entry) => entry.roundState === 'pending'),
)
const ranking = computed(() =>
  (view.value?.board ?? [])
    .filter((entry): entry is RoomBoardEntry & { placement: number } => entry.placement !== null)
    .sort((a, b) => a.placement - b.placement),
)
const rankingComplete = computed(
  () => (view.value?.board?.length ?? 0) > 0 && ranking.value.length === view.value?.board?.length,
)

const canStart = computed(
  () =>
    (view.value?.players.length ?? 0) >= WHO_AM_I.minPlayers && room.missingTerms === 0,
)

const startBlockedReason = computed(() => {
  if (!view.value) return null
  if (view.value.players.length < WHO_AM_I.minPlayers)
    return t('whoami.lobby.startBlocked.players', { min: WHO_AM_I.minPlayers })
  if (room.missingTerms > 0)
    return t('whoami.lobby.startBlocked.terms', { count: room.missingTerms })
  return null
})

/**
 * Meldet den Raum beim Store an. Zurück zum Einstieg geht es ausschließlich
 * bei `idle` – also wenn überhaupt keine Zugangsdaten für diesen Code
 * vorliegen. Eine noch ausstehende erste RoomView ist ein Ladezustand: der
 * frisch erstellte Raum darf deshalb nicht mehr als ungültig gelten.
 */
function open(target: string) {
  if (room.ensure(target) === 'idle') {
    // Ohne bekanntes Rejoin-Token gibt es keinen Zugang – Raumcode allein reicht nicht.
    void router.replace({ name: 'whoami-entry', query: { code: target } })
  }
}

onMounted(() => open(code.value))

// Ein Deep Link auf einen anderen Raum verwendet dieselbe Komponenteninstanz;
// ohne diesen Wechsel bliebe die alte Sitzung stehen.
watch(code, (next, previous) => {
  if (previous) room.release(previous)
  open(next)
})

// Nur den Sync dieses Raums freigeben: gehört er beim Verlassen der Route
// bereits zur nächsten Ansicht, bleibt er unangetastet.
onBeforeUnmount(() => room.release(code.value))

// Sobald der Server einen Begriff kennt, spiegelt ihn das Eingabefeld.
watch(
  () => view.value?.submittedTerm,
  (term) => {
    if (!editingTerm.value) termDraft.value = term ?? ''
  },
  { immediate: true },
)

watch(
  () => room.fatalError,
  (error) => {
    if (error) showQr.value = false
  },
)

watch(
  () => pendingPlayers.value.map((player) => player.playerId),
  (current, previous) => {
    const previousIds = new Set(previous ?? [])
    const added = pendingPlayers.value.filter((player) => !previousIds.has(player.playerId))
    if (added.length === 1) {
      approvalAnnouncement.value = t('whoami.ranking.pendingAnnounced', {
        name: added[0]!.name,
      })
    } else if (added.length > 1) {
      approvalAnnouncement.value = t('whoami.ranking.pendingAnnouncedMany', {
        count: added.length,
      })
    }
  },
)

async function submitTerm() {
  if (await room.submitTerm(termDraft.value)) editingTerm.value = false
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(roomDeepLink(code.value))
    copied.value = true
    setTimeout(() => (copied.value = false), 1800)
  } catch {
    // Ohne Clipboard-Berechtigung bleibt der sichtbare Code der Weg.
  }
}

function ask(title: string, action: ConfirmationAction) {
  confirm.value = { title, action }
}

async function runConfirmed() {
  const current = confirm.value
  if (!current || confirmBusy.value) return
  confirmBusy.value = true
  try {
    const succeeded = await current.action()
    // Store-Aktionen liefern `false`, wenn der Server abgelehnt hat oder eine
    // andere Aktion noch lief. In diesem Fall bleibt die Rückfrage offen.
    if (succeeded !== false && confirm.value === current) confirm.value = null
  } catch {
    // Unerwartete Fehler schließen den Dialog ebenfalls nicht blind.
  } finally {
    confirmBusy.value = false
  }
}

function closeConfirmation() {
  if (!confirmBusy.value) confirm.value = null
}

async function leaveRoom(): Promise<boolean> {
  const left = await room.leave()
  if (left) void router.replace({ name: 'home' })
  return left
}

async function closeRoom(): Promise<boolean> {
  await room.close()
  void router.replace({ name: 'home' })
  return true
}

function focusAfterModeration(previousIndex: number) {
  const nextPlayer = pendingPlayers.value[Math.min(previousIndex, pendingPlayers.value.length - 1)]
  if (nextPlayer) {
    const rows = roomRoot.value?.querySelectorAll<HTMLElement>('[data-approval-player]') ?? []
    const row = [...rows].find(
      (candidate) => candidate.dataset.approvalPlayer === nextPlayer.playerId,
    )
    row?.querySelector<HTMLButtonElement>('button')?.focus()
    return
  }
  approvalHeading.value?.focus()
}

async function decidePlacement(entry: RoomBoardEntry, approve: boolean): Promise<boolean> {
  if (!entry.placementClaimId) return false
  const previousIndex = pendingPlayers.value.findIndex(
    (candidate) => candidate.playerId === entry.playerId,
  )
  const succeeded = approve
    ? await room.approvePlacement(entry.playerId, entry.placementClaimId)
    : await room.resetPlacement(entry.playerId, entry.placementClaimId)
  if (!succeeded) return false

  approvalAnnouncement.value = t(
    approve ? 'whoami.ranking.approvedAnnounced' : 'whoami.ranking.rejectedAnnounced',
    { name: entry.name },
  )
  await nextTick()
  focusAfterModeration(Math.max(previousIndex, 0))
  return true
}

function approvePlacement(entry: RoomBoardEntry) {
  void decidePlacement(entry, true)
}

function rejectPlacement(entry: RoomBoardEntry) {
  void decidePlacement(entry, false)
}

function askPlacementReset(entry: RoomBoardEntry) {
  if (!entry.placementClaimId) return
  ask(t('whoami.ranking.resetConfirm', { name: entry.name }), () => {
    return room.resetPlacement(entry.playerId, entry.placementClaimId!)
  })
}
</script>

<template>
  <main ref="roomRoot" class="page room">
    <AppHeader
      :title="t('whoami.game.title')"
      :subtitle="t('whoami.lobby.room', { code })"
      intercept-back
      @back="ask(t('whoami.lobby.leaveConfirm'), leaveRoom)"
    >
      <template #action>
        <button class="room__copy" type="button" :aria-label="t('common.share')" @click="copyLink">
          <AppIcon :name="copied ? 'check' : 'copy'" :size="18" />
        </button>
      </template>
    </AppHeader>

    <StatusNote v-if="room.fatalError" tone="error" icon="alert">
      {{ tDynamic(`whoami.error.${room.fatalError}`, { max: WHO_AM_I.maxPlayers }, t('common.error')) }}
    </StatusNote>
    <StatusNote v-else-if="!room.connected" tone="warn" icon="wifi-off">
      {{ t('whoami.conn.lost') }}
    </StatusNote>
    <StatusNote v-if="room.actionError" tone="error" icon="alert">
      {{ tDynamic(`whoami.error.${room.actionError}`, undefined, t('common.error')) }}
    </StatusNote>

    <template v-if="view">
      <!-- ------------------------------ Lobby ------------------------------ -->
      <template v-if="view.phase === 'lobby'">
        <AppCard v-if="showQr">
          <p class="room__shareHint">{{ t('whoami.lobby.share') }}</p>
          <RoomQrCode :code="code" :size="180" />
          <AppButton size="sm" variant="ghost" block @click="showQr = false">
            {{ t('whoami.lobby.hideQr') }}
          </AppButton>
        </AppCard>
        <AppButton v-else variant="ghost" block @click="showQr = true">
          <template #icon><AppIcon name="qr" :size="18" /></template>
          {{ t('whoami.lobby.showQr') }}
        </AppButton>

        <!-- Begriff für den Sitznachbarn -->
        <AppCard v-if="view.assignmentTarget" :title="t('whoami.assign.title')">
          <p class="room__assignFor">
            {{
              t('whoami.assign.for', {
                seat: view.assignmentTarget.seat,
                name: view.assignmentTarget.name,
              })
            }}
          </p>

          <template v-if="view.submittedTerm && !editingTerm">
            <p class="room__term">{{ view.submittedTerm }}</p>
            <p class="room__hint">{{ t('whoami.assign.editable') }}</p>
            <AppButton variant="secondary" block @click="editingTerm = true">
              {{ t('whoami.assign.change') }}
            </AppButton>
          </template>

          <form v-else class="room__form" @submit.prevent="submitTerm">
            <TextField
              v-model="termDraft"
              :placeholder="t('whoami.assign.placeholder')"
              :maxlength="WHO_AM_I.termMaxLength"
              autocomplete="off"
            />
            <AppButton type="submit" block :disabled="termDraft.trim().length === 0" :loading="room.busy">
              {{ t('whoami.assign.submit') }}
            </AppButton>
          </form>
        </AppCard>

        <!-- Sitzordnung -->
        <AppCard
          :title="t('whoami.lobby.title')"
          :hint="t('whoami.lobby.players', { count: view.players.length })"
        >
          <template v-if="room.isHost" #action>
            <AppButton size="sm" variant="ghost" @click="room.renumber()">
              {{ t('whoami.lobby.renumber') }}
            </AppButton>
          </template>

          <SeatingList
            :players="view.players"
            :you-id="view.you.playerId"
            :can-edit="room.isHost"
            show-submission-state
            @reorder="room.reorder($event)"
            @remove="(id) => ask(t('whoami.lobby.kickConfirm', { name: view!.players.find((p) => p.id === id)?.name ?? '' }), () => room.removePlayer(id))"
            @make-host="(id) => ask(t('whoami.lobby.makeHostConfirm', { name: view!.players.find((p) => p.id === id)?.name ?? '' }), () => room.transferHost(id))"
            @reset-term="(id) => ask(t('whoami.lobby.resetTermConfirm', { name: view!.players.find((p) => p.id === id)?.name ?? '' }), () => room.resetSubmission(id))"
          />

          <p class="room__hint">{{ t('whoami.lobby.hostPrivacy') }}</p>
        </AppCard>

        <!-- Hostaktionen -->
        <template v-if="room.isHost">
          <StatusNote v-if="startBlockedReason" tone="info" icon="alert">
            {{ startBlockedReason }}
          </StatusNote>
          <AppButton size="lg" block :disabled="!canStart" :loading="room.busy" @click="room.startRound()">
            {{ t('whoami.lobby.start') }}
          </AppButton>
          <div class="room__hostRow">
            <AppButton variant="secondary" @click="room.setLocked(!view.locked)">
              <template #icon><AppIcon :name="view.locked ? 'unlock' : 'lock'" :size="17" /></template>
              {{ view.locked ? t('whoami.lobby.unlock') : t('whoami.lobby.lock') }}
            </AppButton>
            <AppButton variant="ghost" @click="ask(t('whoami.lobby.closeConfirm'), closeRoom)">
              {{ t('whoami.lobby.close') }}
            </AppButton>
          </div>
        </template>
        <p v-else class="room__waiting">{{ t('whoami.lobby.waitingForHost') }}</p>
      </template>

      <!-- ------------------------- Laufende Runde -------------------------- -->
      <template v-else-if="view.phase === 'playing'">
        <p class="room__round">{{ t('whoami.game.round', { number: view.roundNumber }) }}</p>

        <AppCard :title="t('whoami.ranking.yourStatus')">
          <template v-if="selfBoardEntry?.roundState === 'active'">
            <p class="room__hint">{{ t('whoami.ranking.claimHint') }}</p>
            <AppButton block :loading="room.busy" @click="room.requestPlacement()">
              <template #icon><AppIcon name="check" :size="18" /></template>
              {{ t('whoami.ranking.claim') }}
            </AppButton>
          </template>
          <StatusNote
            v-else-if="selfBoardEntry?.roundState === 'pending'"
            tone="warn"
            icon="clock"
            aria-live="polite"
          >
            {{ t('whoami.ranking.waiting') }}
          </StatusNote>
          <StatusNote v-else-if="selfBoardEntry?.placement" tone="success" icon="check" aria-live="polite">
            {{
              t(
                selfBoardEntry.placementAutomatic
                  ? 'whoami.ranking.youPlacedAutomatic'
                  : 'whoami.ranking.youPlaced',
                { place: selfBoardEntry.placement },
              )
            }}
          </StatusNote>
        </AppCard>

        <GameBoard :entries="view.board ?? []" />

        <section v-if="room.isHost">
          <h2 ref="approvalHeading" class="sr-only" tabindex="-1">
            {{ t('whoami.ranking.pendingTitle') }}
          </h2>
          <p class="sr-only" aria-live="polite" aria-atomic="true">
            {{ approvalAnnouncement }}
          </p>
          <AppCard
            v-if="pendingPlayers.length > 0"
            :title="t('whoami.ranking.pendingTitle')"
            :hint="t('whoami.ranking.pendingCount', { count: pendingPlayers.length })"
          >
            <ul class="approvalList">
              <li
                v-for="player in pendingPlayers"
                :key="player.playerId"
                class="approvalList__row"
                :data-approval-player="player.playerId"
              >
                <span class="approvalList__name">{{ player.name }}</span>
                <div class="approvalList__actions">
                  <AppButton
                    :disabled="room.busy || !player.placementClaimId"
                    :aria-label="t('whoami.ranking.approveFor', { name: player.name })"
                    @click="approvePlacement(player)"
                  >
                    {{ t('whoami.ranking.approve') }}
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    :disabled="room.busy || !player.placementClaimId"
                    :aria-label="t('whoami.ranking.rejectFor', { name: player.name })"
                    @click="rejectPlacement(player)"
                  >
                    {{ t('whoami.ranking.reject') }}
                  </AppButton>
                </div>
              </li>
            </ul>
          </AppCard>
        </section>

        <AppCard v-if="ranking.length > 0" :title="t('whoami.ranking.title')">
          <StatusNote v-if="rankingComplete" tone="success" icon="check">
            {{ t('whoami.ranking.complete') }}
          </StatusNote>
          <ol class="rankingList">
            <li v-for="entry in ranking" :key="entry.playerId" class="rankingList__row">
              <span class="rankingList__place">{{ entry.placement }}.</span>
              <span class="rankingList__name">{{ entry.name }}</span>
              <span v-if="entry.placementAutomatic" class="rankingList__auto">
                {{ t('whoami.ranking.automatic') }}
              </span>
              <AppButton
                v-if="room.isHost && !entry.placementAutomatic"
                variant="ghost"
                :disabled="room.busy || !entry.placementClaimId"
                :aria-label="t('whoami.ranking.resetFor', { name: entry.name })"
                @click="askPlacementReset(entry)"
              >
                {{ t('whoami.ranking.reset') }}
              </AppButton>
            </li>
          </ol>
        </AppCard>

        <NotesPanel :model-value="view.notes" @save="room.saveNotes($event)" />

        <AppButton
          v-if="room.isHost"
          variant="secondary"
          block
          :disabled="room.busy || confirmBusy"
          :loading="room.busy"
          @click="ask(t('whoami.game.endRoundConfirm'), () => room.endRound())"
        >
          {{ rankingComplete ? t('whoami.game.endRound') : t('whoami.game.endRoundEarly') }}
        </AppButton>
      </template>
    </template>

    <!-- Legitimer Ladezustand: Mitgliedschaft steht, die erste RoomView fehlt noch. -->
    <p v-else-if="room.status === 'loading'" class="room__loading">{{ t('common.loading') }}</p>

    <AppButton
      v-if="room.fatalError"
      variant="secondary"
      block
      :to="{ name: 'whoami-entry' }"
    >
      {{ t('whoami.entry.title') }}
    </AppButton>

    <AppDialog :open="!!confirm" :title="confirm?.title" @close="closeConfirmation">
      <template #actions>
        <AppButton variant="danger" block :loading="confirmBusy || room.busy" @click="runConfirmed">
          {{ t('common.confirm') }}
        </AppButton>
        <AppButton variant="ghost" block :disabled="confirmBusy" @click="closeConfirmation">
          {{ t('common.cancel') }}
        </AppButton>
      </template>
    </AppDialog>
  </main>
</template>

<style scoped>
.room__copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--touch);
  height: var(--touch);
  color: var(--c-text-muted);
}

.room__shareHint {
  margin-bottom: var(--s-3);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.room__assignFor {
  margin-bottom: var(--s-3);
  font-size: var(--fs-lg);
  line-height: 1.35;
}

.room__term {
  padding: var(--s-3);
  font-size: var(--fs-xl);
  font-weight: 700;
  text-align: center;
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
  overflow-wrap: anywhere;
}

.room__form {
  display: flex;
  flex-direction: column;
  gap: var(--s-3);
}

.room__hint {
  margin: var(--s-3) 0;
  font-size: var(--fs-sm);
  color: var(--c-text-muted);
}

.room__hostRow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--s-2);
}

.room__waiting,
.room__loading {
  padding: var(--s-5) 0;
  text-align: center;
  color: var(--c-text-muted);
}

.room__round {
  font-size: var(--fs-sm);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--c-text-dim);
}

.approvalList,
.rankingList {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.approvalList__row,
.rankingList__row {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  min-height: var(--touch);
  padding: var(--s-2);
  background: var(--c-surface-2);
  border: 1px solid var(--c-line);
  border-radius: var(--r-md);
}

.approvalList__name,
.rankingList__name {
  min-width: 0;
  flex: 1;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.approvalList__actions {
  display: flex;
  gap: var(--s-1);
}

.rankingList__place {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  font-weight: 850;
  color: #04120f;
  background: var(--c-success);
  border-radius: 10px;
}

.rankingList__auto {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

@media (max-width: 420px) {
  .approvalList__row {
    align-items: stretch;
    flex-direction: column;
  }

  .approvalList__actions > * {
    flex: 1;
  }

  .rankingList__row {
    flex-wrap: wrap;
  }

  .rankingList__row > .btn {
    margin-left: 40px;
  }
}

@media (max-width: 360px) {
  .room__hostRow {
    grid-template-columns: 1fr;
  }
}
</style>
