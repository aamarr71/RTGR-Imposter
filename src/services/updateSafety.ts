import type { RoomView } from '@shared/types'

export interface UpdateSafetyContext {
  routeName: string | symbol | null | undefined
  routeGuardsInteraction: boolean
  hasRoomMembership: boolean
  roomView: RoomView | null
}

/**
 * Router-Metadaten schützen lokale Spielinteraktionen. Im Multiplayer-Raum
 * entscheidet dagegen der echte Serverzustand: Lobby und vollständiges Podium
 * sind sicher, eine laufende oder noch unbekannte Runde nicht.
 */
export function isSafeForAppUpdate(context: UpdateSafetyContext): boolean {
  if (context.routeGuardsInteraction) return false
  if (context.routeName !== 'whoami-room') return true
  if (!context.hasRoomMembership) return true
  if (!context.roomView) return false
  if (context.roomView.phase !== 'playing') return true

  const board = context.roomView.board
  return Boolean(
    board && board.length > 0 && board.every((entry) => entry.placement !== null),
  )
}
