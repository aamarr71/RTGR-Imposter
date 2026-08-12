import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomView } from '@shared/types'
import { HttpError } from '@/services/http'
import type { Membership, RoomSyncService } from '@/services/roomSync'

const roomMocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  requestPlacement: vi.fn(),
  approvePlacement: vi.fn(),
  resetPlacement: vi.fn(),
  leave: vi.fn(),
  createSync: vi.fn(),
  rememberMembership: vi.fn(),
  getMembership: vi.fn(),
  forgetMembership: vi.fn(),
}))

vi.mock('@/services/analytics', () => ({
  analytics: { track: vi.fn() },
}))

vi.mock('@/services/roomSync', () => ({
  createPollingRoomSync: roomMocks.createSync,
  rememberMembership: roomMocks.rememberMembership,
  getMembership: roomMocks.getMembership,
  forgetMembership: roomMocks.forgetMembership,
  roomApi: {
    create: roomMocks.create,
    join: roomMocks.join,
    requestPlacement: roomMocks.requestPlacement,
    approvePlacement: roomMocks.approvePlacement,
    resetPlacement: roomMocks.resetPlacement,
    leave: roomMocks.leave,
  },
}))

import { useRoomStore } from './room'

function fakeSync() {
  const listeners: {
    update?: (view: RoomView) => void
    error?: (error: unknown) => void
    connection?: (connected: boolean) => void
  } = {}
  const service: RoomSyncService = {
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn((listener) => (listeners.update = listener)),
    onError: vi.fn((listener) => (listeners.error = listener)),
    onConnectionChange: vi.fn((listener) => (listeners.connection = listener)),
  }
  return { service, listeners }
}

const host: Membership = {
  code: 'ABCD23',
  playerId: 'host-id',
  rejoinToken: 'host-token',
}

const guest: Membership = {
  code: 'WXYZ89',
  playerId: 'guest-id',
  rejoinToken: 'guest-token',
}

function roomView(
  code: string,
  version: number,
  playerId = code === host.code ? host.playerId : guest.playerId,
): RoomView {
  return { code, version, you: { playerId } } as RoomView
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

let syncs: ReturnType<typeof fakeSync>[]

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  syncs = []
  roomMocks.createSync.mockImplementation(() => {
    const sync = fakeSync()
    syncs.push(sync)
    return sync.service
  })
  roomMocks.getMembership.mockReturnValue(null)
})

describe('Raum-Sync-Lebenszyklus', () => {
  it('verwendet den direkt nach create laufenden Sync ohne Storage-Neustart weiter', async () => {
    roomMocks.create.mockResolvedValue(host)
    const store = useRoomStore()

    await store.create('Lena')
    expect(store.ensure(host.code)).toBe('loading')

    expect(syncs).toHaveLength(1)
    expect(syncs[0]!.service.stop).not.toHaveBeenCalled()
    expect(roomMocks.getMembership).not.toHaveBeenCalled()
  })

  it('ignoriert verspätete Callbacks eines bereits ersetzten Syncs', () => {
    const store = useRoomStore()
    store.attach(host)
    const first = syncs[0]!

    store.attach(guest)
    const second = syncs[1]!
    first.listeners.update?.(roomView(host.code, 99))
    first.listeners.connection?.(false)

    expect(store.view).toBeNull()
    expect(store.connected).toBe(true)

    second.listeners.update?.(roomView(guest.code, 1))
    expect(store.view?.code).toBe(guest.code)
  })

  it('bindet Polling-Sichten an Raumcode und eigenen Spieler', () => {
    const store = useRoomStore()
    store.attach(host)

    syncs[0]!.listeners.update?.(roomView(guest.code, 99, host.playerId))
    syncs[0]!.listeners.update?.(roomView(host.code, 98, guest.playerId))
    expect(store.view).toBeNull()

    // Die hohen Versionen fremder Sichten dürfen nicht in den
    // Versionsvergleich dieser Membership einfließen.
    syncs[0]!.listeners.update?.(roomView(host.code, 1))
    expect(store.view?.code).toBe(host.code)
    expect(store.view?.you.playerId).toBe(host.playerId)
    expect(store.view?.version).toBe(1)
  })

  it('startet nach einem echten Detach mit der aktiven Membership neu', () => {
    const store = useRoomStore()
    store.attach(host)
    store.detach()

    expect(store.ensure(host.code)).toBe('loading')
    expect(syncs).toHaveLength(2)
    expect(roomMocks.getMembership).not.toHaveBeenCalled()
  })

  it('hält einen terminal beendeten Poll nicht weiter für aktiv', () => {
    const store = useRoomStore()
    store.attach(host)
    syncs[0]!.listeners.error?.(new HttpError(404, 'room_not_found', 'Raum weg'))

    expect(store.fatalError).toBe('room_not_found')
    expect(store.ensure(host.code)).toBe('denied')
    expect(syncs[0]!.service.stop).toHaveBeenCalledOnce()
    expect(roomMocks.forgetMembership).toHaveBeenCalledWith(host.code)
    expect(roomMocks.getMembership).not.toHaveBeenCalled()
  })
})

