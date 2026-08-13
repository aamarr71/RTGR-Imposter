import { randomInt, randomUUID } from 'node:crypto'
import { WHO_AM_I } from '../../src/shared/config.js'
import { circularAssignmentMap, renumberSeats, applyOrder } from '../../src/shared/seating.js'
import type {
  RoomBoardEntry,
  RoomPlayerRoundState,
  RoomPlayerView,
  RoomView,
} from '../../src/shared/types.js'
import { playerNameKey, validatePlayerName, validateWhoAmITerm } from '../../src/shared/validation.js'
import { fail } from '../errors.js'
import { randomToken, safeEqual, sha256 } from './crypto.js'
import type {
  AssignmentRecord,
  PlayerRecord,
  RoomRecord,
  RoomStore,
  RoomTx,
  RoundProgressRecord,
} from '../store/types.js'

/**
 * Sämtliche Spielregeln von „Wer bin ich?“ – einmalig und speicherunabhängig.
 *
 * Jede mutierende Funktion läuft innerhalb einer Transaktion, sperrt die
 * Raumzeile und erhöht `version`. Zwei gleichzeitige Hostaktionen können sich
 * damit nicht überholen.
 */

export interface Actor {
  playerId: string
  rejoinToken: string
}

/* ------------------------------------------------------------------ *
 * Hilfsfunktionen
 * ------------------------------------------------------------------ */

function generateCode(): string {
  const alphabet = WHO_AM_I.roomCodeAlphabet
  let code = ''
  for (let index = 0; index < WHO_AM_I.roomCodeLength; index++) {
    code += alphabet[randomInt(alphabet.length)]
  }
  return code
}

async function uniqueCode(tx: RoomTx): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateCode()
    if (!(await tx.codeExists(code))) return code
  }
  throw fail.conflict('code_generation_failed', 'Es konnte kein freier Raumcode erzeugt werden.')
}

function isOnline(player: PlayerRecord, now: number): boolean {
  return now - player.lastSeenAt < WHO_AM_I.offlineAfterMs
}

function bySeat(a: PlayerRecord, b: PlayerRecord): number {
  return a.seat - b.seat
}

/** Jede relevante Aktion erhöht die Version und setzt die Inaktivitätsfrist zurück. */
function touch(room: RoomRecord, now: number): RoomRecord {
  return { ...room, version: room.version + 1, lastActivityAt: now }
}

function requirePlayer(players: PlayerRecord[], playerId: string): PlayerRecord {
  const player = players.find((candidate) => candidate.id === playerId)
  if (!player) throw fail.forbidden('removed', 'Dieser Platz existiert nicht mehr.')
  return player
}

function authenticate(players: PlayerRecord[], actor: Actor): PlayerRecord {
  const player = requirePlayer(players, actor.playerId)
  // Der Raumcode allein genügt bewusst nicht, um einen Platz zu übernehmen.
  if (!safeEqual(sha256(actor.rejoinToken), player.rejoinTokenHash)) {
    throw fail.forbidden('invalid_token', 'Dieser Platz gehört einem anderen Gerät.')
  }
  return player
}

function requireHost(room: RoomRecord, player: PlayerRecord): void {
  if (room.hostPlayerId !== player.id) throw fail.forbidden('not_host', 'Nur der Host darf das.')
}

function progressState(progress: RoundProgressRecord | undefined): RoomPlayerRoundState {
  if (progress?.placement !== null && progress?.placement !== undefined) return 'finished'
  return progress?.claimRequestedAt !== null && progress?.claimRequestedAt !== undefined
    ? 'pending'
    : 'active'
}

function progressFields(progress: RoundProgressRecord | undefined) {
  return {
    roundState: progressState(progress),
    placement: progress?.placement ?? null,
    placementClaimId: progress?.claimId ?? null,
    placementAutomatic: progress?.automatic ?? false,
  }
}

/**
 * Stellt nach jeder Hostkorrektur die Rundeninvarianten wieder her:
 * explizite Plätze sind lückenlos, automatische Plätze werden neu berechnet,
 * und genau der letzte verbleibende Spieler erhält automatisch Platz N.
 */
