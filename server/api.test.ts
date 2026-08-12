import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import vercelHandler, {
  REWRITTEN_API_PATH,
  restoreApiRequestUrl,
} from '../api/handler.js'
import { SUGGESTIONS } from '../src/shared/config.js'
import { hashPassword } from './services/crypto.js'
import { createMemoryStore } from './store/memory.js'
import { resetStore } from './store/index.js'

/**
 * Tests auf HTTP-Ebene: sie sprechen denselben Router an, den auch Vercel
 * aufruft. Damit ist abgedeckt, was Handler, Routing und Fehlerform gemeinsam
 * tun – nicht nur die Dienste dahinter.
 */

const ADMIN_USER = 'chef'
const ADMIN_PASSWORD = 'ein-sehr-langes-testpasswort'

let server: Server
let base: string

beforeAll(async () => {
  process.env.ADMIN_USERNAME = ADMIN_USER
  process.env.ADMIN_PASSWORD_HASH = await hashPassword(ADMIN_PASSWORD)
  process.env.SESSION_SECRET = 'test-secret-mindestens-zweiunddreissig-zeichen'
  process.env.ROOM_STORE = 'memory'

  server = createServer((req, res) => {
    // Vercels Node-Helper stellt `req.body` als lazy Getter bereit und wirft
    // bei ungültigem JSON einen eigenen ApiError statt eines SyntaxError.
    if (req.headers['x-test-vercel-malformed-json'] === '1') {
      Object.defineProperty(req, 'body', {
        get() {
          throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 })
        },
      })
    }
    void vercelHandler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('Kein Port')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  // Frischer Speicher pro Test – sonst schleppen Rate-Limits sich mit.
  resetStore(createMemoryStore())
})

