import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomView } from '@shared/types'
import { HttpError } from '@/services/http'
import type { Membership, RoomSyncService } from '@/services/roomSync'

const roomMocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
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

function roomView(code: string, version: number): RoomView {
  return { code, version } as RoomView
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