function reconcileRoundProgress(
  room: RoomRecord,
  players: PlayerRecord[],
  records: RoundProgressRecord[],
  now: number,
): RoundProgressRecord[] {
  const playerIds = new Set(players.map((player) => player.id))
  const explicit = records
    .filter(
      (record) =>
        playerIds.has(record.playerId) && record.placement !== null && !record.automatic,
    )
    .sort(
      (a, b) =>
        (a.placement ?? Number.MAX_SAFE_INTEGER) - (b.placement ?? Number.MAX_SAFE_INTEGER) ||
        (a.approvedAt ?? 0) - (b.approvedAt ?? 0) ||
        a.playerId.localeCompare(b.playerId),
    )
    .map((record, index) => ({ ...record, placement: index + 1, automatic: false }))

  const explicitIds = new Set(explicit.map((record) => record.playerId))
  const pending = records
    .filter(
      (record) =>
        playerIds.has(record.playerId) &&
        !explicitIds.has(record.playerId) &&
        record.claimRequestedAt !== null &&
        (record.placement === null || record.automatic),
    )
    .map((record) => ({
      ...record,
      placement: null,
      approvedAt: null,
      automatic: false,
    }))

  if (players.length > 1 && explicit.length === players.length - 1) {
    const last = players.find((player) => !explicitIds.has(player.id))
    if (last) {
      const previous = records.find((record) => record.playerId === last.id)
      return [
        ...explicit,
        {
          roomId: room.id,
          roundNumber: room.roundNumber,
          playerId: last.id,
          claimId: previous?.claimId ?? null,
          claimRequestedAt: previous?.claimRequestedAt ?? null,
          placement: players.length,
          approvedAt: now,
          automatic: true,
        },
      ]
    }
  }

  return [...explicit, ...pending]
}

/**
 * Hostübergabe nach fünf Minuten Abwesenheit an den verbundenen Spieler mit der
 * niedrigsten Sitznummer. Ein zurückkehrender Ex-Host bleibt normaler Spieler.
 */
function reconcileHost(room: RoomRecord, players: PlayerRecord[], now: number): RoomRecord {
  if (players.length === 0) return room
  const host = players.find((player) => player.id === room.hostPlayerId)

  if (!host) {
    const successor = [...players].sort(bySeat)[0]
    return successor ? { ...room, hostPlayerId: successor.id, hostOfflineSince: null } : room
  }

  if (isOnline(host, now)) {
    return room.hostOfflineSince === null ? room : { ...room, hostOfflineSince: null }
  }

  const offlineSince = room.hostOfflineSince ?? host.lastSeenAt
  if (now - offlineSince < WHO_AM_I.hostGraceMs) {
    return room.hostOfflineSince === offlineSince ? room : { ...room, hostOfflineSince: offlineSince }
  }

  const successor = players
    .filter((player) => player.id !== host.id && isOnline(player, now))
    .sort(bySeat)[0]
  if (!successor) return { ...room, hostOfflineSince: offlineSince }
  return { ...room, hostPlayerId: successor.id, hostOfflineSince: null }
}

/**
 * Nach jeder Änderung an Sitzordnung oder Teilnehmerkreis: Zuweisungen, deren
 * Ziel nicht mehr der Sitznachbar ist, werden verworfen. Der Autor muss dann
 * einen neuen Begriff eingeben – besser, als einen für Lena gedachten Begriff
 * stillschweigend Tom zuzuordnen.
 */
