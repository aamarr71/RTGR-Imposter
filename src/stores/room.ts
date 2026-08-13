import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { RoomView } from '@shared/types'
import { analytics } from '@/services/analytics'
import { HttpError } from '@/services/http'
import { storage, StorageKeys } from '@/services/storage'
import {
  createPollingRoomSync,
  forgetMembership,
  getMembership,
  rememberMembership,
  roomApi,
  type Membership,
  type RoomSyncService,
} from '@/services/roomSync'

/**
 * Zustand eines Raums aus Sicht der Raumansicht.
 *
 * `idle`    – für diesen Raum liegen keine Zugangsdaten vor
 * `loading` – Mitgliedschaft vorhanden, die erste RoomView ist unterwegs
 * `ready`   – RoomView geladen
 * `denied`  – 403/404/410: Zugang endgültig verloren, Zugangsdaten geräumt
 * `error`   – der Sync hat aus einem anderen Grund aufgegeben
 *
 * Nur `idle` bedeutet „hier ist niemand angemeldet“. Eine noch ausstehende
 * erste RoomView ist ein Ladezustand und kein Fehler – genau diese
 * Unterscheidung fehlte und hat frisch erstellte Räume sofort verworfen.
 */
export type RoomStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error'

/**
 * Zustand eines „Wer bin ich?“-Raums auf dem Gerät.
 *
 * Der Store hält bewusst nur die **serverseitig gefilterte** Sicht. Während
 * des Ratens gelangt der eigene Begriff nicht in den Client; erst nach der
 * vollständig feststehenden Rangfolge wird er für das Podium aufgedeckt.
 *
 * Der Store – nicht die Route – besitzt den laufenden `RoomSync`. Ansichten
 * melden mit `ensure()` nur an, welchen Raum sie brauchen, und geben ihn mit
 * `release()` wieder frei. Ein Routenwechsel kann dadurch keinen Sync stoppen,
 * der bereits zur nächsten Ansicht gehört.
 */
