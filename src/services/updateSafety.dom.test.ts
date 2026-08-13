import { describe, expect, it } from 'vitest'
import type { RoomBoardEntry, RoomView } from '@shared/types'
import { isSafeForAppUpdate } from './updateSafety'

function entry(place: number | null): RoomBoardEntry {
  return {
    playerId: crypto.randomUUID(),
    name: 'Spieler',
    seat: 1,
    online: true,
    isSelf: false,
    term: null,
    roundState: place === null ? 'active' : 'finished',
    placement: place,
    placementClaimId: null,
    placementAutomatic: false,
  }
}

function roomView(phase: RoomView['phase'], placements: Array<number | null> = []): RoomView {
  return {
    code: 'ABCDEF',
    phase,
    version: 1,
    locked: phase === 'playing',
    roundNumber: 1,
    you: { playerId: 'self', name: 'Lena', seat: 1, isHost: true },
    players: [],
    board: phase === 'playing' ? placements.map(entry) : null,
    assignmentTarget: null,
    submittedTerm: null,
    notes: '',
    serverTime: Date.now(),
  }
}

function safe(patch: Partial<Parameters<typeof isSafeForAppUpdate>[0]> = {}): boolean {
  return isSafeForAppUpdate({
    routeName: 'home',
    routeGuardsInteraction: false,
    hasRoomMembership: false,
    roomView: null,
    ...patch,
  })
}

describe('sichere Zeitpunkte für App-Updates', () => {
  it('behandelt Home, Lobby und vollständiges Podium als sicher', () => {
    expect(safe()).toBe(true)
    expect(
      safe({
        routeName: 'whoami-room',
        hasRoomMembership: true,
        roomView: roomView('lobby'),
      }),
    ).toBe(true)
    expect(
      safe({
        routeName: 'whoami-room',
        hasRoomMembership: true,
        roomView: roomView('playing', [1, 2, 3]),
      }),
    ).toBe(true)
  })

  it('schützt eine aktive oder noch unbekannte Multiplayer-Runde', () => {
    expect(
      safe({
        routeName: 'whoami-room',
        hasRoomMembership: true,
        roomView: roomView('playing', [1, null, null]),
      }),
    ).toBe(false)
    expect(
      safe({
        routeName: 'whoami-room',
        hasRoomMembership: true,
        roomView: null,
      }),
    ).toBe(false)
  })

  it('respektiert Router-Metadaten für andere sensible Spielinteraktionen', () => {
    expect(safe({ routeName: 'impostor-round', routeGuardsInteraction: true })).toBe(false)
    expect(safe({ routeName: 'impostor-result', routeGuardsInteraction: false })).toBe(true)
  })
})
