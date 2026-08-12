import { randomUUID } from 'node:crypto'
import { seedTerms } from '../../src/data/seedPool.js'
import type {
  AdminStore,
  AnalyticsEventInput,
  AnalyticsStore,
  AssignmentRecord,
  PlayerRecord,
  RateLimitStore,
  RoomRecord,
  RoundProgressRecord,
  RoomStore,
  RoomTx,
  Store,
  SuggestionRecord,
  SuggestionStore,
  TermFilter,
  TermInput,
  TermRecord,
  TermStore,
} from './types.js'

/**
 * Flüchtiger Speicher für lokale Entwicklung und Tests.
 *
 * Bewusst *keine* Attrappe der Sicherheitslogik: Rejoin-Tokens, Rate-Limits und
 * Adminsessions verhalten sich exakt wie in PostgreSQL. Nur die Persistenz
 * fehlt – deshalb lehnt `assertProductionReady()` diesen Adapter in Produktion ab.
 */

function nowIso(): string {
  return new Date().toISOString()
}

/* ---------------------------- Wortpool ---------------------------- */

class MemoryTermStore implements TermStore {
  private readonly rows = new Map<string, TermRecord>()
  private version = 1

  constructor() {
    for (const seed of seedTerms) {
      const id = randomUUID()
      this.rows.set(id, {
        id,
        seedId: seed.id,
        displayTerm: seed.displayTerm,
        canonicalTerm: seed.canonicalTerm,
        hintTerm: seed.hintTerm,
        category: seed.category,
        enabled: seed.enabled,
        reviewStatus: seed.reviewStatus,
        tags: [],
        note: null,
        drawCount: 0,
        lastUsedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
    }
  }

  async listActive(): Promise<TermRecord[]> {
    return [...this.rows.values()].filter((row) => row.enabled)
  }

  async activeVersion(): Promise<number> {
    return this.version
  }

  async list(filter: TermFilter): Promise<{ rows: TermRecord[]; total: number }> {
    const search = filter.search?.trim().toLowerCase()
    const all = [...this.rows.values()]
      .filter((row) => (filter.category ? row.category === filter.category : true))
      .filter((row) => (filter.enabled === undefined ? true : row.enabled === filter.enabled))
      .filter((row) => (filter.reviewStatus ? row.reviewStatus === filter.reviewStatus : true))
      .filter((row) =>
        search
          ? row.displayTerm.toLowerCase().includes(search) ||
            row.canonicalTerm.toLowerCase().includes(search) ||
            row.hintTerm.toLowerCase().includes(search)
          : true,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 50
    return { rows: all.slice(offset, offset + limit), total: all.length }
  }

  async getById(id: string): Promise<TermRecord | null> {
    return this.rows.get(id) ?? null
  }

  async create(input: TermInput): Promise<TermRecord> {
    const id = randomUUID()
    const record: TermRecord = {
      id,
      seedId: input.seedId ?? null,
      displayTerm: input.displayTerm,
      canonicalTerm: input.canonicalTerm,
      hintTerm: input.hintTerm,
      category: input.category,
      enabled: input.enabled,
      reviewStatus: input.reviewStatus,
      tags: input.tags ?? [],
      note: input.note ?? null,
      drawCount: 0,
      lastUsedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.rows.set(id, record)
    this.version++
    return record
  }

  async update(id: string, patch: Partial<TermInput>): Promise<TermRecord | null> {
    const existing = this.rows.get(id)
    if (!existing) return null
    const updated: TermRecord = { ...existing, ...patch, updatedAt: nowIso() }
    this.rows.set(id, updated)
    this.version++
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const deleted = this.rows.delete(id)
    if (deleted) this.version++
    return deleted
  }

  async upsertBySeedId(
    inputs: Array<TermInput & { seedId: string }>,
  ): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0
    let skipped = 0
    for (const input of inputs) {
      const exists = [...this.rows.values()].some(
        (row) =>
          row.seedId === input.seedId ||
          (row.displayTerm.toLowerCase() === input.displayTerm.toLowerCase() &&
            row.category === input.category),
      )
      if (exists) {
        skipped++
        continue
      }
      await this.create(input)
      inserted++
    }
    return { inserted, skipped }
  }

  async findDuplicate(displayTerm: string, category: string): Promise<TermRecord | null> {
    const key = displayTerm.trim().toLowerCase()
    return (
      [...this.rows.values()].find(
        (row) => row.displayTerm.toLowerCase() === key && row.category === category,
      ) ?? null
    )
  }

  async recordDraws(termIds: string[], at: string): Promise<void> {
    for (const id of termIds) {
      const row = this.rows.get(id)
      if (row) this.rows.set(id, { ...row, drawCount: row.drawCount + 1, lastUsedAt: at })
    }
  }

  async usageStats(limit: number) {
    return [...this.rows.values()]
      .sort((a, b) => b.drawCount - a.drawCount)
      .slice(0, limit)
      .map((row) => ({
        termId: row.id,
        displayTerm: row.displayTerm,
        category: row.category,
        draws: row.drawCount,
        lastUsedAt: row.lastUsedAt,
        enabled: row.enabled,
      }))
  }

  async countByCategory() {
    const map = new Map<string, { category: string; enabled: number; disabled: number }>()
    for (const row of this.rows.values()) {
      const entry = map.get(row.category) ?? { category: row.category, enabled: 0, disabled: 0 }
      if (row.enabled) entry.enabled++
      else entry.disabled++
      map.set(row.category, entry)
    }
    return [...map.values()]
  }
}

/* -------------------------- Vorschläge ---------------------------- */

class MemorySuggestionStore implements SuggestionStore {
  private readonly rows = new Map<string, SuggestionRecord>()

  async create(input: {
    displayTerm: string
    canonicalTerm: string
    hintTerm: string
    category: string
    explanation: string | null
    submitterHash: string
    ipHash: string | null
  }): Promise<SuggestionRecord> {
    const record: SuggestionRecord = {
      id: randomUUID(),
      displayTerm: input.displayTerm,
      canonicalTerm: input.canonicalTerm,
      hintTerm: input.hintTerm,
      category: input.category,
      explanation: input.explanation,
      status: 'new',
      submitterHash: input.submitterHash,
      reviewNote: null,
      reviewedAt: null,
      convertedTermId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.rows.set(record.id, record)
    return record
  }

  async list(filter: { status?: SuggestionRecord['status']; limit?: number; offset?: number }) {
    const all = [...this.rows.values()]
      .filter((row) => (filter.status ? row.status === filter.status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const offset = filter.offset ?? 0
    const limit = filter.limit ?? 50
    return { rows: all.slice(offset, offset + limit), total: all.length }
  }

  async getById(id: string) {
    return this.rows.get(id) ?? null
  }

  async update(id: string, patch: Partial<SuggestionRecord>) {
    const existing = this.rows.get(id)
    if (!existing) return null
    const updated: SuggestionRecord = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
      reviewedAt: patch.status && patch.status !== 'new' ? nowIso() : existing.reviewedAt,
    }
    this.rows.set(id, updated)
    return updated
  }

  async countSince(since: string) {
    return [...this.rows.values()].filter((row) => row.createdAt >= since).length
  }
}

/* -------------------------- Rate-Limit ---------------------------- */

class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>()

  async hit(bucket: string, subject: string, limit: number, windowMs: number) {
    const key = `${bucket}:${subject}`
    const now = Date.now()
    const timestamps = (this.hits.get(key) ?? []).filter((time) => now - time < windowMs)

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? now
      this.hits.set(key, timestamps)
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
      }
    }

    timestamps.push(now)
    this.hits.set(key, timestamps)
    return { allowed: true, remaining: limit - timestamps.length, retryAfterSeconds: 0 }
  }

  async purgeBefore(cutoff: string): Promise<void> {
    const threshold = Date.parse(cutoff)
    for (const [key, times] of this.hits) {
      const kept = times.filter((time) => time >= threshold)
      if (kept.length === 0) this.hits.delete(key)
      else this.hits.set(key, kept)
    }
  }
}

/* ----------------------------- Räume ------------------------------ */

interface RoomState {
  room: RoomRecord
  players: Map<string, PlayerRecord>
  assignments: Map<string, AssignmentRecord>
  roundProgress: Map<string, RoundProgressRecord>
  notes: Map<string, string>
}

class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, RoomState>()
  private readonly byCode = new Map<string, string>()
  /** Serialisiert alle Transaktionen – entspricht dem Zeilen-Lock in PostgreSQL. */
  private queue: Promise<unknown> = Promise.resolve()

  private key(roomId: string, roundNumber: number, playerId: string): string {
    return `${roomId}:${roundNumber}:${playerId}`
  }

  private tx(): RoomTx {
    const rooms = this.rooms
    const byCode = this.byCode
    const key = this.key.bind(this)

    const state = (roomId: string): RoomState => {
      const found = rooms.get(roomId)
      if (!found) throw new Error(`Unbekannter Raum ${roomId}`)
      return found
    }

    return {
      async codeExists(code) {
        return byCode.has(code)
      },
      async insertRoom(room) {
        rooms.set(room.id, {
          room,
          players: new Map(),
          assignments: new Map(),
          roundProgress: new Map(),
          notes: new Map(),
        })
        byCode.set(room.code, room.id)
      },
      async getRoomForUpdate(code) {
        const id = byCode.get(code)
        return id ? { ...state(id).room } : null
      },
      async getRoom(code) {
        const id = byCode.get(code)
        return id ? { ...state(id).room } : null
      },
      async updateRoom(room) {
        state(room.id).room = { ...room }
      },
      async deleteRoom(roomId) {
        const found = rooms.get(roomId)
        if (!found) return
        byCode.delete(found.room.code)
        rooms.delete(roomId)
      },
      async listPlayers(roomId) {
        return [...state(roomId).players.values()].map((player) => ({ ...player }))
      },
      async insertPlayer(player) {
        state(player.roomId).players.set(player.id, { ...player })
      },
      async updatePlayer(player) {
        state(player.roomId).players.set(player.id, { ...player })
      },
      async replaceSeats(roomId, seats) {
        const current = state(roomId)
        for (const { playerId, seat } of seats) {
          const player = current.players.get(playerId)
          if (player) current.players.set(playerId, { ...player, seat })
        }
      },
      async deletePlayer(playerId) {
        for (const current of rooms.values()) {
          if (!current.players.delete(playerId)) continue
          if (current.room.hostPlayerId === playerId) current.room.hostPlayerId = null
          for (const [assignmentKey, assignment] of current.assignments) {
            if (assignment.authorPlayerId === playerId || assignment.targetPlayerId === playerId) {
              current.assignments.delete(assignmentKey)
            }
          }
          for (const [progressKey, progress] of current.roundProgress) {
            if (progress.playerId === playerId) current.roundProgress.delete(progressKey)
          }
          for (const noteKey of [...current.notes.keys()]) {
            if (noteKey.endsWith(`:${playerId}`)) current.notes.delete(noteKey)
          }
          return
        }
      },
      async listAssignments(roomId, roundNumber) {
        return [...state(roomId).assignments.values()]
          .filter((assignment) => assignment.roundNumber === roundNumber)
          .map((assignment) => ({ ...assignment }))
      },
      async upsertAssignment(assignment) {
        const current = state(assignment.roomId)
        // Ein Ziel darf pro Runde nur einmal belegt sein.
        for (const [existingKey, existing] of current.assignments) {
          if (
            existing.roundNumber === assignment.roundNumber &&
            existing.targetPlayerId === assignment.targetPlayerId &&
            existing.authorPlayerId !== assignment.authorPlayerId
          ) {
            current.assignments.delete(existingKey)
          }
        }
        current.assignments.set(
          key(assignment.roomId, assignment.roundNumber, assignment.authorPlayerId),
          { ...assignment },
        )
      },
      async deleteAssignment(roomId, roundNumber, authorPlayerId) {
        state(roomId).assignments.delete(key(roomId, roundNumber, authorPlayerId))
      },
      async deleteAssignmentsForRound(roomId, roundNumber) {
        const current = state(roomId)
        for (const [assignmentKey, assignment] of current.assignments) {
          if (assignment.roundNumber === roundNumber) current.assignments.delete(assignmentKey)
        }
        for (const noteKey of [...current.notes.keys()]) {
          if (noteKey.startsWith(`${roomId}:${roundNumber}:`)) current.notes.delete(noteKey)
        }
      },
      async listRoundProgress(roomId, roundNumber) {
        return [...state(roomId).roundProgress.values()]
          .filter((progress) => progress.roundNumber === roundNumber)
          .map((progress) => ({ ...progress }))
      },
      async replaceRoundProgress(roomId, roundNumber, records) {
        const current = state(roomId)
        for (const [progressKey, progress] of current.roundProgress) {
          if (progress.roundNumber === roundNumber) current.roundProgress.delete(progressKey)
        }
        for (const record of records) {
          current.roundProgress.set(key(roomId, roundNumber, record.playerId), { ...record })
        }
      },
      async deleteRoundProgressForRound(roomId, roundNumber) {
        const current = state(roomId)
        for (const [progressKey, progress] of current.roundProgress) {
          if (progress.roundNumber === roundNumber) current.roundProgress.delete(progressKey)
        }
      },
      async getNotes(roomId, playerId, roundNumber) {
        return state(roomId).notes.get(key(roomId, roundNumber, playerId)) ?? ''
      },
      async setNotes(roomId, playerId, roundNumber, content) {
        state(roomId).notes.set(key(roomId, roundNumber, playerId), content)
      },
      async insertEvent() {
        // Das Revisionsprotokoll ist für die Entwicklungsfassung entbehrlich.
      },
    }
  }

  async withTransaction<T>(fn: (tx: RoomTx) => Promise<T>): Promise<T> {
    const run = this.queue.then(
      () => fn(this.tx()),
      () => fn(this.tx()),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  async findExpiredRoomIds(inactiveBefore: number): Promise<string[]> {
    return [...this.rooms.values()]
      .filter((state) => state.room.phase !== 'playing' && state.room.lastActivityAt < inactiveBefore)
      .map((state) => state.room.id)
  }

  async deleteRoomsByIds(ids: string[]): Promise<number> {
    let deleted = 0
    for (const id of ids) {
      const state = this.rooms.get(id)
      if (!state) continue
      this.byCode.delete(state.room.code)
      this.rooms.delete(id)
      deleted++
    }
    return deleted
  }

  async countRoomsCreatedSince(since: string): Promise<number> {
    const threshold = Date.parse(since)
    return [...this.rooms.values()].filter((state) => state.room.createdAt >= threshold).length
  }
}

/* ---------------------------- Analytics --------------------------- */

interface StoredEvent extends AnalyticsEventInput {
  id: string
}

class MemoryAnalyticsStore implements AnalyticsStore {
  private readonly events: StoredEvent[] = []

  async insertMany(events: AnalyticsEventInput[]): Promise<number> {
    for (const event of events) this.events.push({ ...event, id: randomUUID() })
    return events.length
  }

  async query(from: string, to: string) {
    return this.events
      .filter((event) => event.occurredAt >= from && event.occurredAt <= to)
      .map((event) => ({ ...event, payload: event.payload }))
  }

  async deleteRange(from: string, to: string): Promise<number> {
    let deleted = 0
    for (let index = this.events.length - 1; index >= 0; index--) {
      const event = this.events[index]
      if (event && event.occurredAt >= from && event.occurredAt <= to) {
        this.events.splice(index, 1)
        deleted++
      }
    }
    return deleted
  }

  async deleteByIds(ids: string[]): Promise<number> {
    const set = new Set(ids)
    let deleted = 0
    for (let index = this.events.length - 1; index >= 0; index--) {
      const event = this.events[index]
      if (event && set.has(event.id)) {
        this.events.splice(index, 1)
        deleted++
      }
    }
    return deleted
  }

  async deleteAll(): Promise<number> {
    const count = this.events.length
    this.events.length = 0
    return count
  }
}

/* ------------------------------ Admin ----------------------------- */

class MemoryAdminStore implements AdminStore {
  private readonly sessions = new Map<
    string,
    { username: string; expiresAt: string; revokedAt: string | null }
  >()
  private readonly audit: Array<{
    id: string
    actor: string
    action: string
    target: string | null
    details: Record<string, unknown>
    createdAt: string
  }> = []

  async createSession(tokenHash: string, username: string, expiresAt: string) {
    this.sessions.set(tokenHash, { username, expiresAt, revokedAt: null })
  }

  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null
  }

  async revokeSession(tokenHash: string) {
    const session = this.sessions.get(tokenHash)
    if (session) session.revokedAt = nowIso()
  }

  async purgeExpiredSessions(now: string) {
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt < now) this.sessions.delete(hash)
    }
  }

  async logAction(actor: string, action: string, target: string | null, details: Record<string, unknown>) {
    this.audit.unshift({ id: randomUUID(), actor, action, target, details, createdAt: nowIso() })
  }

  async listAuditLog(limit: number) {
    return this.audit.slice(0, limit)
  }
}

/* ------------------------------ Store ----------------------------- */

export function createMemoryStore(): Store {
  return {
    kind: 'memory',
    terms: new MemoryTermStore(),
    suggestions: new MemorySuggestionStore(),
    rateLimit: new MemoryRateLimitStore(),
    rooms: new MemoryRoomStore(),
    analytics: new MemoryAnalyticsStore(),
    admin: new MemoryAdminStore(),
    async healthCheck() {
      /* immer verfügbar */
    },
  }
}