async function pruneStaleAssignments(
  tx: RoomTx,
  room: RoomRecord,
  players: PlayerRecord[],
): Promise<void> {
  const assignments = await tx.listAssignments(room.id, room.roundNumber)
  if (assignments.length === 0) return
  const targets = circularAssignmentMap(players.map((player) => ({ id: player.id, seat: player.seat })))
  for (const assignment of assignments) {
    const expected = targets.get(assignment.authorPlayerId)
    if (expected !== assignment.targetPlayerId) {
      await tx.deleteAssignment(room.id, room.roundNumber, assignment.authorPlayerId)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Sichtaufbau – serverseitige Filterung
 * ------------------------------------------------------------------ */

export function buildView(
  room: RoomRecord,
  players: PlayerRecord[],
  assignments: AssignmentRecord[],
  roundProgress: RoundProgressRecord[],
  viewer: PlayerRecord,
  notes: string,
  now: number,
): RoomView {
  const ordered = [...players].sort(bySeat)
  const submitted = new Set(assignments.map((assignment) => assignment.authorPlayerId))
  const progressByPlayer = new Map(roundProgress.map((progress) => [progress.playerId, progress]))
  const rankingComplete =
    room.phase === 'playing' &&
    ordered.length > 0 &&
    ordered.every((player) => progressByPlayer.get(player.id)?.placement != null)

  const playerViews: RoomPlayerView[] = ordered.map((player) => ({
    id: player.id,
    name: player.name,
    seat: player.seat,
    isHost: room.hostPlayerId === player.id,
    online: isOnline(player, now),
    hasSubmittedTerm: submitted.has(player.id),
    ...progressFields(progressByPlayer.get(player.id)),
  }))

  let board: RoomBoardEntry[] | null = null
  if (room.phase === 'playing') {
    const termByTarget = new Map(assignments.map((a) => [a.targetPlayerId, a.term]))
    board = ordered.map((player) => ({
      playerId: player.id,
      name: player.name,
      seat: player.seat,
      online: isOnline(player, now),
      isSelf: player.id === viewer.id,
      // Während des Ratens bleibt der eigene Begriff vollständig serverseitig.
      // Erst der gemeinsame Rundenabschluss deckt alle Begriffe für alle auf.
      term:
        player.id === viewer.id && !rankingComplete
          ? null
          : (termByTarget.get(player.id) ?? null),
      ...progressFields(progressByPlayer.get(player.id)),
    }))
  }

  const targets = circularAssignmentMap(ordered.map((player) => ({ id: player.id, seat: player.seat })))
  const targetId = targets.get(viewer.id)
  const target = targetId ? ordered.find((player) => player.id === targetId) : undefined

  const ownAssignment = assignments.find((a) => a.authorPlayerId === viewer.id)

  return {
    code: room.code,
    phase: room.phase,
    version: room.version,
    locked: room.locked,
    roundNumber: room.roundNumber,
    you: {
      playerId: viewer.id,
      name: viewer.name,
      seat: viewer.seat,
      isHost: room.hostPlayerId === viewer.id,
    },
    players: playerViews,
    board,
    assignmentTarget:
      room.phase === 'lobby' && target
        ? { playerId: target.id, name: target.name, seat: target.seat }
        : null,
    // Während der Runde darf auch der eigene vergebene Begriff nicht mehr
    // ausgeliefert werden – sonst ließe sich indirekt zurückschließen.
    submittedTerm: room.phase === 'lobby' ? (ownAssignment?.term ?? null) : null,
    notes,
    serverTime: now,
  }
}

/* ------------------------------------------------------------------ *
 * Operationen
 * ------------------------------------------------------------------ */

export interface CreatedRoom {
  code: string
  playerId: string
  rejoinToken: string
}

export async function createRoom(store: RoomStore, rawName: string): Promise<CreatedRoom> {
  const name = validatePlayerName(rawName)
  if (!name.ok) throw fail.badRequest('name_invalid', 'Ungültiger Anzeigename.')

  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const code = await uniqueCode(tx)
    const roomId = randomUUID()
    const playerId = randomUUID()
    const token = randomToken()

    await tx.insertRoom({
      id: roomId,
      code,
      phase: 'lobby',
      version: 1,
      locked: false,
      roundNumber: 1,
      hostPlayerId: null,
      hostOfflineSince: null,
      roundStartedAt: null,
      createdAt: now,
      lastActivityAt: now,
    })

    await tx.insertPlayer({
      id: playerId,
      roomId,
      name: name.value,
      nameKey: playerNameKey(name.value),
      seat: 1,
      rejoinTokenHash: sha256(token),
      joinedAt: now,
      lastSeenAt: now,
    })

    const room = await tx.getRoomForUpdate(code)
    if (!room) throw fail.internal()
    await tx.updateRoom({ ...room, hostPlayerId: playerId })
    await tx.insertEvent(roomId, 1, 'room_created', playerId)

    return { code, playerId, rejoinToken: token }
  })
}

export async function joinRoom(
  store: RoomStore,
  code: string,
  rawName: string,
): Promise<CreatedRoom> {
  const name = validatePlayerName(rawName)
  if (!name.ok) throw fail.badRequest('name_invalid', 'Ungültiger Anzeigename.')

  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const room = await tx.getRoomForUpdate(code)
    if (!room || room.phase === 'closed') throw fail.notFound('room_not_found', 'Raum nicht gefunden.')
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Die Runde läuft bereits.')
    if (room.locked) throw fail.conflict('room_locked', 'Der Raum ist gesperrt.')

    const players = await tx.listPlayers(room.id)
    if (players.length >= WHO_AM_I.maxPlayers) throw fail.conflict('room_full', 'Der Raum ist voll.')

    const key = playerNameKey(name.value)
    if (players.some((player) => player.nameKey === key))
      throw fail.conflict('name_taken', 'Dieser Name ist bereits vergeben.')

    const playerId = randomUUID()
    const token = randomToken()
    const seat = players.length + 1

    await tx.insertPlayer({
      id: playerId,
      roomId: room.id,
      name: name.value,
      nameKey: key,
      seat,
      rejoinTokenHash: sha256(token),
      joinedAt: now,
      lastSeenAt: now,
    })

    const updated = touch(room, now)
    await tx.updateRoom(updated)
    await pruneStaleAssignments(tx, updated, [
      ...players,
      {
        id: playerId,
        roomId: room.id,
        name: name.value,
        nameKey: key,
        seat,
        rejoinTokenHash: '',
        joinedAt: now,
        lastSeenAt: now,
      },
    ])
    await tx.insertEvent(room.id, updated.version, 'player_joined', playerId)

    return { code: room.code, playerId, rejoinToken: token }
  })
}