export const useRoomStore = defineStore('room', () => {
  const view = ref<RoomView | null>(null)
  const membership = ref<Membership | null>(null)
  const connected = ref(true)
  const fatalError = ref<string | null>(null)
  const actionError = ref<string | null>(null)
  const busy = ref(false)
  /** Gesetzt, sobald ein Sync endgültig aufgegeben hat. */
  const terminal = ref<{ code: string; accessLost: boolean } | null>(null)

  let sync: RoomSyncService | null = null
  /** Raum, zu dem der laufende Sync gehört – Grundlage für `release()`. */
  let syncCode: string | null = null
  /**
   * Trennt asynchrone Aktionen verschiedener Raum-/Membership-Lebenszyklen.
   *
   * Ein bloßer `busy`-Boolean reicht nicht: Wenn eine Aktion aus Raum A nach
   * einem Wechsel zu B fertig wird, darf ihr `finally` eine inzwischen
   * laufende Aktion in B nicht entsperren. Jeder Kontextwechsel entwertet
   * deshalb die zuvor aufgenommenen Epochen.
   */
  let membershipEpoch = 0

  const isHost = computed(() => view.value?.you.isHost ?? false)
  const phase = computed(() => view.value?.phase ?? 'lobby')
  const missingTerms = computed(
    () => (view.value?.players ?? []).filter((player) => !player.hasSubmittedTerm).length,
  )

  const status = computed<RoomStatus>(() => {
    if (terminal.value) return terminal.value.accessLost ? 'denied' : 'error'
    if (!membership.value) return 'idle'
    return view.value ? 'ready' : 'loading'
  })

  function sameMembership(a: Membership | null, b: Membership): boolean {
    return (
      a !== null && a.code === b.code && a.playerId === b.playerId && a.rejoinToken === b.rejoinToken
    )
  }

  function beginsNewMembershipEpoch() {
    membershipEpoch += 1
    busy.value = false
  }

  function isCurrentMembershipEpoch(epoch: number, expected: Membership): boolean {
    return epoch === membershipEpoch && sameMembership(membership.value, expected)
  }

  function viewBelongsToMembership(incoming: RoomView, expected: Membership): boolean {
    return incoming.code === expected.code && incoming.you?.playerId === expected.playerId
  }

  function stopSync() {
    sync?.stop()
    sync = null
    syncCode = null
  }

  type ViewAdoption = 'ignored' | 'accepted' | 'advanced'

  /**
   * Polling und Aktionsantworten dürfen nur innerhalb derselben Membership
   * vorwärts durch die Raumversion laufen. Raumcode und eigener Spieler sind
   * Teil der Vertrauensgrenze; eine fremde Sicht wird nie übernommen.
   */
  function adoptView(incoming: RoomView, expected: Membership): ViewAdoption {
    if (!sameMembership(membership.value, expected)) return 'ignored'
    if (!viewBelongsToMembership(incoming, expected)) return 'ignored'

    const current = view.value
    const currentBelongsToMembership =
      current !== null && viewBelongsToMembership(current, expected)
    if (currentBelongsToMembership && incoming.version < current.version) return 'ignored'

    const advanced = !currentBelongsToMembership || incoming.version > current.version
    view.value = incoming
    return advanced ? 'advanced' : 'accepted'
  }

  function attach(next: Membership) {
    // Läuft für exakt diese Zugangsdaten schon ein Sync, bleibt er bestehen.
    // Ein Neustart würde die bereits abgeschickte erste Abfrage verwerfen und
    // ein zweites GET auslösen.
    if (sync && sameMembership(membership.value, next)) return

    stopSync()
    beginsNewMembershipEpoch()
    view.value = null
    connected.value = true
    fatalError.value = null
    actionError.value = null
    terminal.value = null
    membership.value = next
    rememberMembership(next)

    // `own` statt `sync`: Rückmeldungen eines abgelösten Syncs dürfen den
    // Zustand des nachfolgenden nicht mehr anfassen.
    const own = createPollingRoomSync()
    sync = own
    syncCode = next.code

    own.onUpdate((incoming) => {
      if (sync !== own) return
      // Nur neuere Stände übernehmen: eine langsame Antwort darf einen
      // frischeren Zustand nicht überschreiben.
      const adoption = adoptView(incoming, next)
      if (adoption === 'ignored') return
      fatalError.value = null
      // Ein wirklich neuer Serverstand macht einen alten Aktionsfehler
      // gegenstandslos. Ein Poll derselben Version lässt ihn sichtbar.
      if (adoption === 'advanced') actionError.value = null
    })
    own.onConnectionChange((value) => {
      if (sync !== own) return
      connected.value = value
    })
    own.onError((error) => {
      if (sync !== own) return
      // Der Sync meldet nur, wenn er aufgegeben hat – Netz- und 5xx-Aussetzer
      // laufen als „offline“ weiter und landen nie hier.
      const accessLost = error instanceof HttpError && [403, 404, 410].includes(error.status)
      fatalError.value = error instanceof HttpError ? error.code : 'unknown'
      stopSync()
      if (accessLost) {
        // Platz oder Raum sind weg: gespeicherte Zugangsdaten wegräumen.
        forgetMembership(next.code)
        beginsNewMembershipEpoch()
        membership.value = null
      }
      terminal.value = { code: next.code, accessLost }
    })

    own.start(next)
  }

  function detach() {
    stopSync()
    beginsNewMembershipEpoch()
    view.value = null
    connected.value = true
  }

  /**
   * Gibt einen Raum frei – aber nur, wenn der laufende Sync noch zu ihm gehört.
   * Beim Routenwechsel darf das Aufräumen der alten Ansicht niemals den Sync
   * der neuen stoppen.
   */
  function release(code: string) {
    if (syncCode !== code) return
    detach()
  }

  /**
   * Stellt sicher, dass für `code` synchronisiert wird, und meldet den
   * Zustand. Bevorzugt die Mitgliedschaft im Speicher, fällt sonst auf die
   * lokal hinterlegte zurück – der Raumcode allein reicht bewusst nie.
   */
  function ensure(code: string): RoomStatus {
    // Ein Endzustand gilt nur für den Raum, aus dem er stammt.
    if (terminal.value && terminal.value.code !== code) terminal.value = null
    if (terminal.value) return status.value

    const active = membership.value?.code === code ? membership.value : getMembership(code)
    if (!active) return 'idle'

    attach(active)
    return status.value
  }

  async function create(name: string): Promise<string> {
    const result = await roomApi.create(name)
    analytics.track('whoami_room_created', { mode: 'whoami' })
    attach(result)
    return result.code
  }

  async function join(code: string, name: string): Promise<string> {
    const result = await roomApi.join(code, name)
    analytics.track('whoami_room_joined', { mode: 'whoami' })
    attach(result)
    return result.code
  }

  /** Führt eine Aktion aus und übernimmt die zurückgelieferte Sicht sofort. */
  async function act<T extends RoomView | void>(
    operation: (m: Membership) => Promise<T>,
  ): Promise<boolean> {
    if (!membership.value || busy.value) return false
    const current = membership.value
    const epoch = membershipEpoch
    busy.value = true
    actionError.value = null
    try {
      const result = await operation(current)
      if (result && isCurrentMembershipEpoch(epoch, current)) {
        adoptView(result as RoomView, current)
      }
      return true
    } catch (error) {
      if (isCurrentMembershipEpoch(epoch, current)) {
        actionError.value = error instanceof HttpError ? error.code : 'network'
      }
      return false
    } finally {
      if (isCurrentMembershipEpoch(epoch, current)) busy.value = false
    }
  }

  const submitTerm = (term: string) => act((m) => roomApi.submitTerm(m, term))
  const reorder = (order: string[]) => act((m) => roomApi.reorder(m, order))
  const renumber = () => act((m) => roomApi.renumber(m))
  const removePlayer = (playerId: string) => act((m) => roomApi.removePlayer(m, playerId))
  const setLocked = (locked: boolean) => act((m) => roomApi.setLocked(m, locked))
  const transferHost = (playerId: string) => act((m) => roomApi.transferHost(m, playerId))
  const resetSubmission = (playerId: string) => act((m) => roomApi.resetSubmission(m, playerId))
  const requestPlacement = () => act((m) => roomApi.requestPlacement(m))
  const approvePlacement = (playerId: string, claimId: string) =>
    act((m) => roomApi.approvePlacement(m, playerId, claimId))
  const resetPlacement = (playerId: string, claimId: string) =>
    act((m) => roomApi.resetPlacement(m, playerId, claimId))
  const endRound = () => act((m) => roomApi.end(m))

  async function startRound(): Promise<void> {
    const playerCount = view.value?.players.length ?? 0
    if (await act((m) => roomApi.start(m))) {
      analytics.track('whoami_round_started', { mode: 'whoami', playerCount })
    }
  }

  /** Notizen werden direkt gespeichert; die Antwort ersetzt die Sicht nicht. */
  async function saveNotes(content: string): Promise<void> {
    if (!membership.value) return
    storage.set(`${StorageKeys.roomNotesDraft}:${membership.value.code}`, content)
    await roomApi.saveNotes(membership.value, content)
  }

  function localNotesDraft(): string | null {
    if (!membership.value) return null
    return storage.get<string | null>(`${StorageKeys.roomNotesDraft}:${membership.value.code}`, null)
  }

  /** Vollständiges Aufräumen nach dem endgültigen Verlassen eines Raums. */
  function reset() {
    detach()
    membership.value = null
    fatalError.value = null
    actionError.value = null
    terminal.value = null
  }

  async function leave(): Promise<boolean> {
    if (!membership.value) return false
    const current = membership.value
    const epoch = membershipEpoch
    actionError.value = null
    try {
      await roomApi.leave(current)
    } catch (error) {
      if (isCurrentMembershipEpoch(epoch, current)) {
        actionError.value = error instanceof HttpError ? error.code : 'network'
      }
      return false
    }
    if (!isCurrentMembershipEpoch(epoch, current)) {
      // Bei einem Wechsel in einen anderen Raum darf dessen gespeicherte
      // Membership nicht durch die alte Leave-Antwort berührt werden.
      if (membership.value?.code !== current.code) forgetMembership(current.code)
      return true
    }
    reset()
    forgetMembership(current.code)
    return true
  }

  async function close(): Promise<void> {
    if (!membership.value) return
    const current = membership.value
    reset()
    forgetMembership(current.code)
    await roomApi.close(current).catch(() => undefined)
  }

  return {
    view,
    membership,
    connected,
    fatalError,
    actionError,
    busy,
    isHost,
    phase,
    missingTerms,
    status,
    attach,
    detach,
    release,
    ensure,
    create,
    join,
    submitTerm,
    reorder,
    renumber,
    removePlayer,
    setLocked,
    transferHost,
    resetSubmission,
    requestPlacement,
    approvePlacement,
    resetPlacement,
    startRound,
    endRound,
    saveNotes,
    localNotesDraft,
    leave,
    close,
  }
})