interface Options {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

async function call(path: string, options: Options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  return {
    status: response.status,
    headers: response.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  }
}

/** Simuliert den öffentlichen Pfad nach dem Rewrite auf die konkrete Function. */
function throughVercelRewrite(path: string): string {
  const publicUrl = new URL(path, 'http://localhost')
  const query = new URLSearchParams(publicUrl.searchParams)
  query.set(REWRITTEN_API_PATH, publicUrl.pathname.replace(/^\/api\/?/, ''))
  return `/api/handler?${query.toString()}`
}

async function loginCookie(): Promise<string> {
  const response = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.getSetCookie()[0]
  if (!cookie) throw new Error('Kein Session-Cookie erhalten')
  return cookie.split(';')[0] as string
}

interface ApiMember {
  code: string
  playerId: string
  rejoinToken: string
}

function member(body: Record<string, unknown> | null): ApiMember {
  return {
    code: body?.code as string,
    playerId: body?.playerId as string,
    rejoinToken: body?.rejoinToken as string,
  }
}

function playerHeaders(value: ApiMember): Record<string, string> {
  return {
    'x-player-id': value.playerId,
    'x-rejoin-token': value.rejoinToken,
  }
}

async function createApiPlayingRoom() {
  const created = await call('/api/rooms', { method: 'POST', body: { name: 'Lena' } })
  const host = member(created.body)
  const joined: ApiMember[] = []
  for (const name of ['Tom', 'Mia']) {
    joined.push(
      member(
        (
          await call(`/api/rooms/${host.code}/join`, {
            method: 'POST',
            body: { name },
          })
        ).body,
      ),
    )
  }
  const members = [host, ...joined]
  for (const [index, value] of members.entries()) {
    expect(
      (
        await call(`/api/rooms/${host.code}/term`, {
          method: 'POST',
          headers: playerHeaders(value),
          body: { term: `Begriff-${index + 1}` },
        })
      ).status,
    ).toBe(200)
  }
  expect(
    (
      await call(`/api/rooms/${host.code}/start`, {
        method: 'POST',
        headers: playerHeaders(host),
        body: {},
      })
    ).status,
  ).toBe(200)
  return { code: host.code, members }
}

describe('Routing und Fehlerform', () => {
  it('meldet unbekannte Endpunkte als 404', async () => {
    const result = await call('/api/gibtsnicht')
    expect(result.status).toBe(404)
    expect(result.body?.error).toBe('route_not_found')
  })

  it('meldet eine falsche Methode als 405', async () => {
    const result = await call('/api/terms', { method: 'DELETE' })
    expect(result.status).toBe(405)
  })

  it('weist ungültiges JSON ab', async () => {
    const response = await fetch(`${base}/api/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{kaputt',
    })
    expect(response.status).toBe(400)
  })

  it('ordnet auch Vercels Bodyparserfehler als ungültiges JSON ein', async () => {
    const result = await call('/api/rooms', {
      method: 'POST',
      headers: { 'x-test-vercel-malformed-json': '1' },
      body: { name: 'wird vom Getter nicht gelesen' },
    })
    expect(result.status).toBe(400)
    expect(result.body?.error).toBe('malformed_json')
  })

  it('liefert eine Gesundheitsauskunft', async () => {
    const result = await call('/api/health')
    expect(result.status).toBe(200)
    expect(result.body?.ok).toBe(true)
  })
})

describe('Vercel-Function-Rewrite', () => {
  it('leitet alle API-Pfadtiefen an den konkreten Handler weiter', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      functions: Record<string, unknown>
      rewrites: Array<{ source: string; destination: string }>
    }

    expect(config.functions['api/handler.ts']).toBeTruthy()
    expect(config.functions['api/[...path].ts']).toBeUndefined()
    expect(config.rewrites[0]).toEqual({
      source: '/api/(.*)',
      destination: `/api/handler?${REWRITTEN_API_PATH}=$1`,
    })
  })

  it('stellt tiefe Pfade wieder her und bewahrt öffentliche Query-Parameter', () => {
    expect(
      restoreApiRequestUrl(
        '/api/handler?range=7d&__k10_api_path=admin%2Fanalytics&path=public&search=D%C3%B6ner',
      ),
    ).toBe('/api/admin/analytics?range=7d&path=public&search=D%C3%B6ner')
  })

  it('trägt einen erstellten Raum durch Join und authentifizierten Read', async () => {
    const created = await call(throughVercelRewrite('/api/rooms'), {
      method: 'POST',
      body: { name: 'Lena' },
    })
    expect(created.status).toBe(201)

    const code = created.body?.code as string
    const joined = await call(throughVercelRewrite(`/api/rooms/${code}/join`), {
      method: 'POST',
      body: { name: 'Tom' },
    })
    expect(joined.status).toBe(201)

    const room = await call(throughVercelRewrite(`/api/rooms/${code}`), {
      headers: {
        'x-player-id': created.body?.playerId as string,
        'x-rejoin-token': created.body?.rejoinToken as string,
      },
    })
    expect(room.status).toBe(200)
    expect(room.body?.phase).toBe('lobby')
    expect(room.body?.players).toHaveLength(2)
  })
})

describe('Wer-bin-ich-Rundenplatzierung', () => {
  it('verlangt eine eigene Mitgliedschaft und eine laufende Runde', async () => {
    const created = member(
      (await call('/api/rooms', { method: 'POST', body: { name: 'Lena' } })).body,
    )
    const missing = await call(`/api/rooms/${created.code}/placement`, {
      method: 'POST',
      body: {},
    })
    expect(missing.status).toBe(401)

    const lobby = await call(`/api/rooms/${created.code}/placement`, {
      method: 'POST',
      headers: playerHeaders(created),
      body: {},
    })
    expect(lobby.status).toBe(409)
    expect(lobby.body?.error).toBe('not_playing')
  })

  it('führt Meldung, Hostbestätigung, Auto-Letzten und Korrektur durch den Vercel-Rewrite', async () => {
    const { code, members } = await createApiPlayingRoom()
    const [host, tom, mia] = members as [ApiMember, ApiMember, ApiMember]
    const claimIds = new Map<string, string>()

    for (const value of members) {
      const claimed = await call(`/api/rooms/${code}/placement`, {
        method: 'POST',
        headers: playerHeaders(value),
        body: {},
      })
      expect(claimed.status).toBe(200)
      const player = (claimed.body?.players as Array<Record<string, unknown>>).find(
        (entry) => entry.id === value.playerId,
      )
      expect(player?.placementClaimId).toEqual(expect.any(String))
      claimIds.set(value.playerId, player?.placementClaimId as string)
    }

    const forbidden = await call(`/api/rooms/${code}/placements/${host.playerId}/approve`, {
      method: 'POST',
      headers: playerHeaders(tom),
      body: { claimId: claimIds.get(host.playerId) },
    })
    expect(forbidden.status).toBe(403)
    expect(forbidden.body?.error).toBe('not_host')

    const first = await call(
      throughVercelRewrite(`/api/rooms/${code}/placements/${host.playerId}/approve`),
      {
        method: 'POST',
        headers: playerHeaders(host),
        body: { claimId: claimIds.get(host.playerId) },
      },
    )
    expect(first.status).toBe(200)

    const complete = await call(`/api/rooms/${code}/placements/${tom.playerId}/approve`, {
      method: 'POST',
      headers: playerHeaders(host),
      body: { claimId: claimIds.get(tom.playerId) },
    })
    const completedBoard = complete.body?.board as Array<Record<string, unknown>>
    expect(completedBoard.map((entry) => entry.placement).sort()).toEqual([1, 2, 3])
    expect(completedBoard.find((entry) => entry.playerId === mia.playerId)).toMatchObject({
      placement: 3,
      placementAutomatic: true,
      roundState: 'finished',
    })

    const corrected = await call(`/api/rooms/${code}/placements/${host.playerId}`, {
      method: 'DELETE',
      headers: playerHeaders(host),
      body: { claimId: claimIds.get(host.playerId) },
    })
    expect(corrected.status).toBe(200)
    const correctedBoard = corrected.body?.board as Array<Record<string, unknown>>
    expect(correctedBoard.find((entry) => entry.playerId === host.playerId)?.roundState).toBe(
      'active',
    )
    expect(correctedBoard.find((entry) => entry.playerId === tom.playerId)?.placement).toBe(1)
    expect(correctedBoard.find((entry) => entry.playerId === mia.playerId)?.roundState).toBe(
      'pending',
    )
  })

  it('bindet Hostentscheidungen an die aktuelle Meldungs-ID', async () => {
    const { code, members } = await createApiPlayingRoom()
    const [host, tom] = members as [ApiMember, ApiMember]

    const first = await call(`/api/rooms/${code}/placement`, {
      method: 'POST',
      headers: playerHeaders(tom),
      body: {},
    })
    const firstClaimId = (
      first.body?.players as Array<Record<string, unknown>>
    ).find((entry) => entry.id === tom.playerId)?.placementClaimId as string
    expect(firstClaimId).toEqual(expect.any(String))

    const rejected = await call(`/api/rooms/${code}/placements/${tom.playerId}`, {
      method: 'DELETE',
      headers: playerHeaders(host),
      body: { claimId: firstClaimId },
    })
    expect(rejected.status).toBe(200)

    const reclaimed = await call(`/api/rooms/${code}/placement`, {
      method: 'POST',
      headers: playerHeaders(tom),
      body: {},
    })
    const secondClaimId = (
      reclaimed.body?.players as Array<Record<string, unknown>>
    ).find((entry) => entry.id === tom.playerId)?.placementClaimId as string
    expect(secondClaimId).toEqual(expect.any(String))
    expect(secondClaimId).not.toBe(firstClaimId)

    const staleApproval = await call(
      `/api/rooms/${code}/placements/${tom.playerId}/approve`,
      {
        method: 'POST',
        headers: playerHeaders(host),
        body: { claimId: firstClaimId },
      },
    )
    expect(staleApproval.status).toBe(409)
    expect(staleApproval.body?.error).toBe('placement_claim_stale')

    const staleDelete = await call(`/api/rooms/${code}/placements/${tom.playerId}`, {
      method: 'DELETE',
      headers: playerHeaders(host),
      body: { claimId: firstClaimId },
    })
    expect(staleDelete.status).toBe(409)
    expect(staleDelete.body?.error).toBe('placement_claim_stale')

    const approved = await call(`/api/rooms/${code}/placements/${tom.playerId}/approve`, {
      method: 'POST',
      headers: playerHeaders(host),
      body: { claimId: secondClaimId },
    })
    expect(approved.status).toBe(200)
    expect(
      (approved.body?.players as Array<Record<string, unknown>>).find(
        (entry) => entry.id === tom.playerId,
      ),
    ).toMatchObject({
      roundState: 'finished',
      placement: 1,
      placementClaimId: secondClaimId,
    })
  })
})

describe('Wortpool', () => {
  it('liefert die aktiven Begriffe ohne interne Felder', async () => {
    const result = await call('/api/terms')
    expect(result.status).toBe(200)
    const terms = result.body?.terms as Array<Record<string, unknown>>
    expect(terms.length).toBeGreaterThan(300)
    expect(Object.keys(terms[0] as object).sort()).toEqual([
      'category',
      'displayTerm',
      'hintTerm',
      'id',
    ])
  })
})

describe('Wortvorschläge', () => {
  const suggestion = {
    displayTerm: 'Testbegriff',
    canonicalTerm: 'Bedeutung des Testbegriffs',
    hintTerm: 'Hinweis',
    category: 'Alltag',
    clientId: 'anonyme-browserkennung-1',
  }

  it('nimmt einen gültigen Vorschlag als „neu“ entgegen', async () => {
    const result = await call('/api/suggestions', { method: 'POST', body: suggestion })
    expect(result.status).toBe(201)
    expect(result.body?.status).toBe('new')
  })

  it('veröffentlicht Vorschläge nicht automatisch im Wortpool', async () => {
    await call('/api/suggestions', { method: 'POST', body: suggestion })
    const terms = await call('/api/terms')
    const list = terms.body?.terms as Array<{ displayTerm: string }>
    expect(list.some((term) => term.displayTerm === 'Testbegriff')).toBe(false)
  })

  it('weist unvollständige Vorschläge ab', async () => {
    const result = await call('/api/suggestions', {
      method: 'POST',
      body: { ...suggestion, hintTerm: '' },
    })
    expect(result.status).toBe(400)
    expect(result.body?.error).toBe('hintTerm_empty')
  })

  it('verlangt eine anonyme Browserkennung', async () => {
    const result = await call('/api/suggestions', {
      method: 'POST',
      body: { ...suggestion, clientId: undefined },
    })
    expect(result.status).toBe(400)
  })

  it('setzt das Limit von 10 Vorschlägen pro Stunde serverseitig durch', async () => {
    for (let index = 0; index < SUGGESTIONS.ratePerHour; index++) {
      const result = await call('/api/suggestions', {
        method: 'POST',
        body: { ...suggestion, displayTerm: `Begriff ${index}` },
      })
      expect(result.status, `Vorschlag ${index + 1}`).toBe(201)
    }

    const blocked = await call('/api/suggestions', {
      method: 'POST',
      body: { ...suggestion, displayTerm: 'Einer zu viel' },
    })
    expect(blocked.status).toBe(429)
    expect(blocked.body?.error).toBe('rate_limited')
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })

  it('greift auch, wenn eine neue Browserkennung verwendet wird', async () => {
    for (let index = 0; index < SUGGESTIONS.ratePerHour; index++) {
      await call('/api/suggestions', {
        method: 'POST',
        body: { ...suggestion, displayTerm: `Begriff ${index}` },
      })
    }
    // Frische clientId, aber dieselbe IP – das IP-Limit greift.
    const blocked = await call('/api/suggestions', {
      method: 'POST',
      body: { ...suggestion, clientId: 'ganz-andere-kennung', displayTerm: 'Neuer Tab' },
    })
    expect(blocked.status).toBe(429)
  })
})

describe('Adminzugang', () => {
  const adminRoutes: Array<[string, string]> = [
    ['GET', '/api/admin/session'],
    ['GET', '/api/admin/terms'],
    ['POST', '/api/admin/terms'],
    ['GET', '/api/admin/suggestions'],
    ['GET', '/api/admin/analytics'],
    ['DELETE', '/api/admin/analytics'],
    ['GET', '/api/admin/audit'],
  ]

  it('blockiert jede Adminroute ohne Anmeldung', async () => {
    for (const [method, path] of adminRoutes) {
      const result = await call(path, { method, body: method === 'GET' ? undefined : {} })
      expect(result.status, `${method} ${path}`).toBe(401)
    }
  })

  it('lehnt falsche Zugangsdaten ab', async () => {
    const result = await call('/api/admin/login', {
      method: 'POST',
      body: { username: ADMIN_USER, password: 'falsch' },
    })
    expect(result.status).toBe(401)
  })

  it('setzt ein HTTP-only-Cookie und gewährt danach Zugriff', async () => {
    const response = await fetch(`${base}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
    })
    const cookie = response.headers.getSetCookie()[0] ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')

    const session = await call('/api/admin/session', {
      headers: { cookie: cookie.split(';')[0] as string },
    })
    expect(session.status).toBe(200)
    expect(session.body?.username).toBe(ADMIN_USER)
  })

  it('macht die Sitzung mit dem Abmelden ungültig', async () => {
    const cookie = await loginCookie()
    await call('/api/admin/logout', { method: 'POST', headers: { cookie } })
    const after = await call('/api/admin/session', { headers: { cookie } })
    expect(after.status).toBe(401)
  })

  it('bremst wiederholte Fehlversuche aus', async () => {
    let sawRateLimit = false
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await call('/api/admin/login', {
        method: 'POST',
        body: { username: ADMIN_USER, password: 'falsch' },
      })
      if (result.status === 429) sawRateLimit = true
    }
    expect(sawRateLimit).toBe(true)
  })
})

