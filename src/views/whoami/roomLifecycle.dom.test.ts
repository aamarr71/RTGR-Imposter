import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App.vue'
import { routes } from '@/router'
import { storage, StorageKeys } from '@/services/storage'
import { rememberMembership, type Membership } from '@/services/roomSync'
import { useRoomStore } from '@/stores/room'
import { WHO_AM_I } from '@shared/config'

/**
 * Der Lebenszyklus rund um „Raum erstellen“ – genau der Ablauf, der in
 * Produktion gebrochen war: POST erfolgreich, danach fiel die App sofort auf
 * den Einstiegsbildschirm zurück und der erste `GET /api/rooms/:code` ging
 * entweder verloren oder riss die Sitzung mit sich.
 *
 * Getestet wird deshalb nicht `roomApi.create()` allein, sondern die Kette
 * aus Formular, Store, Router, Mitgliedschaft und Sync.
 */

const CODE = 'ABCDEF'
const MEMBERSHIP: Membership = { code: CODE, playerId: 'p1', rejoinToken: 'geheim' }

interface Recorded {
  method: string
  url: string
  headers: Record<string, string>
}

const requests: Recorded[] = []

/** Steuert, wie der gefälschte Server auf `GET /api/rooms/:code` antwortet. */
type GetMode = 'pending' | 'ok' | 403 | 404 | 410 | 500
let getMode: GetMode = 'ok'
let releasePendingGet: (() => void) | null = null

const ROOM_VIEW = {
  code: CODE,
  version: 1,
  phase: 'lobby' as const,
  locked: false,
  roundNumber: 1,
  players: [
    { id: 'p1', name: 'Lena', seat: 1, isHost: true, hasSubmittedTerm: false, online: true },
  ],
  you: { playerId: 'p1', isHost: true, seat: 1 },
  notes: '',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function roomViewResponse(): Response {
  return jsonResponse(ROOM_VIEW, 200)
}

function installFakeServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      requests.push({ method, url, headers: { ...((init.headers ?? {}) as Record<string, string>) } })

      if (method === 'POST' && url.endsWith('/api/rooms')) {
        return Promise.resolve(jsonResponse(MEMBERSHIP, 201))
      }

      if (method === 'GET' && url.includes('/api/rooms/')) {
        if (getMode === 'ok') return Promise.resolve(roomViewResponse())
        if (getMode === 'pending') {
          return new Promise<Response>((resolve) => {
            releasePendingGet = () => resolve(roomViewResponse())
          })
        }
        return Promise.resolve(
          jsonResponse(
            { error: getMode === 500 ? 'internal' : 'room_not_found', message: 'weg' },
            getMode,
          ),
        )
      }

      // Analytics und alles Übrige interessieren hier nicht.
      return Promise.resolve(jsonResponse({}, 200))
    }),
  )
}

function roomRequests(): Recorded[] {
  return requests.filter((r) => r.method === 'GET' && r.url.includes('/api/rooms/'))
}

function storedMemberships(): Record<string, Membership> {
  return storage.get<Record<string, Membership>>(StorageKeys.roomMembership, {})
}

let router: Router
let mounted: VueWrapper | null = null

function makeRouter(): Router {
  return createRouter({ history: createMemoryHistory(), routes })
}

async function mountAt(path: string): Promise<VueWrapper> {
  await router.push(path)
  await router.isReady()
  mounted = mount(App, {
    global: {
      plugins: [router],
      // jsdom kennt hier kein <dialog>; der Bestätigungsdialog ist für den
      // Lebenszyklus ohnehin ohne Belang.
      stubs: { AppDialog: true },
    },
  })
  return mounted
}

/** Lässt Microtasks, Timer und Vue-Updates zur Ruhe kommen. */
async function settle(wrapper: VueWrapper, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    await wrapper.vm.$nextTick()
  }
}

/** Durchläuft „Raum erstellen“ im Formular bis zum abgeschickten POST. */
async function createRoomViaUi(wrapper: VueWrapper) {
  await vi.waitFor(() => expect(wrapper.text()).toContain('Raum erstellen'))
  const button = wrapper.findAll('button').find((b) => b.text().includes('Raum erstellen'))
  await button!.trigger('click')
  await wrapper.find('input').setValue('Lena')
  await wrapper.find('form').trigger('submit')
  // Nur auf den abgeschickten POST warten – wohin die App danach navigiert,
  // ist genau die Frage, die die einzelnen Tests beantworten.
  await vi.waitFor(() => expect(requests.some((r) => r.method === 'POST')).toBe(true))
  await settle(wrapper)
}

beforeAll(async () => {
  // Beide Ansichten einmal vorladen: sonst verfälscht die erste
  // Chunk-Übersetzung die Zeitmessungen der Navigationstests.
  await Promise.all([
    import('@/views/whoami/WhoAmIEntryView.vue'),
    import('@/views/whoami/WhoAmIRoomView.vue'),
  ])
})

beforeEach(() => {
  requests.length = 0
  releasePendingGet = null
  getMode = 'ok'
  storage.clearNamespace()
  storage.set(StorageKeys.ageConfirmed, true)
  setActivePinia(createPinia())
  router = makeRouter()
  installFakeServer()
})

