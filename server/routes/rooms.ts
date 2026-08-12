import { WHO_AM_I } from '../../src/shared/config.js'
import { isValidRoomCode, normalizeRoomCode } from '../../src/shared/validation.js'
import { fail } from '../errors.js'
import { json, noContent, type ApiRequest, type Handler } from '../http.js'
import { getStore } from '../store/index.js'
import { maybeRunMaintenance } from '../services/maintenance.js'
import * as rooms from '../services/roomService.js'

/**
 * HTTP-Schicht für „Wer bin ich?“. Sie validiert Eingaben und übersetzt sie in
 * Aufrufe des `roomService` – dort und nur dort liegen die Spielregeln.
 */

function code(req: ApiRequest): string {
  const value = normalizeRoomCode(req.params.code ?? '')
  if (!isValidRoomCode(value)) throw fail.badRequest('code_invalid', 'Ungültiger Raumcode.')
  return value
}

/**
 * Authentifizierung eines Spielers. Das Rejoin-Token kommt im Header, damit es
 * nicht in Server-Logs von Query-Strings landet.
 */
function actor(req: ApiRequest): rooms.Actor {
  const playerId = req.headers['x-player-id']
  const rejoinToken = req.headers['x-rejoin-token']
  if (!playerId || !rejoinToken) throw fail.unauthorized('missing_credentials', 'Kein Spielertoken.')
  return { playerId, rejoinToken }
}

function body<T extends Record<string, unknown>>(req: ApiRequest): Partial<T> {
  return (req.body ?? {}) as Partial<T>
}

export const postRoom: Handler = async (req) => {
  void maybeRunMaintenance()
  const { name } = body<{ name: string }>(req)
  const created = await rooms.createRoom(getStore().rooms, String(name ?? ''))
  return json(created, 201)
}

export const postJoin: Handler = async (req) => {
  const { name } = body<{ name: string }>(req)
  const joined = await rooms.joinRoom(getStore().rooms, code(req), String(name ?? ''))
  return json(joined, 201)
}

export const getRoom: Handler = async (req) => {
  const view = await rooms.readRoom(getStore().rooms, code(req), actor(req))
  return json(view)
}

export const postTerm: Handler = async (req) => {
  const { term } = body<{ term: string }>(req)
  if (typeof term !== 'string' || term.length > WHO_AM_I.termMaxLength * 4) {
    throw fail.badRequest('term_invalid', 'Ungültiger Begriff.')
  }
  const view = await rooms.submitTerm(getStore().rooms, code(req), actor(req), term)
  return json(view)
}

export const putNotes: Handler = async (req) => {
  const { content } = body<{ content: string }>(req)
  const view = await rooms.setNotes(
    getStore().rooms,
    code(req),
    actor(req),
    typeof content === 'string' ? content : '',
  )
  return json(view)
}

export const postReorder: Handler = async (req) => {
  const { order } = body<{ order: string[] }>(req)
  if (!Array.isArray(order)) throw fail.badRequest('order_invalid', 'Reihenfolge fehlt.')
  const ids = order.filter((id): id is string => typeof id === 'string')
  const view = await rooms.reorderPlayers(getStore().rooms, code(req), actor(req), ids)
  return json(view)
}

export const postRenumber: Handler = async (req) =>
  json(await rooms.renumberPlayers(getStore().rooms, code(req), actor(req)))

export const deletePlayer: Handler = async (req) => {
  const targetId = req.params.playerId
  if (!targetId) throw fail.badRequest('player_missing', 'Spieler fehlt.')
  const view = await rooms.removePlayer(getStore().rooms, code(req), actor(req), targetId)
  return json(view)
}

export const postLock: Handler = async (req) => {
  const { locked } = body<{ locked: boolean }>(req)
  const view = await rooms.setLocked(getStore().rooms, code(req), actor(req), locked === true)
  return json(view)
}

export const postHost: Handler = async (req) => {
  const { playerId } = body<{ playerId: string }>(req)
  if (typeof playerId !== 'string') throw fail.badRequest('player_missing', 'Spieler fehlt.')
  const view = await rooms.transferHost(getStore().rooms, code(req), actor(req), playerId)
  return json(view)
}

export const postResetSubmission: Handler = async (req) => {
  const { playerId } = body<{ playerId: string }>(req)
  if (typeof playerId !== 'string') throw fail.badRequest('player_missing', 'Spieler fehlt.')
  const view = await rooms.resetSubmission(getStore().rooms, code(req), actor(req), playerId)
  return json(view)
}

export const postStart: Handler = async (req) =>
  json(await rooms.startRound(getStore().rooms, code(req), actor(req)))

export const postPlacementRequest: Handler = async (req) =>
  json(await rooms.requestPlacement(getStore().rooms, code(req), actor(req)))

function targetPlayerId(req: ApiRequest): string {
  const targetId = req.params.playerId
  if (!targetId) throw fail.badRequest('player_missing', 'Spieler fehlt.')
  return targetId
}

function placementClaimId(req: ApiRequest): string {
  const { claimId } = body<{ claimId: string }>(req)
  if (typeof claimId !== 'string' || claimId.length < 1 || claimId.length > 64) {
    throw fail.badRequest('placement_claim_missing', 'Meldungs-ID fehlt.')
  }
  return claimId
}

export const postPlacementApproval: Handler = async (req) =>
  json(
    await rooms.approvePlacement(
      getStore().rooms,
      code(req),
      actor(req),
      targetPlayerId(req),
      placementClaimId(req),
    ),
  )

export const deletePlacement: Handler = async (req) =>
  json(
    await rooms.resetPlacement(
      getStore().rooms,
      code(req),
      actor(req),
      targetPlayerId(req),
      placementClaimId(req),
    ),
  )

export const postEnd: Handler = async (req) =>
  json(await rooms.endRound(getStore().rooms, code(req), actor(req)))

export const postLeave: Handler = async (req) => {
  await rooms.leaveRoom(getStore().rooms, code(req), actor(req))
  return noContent()
}

export const deleteRoom: Handler = async (req) => {
  await rooms.closeRoom(getStore().rooms, code(req), actor(req))
  return noContent()
}