/**
 * Liest den Raum aus Sicht eines authentifizierten Spielers und markiert ihn
 * dabei als online. Bewusst ohne Versionserhöhung: sonst würde jedes Polling
 * bei allen anderen ein Update auslösen.
 */
export async function readRoom(store: RoomStore, code: string, actor: Actor): Promise<RoomView> {
  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const room = await tx.getRoomForUpdate(code)
    if (!room || room.phase === 'closed') throw fail.notFound('room_not_found', 'Raum nicht gefunden.')

    const players = await tx.listPlayers(room.id)
    const viewer = authenticate(players, actor)

    if (now - viewer.lastSeenAt > 3000) {
      await tx.updatePlayer({ ...viewer, lastSeenAt: now })
    }
    const refreshed = players.map((player) =>
      player.id === viewer.id ? { ...player, lastSeenAt: now } : player,
    )

    const reconciled = reconcileHost(room, refreshed, now)
    if (reconciled.hostPlayerId !== room.hostPlayerId) {
      const promoted = { ...reconciled, version: room.version + 1 }
      await tx.updateRoom(promoted)
      await tx.insertEvent(room.id, promoted.version, 'host_transferred_automatically', promoted.hostPlayerId)
      return finishView(tx, promoted, refreshed, viewer, now)
    }
    if (reconciled.hostOfflineSince !== room.hostOfflineSince) {
      await tx.updateRoom(reconciled)
    }

    return finishView(tx, reconciled, refreshed, viewer, now)
  })
}

async function finishView(
  tx: RoomTx,
  room: RoomRecord,
  players: PlayerRecord[],
  viewer: PlayerRecord,
  now: number,
): Promise<RoomView> {
  const assignments = await tx.listAssignments(room.id, room.roundNumber)
  const roundProgress = await tx.listRoundProgress(room.id, room.roundNumber)
  const notes = await tx.getNotes(room.id, viewer.id, room.roundNumber)
  return buildView(
    room,
    players,
    assignments,
    roundProgress,
    { ...viewer, lastSeenAt: now },
    notes,
    now,
  )
}