describe('Adminfunktionen', () => {
  it('legt Begriffe an und liefert sie erst nach dem Aktivieren aus', async () => {
    const cookie = await loginCookie()
    const created = await call('/api/admin/terms', {
      method: 'POST',
      headers: { cookie },
      body: {
        displayTerm: 'Neuer Begriff',
        canonicalTerm: 'Bedeutung',
        hintTerm: 'Hinweis',
        category: 'Gaming',
      },
    })
    expect(created.status).toBe(201)
    expect(created.body?.enabled).toBe(false)

    let terms = await call('/api/terms')
    let list = terms.body?.terms as Array<{ displayTerm: string }>
    expect(list.some((term) => term.displayTerm === 'Neuer Begriff')).toBe(false)

    await call(`/api/admin/terms/${created.body?.id as string}`, {
      method: 'PATCH',
      headers: { cookie },
      body: { enabled: true, reviewStatus: 'approved' },
    })

    terms = await call('/api/terms')
    list = terms.body?.terms as Array<{ displayTerm: string }>
    expect(list.some((term) => term.displayTerm === 'Neuer Begriff')).toBe(true)
  })

  it('verhindert doppelte Begriffe in derselben Kategorie', async () => {
    const cookie = await loginCookie()
    const body = {
      displayTerm: 'Döner',
      canonicalTerm: 'Döner',
      hintTerm: 'Fast Food',
      category: 'Alltag',
    }
    const result = await call('/api/admin/terms', { method: 'POST', headers: { cookie }, body })
    expect(result.status).toBe(409)
    expect(result.body?.error).toBe('duplicate_term')
  })

  it('legt Importe grundsätzlich deaktiviert und ungeprüft an', async () => {
    const cookie = await loginCookie()
    const result = await call('/api/admin/terms/import', {
      method: 'POST',
      headers: { cookie },
      body: {
        csv: 'displayTerm,canonicalTerm,hintTerm,category\nImportiert,Bedeutung,Hinweis,Berufe',
      },
    })
    expect(result.status).toBe(200)
    expect(result.body?.created).toBe(1)

    const list = await call('/api/admin/terms?search=Importiert', { headers: { cookie } })
    const rows = list.body?.rows as Array<{ enabled: boolean; reviewStatus: string }>
    expect(rows[0]?.enabled).toBe(false)
    expect(rows[0]?.reviewStatus).toBe('needs_human_review')
  })

  it('führt einen Vorschlag durch den Moderationsworkflow', async () => {
    await call('/api/suggestions', {
      method: 'POST',
      body: {
        displayTerm: 'Moderiert',
        canonicalTerm: 'Bedeutung',
        hintTerm: 'Hinweis',
        category: 'Promis',
        clientId: 'kennung-moderation',
      },
    })

    const cookie = await loginCookie()
    const queue = await call('/api/admin/suggestions?status=new', { headers: { cookie } })
    const rows = queue.body?.rows as Array<{ id: string }>
    expect(rows).toHaveLength(1)

    const converted = await call(`/api/admin/suggestions/${rows[0]!.id}/convert`, {
      method: 'POST',
      headers: { cookie },
      body: { enable: true },
    })
    expect(converted.status).toBe(201)

    const after = await call('/api/admin/suggestions?status=accepted', { headers: { cookie } })
    expect((after.body?.rows as unknown[]).length).toBe(1)

    const terms = await call('/api/terms')
    const list = terms.body?.terms as Array<{ displayTerm: string }>
    expect(list.some((term) => term.displayTerm === 'Moderiert')).toBe(true)
  })

  it('protokolliert Adminaktionen', async () => {
    const cookie = await loginCookie()
    await call('/api/admin/terms', {
      method: 'POST',
      headers: { cookie },
      body: {
        displayTerm: 'Protokolltest',
        canonicalTerm: 'Bedeutung',
        hintTerm: 'Hinweis',
        category: 'Gaming',
      },
    })
    const audit = await call('/api/admin/audit', { headers: { cookie } })
    const actions = (audit.body?.rows as Array<{ action: string }>).map((row) => row.action)
    expect(actions).toContain('term_created')
    expect(actions).toContain('admin_login')
  })
})