afterEach(() => {
  // Ohne Abbau liefe der Sync einer gemounteten App in den nächsten Test
  // hinein und würde dessen Abfragezählung verfälschen.
  mounted?.unmount()
  mounted = null
  useRoomStore().detach()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ *
 * Raum erstellen
 * ------------------------------------------------------------------ */

describe('Raum erstellen', () => {
  it('legt den Raum an, sichert die Mitgliedschaft und wechselt in den Raum', async () => {
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    const post = requests.find((r) => r.method === 'POST' && r.url.endsWith('/api/rooms'))
    expect(post).toBeDefined()

    // JoinResult vollständig übernommen – inklusive der geheimen Zugangsdaten.
    expect(storedMemberships()[CODE]).toEqual(MEMBERSHIP)
    expect(useRoomStore().membership).toEqual(MEMBERSHIP)

    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
  })

  it('fragt den Raum genau einmal und mit Spielerkennung ab', async () => {
    getMode = 'pending'
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    // Der Kern des Produktionsfehlers: nach dem POST muss ein GET folgen.
    const reads = roomRequests()
    expect(reads).toHaveLength(1)
    expect(reads[0]!.url).toContain(`/api/rooms/${CODE}`)
    expect(reads[0]!.headers['x-player-id']).toBe(MEMBERSHIP.playerId)
    expect(reads[0]!.headers['x-rejoin-token']).toBe(MEMBERSHIP.rejoinToken)

    // Tokens gehören ausschließlich in Header, niemals in die URL.
    expect(reads[0]!.url).not.toContain(MEMBERSHIP.rejoinToken)
    expect(reads[0]!.url).not.toContain('rejoin')
  })

  it('bleibt im Raum, solange die erste RoomView noch aussteht', async () => {
    getMode = 'pending'
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    const room = useRoomStore()
    // Genau hier ist die App früher zurück auf den Einstieg gesprungen.
    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    expect(room.view).toBeNull()
    // Ausstehende erste RoomView = Ladezustand, kein Fehler.
    expect(room.status).toBe('loading')
    expect(wrapper.text()).toContain('Lädt')
    // Die Mitgliedschaft überlebt die Navigation.
    expect(room.membership).toEqual(MEMBERSHIP)
    expect(storedMemberships()[CODE]).toEqual(MEMBERSHIP)
  })

  it('zeigt die Lobby, sobald die erste RoomView eintrifft', async () => {
    getMode = 'pending'
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    releasePendingGet!()
    await settle(wrapper)

    const room = useRoomStore()
    expect(room.status).toBe('ready')
    expect(room.view?.code).toBe(CODE)
    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    expect(wrapper.text()).toContain('Lobby')
    expect(wrapper.text()).toContain('Lena')
    // Kein zweiter Sync, der den ersten abgelöst hätte.
    expect(roomRequests()).toHaveLength(1)
  })

  it('zeigt die Lobby auch, wenn die erste RoomView vor der Navigation da ist', async () => {
    getMode = 'ok'
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    expect(useRoomStore().status).toBe('ready')
    expect(wrapper.text()).toContain('Lobby')
    expect(roomRequests()).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ *
 * Rückkehr in einen Raum
 * ------------------------------------------------------------------ */

describe('Rückkehr in einen Raum', () => {
  it('nimmt mit gespeicherter Mitgliedschaft einen Direktaufruf wieder auf', async () => {
    rememberMembership(MEMBERSHIP)
    const wrapper = await mountAt(`/room/${CODE}`)
    await settle(wrapper)

    const reads = roomRequests()
    expect(reads).toHaveLength(1)
    expect(reads[0]!.headers['x-player-id']).toBe(MEMBERSHIP.playerId)
    expect(reads[0]!.headers['x-rejoin-token']).toBe(MEMBERSHIP.rejoinToken)

    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    expect(useRoomStore().status).toBe('ready')
    expect(wrapper.text()).toContain('Lobby')
  })

  it('bleibt beim Direktaufruf während der ersten Abfrage im Raum', async () => {
    getMode = 'pending'
    rememberMembership(MEMBERSHIP)
    const wrapper = await mountAt(`/room/${CODE}`)
    await settle(wrapper)

    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    expect(useRoomStore().status).toBe('loading')
  })

  it('verweigert den Zutritt, wenn nur der Raumcode bekannt ist', async () => {
    // Kein gespeichertes Rejoin-Token: der Code allein darf keinen Platz öffnen.
    const wrapper = await mountAt(`/room/${CODE}`)
    await settle(wrapper)

    expect(router.currentRoute.value.name).toBe('whoami-entry')
    expect(router.currentRoute.value.query.code).toBe(CODE)
    expect(roomRequests()).toHaveLength(0)
    expect(useRoomStore().status).toBe('idle')
  })
})

/* ------------------------------------------------------------------ *
 * Fehlerzustände
 * ------------------------------------------------------------------ */

describe('Fehlerzustände', () => {
  for (const status of [403, 404, 410] as const) {
    it(`räumt bei ${status} auf und meldet den Verlust, statt stumm zurückzuspringen`, async () => {
      getMode = status
      const wrapper = await mountAt('/wer-bin-ich')
      await createRoomViaUi(wrapper)

      const room = useRoomStore()
      // Das war das Produktionssymptom: die App sprang kommentarlos zurück
      // auf „Raum erstellen / Code eingeben“.
      expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
      expect(room.status).toBe('denied')
      expect(wrapper.text()).not.toContain('Lädt')
      expect(room.fatalError).not.toBeNull()
      // Aufräumen: unbrauchbare Zugangsdaten verschwinden.
      expect(storedMemberships()[CODE]).toBeUndefined()
      expect(room.membership).toBeNull()
    })
  }

  it('wertet einen Serverfehler als vorübergehend und hält die Sitzung', async () => {
    getMode = 500
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)

    const room = useRoomStore()
    expect(room.connected).toBe(false)
    // 5xx ist kein Zugangsverlust: Mitgliedschaft und Raum bleiben bestehen.
    expect(room.status).toBe('loading')
    expect(room.membership).toEqual(MEMBERSHIP)
    expect(storedMemberships()[CODE]).toEqual(MEMBERSHIP)
    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
  })

  // Das Nachlassen der Abfragen ist exponentiell – dieser Test darf länger dauern.
  it('holt sich nach einem Serverfehler den Raum ohne Zutun zurück', { timeout: 20000 }, async () => {
    getMode = 500
    const wrapper = await mountAt('/wer-bin-ich')
    await createRoomViaUi(wrapper)
    expect(useRoomStore().connected).toBe(false)

    getMode = 'ok'
    // Der Sync lässt nach einem Fehlschlag exponentiell nach und kommt von
    // selbst zurück – ohne Zutun der Ansicht.
    await vi.waitFor(() => expect(useRoomStore().status).toBe('ready'), { timeout: 12000 })
    expect(useRoomStore().connected).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe(`/room/${CODE}`)
    await settle(wrapper, 2)
  })
})

/* ------------------------------------------------------------------ *
 * Sync-Besitz über Routenwechsel hinweg
 * ------------------------------------------------------------------ */

describe('Sync-Besitz beim Routenwechsel', () => {
  it('gibt beim Verlassen der Route nur den eigenen Raum frei', async () => {
    const room = useRoomStore()
    const other: Membership = { code: 'ZZZZZZ', playerId: 'p9', rejoinToken: 'anders' }

    room.attach(MEMBERSHIP)
    await vi.waitFor(() => expect(roomRequests().length).toBeGreaterThan(0))

    // Die nächste Ansicht übernimmt den Store …
    room.attach(other)
    await vi.waitFor(() => expect(roomRequests().some((r) => r.url.includes('ZZZZZZ'))).toBe(true))

    // … und das verspätete Aufräumen der alten Ansicht darf das nicht stoppen.
    room.release(CODE)
    expect(room.membership).toEqual(other)
    expect(room.status).not.toBe('idle')

    const before = roomRequests().filter((r) => r.url.includes('ZZZZZZ')).length
    await vi.waitFor(
      () => expect(roomRequests().filter((r) => r.url.includes('ZZZZZZ')).length).toBeGreaterThan(before),
      { timeout: WHO_AM_I.pollIntervalMs * 3 },
    )

    room.detach()
  })

  it('startet keinen zweiten Sync für dieselbe Mitgliedschaft', async () => {
    const room = useRoomStore()
    getMode = 'pending'

    room.attach(MEMBERSHIP)
    await vi.waitFor(() => expect(roomRequests()).toHaveLength(1))

    // Genau das tat die alte `resume()`-Logik beim Mounten der Raumansicht:
    // sie warf den laufenden Sync weg und stellte dieselbe Abfrage erneut.
    expect(room.ensure(CODE)).toBe('loading')
    room.attach(MEMBERSHIP)
    expect(roomRequests()).toHaveLength(1)

    room.detach()
  })

  it('stoppt den Sync, wenn die Raumansicht ihren eigenen Raum freigibt', async () => {
    const room = useRoomStore()
    room.attach(MEMBERSHIP)
    await vi.waitFor(() => expect(roomRequests().length).toBeGreaterThan(0))

    room.release(CODE)
    const after = roomRequests().length
    await new Promise((resolve) => setTimeout(resolve, WHO_AM_I.pollIntervalMs + 300))
    expect(roomRequests()).toHaveLength(after)
  })

  it('wechselt bei einem Deep Link in einen anderen Raum die Sitzung', async () => {
    const other: Membership = { code: 'ZZZZZZ', playerId: 'p9', rejoinToken: 'anders' }
    rememberMembership(MEMBERSHIP)
    rememberMembership(other)

    const wrapper = await mountAt(`/room/${CODE}`)
    await settle(wrapper)
    expect(useRoomStore().membership).toEqual(MEMBERSHIP)

    await router.push(`/room/${other.code}`)
    await settle(wrapper)

    expect(useRoomStore().membership).toEqual(other)
    expect(roomRequests().some((r) => r.url.includes('ZZZZZZ'))).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe(`/room/${other.code}`)
  })
})
