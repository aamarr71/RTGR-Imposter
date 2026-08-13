import type { CategoryName, ReviewStatus, SuggestionStatus } from './config.js'

/* ------------------------------------------------------------------ *
 * Impostor
 * ------------------------------------------------------------------ */

/** Ein Eintrag des Wortpools. `canonicalTerm` ist rein intern. */
export interface ImpostorTerm {
  id: string
  displayTerm: string
  canonicalTerm: string
  hintTerm: string
  category: CategoryName
  enabled: boolean
  reviewStatus: ReviewStatus
  tags?: string[]
  note?: string | null
  createdAt?: string
  updatedAt?: string
}

/** Was der Client tatsächlich zum Spielen braucht – ohne Admin-Metadaten. */
export interface PlayableTerm {
  id: string
  displayTerm: string
  hintTerm: string
  category: CategoryName
}

export interface TermPool {
  /** Monoton steigende Version des Serverpools; `0` bedeutet „gebündelte Seeds“. */
  version: number
  fetchedAt: string
  source: 'server' | 'bundled'
  terms: PlayableTerm[]
}

export interface ImpostorConfig {
  playerNames: string[]
  impostorCount: number
  impostorsKnowEachOther: boolean
  categories: CategoryName[]
  hintsEnabled: boolean
  timerEnabled: boolean
  timerSeconds: number | null
}

export type ImpostorRole = 'crew' | 'impostor'

export interface ImpostorAssignment {
  playerIndex: number
  playerName: string
  role: ImpostorRole
}

export type ImpostorPhase =
  | 'reveal' // Karte wird herumgereicht
  | 'ready' // alle haben gesehen, „Runde starten“
  | 'announcing' // „<Name> beginnt“
  | 'playing' // freie Spielphase
  | 'revealed' // Impostor aufgedeckt

export interface ImpostorRound {
  id: string
  createdAt: number
  config: ImpostorConfig
  term: PlayableTerm
  assignments: ImpostorAssignment[]
  /** Index des Spielers, der die Karte als Nächstes bekommt. */
  revealCursor: number
  phase: ImpostorPhase
  startPlayerIndex: number | null
  /** Absoluter Endzeitpunkt (Epoch ms), damit ein Reload den Timer nicht verfälscht. */
  timerEndsAt: number | null
  timerAlarmActive: boolean
  poolSource: TermPool['source']
}

/* ------------------------------------------------------------------ *
 * Wer bin ich?
 * ------------------------------------------------------------------ */

export type RoomPhase = 'lobby' | 'assigning' | 'playing' | 'closed'
export type RoomPlayerRoundState = 'active' | 'pending' | 'finished'

export interface RoomPlayerView {
  id: string
  name: string
  /** Fortlaufende Sitznummer, beginnend bei 1, lückenlos. */
  seat: number
  isHost: boolean
  online: boolean
  /** Nur in Lobby/Assigning: hat dieser Spieler seinen Begriff schon abgegeben? */
  hasSubmittedTerm: boolean
  /** Fortschritt ausschließlich innerhalb der aktuellen Runde. */
  roundState: RoomPlayerRoundState
  /** Serverseitig vergebener, lückenloser Platz; sonst `null`. */
  placement: number | null
  /** Revision der aktuellen Meldung; Hostentscheidungen müssen exakt diese ID bestätigen. */
  placementClaimId: string | null
  /** Der letzte verbleibende Spieler erhält seinen Platz automatisch. */
  placementAutomatic: boolean
}

/** Was ein Spieler in der laufenden Runde über einen Mitspieler sehen darf. */
export interface RoomBoardEntry {
  playerId: string
  name: string
  seat: number
  online: boolean
  isSelf: boolean
  /**
   * Der Begriff des Mitspielers. Für den eigenen Platz liefert der Server bis
   * zum vollständigen Rundenabschluss bewusst `null`; danach wird das gesamte
   * Podium inklusive des eigenen Begriffs aufgedeckt.
   */
  term: string | null
  roundState: RoomPlayerRoundState
  placement: number | null
  placementClaimId: string | null
  placementAutomatic: boolean
}

/** Serverseitig gefilterte Sicht eines konkreten Spielers auf den Raum. */
export interface RoomView {
  code: string
  phase: RoomPhase
  version: number
  locked: boolean
  roundNumber: number
  you: {
    playerId: string
    name: string
    seat: number
    isHost: boolean
  }
  players: RoomPlayerView[]
  /** Nur gesetzt, wenn `phase === 'playing'`. */
  board: RoomBoardEntry[] | null
  /** Für wen dieser Spieler einen Begriff eingeben muss (Sitznachbar im Kreis). */
  assignmentTarget: { playerId: string; name: string; seat: number } | null
  /** Der eigene, für den Nachbarn vergebene Begriff – darf bearbeitet werden. */
  submittedTerm: string | null
  notes: string
  serverTime: number
}

export interface JoinResult {
  code: string
  playerId: string
  /** Geheimes Token; nur der Client kennt es im Klartext. */
  rejoinToken: string
}

/* ------------------------------------------------------------------ *
 * Vorschläge und Admin
 * ------------------------------------------------------------------ */

export interface TermSuggestion {
  id: string
  displayTerm: string
  canonicalTerm: string
  hintTerm: string
  category: CategoryName
  explanation: string | null
  status: SuggestionStatus
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
  reviewNote: string | null
}

export interface AnalyticsRange {
  from: string
  to: string
}

export interface AnalyticsSummary {
  range: AnalyticsRange
  devices: number
  sessions: number
  gameParticipations: number
  impostorRoundsStarted: number
  impostorRoundsCompleted: number
  impostorSetupAbandoned: number
  impostorOnline: number
  impostorOffline: number
  whoAmIRoomsCreated: number
  whoAmIRoundsStarted: number
  averagePlayers: number
  averageRoundsPerSession: number
  modeSplit: { impostor: number; whoAmI: number }
  suggestions: number
  categoryUsage: Array<{ category: string; count: number }>
}

export interface TermUsageRow {
  termId: string
  displayTerm: string
  category: string
  draws: number
  lastUsedAt: string | null
  enabled: boolean
}

export interface ApiError {
  error: string
  message: string
  details?: unknown
}