describe('Rundenplatzierungs-Aktionen', () => {
  it('übernimmt eine ältere Aktionsantwort nicht über einen neueren Pollingstand', async () => {
    const store = useRoomStore()
    store.attach(host)
    syncs[0]!.listeners.update?.(roomView(host.code, 5))
    roomMocks.requestPlacement.mockResolvedValue(roomView(host.code, 4))

    await store.requestPlacement()

    expect(store.view?.version).toBe(5)
    expect(roomMocks.requestPlacement).toHaveBeenCalledWith(host)
  })

  it('übernimmt den neuen Serverstand und serialisiert Doppelklicks', async () => {
    const store = useRoomStore()
    store.attach(host)
    syncs[0]!.listeners.update?.(roomView(host.code, 5))

    let release!: (view: RoomView) => void
    roomMocks.requestPlacement.mockImplementation(
      () => new Promise<RoomView>((resolve) => (release = resolve)),
    )
    const first = store.requestPlacement()
    const second = store.requestPlacement()
    expect(roomMocks.requestPlacement).toHaveBeenCalledOnce()

    release(roomView(host.code, 6))
    await Promise.all([first, second])
    expect(store.view?.version).toBe(6)
    expect(store.busy).toBe(false)
  })

  it('ignoriert eine alte Aktionsantwort nach Membership-Wechsel, ohne Bs Aktion zu entsperren', async () => {
    const store = useRoomStore()
    const actionA = deferred<RoomView>()
    const actionB = deferred<RoomView>()
    roomMocks.requestPlacement
      .mockImplementationOnce(() => actionA.promise)
      .mockImplementationOnce(() => actionB.promise)

    store.attach(host)
    const pendingA = store.requestPlacement()
    expect(store.busy).toBe(true)

    store.attach(guest)
    syncs[1]!.listeners.update?.(roomView(guest.code, 1))
    const pendingB = store.requestPlacement()
    expect(store.busy).toBe(true)

    actionA.resolve(roomView(host.code, 99))
    expect(await pendingA).toBe(true)
    expect(store.view?.code).toBe(guest.code)
    expect(store.view?.version).toBe(1)
    expect(store.busy).toBe(true)

    // Auch nach der alten Antwort bleibt Bs Polling ganz normal adoptierbar.
    syncs[1]!.listeners.update?.(roomView(guest.code, 2))
    expect(store.view?.version).toBe(2)

    actionB.resolve(roomView(guest.code, 3))
    expect(await pendingB).toBe(true)
    expect(store.view?.version).toBe(3)
    expect(store.busy).toBe(false)
  })

  it('ignoriert einen alten Aktionsfehler nach Membership-Wechsel, ohne Bs Aktion zu entsperren', async () => {
    const store = useRoomStore()
    const actionA = deferred<RoomView>()
    const actionB = deferred<RoomView>()
    roomMocks.requestPlacement
      .mockImplementationOnce(() => actionA.promise)
      .mockImplementationOnce(() => actionB.promise)

    store.attach(host)
    const pendingA = store.requestPlacement()
    store.attach(guest)
    syncs[1]!.listeners.update?.(roomView(guest.code, 1))
    const pendingB = store.requestPlacement()

    actionA.reject(new HttpError(409, 'placement_not_pending', 'Alt'))
    expect(await pendingA).toBe(false)
    expect(store.actionError).toBeNull()
    expect(store.busy).toBe(true)

    actionB.resolve(roomView(guest.code, 2))
    expect(await pendingB).toBe(true)
    expect(store.view?.version).toBe(2)
    expect(store.busy).toBe(false)
  })

  it('ignoriert Aktionsantworten aus einer vorigen Detach-Epoche', async () => {
    const store = useRoomStore()
    const oldAction = deferred<RoomView>()
    roomMocks.requestPlacement.mockImplementationOnce(() => oldAction.promise)

    store.attach(host)
    const pending = store.requestPlacement()
    store.detach()
    store.attach(host)
    syncs[1]!.listeners.update?.(roomView(host.code, 1))

    oldAction.resolve(roomView(host.code, 99))
    expect(await pending).toBe(true)
    expect(store.view?.version).toBe(1)
    expect(store.busy).toBe(false)
  })

  it('ignoriert einen alten Aktionsfehler nach erfolgreichem Leave-Reset', async () => {
    const store = useRoomStore()
    const oldAction = deferred<RoomView>()
    roomMocks.requestPlacement.mockImplementationOnce(() => oldAction.promise)
    roomMocks.leave.mockResolvedValue(undefined)

    store.attach(host)
    const pending = store.requestPlacement()
    expect(await store.leave()).toBe(true)

    oldAction.reject(new HttpError(409, 'placement_not_pending', 'Alt'))
    expect(await pending).toBe(false)
    expect(store.membership).toBeNull()
    expect(store.actionError).toBeNull()
    expect(store.busy).toBe(false)
  })

  it('ignoriert eine Aktionssicht mit falscher Identität und akzeptiert danach einen kleineren Poll', async () => {
    const store = useRoomStore()
    store.attach(host)
    roomMocks.requestPlacement.mockResolvedValue(roomView(host.code, 99, guest.playerId))

    expect(await store.requestPlacement()).toBe(true)
    expect(store.view).toBeNull()

    syncs[0]!.listeners.update?.(roomView(host.code, 1))
    expect(store.view?.version).toBe(1)
  })

  it('zeigt Aktionsfehler an und behält die Mitgliedschaft', async () => {
    const store = useRoomStore()
    store.attach(host)
    roomMocks.approvePlacement.mockRejectedValue(
      new HttpError(409, 'placement_not_pending', 'Nicht offen'),
    )

    await store.approvePlacement(guest.playerId, 'claim-1')

    expect(store.actionError).toBe('placement_not_pending')
    expect(store.membership).toEqual(host)
    expect(store.busy).toBe(false)
  })

  it('räumt einen Aktionsfehler erst mit einem wirklich neueren Pollingstand', async () => {
    const store = useRoomStore()
    store.attach(host)
    syncs[0]!.listeners.update?.(roomView(host.code, 5))
    roomMocks.approvePlacement.mockRejectedValue(
      new HttpError(409, 'placement_not_pending', 'Nicht offen'),
    )

    expect(await store.approvePlacement(guest.playerId, 'claim-1')).toBe(false)
    expect(store.actionError).toBe('placement_not_pending')

    syncs[0]!.listeners.update?.(roomView(host.code, 5))
    expect(store.actionError).toBe('placement_not_pending')

    syncs[0]!.listeners.update?.(roomView(host.code, 6))
    expect(store.actionError).toBeNull()
  })

  it('verlässt eine laufende Runde bei Serverablehnung nicht lokal', async () => {
    const store = useRoomStore()
    store.attach(host)
    roomMocks.leave.mockRejectedValue(new HttpError(409, 'round_in_progress', 'Runde läuft'))

    expect(await store.leave()).toBe(false)
    expect(store.membership).toEqual(host)
    expect(store.actionError).toBe('round_in_progress')
    expect(roomMocks.forgetMembership).not.toHaveBeenCalled()
  })
})