/** Gemeinsamer Rahmen für alle mutierenden Aktionen. */
async function mutate(
  store: RoomStore,
  code: string,
  actor: Actor,
  operation: (context: {
    tx: RoomTx
    room: RoomRecord
    players: PlayerRecord[]
    self: PlayerRecord
    now: number
  }) => Promise<{ room: RoomRecord; players?: PlayerRecord[]; event: string } | null>,
): Promise<RoomView> {
  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const room = await tx.getRoomForUpdate(code)
    if (!room || room.phase === 'closed') throw fail.notFound('room_not_found', 'Raum nicht gefunden.')

    const players = await tx.listPlayers(room.id)
    const self = authenticate(players, actor)
    await tx.updatePlayer({ ...self, lastSeenAt: now })
    const withSelf = players.map((player) =>
      player.id === self.id ? { ...player, lastSeenAt: now } : player,
    )

    const result = await operation({ tx, room, players: withSelf, self, now })
    if (!result) return finishView(tx, room, withSelf, self, now)

    const updated = touch(result.room, now)
    await tx.updateRoom(updated)
    await tx.insertEvent(room.id, updated.version, result.event, self.id)

    const finalPlayers = result.players ?? (await tx.listPlayers(room.id))
    const viewer = finalPlayers.find((player) => player.id === self.id)
    if (!viewer) throw fail.forbidden('removed', 'Du bist nicht mehr im Raum.')
    return finishView(tx, updated, finalPlayers, viewer, now)
  })
}

export function submitTerm(store: RoomStore, code: string, actor: Actor, rawTerm: string) {
  const term = validateWhoAmITerm(rawTerm)
  if (!term.ok) throw fail.badRequest('term_invalid', 'Ungültiger Begriff.')

  return mutate(store, code, actor, async ({ tx, room, players, self }) => {
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Die Runde läuft bereits.')
    const targets = circularAssignmentMap(players.map((p) => ({ id: p.id, seat: p.seat })))
    const targetId = targets.get(self.id)
    if (!targetId) throw fail.conflict('too_few_players', 'Es sind noch zu wenige Spieler im Raum.')

    await tx.upsertAssignment({
      roomId: room.id,
      roundNumber: room.roundNumber,
      authorPlayerId: self.id,
      targetPlayerId: targetId,
      term: term.value,
    })
    return { room, event: 'term_submitted' }
  })
}

export function setNotes(store: RoomStore, code: string, actor: Actor, content: string) {
  const trimmed = content.slice(0, WHO_AM_I.notesMaxLength)
  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const room = await tx.getRoomForUpdate(code)
    if (!room || room.phase === 'closed') throw fail.notFound('room_not_found', 'Raum nicht gefunden.')
    const players = await tx.listPlayers(room.id)
    const self = authenticate(players, actor)
    // Notizen sind rein privat: sie erhöhen die Raumversion nicht und lösen
    // damit auch kein Update bei den Mitspielern aus.
    await tx.setNotes(room.id, self.id, room.roundNumber, trimmed)
    await tx.updatePlayer({ ...self, lastSeenAt: now })
    const refreshed = players.map((p) => (p.id === self.id ? { ...p, lastSeenAt: now } : p))
    return finishView(tx, room, refreshed, self, now)
  })
}

export function reorderPlayers(store: RoomStore, code: string, actor: Actor, orderedIds: string[]) {
  return mutate(store, code, actor, async ({ tx, room, players, self }) => {
    requireHost(room, self)
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Während der Runde nicht möglich.')

    const reordered = applyOrder(
      players.map((player) => ({ id: player.id, seat: player.seat })),
      orderedIds,
    )
    await tx.replaceSeats(
      room.id,
      reordered.map((entry) => ({ playerId: entry.id, seat: entry.seat })),
    )
    const seatById = new Map(reordered.map((entry) => [entry.id, entry.seat]))
    const updatedPlayers = players.map((player) => ({
      ...player,
      seat: seatById.get(player.id) ?? player.seat,
    }))
    await pruneStaleAssignments(tx, room, updatedPlayers)
    return { room, players: updatedPlayers, event: 'players_reordered' }
  })
}