describe('Analytics', () => {
  const events = {
    deviceId: 'geraetekennung-1',
    sessionId: 'sitzungskennung-1',
    events: [
      {
        name: 'impostor_round_started',
        occurredAt: new Date().toISOString(),
        payload: { mode: 'impostor', playerCount: 5, categories: ['Alltag'], online: true },
      },
    ],
  }

  it('nimmt bekannte Ereignisse an', async () => {
    const result = await call('/api/analytics/events', { method: 'POST', body: events })
    expect(result.body?.accepted).toBe(1)
  })

  it('verwirft unbekannte Ereignisnamen', async () => {
    const result = await call('/api/analytics/events', {
      method: 'POST',
      body: { ...events, events: [{ name: 'spielernamen_absaugen', occurredAt: new Date().toISOString() }] },
    })
    expect(result.body?.accepted).toBe(0)
  })

  it('entfernt Freitext aus der Payload, auch wenn ein Client ihn mitschickt', async () => {
    await call('/api/analytics/events', {
      method: 'POST',
      body: {
        ...events,
        events: [
          {
            name: 'whoami_round_started',
            occurredAt: new Date().toISOString(),
            payload: {
              mode: 'whoami',
              playerCount: 4,
              playerNames: ['Lena', 'Tom'],
              notes: 'private Notiz',
              term: 'Elon Musk',
            },
          },
        ],
      },
    })

    const cookie = await loginCookie()
    const exported = await call('/api/admin/analytics/export?range=24h', { headers: { cookie } })
    const raw = JSON.stringify(exported.body)
    expect(raw).not.toContain('Lena')
    expect(raw).not.toContain('private Notiz')
    expect(raw).not.toContain('Elon Musk')
    expect(raw).toContain('playerCount')
  })

  it('wertet die Zeiträume aus', async () => {
    await call('/api/analytics/events', { method: 'POST', body: events })
    const cookie = await loginCookie()

    for (const range of ['24h', '7d', '30d']) {
      const result = await call(`/api/admin/analytics?range=${range}`, { headers: { cookie } })
      expect(result.status, range).toBe(200)
      const summary = (result.body?.summary as { impostorRoundsStarted: number })
      expect(summary.impostorRoundsStarted).toBe(1)
    }
  })

  it('akzeptiert einen benutzerdefinierten Zeitraum und weist ungültige ab', async () => {
    const cookie = await loginCookie()
    const from = new Date(Date.now() - 3600_000).toISOString()
    const to = new Date().toISOString()
    expect((await call(`/api/admin/analytics?from=${from}&to=${to}`, { headers: { cookie } })).status).toBe(200)
    expect((await call(`/api/admin/analytics?range=1000j`, { headers: { cookie } })).status).toBe(400)
  })

  it('löscht nur nach ausdrücklicher Bestätigung', async () => {
    await call('/api/analytics/events', { method: 'POST', body: events })
    const cookie = await loginCookie()

    const withoutConfirmation = await call('/api/admin/analytics', {
      method: 'DELETE',
      headers: { cookie },
      body: { scope: 'all' },
    })
    expect(withoutConfirmation.status).toBe(400)

    const confirmed = await call('/api/admin/analytics', {
      method: 'DELETE',
      headers: { cookie },
      body: { scope: 'all', confirm: 'LÖSCHEN' },
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body?.deleted).toBe(1)
  })
})
