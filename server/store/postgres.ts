import pg from 'pg'
import { env, requireDatabaseUrl } from '../env.js'
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

const { Pool } = pg
type PoolClient = pg.PoolClient

/**
 * PostgreSQL-Adapter.
 *
 * Der Pool ist bewusst klein: Serverless-Instanzen skalieren horizontal, jede
 * einzelne braucht nur wenige Verbindungen. Alle Raumänderungen laufen in
 * Transaktionen mit `select … for update` auf der Raumzeile.
 */

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: requireDatabaseUrl(),
    ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: env.isVercel ? 2 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  })
  pool.on('error', (error) => console.error('[db] Pool-Fehler:', error))
  return pool
}

async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, values)
}

/* ------------------------ Mapper ------------------------ */

interface TermRow {
  id: string
  seed_id: string | null
  display_term: string
  canonical_term: string
  hint_term: string
  category: string
  enabled: boolean
  review_status: TermRecord['reviewStatus']
  tags: string[]
  note: string | null
  draw_count: string | number
  last_used_at: Date | null
  created_at: Date
  updated_at: Date
}

function toTerm(row: TermRow): TermRecord {
  return {
    id: row.id,
    seedId: row.seed_id,
    displayTerm: row.display_term,
    canonicalTerm: row.canonical_term,
    hintTerm: row.hint_term,
    category: row.category,
    enabled: row.enabled,
    reviewStatus: row.review_status,
    tags: row.tags ?? [],
    note: row.note,
    drawCount: Number(row.draw_count),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const TERM_SELECT = `
  select t.id, t.seed_id, t.display_term, t.canonical_term, t.hint_term,
         c.name as category, t.enabled, t.review_status, t.tags, t.note,
         t.draw_count, t.last_used_at, t.created_at, t.updated_at
  from impostor_terms t
  join categories c on c.id = t.category_id
`

/* ---------------------------- Wortpool ---------------------------- */

class PgTermStore implements TermStore {
  async listActive(): Promise<TermRecord[]> {
    const result = await query<TermRow>(`${TERM_SELECT} where t.enabled order by t.display_term`)
    return result.rows.map(toTerm)
  }

  async activeVersion(): Promise<number> {
    const result = await query<{ version: string | null }>(
      `select extract(epoch from max(updated_at))::bigint::text as version
       from impostor_terms where enabled`,
    )
    return Number(result.rows[0]?.version ?? 0)
  }

  async list(filter: TermFilter): Promise<{ rows: TermRecord[]; total: number }> {
    const conditions: string[] = []
    const values: unknown[] = []

    if (filter.category) {
      values.push(filter.category)
      conditions.push(`c.name = $${values.length}`)
    }
    if (filter.enabled !== undefined) {
      values.push(filter.enabled)
      conditions.push(`t.enabled = $${values.length}`)
    }
    if (filter.reviewStatus) {
      values.push(filter.reviewStatus)
      conditions.push(`t.review_status = $${values.length}`)
    }
    if (filter.search?.trim()) {
      values.push(`%${filter.search.trim()}%`)
      conditions.push(
        `(t.display_term ilike $${values.length} or t.canonical_term ilike $${values.length} or t.hint_term ilike $${values.length})`,
      )
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''
    const totalResult = await query<{ count: string }>(
      `select count(*)::text as count from impostor_terms t
       join categories c on c.id = t.category_id ${where}`,
      values,
    )

    values.push(filter.limit ?? 50, filter.offset ?? 0)
    const rows = await query<TermRow>(
      `${TERM_SELECT} ${where} order by t.updated_at desc limit $${values.length - 1} offset $${values.length}`,
      values,
    )

    return { rows: rows.rows.map(toTerm), total: Number(totalResult.rows[0]?.count ?? 0) }
  }

  async getById(id: string): Promise<TermRecord | null> {
    const result = await query<TermRow>(`${TERM_SELECT} where t.id = $1`, [id])
    const row = result.rows[0]
    return row ? toTerm(row) : null
  }

  async create(input: TermInput): Promise<TermRecord> {
    const result = await query<{ id: string }>(
      `insert into impostor_terms
         (seed_id, display_term, canonical_term, hint_term, category_id, enabled, review_status, tags, note)
       values ($1, $2, $3, $4, (select id from categories where name = $5), $6, $7, $8, $9)
       returning id`,
      [
        input.seedId ?? null,
        input.displayTerm,
        input.canonicalTerm,
        input.hintTerm,
        input.category,
        input.enabled,
        input.reviewStatus,
        input.tags ?? [],
        input.note ?? null,
      ],
    )
    const id = result.rows[0]?.id
    if (!id) throw new Error('Insert lieferte keine ID')
    const created = await this.getById(id)
    if (!created) throw new Error('Erzeugter Begriff nicht auffindbar')
    return created
  }

  async update(id: string, patch: Partial<TermInput>): Promise<TermRecord | null> {
    const sets: string[] = []
    const values: unknown[] = []
    const push = (column: string, value: unknown) => {
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }

    if (patch.displayTerm !== undefined) push('display_term', patch.displayTerm)
    if (patch.canonicalTerm !== undefined) push('canonical_term', patch.canonicalTerm)
    if (patch.hintTerm !== undefined) push('hint_term', patch.hintTerm)
    if (patch.enabled !== undefined) push('enabled', patch.enabled)
    if (patch.reviewStatus !== undefined) push('review_status', patch.reviewStatus)
    if (patch.tags !== undefined) push('tags', patch.tags)
    if (patch.note !== undefined) push('note', patch.note)
    if (patch.category !== undefined) {
      values.push(patch.category)
      sets.push(`category_id = (select id from categories where name = $${values.length})`)
    }
    if (sets.length === 0) return this.getById(id)

    sets.push('updated_at = now()')
    values.push(id)
    await query(`update impostor_terms set ${sets.join(', ')} where id = $${values.length}`, values)
    return this.getById(id)
  }

  async remove(id: string): Promise<boolean> {
    const result = await query('delete from impostor_terms where id = $1', [id])
    return (result.rowCount ?? 0) > 0
  }

  async upsertBySeedId(
    inputs: Array<TermInput & { seedId: string }>,
  ): Promise<{ inserted: number; skipped: number }> {
    if (inputs.length === 0) return { inserted: 0, skipped: 0 }
    const client = await getPool().connect()
    try {
      await client.query('begin')
      let inserted = 0
      for (const input of inputs) {
        const result = await client.query(
          `insert into impostor_terms
             (seed_id, display_term, canonical_term, hint_term, category_id, enabled, review_status)
           values ($1, $2, $3, $4, (select id from categories where name = $5), $6, $7)
           on conflict do nothing`,
          [
            input.seedId,
            input.displayTerm,
            input.canonicalTerm,
            input.hintTerm,
            input.category,
            input.enabled,
            input.reviewStatus,
          ],
        )
        inserted += result.rowCount ?? 0
      }
      await client.query('commit')
      return { inserted, skipped: inputs.length - inserted }
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async findDuplicate(displayTerm: string, category: string): Promise<TermRecord | null> {
    const result = await query<TermRow>(
      `${TERM_SELECT} where lower(t.display_term) = lower($1) and c.name = $2 limit 1`,
      [displayTerm, category],
    )
    const row = result.rows[0]
    return row ? toTerm(row) : null
  }

  async recordDraws(termIds: string[], at: string): Promise<void> {
    if (termIds.length === 0) return
    await query(
      `update impostor_terms
         set draw_count = draw_count + 1, last_used_at = $2
       where id = any($1::uuid[])`,
      [termIds, at],
    )
  }

  async usageStats(limit: number) {
    const result = await query<{
      id: string
      display_term: string
      category: string
      draw_count: string
      last_used_at: Date | null
      enabled: boolean
    }>(
      `select t.id, t.display_term, c.name as category, t.draw_count::text, t.last_used_at, t.enabled
       from impostor_terms t join categories c on c.id = t.category_id
       order by t.draw_count desc, t.display_term limit $1`,
      [limit],
    )
    return result.rows.map((row) => ({
      termId: row.id,
      displayTerm: row.display_term,
      category: row.category,
      draws: Number(row.draw_count),
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      enabled: row.enabled,
    }))
  }

  async countByCategory() {
    const result = await query<{ category: string; enabled: string; disabled: string }>(
      `select c.name as category,
              count(*) filter (where t.enabled)::text as enabled,
              count(*) filter (where not t.enabled)::text as disabled
       from categories c left join impostor_terms t on t.category_id = c.id
       group by c.name, c.sort_order order by c.sort_order`,
    )
    return result.rows.map((row) => ({
      category: row.category,
      enabled: Number(row.enabled),
      disabled: Number(row.disabled),
    }))
  }
}

/* -------------------------- Vorschläge ---------------------------- */

interface SuggestionRow {
  id: string
  display_term: string
  canonical_term: string
  hint_term: string
  category: string
  explanation: string | null
  status: SuggestionRecord['status']
  submitter_hash: string
  review_note: string | null
  reviewed_at: Date | null
  converted_term_id: string | null
  created_at: Date
  updated_at: Date
}

function toSuggestion(row: SuggestionRow): SuggestionRecord {
  return {
    id: row.id,
    displayTerm: row.display_term,
    canonicalTerm: row.canonical_term,
    hintTerm: row.hint_term,
    category: row.category,
    explanation: row.explanation,
    status: row.status,
    submitterHash: row.submitter_hash,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    convertedTermId: row.converted_term_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

const SUGGESTION_SELECT = `
  select s.id, s.display_term, s.canonical_term, s.hint_term, c.name as category,
         s.explanation, s.status, s.submitter_hash, s.review_note, s.reviewed_at,
         s.converted_term_id, s.created_at, s.updated_at
  from term_suggestions s join categories c on c.id = s.category_id
`

class PgSuggestionStore implements SuggestionStore {
  async create(input: {
    displayTerm: string
    canonicalTerm: string
    hintTerm: string
    category: string
    explanation: string | null
    submitterHash: string
    ipHash: string | null
  }): Promise<SuggestionRecord> {
    const result = await query<{ id: string }>(
      `insert into term_suggestions
         (display_term, canonical_term, hint_term, category_id, explanation, submitter_hash, ip_hash)
       values ($1, $2, $3, (select id from categories where name = $4), $5, $6, $7)
       returning id`,
      [
        input.displayTerm,
        input.canonicalTerm,
        input.hintTerm,
        input.category,
        input.explanation,
        input.submitterHash,
        input.ipHash,
      ],
    )
    const created = await this.getById(result.rows[0]?.id ?? '')
    if (!created) throw new Error('Erzeugter Vorschlag nicht auffindbar')
    return created
  }

  async list(filter: { status?: SuggestionRecord['status']; limit?: number; offset?: number }) {
    const values: unknown[] = []
    let where = ''
    if (filter.status) {
      values.push(filter.status)
      where = `where s.status = $${values.length}`
    }
    const totalResult = await query<{ count: string }>(
      `select count(*)::text as count from term_suggestions s ${where}`,
      values,
    )
    values.push(filter.limit ?? 50, filter.offset ?? 0)
    const rows = await query<SuggestionRow>(
      `${SUGGESTION_SELECT} ${where} order by s.created_at desc
       limit $${values.length - 1} offset $${values.length}`,
      values,
    )
    return { rows: rows.rows.map(toSuggestion), total: Number(totalResult.rows[0]?.count ?? 0) }
  }

  async getById(id: string): Promise<SuggestionRecord | null> {
    if (!id) return null
    const result = await query<SuggestionRow>(`${SUGGESTION_SELECT} where s.id = $1`, [id])
    const row = result.rows[0]
    return row ? toSuggestion(row) : null
  }

  async update(id: string, patch: Partial<SuggestionRecord>): Promise<SuggestionRecord | null> {
    const sets: string[] = []
    const values: unknown[] = []
    const push = (column: string, value: unknown) => {
      values.push(value)
      sets.push(`${column} = $${values.length}`)
    }

    if (patch.displayTerm !== undefined) push('display_term', patch.displayTerm)
    if (patch.canonicalTerm !== undefined) push('canonical_term', patch.canonicalTerm)
    if (patch.hintTerm !== undefined) push('hint_term', patch.hintTerm)
    if (patch.explanation !== undefined) push('explanation', patch.explanation)
    if (patch.reviewNote !== undefined) push('review_note', patch.reviewNote)
    if (patch.convertedTermId !== undefined) push('converted_term_id', patch.convertedTermId)
    if (patch.status !== undefined) {
      push('status', patch.status)
      sets.push(`reviewed_at = case when $${values.length} = 'new' then null else now() end`)
    }
    if (patch.category !== undefined) {
      values.push(patch.category)
      sets.push(`category_id = (select id from categories where name = $${values.length})`)
    }
    if (sets.length === 0) return this.getById(id)

    sets.push('updated_at = now()')
    values.push(id)
    await query(`update term_suggestions set ${sets.join(', ')} where id = $${values.length}`, values)
    return this.getById(id)
  }

  async countSince(since: string): Promise<number> {
    const result = await query<{ count: string }>(
      'select count(*)::text as count from term_suggestions where created_at >= $1',
      [since],
    )
    return Number(result.rows[0]?.count ?? 0)
  }
}

/* -------------------------- Rate-Limit ---------------------------- */

class PgRateLimitStore implements RateLimitStore {
  /**
   * Zählen und Eintragen laufen in einer Transaktion mit Advisory-Lock auf
   * (bucket, subject) – zwei parallele Anfragen können das Limit dadurch nicht
   * gemeinsam überschreiten.
   */
  async hit(bucket: string, subject: string, limit: number, windowMs: number) {
    const client = await getPool().connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${bucket}:${subject}`])

      const cutoff = new Date(Date.now() - windowMs).toISOString()
      const counted = await client.query<{ count: string; oldest: Date | null }>(
        `select count(*)::text as count, min(occurred_at) as oldest
         from rate_limit_hits
         where bucket = $1 and subject = $2 and occurred_at >= $3`,
        [bucket, subject, cutoff],
      )
      const used = Number(counted.rows[0]?.count ?? 0)

      if (used >= limit) {
        const oldest = counted.rows[0]?.oldest?.getTime() ?? Date.now()
        await client.query('commit')
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (Date.now() - oldest)) / 1000)),
        }
      }

      await client.query(
        'insert into rate_limit_hits (bucket, subject) values ($1, $2)',
        [bucket, subject],
      )
      await client.query('commit')
      return { allowed: true, remaining: limit - used - 1, retryAfterSeconds: 0 }
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async purgeBefore(cutoff: string): Promise<void> {
    await query('delete from rate_limit_hits where occurred_at < $1', [cutoff])
  }
}

/* ----------------------------- Räume ------------------------------ */

interface RoomRow {
  id: string
  code: string
  phase: RoomRecord['phase']
  version: string
  locked: boolean
  round_number: number
  host_player_id: string | null
  host_offline_since: Date | null
  round_started_at: Date | null
  created_at: Date
  last_activity_at: Date
}

function toRoom(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    code: row.code,
    phase: row.phase,
    version: Number(row.version),
    locked: row.locked,
    roundNumber: row.round_number,
    hostPlayerId: row.host_player_id,
    hostOfflineSince: row.host_offline_since?.getTime() ?? null,
    roundStartedAt: row.round_started_at?.getTime() ?? null,
    createdAt: row.created_at.getTime(),
    lastActivityAt: row.last_activity_at.getTime(),
  }
}

interface PlayerRow {
  id: string
  room_id: string
  name: string
  name_key: string
  seat: number
  rejoin_token_hash: string
  joined_at: Date
  last_seen_at: Date
}

function toPlayer(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    nameKey: row.name_key,
    seat: row.seat,
    rejoinTokenHash: row.rejoin_token_hash,
    joinedAt: row.joined_at.getTime(),
    lastSeenAt: row.last_seen_at.getTime(),
  }
}

function createRoomTx(client: PoolClient): RoomTx {
  return {
    async codeExists(code) {
      const result = await client.query('select 1 from rooms where code = $1', [code])
      return (result.rowCount ?? 0) > 0
    },

    async insertRoom(room) {
      await client.query(
        `insert into rooms (id, code, phase, version, locked, round_number, created_at, last_activity_at)
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))`,
        [
          room.id,
          room.code,
          room.phase,
          room.version,
          room.locked,
          room.roundNumber,
          room.createdAt,
          room.lastActivityAt,
        ],
      )
    },

    async getRoomForUpdate(code) {
      const result = await client.query<RoomRow>(
        'select * from rooms where code = $1 for update',
        [code],
      )
      const row = result.rows[0]
      return row ? toRoom(row) : null
    },

    async getRoom(code) {
      const result = await client.query<RoomRow>('select * from rooms where code = $1', [code])
      const row = result.rows[0]
      return row ? toRoom(row) : null
    },

    async updateRoom(room) {
      await client.query(
        `update rooms set phase = $2, version = $3, locked = $4, round_number = $5,
                          host_player_id = $6,
                          host_offline_since = case when $7::bigint is null then null else to_timestamp($7 / 1000.0) end,
                          round_started_at = case when $8::bigint is null then null else to_timestamp($8 / 1000.0) end,
                          last_activity_at = to_timestamp($9 / 1000.0)
         where id = $1`,
        [
          room.id,
          room.phase,
          room.version,
          room.locked,
          room.roundNumber,
          room.hostPlayerId,
          room.hostOfflineSince,
          room.roundStartedAt,
          room.lastActivityAt,
        ],
      )
    },

    async deleteRoom(roomId) {
      // Spieler, Zuweisungen, Notizen und Events hängen per ON DELETE CASCADE dran.
      await client.query('delete from rooms where id = $1', [roomId])
    },

    async listPlayers(roomId) {
      const result = await client.query<PlayerRow>(
        'select * from room_players where room_id = $1 order by seat',
        [roomId],
      )
      return result.rows.map(toPlayer)
    },

    async insertPlayer(player) {
      await client.query(
        `insert into room_players (id, room_id, name, name_key, seat, rejoin_token_hash, joined_at, last_seen_at)
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), to_timestamp($8 / 1000.0))`,
        [
          player.id,
          player.roomId,
          player.name,
          player.nameKey,
          player.seat,
          player.rejoinTokenHash,
          player.joinedAt,
          player.lastSeenAt,
        ],
      )
    },

    async updatePlayer(player) {
      await client.query(
        `update room_players set name = $2, name_key = $3, seat = $4,
                                 last_seen_at = to_timestamp($5 / 1000.0)
         where id = $1`,
        [player.id, player.name, player.nameKey, player.seat, player.lastSeenAt],
      )
    },

    async replaceSeats(roomId, seats) {
      if (seats.length === 0) return
      // Die Unique-Bedingung ist DEFERRABLE, deshalb dürfen Nummern innerhalb
      // der Transaktion kurzzeitig kollidieren.
      await client.query(
        `update room_players as p set seat = v.seat
         from (select unnest($2::uuid[]) as id, unnest($3::int[]) as seat) as v
         where p.id = v.id and p.room_id = $1`,
        [roomId, seats.map((entry) => entry.playerId), seats.map((entry) => entry.seat)],
      )
    },

    async deletePlayer(playerId) {
      await client.query('delete from room_players where id = $1', [playerId])
    },

    async listAssignments(roomId, roundNumber) {
      const result = await client.query<{
        room_id: string
        round_number: number
        author_player_id: string
        target_player_id: string
        term: string
      }>(
        `select room_id, round_number, author_player_id, target_player_id, term
         from whoami_assignments where room_id = $1 and round_number = $2`,
        [roomId, roundNumber],
      )
      return result.rows.map<AssignmentRecord>((row) => ({
        roomId: row.room_id,
        roundNumber: row.round_number,
        authorPlayerId: row.author_player_id,
        targetPlayerId: row.target_player_id,
        term: row.term,
      }))
    },

    async upsertAssignment(assignment) {
      // Ein Ziel darf pro Runde nur einmal belegt sein; ein Wechsel der
      // Sitzordnung könnte sonst gegen die Unique-Bedingung laufen.
      await client.query(
        `delete from whoami_assignments
         where room_id = $1 and round_number = $2 and target_player_id = $3 and author_player_id <> $4`,
        [
          assignment.roomId,
          assignment.roundNumber,
          assignment.targetPlayerId,
          assignment.authorPlayerId,
        ],
      )
      await client.query(
        `insert into whoami_assignments (room_id, round_number, author_player_id, target_player_id, term)
         values ($1, $2, $3, $4, $5)
         on conflict (room_id, round_number, author_player_id)
         do update set target_player_id = excluded.target_player_id,
                       term = excluded.term,
                       updated_at = now()`,
        [
          assignment.roomId,
          assignment.roundNumber,
          assignment.authorPlayerId,
          assignment.targetPlayerId,
          assignment.term,
        ],
      )
    },

    async deleteAssignment(roomId, roundNumber, authorPlayerId) {
      await client.query(
        'delete from whoami_assignments where room_id = $1 and round_number = $2 and author_player_id = $3',
        [roomId, roundNumber, authorPlayerId],
      )
    },

    async deleteAssignmentsForRound(roomId, roundNumber) {
      await client.query('delete from whoami_assignments where room_id = $1 and round_number = $2', [
        roomId,
        roundNumber,
      ])
      await client.query('delete from player_private_notes where room_id = $1 and round_number = $2', [
        roomId,
        roundNumber,
      ])
    },

    async listRoundProgress(roomId, roundNumber) {
      const result = await client.query<{
        room_id: string
        round_number: number
        player_id: string
        claim_id: string | null
        claim_requested_at: Date | null
        placement: number | null
        approved_at: Date | null
        automatic: boolean
      }>(
        `select room_id, round_number, player_id, claim_id, claim_requested_at,
                placement, approved_at, automatic
         from whoami_round_progress
         where room_id = $1 and round_number = $2
         order by placement nulls last, claim_requested_at nulls last, player_id`,
        [roomId, roundNumber],
      )
      return result.rows.map<RoundProgressRecord>((row) => ({
        roomId: row.room_id,
        roundNumber: row.round_number,
        playerId: row.player_id,
        claimId: row.claim_id,
        claimRequestedAt: row.claim_requested_at?.getTime() ?? null,
        placement: row.placement,
        approvedAt: row.approved_at?.getTime() ?? null,
        automatic: row.automatic,
      }))
    },

    async replaceRoundProgress(roomId, roundNumber, records) {
      // Löschen und Neuaufbau geschehen innerhalb derselben, über die Raumzeile
      // serialisierten Transaktion. So kann eine Korrektur mehrere Plätze
      // lückenlos verschieben, ohne vorübergehend gegen den Unique-Index zu laufen.
      await client.query(
        'delete from whoami_round_progress where room_id = $1 and round_number = $2',
        [roomId, roundNumber],
      )
      for (const record of records) {
        await client.query(
          `insert into whoami_round_progress
             (room_id, round_number, player_id, claim_id, claim_requested_at, placement, approved_at, automatic)
           values (
             $1, $2, $3, $4,
             case when $5::bigint is null then null else to_timestamp($5 / 1000.0) end,
             $6,
             case when $7::bigint is null then null else to_timestamp($7 / 1000.0) end,
             $8
           )`,
          [
            roomId,
            roundNumber,
            record.playerId,
            record.claimId,
            record.claimRequestedAt,
            record.placement,
            record.approvedAt,
            record.automatic,
          ],
        )
      }
    },

    async deleteRoundProgressForRound(roomId, roundNumber) {
      await client.query(
        'delete from whoami_round_progress where room_id = $1 and round_number = $2',
        [roomId, roundNumber],
      )
    },

    async getNotes(roomId, playerId, roundNumber) {
      const result = await client.query<{ content: string }>(
        'select content from player_private_notes where room_id = $1 and player_id = $2 and round_number = $3',
        [roomId, playerId, roundNumber],
      )
      return result.rows[0]?.content ?? ''
    },

    async setNotes(roomId, playerId, roundNumber, content) {
      await client.query(
        `insert into player_private_notes (room_id, player_id, round_number, content)
         values ($1, $2, $3, $4)
         on conflict (room_id, player_id, round_number)
         do update set content = excluded.content, updated_at = now()`,
        [roomId, playerId, roundNumber, content],
      )
    },

    async insertEvent(roomId, version, kind, actorPlayerId) {
      await client.query(
        'insert into room_events (room_id, version, kind, actor_player_id) values ($1, $2, $3, $4)',
        [roomId, version, kind, actorPlayerId],
      )
    },
  }
}

class PgRoomStore implements RoomStore {
  async withTransaction<T>(fn: (tx: RoomTx) => Promise<T>): Promise<T> {
    const client = await getPool().connect()
    try {
      await client.query('begin')
      const result = await fn(createRoomTx(client))
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  async findExpiredRoomIds(inactiveBefore: number): Promise<string[]> {
    const result = await query<{ id: string }>(
      `select id from rooms
       where phase <> 'playing' and last_activity_at < to_timestamp($1 / 1000.0)
       limit 500`,
      [inactiveBefore],
    )
    return result.rows.map((row) => row.id)
  }

  async deleteRoomsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const result = await query('delete from rooms where id = any($1::uuid[])', [ids])
    return result.rowCount ?? 0
  }

  async countRoomsCreatedSince(since: string): Promise<number> {
    const result = await query<{ count: string }>(
      'select count(*)::text as count from rooms where created_at >= $1',
      [since],
    )
    return Number(result.rows[0]?.count ?? 0)
  }
}

/* ---------------------------- Analytics --------------------------- */

class PgAnalyticsStore implements AnalyticsStore {
  async insertMany(events: AnalyticsEventInput[]): Promise<number> {
    if (events.length === 0) return 0
    const result = await query(
      `insert into analytics_events (name, device_hash, session_hash, payload, occurred_at)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::jsonb[], $5::timestamptz[])`,
      [
        events.map((event) => event.name),
        events.map((event) => event.deviceHash),
        events.map((event) => event.sessionHash),
        events.map((event) => JSON.stringify(event.payload)),
        events.map((event) => event.occurredAt),
      ],
    )
    return result.rowCount ?? 0
  }

  async query(from: string, to: string) {
    const result = await query<{
      id: string
      name: string
      device_hash: string
      session_hash: string
      payload: Record<string, unknown>
      occurred_at: Date
    }>(
      `select id::text, name, device_hash, session_hash, payload, occurred_at
       from analytics_events where occurred_at >= $1 and occurred_at <= $2
       order by occurred_at`,
      [from, to],
    )
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      deviceHash: row.device_hash,
      sessionHash: row.session_hash,
      payload: row.payload,
      occurredAt: row.occurred_at.toISOString(),
    }))
  }

  async deleteRange(from: string, to: string): Promise<number> {
    const result = await query(
      'delete from analytics_events where occurred_at >= $1 and occurred_at <= $2',
      [from, to],
    )
    return result.rowCount ?? 0
  }

  async deleteByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0
    const result = await query('delete from analytics_events where id = any($1::bigint[])', [ids])
    return result.rowCount ?? 0
  }

  async deleteAll(): Promise<number> {
    const result = await query('delete from analytics_events')
    return result.rowCount ?? 0
  }
}

/* ------------------------------ Admin ----------------------------- */

class PgAdminStore implements AdminStore {
  async createSession(tokenHash: string, username: string, expiresAt: string): Promise<void> {
    await query(
      'insert into admin_sessions (token_hash, username, expires_at) values ($1, $2, $3)',
      [tokenHash, username, expiresAt],
    )
  }

  async findSession(tokenHash: string) {
    const result = await query<{ username: string; expires_at: Date; revoked_at: Date | null }>(
      'select username, expires_at, revoked_at from admin_sessions where token_hash = $1',
      [tokenHash],
    )
    const row = result.rows[0]
    if (!row) return null
    return {
      username: row.username,
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await query('update admin_sessions set revoked_at = now() where token_hash = $1', [tokenHash])
  }

  async purgeExpiredSessions(now: string): Promise<void> {
    await query('delete from admin_sessions where expires_at < $1', [now])
  }

  async logAction(
    actor: string,
    action: string,
    target: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await query(
      'insert into admin_audit_log (actor, action, target, details) values ($1, $2, $3, $4)',
      [actor, action, target, JSON.stringify(details)],
    )
  }

  async listAuditLog(limit: number) {
    const result = await query<{
      id: string
      actor: string
      action: string
      target: string | null
      details: Record<string, unknown>
      created_at: Date
    }>(
      'select id::text, actor, action, target, details, created_at from admin_audit_log order by created_at desc limit $1',
      [limit],
    )
    return result.rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      details: row.details,
      createdAt: row.created_at.toISOString(),
    }))
  }
}

/* ------------------------------ Store ----------------------------- */

export function createPostgresStore(): Store {
  return {
    kind: 'postgres',
    terms: new PgTermStore(),
    suggestions: new PgSuggestionStore(),
    rateLimit: new PgRateLimitStore(),
    rooms: new PgRoomStore(),
    analytics: new PgAnalyticsStore(),
    admin: new PgAdminStore(),
    async healthCheck() {
      await query('select 1')
      // Die Anwendung liest den Rundenfortschritt bereits beim ersten
      // Raum-GET. Deshalb darf ein Deployment mit noch nicht angewendeter
      // Ranking-Migration nicht irreführend als gesund gemeldet werden.
      await query('select claim_id, placement, automatic from whoami_round_progress limit 0')
    },
  }
}
