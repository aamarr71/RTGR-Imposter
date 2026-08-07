<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const confirm = ref<{ title: string; action: () => void } | null>(null)
const copied = ref(false)

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

async function submitTerm() {
  await room.submitTerm(termDraft.value)
  editingTerm.value = false
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

function ask(title: string, action: () => void) {
  confirm.value = { title, action }
}

function runConfirmed() {
  confirm.value?.action()
  confirm.value = null
}

async function leaveRoom() {
  await room.leave()
  void router.replace({ name: 'home' })
}

async function closeRoom() {
  await room.close()
  void router.replace({ name: 'home' })
}
</script>

<template>
  <main class="page room">
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

        <GameBoard :entries="view.board ?? []" />

        <NotesPanel :model-value="view.notes" @save="room.saveNotes($event)" />

        <AppButton
          v-if="room.isHost"
          variant="secondary"
          block
          @click="ask(t('whoami.game.endRoundConfirm'), () => room.endRound())"
        >
          {{ t('whoami.game.endRound') }}
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

    <AppDialog :open="!!confirm" :title="confirm?.title" @close="confirm = null">
      <template #actions>
        <AppButton variant="danger" block @click="runConfirmed">{{ t('common.confirm') }}</AppButton>
        <AppButton variant="ghost" block @click="confirm = null">{{ t('common.cancel') }}</AppButton>
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
  grid-template-columns: 1fr 1fr;
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
</style>
