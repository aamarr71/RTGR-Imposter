import type { RoomPhase } from '../../src/shared/types.js'
import type { ReviewStatus, SuggestionStatus } from '../../src/shared/config.js'

/**
 * Speicherabstraktion.
 *
 * Die Geschäftsregeln liegen bewusst *nicht* hier, sondern einmalig in
 * `server/services/roomService.ts`. Dieser Layer stellt nur transaktionale
 * Lese-/Schreiboperationen bereit – dadurch verhalten sich der PostgreSQL- und
 * der In-Memory-Adapter garantiert gleich.
 */

/* ---------------------------- Wortpool ---------------------------- */

export interface TermRecord {
  id: string
  seedId: string | null
  displayTerm: string
  canonicalTerm: string
  hintTerm: string
  category: string
  enabled: boolean
  reviewStatus: ReviewStatus
  tags: string[]
  note: string | null
  drawCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TermFilter {
  search?: string
  category?: string
  enabled?: boolean
  reviewStatus?: ReviewStatus
  limit?: number
  offset?: number
}

export interface TermInput {
  displayTerm: string
  canonicalTerm: string
  hintTerm: string
  category: string
  enabled: boolean
  reviewStatus: ReviewStatus
  tags?: string[]
  note?: string | null
  seedId?: string | null
}

export interface TermStore {
  listActive(): Promise<TermRecord[]>
  /** Version des aktiven Pools – ändert sich, sobald ein Begriff bearbeitet wird. */
  activeVersion(): Promise<number>
  list(filter: TermFilter): Promise<{ rows: TermRecord[]; total: number }>
  getById(id: string): Promise<TermRecord | null>
  create(input: TermInput): Promise<TermRecord>
  update(id: string, patch: Partial<TermInput>): Promise<TermRecord | null>
  remove(id: string): Promise<boolean>
  /** Idempotenter Import der gelieferten Startdaten. */
  upsertBySeedId(inputs: Array<TermInput & { seedId: string }>): Promise<{ inserted: number; skipped: number }>
  /** Duplikatprüfung: gleicher Anzeigebegriff in derselben Kategorie. */
  findDuplicate(displayTerm: string, category: string): Promise<TermRecord | null>
  recordDraws(termIds: string[], at: string): Promise<void>
  usageStats(limit: number): Promise<
    Array<{ termId: string; displayTerm: string; category: string; draws: number; lastUsedAt: string | null; enabled: boolean }>
  >
  countByCategory(): Promise<Array<{ category: string; enabled: number; disabled: number }>>
}

/* -------------------------- Vorschläge ---------------------------- */

export interface SuggestionRecord {
  id: string
  displayTerm: string
  canonicalTerm: string
  hintTerm: string
  category: string
  explanation: string | null
  status: SuggestionStatus
  submitterHash: string
  reviewNote: string | null
  reviewedAt: string | null
  convertedTermId: string | null
  createdAt: string
  updatedAt: string
}

export interface SuggestionStore {
  create(input: {
    displayTerm: string
    canonicalTerm: string
    hintTerm: string
    category: string
    explanation: string | null
    submitterHash: string
    ipHash: string | null
  }): Promise<SuggestionRecord>
  list(filter: { status?: SuggestionStatus; limit?: number; offset?: number }): Promise<{
    rows: SuggestionRecord[]
    total: number
  }>
  getById(id: string): Promise<SuggestionRecord | null>
  update(
    id: string,
    patch: Partial<
      Pick<
        SuggestionRecord,
        'displayTerm' | 'canonicalTerm' | 'hintTerm' | 'category' | 'explanation' | 'status' | 'reviewNote' | 'convertedTermId'
      >
    >,
  ): Promise<SuggestionRecord | null>
  countSince(since: string): Promise<number>
}

/* -------------------------- Rate-Limit ---------------------------- */

export interface RateLimitStore {
  /**
   * Zählt Treffer im gleitenden Fenster und registriert den aktuellen Versuch,
   * falls das Limit noch nicht erreicht ist. Muss atomar sein.
   */
  hit(
    bucket: string,
    subject: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>
  purgeBefore(cutoff: string): Promise<void>
}

/* ----------------------------- Räume ------------------------------ */

export interface RoomRecord {
  id: string
  code: string
  phase: RoomPhase
  version: number
  locked: boolean
  roundNumber: number
  hostPlayerId: string | null
  hostOfflineSince: number | null
  roundStartedAt: number | null
  createdAt: number
  lastActivityAt: number
}

export interface PlayerRecord {
  id: string
  roomId: string
  name: string
  nameKey: string
  seat: number
  rejoinTokenHash: string
  joinedAt: number
  lastSeenAt: number
}

export interface AssignmentRecord {
  roomId: string
  roundNumber: number
  authorPlayerId: string
  targetPlayerId: string
  term: string
}

/** Vergabezustand eines Spielers innerhalb genau einer „Wer bin ich?“-Runde. */
export interface RoundProgressRecord {
  roomId: string
  roundNumber: number
  playerId: string
  /** Eindeutige Revision der aktuellen Spieler-Meldung (ABA-Schutz). */
  claimId: string | null
  claimRequestedAt: number | null
  placement: number | null
  approvedAt: number | null
  automatic: boolean
}

/** Transaktionale Sicht auf einen Raum. Alle Methoden laufen in einer Transaktion. */
export interface RoomTx {
  codeExists(code: string): Promise<boolean>
  insertRoom(room: RoomRecord): Promise<void>
  /** Sperrt die Raumzeile, damit parallele Updates sich nicht überholen. */
  getRoomForUpdate(code: string): Promise<RoomRecord | null>
  getRoom(code: string): Promise<RoomRecord | null>
  updateRoom(room: RoomRecord): Promise<void>
  deleteRoom(roomId: string): Promise<void>