export function renumberPlayers(store: RoomStore, code: string, actor: Actor) {
  return mutate(store, code, actor, async ({ tx, room, players, self }) => {
    requireHost(room, self)
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Während der Runde nicht möglich.')

    const ordered = renumberSeats(
      [...players].sort((a, b) => a.seat - b.seat || a.joinedAt - b.joinedAt),
    )
    await tx.replaceSeats(
      room.id,
      ordered.map((entry) => ({ playerId: entry.id, seat: entry.seat })),
    )
    const seatById = new Map(ordered.map((entry) => [entry.id, entry.seat]))
    const updatedPlayers = players.map((player) => ({
      ...player,
      seat: seatById.get(player.id) ?? player.seat,
    }))
    await pruneStaleAssignments(tx, room, updatedPlayers)
    return { room, players: updatedPlayers, event: 'players_renumbered' }
  })
}

export function removePlayer(store: RoomStore, code: string, actor: Actor, targetId: string) {
  return mutate(store, code, actor, async ({ tx, room, players, self }) => {
    requireHost(room, self)
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Während der Runde nicht möglich.')
    if (targetId === self.id) throw fail.badRequest('cannot_remove_self', 'Der Host kann sich nicht selbst entfernen.')
    requirePlayer(players, targetId)

    await tx.deletePlayer(targetId)
    const remaining = renumberSeats(
      players.filter((player) => player.id !== targetId).sort(bySeat),
    )
    await tx.replaceSeats(
      room.id,
      remaining.map((entry) => ({ playerId: entry.id, seat: entry.seat })),
    )
    const updatedPlayers = remaining.map((entry) => ({ ...entry }))
    await pruneStaleAssignments(tx, room, updatedPlayers)
    return { room, players: updatedPlayers, event: 'player_removed' }
  })
}

export function leaveRoom(store: RoomStore, code: string, actor: Actor) {
  return store.withTransaction(async (tx) => {
    const now = Date.now()
    const room = await tx.getRoomForUpdate(code)
    if (!room || room.phase === 'closed') return
    const players = await tx.listPlayers(room.id)
    const self = authenticate(players, actor)
    // Der Spielerkreis einer laufenden Runde ist stabil: sonst würden durch
    // FK-Cascades Begriffe verschwinden und N bzw. der automatische letzte
    // Platz sich mitten in der Runde verändern. Offlinegehen bleibt möglich;
    // der Platz wird erst nach dem Rundenende verlassen.
    if (room.phase === 'playing') {
      throw fail.conflict(
        'round_in_progress',
        'Während einer laufenden Runde kann der Platz nicht verlassen werden.',
      )
    }

    await tx.deletePlayer(self.id)
    const remaining = renumberSeats(players.filter((player) => player.id !== self.id).sort(bySeat))

    if (remaining.length === 0) {
      await tx.deleteRoom(room.id)
      return
    }

    await tx.replaceSeats(
      room.id,
      remaining.map((entry) => ({ playerId: entry.id, seat: entry.seat })),
    )
    let updated = touch(room, now)
    if (room.hostPlayerId === self.id) {
      updated = { ...updated, hostPlayerId: remaining[0]?.id ?? null, hostOfflineSince: null }
    }
    await tx.updateRoom(updated)
    await pruneStaleAssignments(tx, updated, remaining as PlayerRecord[])
    await tx.insertEvent(room.id, updated.version, 'player_left', self.id)
  })
}

export function setLocked(store: RoomStore, code: string, actor: Actor, locked: boolean) {
  return mutate(store, code, actor, async ({ room, self }) => {
    requireHost(room, self)
    return { room: { ...room, locked }, event: locked ? 'room_locked' : 'room_unlocked' }
  })
}

