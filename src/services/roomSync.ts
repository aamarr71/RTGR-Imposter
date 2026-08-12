import { WHO_AM_I } from '@shared/config'
import type { JoinResult, RoomView } from '@shared/types'
import { HttpError, http, NetworkError, type RequestOptions } from './http'
import { storage, StorageKeys } from './storage'

/**
 * Austauschbare Synchronisierungsschicht für „Wer bin ich?“.
 *
 * Die Implementierung ist bewusst kurzes Polling mit Versionsprüfung:
 * Vercels Serverless-Funktionen halten keine langlebigen Verbindungen, eine
 * WebSocket-Annahme wäre dort schlicht falsch. Sobald Supabase Realtime oder
 * ein vergleichbarer Dienst bereitsteht, kann `RoomSyncService` gegen einen
 * Push-Adapter getauscht werden, ohne dass Views sich ändern.
 */

export interface Membership {
  code: string
  playerId: string
  rejoinToken: string
}

export interface RoomSyncService {
  start(membership: Membership): void
  stop(): void
  /** Sofortige Aktualisierung, z. B. nach einer eigenen Aktion. */
  refresh(): Promise<void>
  onUpdate(listener: (view: RoomView) => void): void
  onError(listener: (error: unknown) => void): void
  onConnectionChange(listener: (connected: boolean) => void): void
}

/* --------------------------- Mitgliedschaften --------------------------- */

type MembershipMap = Record<string, Membership>

export function rememberMembership(membership: Membership): void {
  const all = storage.get<MembershipMap>(StorageKeys.roomMembership, {})
  all[membership.code] = membership
  storage.set(StorageKeys.roomMembership, all)
}

export function getMembership(code: string): Membership | null {
  return storage.get<MembershipMap>(StorageKeys.roomMembership, {})[code] ?? null
}

export function forgetMembership(code: string): void {
  const all = storage.get<MembershipMap>(StorageKeys.roomMembership, {})
  delete all[code]
  storage.set(StorageKeys.roomMembership, all)
}

export function lastMembership(): Membership | null {
  const all = Object.values(storage.get<MembershipMap>(StorageKeys.roomMembership, {}))
  return all[all.length - 1] ?? null
}

/* ------------------------------- Aufrufe -------------------------------- */

function authHeaders(membership: Membership): RequestOptions {
  return {
    // Tokens gehören in Header, nicht in URLs – sonst landen sie in Logs.
    headers: {
      'x-player-id': membership.playerId,
      'x-rejoin-token': membership.rejoinToken,
    },
  }
}

export const roomApi = {
  create: (name: string) => http.post<JoinResult>('/rooms', { name }),
  join: (code: string, name: string) => http.post<JoinResult>(`/rooms/${code}/join`, { name }),
  read: (m: Membership) => http.get<RoomView>(`/rooms/${m.code}`, authHeaders(m)),
  submitTerm: (m: Membership, term: string) =>
    http.post<RoomView>(`/rooms/${m.code}/term`, { term }, authHeaders(m)),
  saveNotes: (m: Membership, content: string) =>
    http.patch<RoomView>(`/rooms/${m.code}/notes`, { content }, authHeaders(m)),
  reorder: (m: Membership, order: string[]) =>
    http.post<RoomView>(`/rooms/${m.code}/order`, { order }, authHeaders(m)),
  renumber: (m: Membership) => http.post<RoomView>(`/rooms/${m.code}/renumber`, {}, authHeaders(m)),
  removePlayer: (m: Membership, playerId: string) =>
    http.delete<RoomView>(`/rooms/${m.code}/players/${playerId}`, undefined, authHeaders(m)),
  setLocked: (m: Membership, locked: boolean) =>
    http.post<RoomView>(`/rooms/${m.code}/lock`, { locked }, authHeaders(m)),
  transferHost: (m: Membership, playerId: string) =>
    http.post<RoomView>(`/rooms/${m.code}/host`, { playerId }, authHeaders(m)),
  resetSubmission: (m: Membership, playerId: string) =>
    http.post<RoomView>(`/rooms/${m.code}/reset-submission`, { playerId }, authHeaders(m)),
  start: (m: Membership) => http.post<RoomView>(`/rooms/${m.code}/start`, {}, authHeaders(m)),
  requestPlacement: (m: Membership) =>
    http.post<RoomView>(`/rooms/${m.code}/placement`, {}, authHeaders(m)),
  approvePlacement: (m: Membership, playerId: string, claimId: string) =>
    http.post<RoomView>(
      `/rooms/${m.code}/placements/${playerId}/approve`,
      { claimId },
      authHeaders(m),
    ),
  resetPlacement: (m: Membership, playerId: string, claimId: string) =>
    http.delete<RoomView>(`/rooms/${m.code}/placements/${playerId}`, { claimId }, authHeaders(m)),
  end: (m: Membership) => http.post<RoomView>(`/rooms/${m.code}/end`, {}, authHeaders(m)),
  leave: (m: Membership) => http.post<void>(`/rooms/${m.code}/leave`, {}, authHeaders(m)),
  close: (m: Membership) => http.delete<void>(`/rooms/${m.code}`, undefined, authHeaders(m)),
}

/* ------------------------------- Polling -------------------------------- */

export function createPollingRoomSync(): RoomSyncService {
  let membership: Membership | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight = false
  let stopped = true
  let failures = 0
  let connected = true

  const updateListeners: Array<(view: RoomView) => void> = []
  const errorListeners: Array<(error: unknown) => void> = []
  const connectionListeners: Array<(connected: boolean) => void> = []

  function setConnected(value: boolean) {
    if (connected === value) return
    connected = value
    for (const listener of connectionListeners) listener(value)
  }

  function interval(): number {
    const base =
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? WHO_AM_I.pollIntervalHiddenMs
        : WHO_AM_I.pollIntervalMs
    // Exponentielles Nachlassen bei Fehlern, gedeckelt auf 15 Sekunden.
    return failures === 0 ? base : Math.min(base * 2 ** failures, 15000)
  }

  function schedule() {
    if (stopped) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => void poll(), interval())
  }

  async function poll(): Promise<void> {
    if (!membership || inFlight || stopped) return
    inFlight = true
    try {
      const view = await roomApi.read(membership)
      failures = 0
      setConnected(true)
      for (const listener of updateListeners) listener(view)
    } catch (error) {
      if (error instanceof NetworkError) {
        // Netzwerkaussetzer sind normal: nur als „offline“ melden, weiter versuchen.
        failures = Math.min(failures + 1, 4)
        setConnected(false)
      } else if (error instanceof HttpError && error.status >= 500) {
        failures = Math.min(failures + 1, 4)
        setConnected(false)
      } else {
        // 403/404 sind endgültig – Raum weg oder Platz verloren.
        stopped = true
        for (const listener of errorListeners) listener(error)
        return
      }
    } finally {
      inFlight = false
      schedule()
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void poll()
  }

  return {
    start(next) {
      membership = next
      stopped = false
      failures = 0
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onVisibility)
      }
      void poll()
    },
    stop() {
      stopped = true
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
    async refresh() {
      await poll()
    },
    onUpdate(listener) {
      updateListeners.push(listener)
    },
    onError(listener) {
      errorListeners.push(listener)
    },
    onConnectionChange(listener) {
      connectionListeners.push(listener)
    },
  }
}