  listPlayers(roomId: string): Promise<PlayerRecord[]>
  insertPlayer(player: PlayerRecord): Promise<void>
  updatePlayer(player: PlayerRecord): Promise<void>
  /** Setzt alle Sitznummern gemeinsam – nötig beim Umsortieren. */
  replaceSeats(roomId: string, seats: Array<{ playerId: string; seat: number }>): Promise<void>
  deletePlayer(playerId: string): Promise<void>

  listAssignments(roomId: string, roundNumber: number): Promise<AssignmentRecord[]>
  upsertAssignment(assignment: AssignmentRecord): Promise<void>
  deleteAssignment(roomId: string, roundNumber: number, authorPlayerId: string): Promise<void>
  deleteAssignmentsForRound(roomId: string, roundNumber: number): Promise<void>

  listRoundProgress(roomId: string, roundNumber: number): Promise<RoundProgressRecord[]>
  /** Ersetzt den gesamten Rundenstand atomar; maximal 20 kleine Datensätze. */
  replaceRoundProgress(
    roomId: string,
    roundNumber: number,
    records: RoundProgressRecord[],
  ): Promise<void>
  deleteRoundProgressForRound(roomId: string, roundNumber: number): Promise<void>

  getNotes(roomId: string, playerId: string, roundNumber: number): Promise<string>
  setNotes(roomId: string, playerId: string, roundNumber: number, content: string): Promise<void>

  insertEvent(roomId: string, version: number, kind: string, actorPlayerId: string | null): Promise<void>
}

export interface RoomStore {
  withTransaction<T>(fn: (tx: RoomTx) => Promise<T>): Promise<T>
  /** Offene, nicht laufende Räume, die zu lange inaktiv sind. */
  findExpiredRoomIds(inactiveBefore: number): Promise<string[]>
  deleteRoomsByIds(ids: string[]): Promise<number>
  countRoomsCreatedSince(since: string): Promise<number>
}

/* ---------------------------- Analytics --------------------------- */

export interface AnalyticsEventInput {
  name: string
  deviceHash: string
  sessionHash: string
  payload: Record<string, unknown>
  occurredAt: string
}

export interface AnalyticsStore {
  insertMany(events: AnalyticsEventInput[]): Promise<number>
  query(from: string, to: string): Promise<
    Array<{ id: string; name: string; deviceHash: string; sessionHash: string; payload: Record<string, unknown>; occurredAt: string }>
  >
  deleteRange(from: string, to: string): Promise<number>
  deleteByIds(ids: string[]): Promise<number>
  deleteAll(): Promise<number>
}

/* ------------------------------ Admin ----------------------------- */

export interface AdminStore {
  createSession(tokenHash: string, username: string, expiresAt: string): Promise<void>
  findSession(tokenHash: string): Promise<{ username: string; expiresAt: string; revokedAt: string | null } | null>
  revokeSession(tokenHash: string): Promise<void>
  purgeExpiredSessions(now: string): Promise<void>
  logAction(actor: string, action: string, target: string | null, details: Record<string, unknown>): Promise<void>
  listAuditLog(limit: number): Promise<
    Array<{ id: string; actor: string; action: string; target: string | null; details: Record<string, unknown>; createdAt: string }>
  >
}

/* ------------------------------ Store ----------------------------- */

export interface Store {
  readonly kind: 'postgres' | 'memory'
  terms: TermStore
  suggestions: SuggestionStore
  rateLimit: RateLimitStore
  rooms: RoomStore
  analytics: AnalyticsStore
  admin: AdminStore
  /** Wirft, wenn der Speicher nicht benutzbar ist (z. B. Datenbank offline). */
  healthCheck(): Promise<void>
}