export function transferHost(store: RoomStore, code: string, actor: Actor, targetId: string) {
  return mutate(store, code, actor, async ({ room, players, self }) => {
    requireHost(room, self)
    requirePlayer(players, targetId)
    return {
      room: { ...room, hostPlayerId: targetId, hostOfflineSince: null },
      event: 'host_transferred',
    }
  })
}

export function resetSubmission(store: RoomStore, code: string, actor: Actor, authorId: string) {
  return mutate(store, code, actor, async ({ tx, room, players, self }) => {
    requireHost(room, self)
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Während der Runde nicht möglich.')
    requirePlayer(players, authorId)
    await tx.deleteAssignment(room.id, room.roundNumber, authorId)
    return { room, event: 'submission_reset' }
  })
}

export function startRound(store: RoomStore, code: string, actor: Actor) {
  return mutate(store, code, actor, async ({ tx, room, players, self, now }) => {
    requireHost(room, self)
    if (room.phase !== 'lobby') throw fail.conflict('already_started', 'Die Runde läuft bereits.')
    if (players.length < WHO_AM_I.minPlayers)
      throw fail.conflict('too_few_players', `Mindestens ${WHO_AM_I.minPlayers} Spieler nötig.`)

    const assignments = await tx.listAssignments(room.id, room.roundNumber)
    const authors = new Set(assignments.map((assignment) => assignment.authorPlayerId))
    const missing = players.filter((player) => !authors.has(player.id))
    if (missing.length > 0)
      throw fail.conflict('terms_missing', `Es fehlen noch ${missing.length} Begriffe.`)

    return {
      room: { ...room, phase: 'playing', roundStartedAt: now, locked: true },
      event: 'round_started',
    }
  })
}

/** Ein Spieler meldet ausschließlich sich selbst zur Bestätigung an. */
export function requestPlacement(store: RoomStore, code: string, actor: Actor) {
  return mutate(store, code, actor, async ({ tx, room, self, players, now }) => {
    if (room.phase !== 'playing') throw fail.conflict('not_playing', 'Es läuft keine Runde.')

    const records = await tx.listRoundProgress(room.id, room.roundNumber)
    const current = records.find((record) => record.playerId === self.id)
    if (current?.placement !== null && current?.placement !== undefined) {
      throw fail.conflict('placement_already_finished', 'Deine Platzierung steht bereits fest.')
    }
    // Mehrere Geräte oder Doppelklicks desselben Spielers bleiben idempotent.
    if (current?.claimRequestedAt !== null && current?.claimRequestedAt !== undefined) return null

    const next = reconcileRoundProgress(
      room,
      players,
      [
        ...records.filter((record) => record.playerId !== self.id),
        {
          roomId: room.id,
          roundNumber: room.roundNumber,
          playerId: self.id,
          claimId: randomUUID(),
          claimRequestedAt: now,
          placement: null,
          approvedAt: null,
          automatic: false,
        },
      ],
      now,
    )
    await tx.replaceRoundProgress(room.id, room.roundNumber, next)
    return { room, event: 'placement_requested' }
  })
}

/** Der Host bestätigt eine offene Meldung; der nächste Platz entsteht im Raum-Lock. */
export function approvePlacement(
  store: RoomStore,
  code: string,
  actor: Actor,
  targetId: string,
  claimId: string,
) {
  return mutate(store, code, actor, async ({ tx, room, self, players, now }) => {
    requireHost(room, self)
    if (room.phase !== 'playing') throw fail.conflict('not_playing', 'Es läuft keine Runde.')
    requirePlayer(players, targetId)

    const records = await tx.listRoundProgress(room.id, room.roundNumber)
    const current = records.find((record) => record.playerId === targetId)
    // Die Entscheidung gilt ausschließlich für genau die Meldung, die der Host
    // gesehen hat. So kann eine verspätete Antwort keine neuere Meldung treffen.
    if (!current || current.claimId !== claimId) {
      throw fail.conflict(
        'placement_claim_stale',
        'Diese Meldung ist nicht mehr aktuell.',
      )
    }
    // Wiederholte Bestätigung derselben bereits erledigten Meldung bleibt
    // idempotent und erzeugt weder einen neuen Platz noch eine neue Version.
    if (current.placement !== null) return null
    if (current.claimRequestedAt === null) throw fail.internal()

    const withoutTargetOrAutomatic = records.filter(
      (record) => record.playerId !== targetId && !record.automatic,
    )
    const explicitCount = withoutTargetOrAutomatic.filter(
      (record) => record.placement !== null,
    ).length
    const approved: RoundProgressRecord = {
      ...current,
      placement: explicitCount + 1,
      approvedAt: now,
      automatic: false,
    }
    const next = reconcileRoundProgress(
      room,
      players,
      [...withoutTargetOrAutomatic, approved],
      now,
    )
    await tx.replaceRoundProgress(room.id, room.roundNumber, next)
    return { room, event: 'placement_approved' }
  })
}

