import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { describe, expect, it } from 'vitest'
import {
  createChunkRecoveryController,
  installChunkRecovery,
  isChunkLoadError,
  type ChunkRecoveryRuntime,
  type RecoveryMarker,
} from './chunkRecovery'

function fakeRuntime(now = 10_000) {
  let marker: RecoveryMarker | null = null
  const reloads: string[] = []
  const runtime: ChunkRecoveryRuntime = {
    now: () => now,
    currentPath: () => '/aktuell',
    loadMarker: () => marker,
    saveMarker: (next) => {
      marker = next
      return true
    },
    clearMarker: () => {
      marker = null
    },
    reloadAt: (target) => reloads.push(target),
  }
  return {
    runtime,
    reloads,
    marker: () => marker,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
  }
}

function routerWith(routes: RouteRecordRaw[]) {
  return createRouter({ history: createMemoryHistory(), routes })
}

describe('Recovery für veraltete Build-Chunks', () => {
  it('erkennt die üblichen Vite-, Safari- und Chunk-Fehler, aber keine Fachfehler', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(
      true,
    )
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/room-old.css'))).toBe(true)
    expect(isChunkLoadError(new Error('room_not_found'))).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
  })

  it('lädt das Ziel genau einmal neu und verhindert eine Reload-Schleife', () => {
    const fake = fakeRuntime()
    const first = createChunkRecoveryController(fake.runtime)

    expect(first.recover('/room/ABCDEF')).toBe(true)
    expect(first.recover('/room/ABCDEF')).toBe(false)
    expect(fake.reloads).toEqual(['/room/ABCDEF'])
    expect(fake.marker()).toEqual({ target: '/room/ABCDEF', attemptedAt: 10_000 })

    // Simuliert dasselbe Dokument nach dem Reload: der persistierte Marker
    // verhindert eine zweite Runde, falls der Chunk weiterhin fehlt.
    const afterReload = createChunkRecoveryController(fake.runtime)
    expect(afterReload.recover('/room/ABCDEF')).toBe(false)
    expect(fake.reloads).toHaveLength(1)

    fake.advance(60_000)
    expect(createChunkRecoveryController(fake.runtime).recover('/room/ABCDEF')).toBe(true)
    expect(fake.reloads).toHaveLength(2)
  })

  it('verwendet beim Vite-Preloadfehler das gerade angeforderte Router-Ziel', async () => {
    const fake = fakeRuntime()
    const controller = createChunkRecoveryController(fake.runtime)
    const events = new EventTarget()
    const preloadEvents: Event[] = []
    const routes: RouteRecordRaw[] = [
      { path: '/', component: { template: '<div>Start</div>' } },
      {
        path: '/room/:code',
        component: async () => {
          const preloadEvent = new Event('vite:preloadError', { cancelable: true }) as Event & {
            payload?: unknown
          }
          preloadEvent.payload = new TypeError('Failed to fetch dynamically imported module')
          preloadEvents.push(preloadEvent)
          events.dispatchEvent(preloadEvent)
          return { template: '<div>Raum</div>' }
        },
      },
    ]
    const router = routerWith(routes)
    const uninstall = installChunkRecovery(router, {
      controller,
      eventTarget: events,
    })

    await router.push('/room/ABCDEF?from=rejoin#ranking')

    expect(fake.reloads).toEqual(['/room/ABCDEF?from=rejoin#ranking'])
    expect(preloadEvents[0]?.defaultPrevented).toBe(true)
    // Ein afterEach aus demselben, bereits veralteten Dokument darf den
    // Schleifenschutz nicht noch vor dem Reload entfernen.
    expect(fake.marker()).not.toBeNull()
    uninstall()
  })

  it('lädt bei einem Fachfehler während der Modulauswertung nicht neu', () => {
    const fake = fakeRuntime()
    const events = new EventTarget()
    const router = routerWith([{ path: '/', component: { template: '<div>Start</div>' } }])
    const uninstall = installChunkRecovery(router, {
      controller: createChunkRecoveryController(fake.runtime),
      eventTarget: events,
    })
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload?: unknown
    }
    event.payload = new ReferenceError('Spiellogik ist kaputt')

    events.dispatchEvent(event)

    expect(fake.reloads).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    uninstall()
  })

  it('startet ohne dokumentübergreifenden Schleifenschutz keinen Reload', () => {
    const fake = fakeRuntime()
    fake.runtime.saveMarker = () => false

    expect(createChunkRecoveryController(fake.runtime).recover('/room/ABCDEF')).toBe(false)
    expect(fake.reloads).toEqual([])
  })

  it('fängt passende Router-Fehler ab, lässt andere Fehler aber unangetastet', async () => {
    const staleFake = fakeRuntime()
    const staleRouter = routerWith([
      { path: '/', component: { template: '<div>Start</div>' } },
      {
        path: '/room/:code',
        component: () => Promise.reject(new TypeError('Importing a module script failed.')),
      },
    ])
    const removeStale = installChunkRecovery(staleRouter, {
      controller: createChunkRecoveryController(staleFake.runtime),
      eventTarget: new EventTarget(),
    })

    await expect(staleRouter.push('/room/ABCDEF')).rejects.toThrow('module script')
    expect(staleFake.reloads).toEqual(['/room/ABCDEF'])
    removeStale()

    const otherFake = fakeRuntime()
    const otherRouter = routerWith([
      { path: '/', component: { template: '<div>Start</div>' } },
      { path: '/kaputt', component: () => Promise.reject(new Error('Fachfehler')) },
    ])
    const removeOther = installChunkRecovery(otherRouter, {
      controller: createChunkRecoveryController(otherFake.runtime),
      eventTarget: new EventTarget(),
    })

    await expect(otherRouter.push('/kaputt')).rejects.toThrow('Fachfehler')
    expect(otherFake.reloads).toEqual([])
    removeOther()
  })
})