/**
 * Hostkorrektur: lehnt eine offene Meldung ab oder nimmt eine explizite
 * Freigabe zurück. Nachfolgende Plätze rücken lückenlos auf; ein zuvor
 * automatisch Letzter wird wieder aktiv, sobald mehr als ein Platz offen ist.
 */
export function resetPlacement(
  store: RoomStore,
  code: string,
  actor: Actor,
  targetId: string,
  claimId: string,
) {
  return mutate(store, code, actor, async ({ tx, room, self, players, now }) => {
    requireHost(room, self)
    if (room.phase !== 'playing') throw fail.conflict('not_playing', 'Es läuft keine Runde.')
    requirePlayer(players, targetId)

    const records = await tx.listRoundProgress(room.id, room.roundNumber)
    const current = records.find((record) => record.playerId === targetId)
    if (!current || current.claimId !== claimId) {
      throw fail.conflict('placement_claim_stale', 'Diese Meldung ist nicht mehr aktuell.')
    }
    if (current.automatic) {
      throw fail.conflict(
        'placement_automatic',
        'Der automatisch letzte Platz folgt aus den übrigen Platzierungen.',
      )
    }

    const next = reconcileRoundProgress(
      room,
      players,
      records.filter((record) => record.playerId !== targetId),
      now,
    )
    await tx.replaceRoundProgress(room.id, room.roundNumber, next)
    return {
      room,
      event: current.placement === null ? 'placement_rejected' : 'placement_reversed',
    }
  })
}

export function endRound(store: RoomStore, code: string, actor: Actor) {
  return mutate(store, code, actor, async ({ tx, room, self }) => {
    requireHost(room, self)
    if (room.phase !== 'playing') throw fail.conflict('not_playing', 'Es läuft keine Runde.')

    // Datensparsamkeit: Begriffe, Notizen und Platzierungen der beendeten
    // Runde werden sofort gelöscht, nicht erst mit dem Raum.
    await tx.deleteAssignmentsForRound(room.id, room.roundNumber)
    await tx.deleteRoundProgressForRound(room.id, room.roundNumber)

    return {
      room: {
        ...room,
        phase: 'lobby',
        locked: false,
        roundNumber: room.roundNumber + 1,
        roundStartedAt: null,
      },
      event: 'round_ended',
    }
  })
}

export function closeRoom(store: RoomStore, code: string, actor: Actor) {
  return store.withTransaction(async (tx) => {
    const room = await tx.getRoomForUpdate(code)
    if (!room) return
    const players = await tx.listPlayers(room.id)
    const self = authenticate(players, actor)
    requireHost(room, self)
    // Räume und alle abhängigen Wer-bin-ich-Daten verschwinden gemeinsam.
    await tx.deleteRoom(room.id)
  })
}

/**
 * Löscht offene, nicht laufende Räume nach einer Stunde Inaktivität.
 * Laufende Runden werden nie gelöscht.
 */
export async function cleanupExpiredRooms(store: RoomStore, now = Date.now()): Promise<number> {
  const ids = await store.findExpiredRoomIds(now - WHO_AM_I.roomInactivityMs)
  if (ids.length === 0) return 0
  return store.deleteRoomsByIds(ids)
}
