import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomBoardEntry, RoomPlayerView, RoomView } from '@shared/types'

const mocks = vi.hoisted(() => ({
  room: null as Record<string, unknown> | null,
  router: { replace: vi.fn() },
}))

vi.mock('@/stores/room', () => ({
  useRoomStore: () => mocks.room,
}))

vi.mock('vue-router', () => ({
  useRouter: () => mocks.router,
}))

import WhoAmIRoomView from './WhoAmIRoomView.vue'

function boardEntry(patch: Partial<RoomBoardEntry>): RoomBoardEntry {
  return {
    playerId: 'host',
    name: 'Lena',
    seat: 1,
    online: true,
    isSelf: false,
    term: 'Elon Musk',
    roundState: 'active',
    placement: null,
    placementClaimId: null,
    placementAutomatic: false,
    ...patch,
  }
}

function player(entry: RoomBoardEntry, isHost = false): RoomPlayerView {
  return {
    id: entry.playerId,
    name: entry.name,
    seat: entry.seat,
    online: entry.online,
    isHost,
    hasSubmittedTerm: true,
    roundState: entry.roundState,
    placement: entry.placement,
    placementClaimId: entry.placementClaimId,
    placementAutomatic: entry.placementAutomatic,
  }
}

function playingView(isHost: boolean): RoomView {
  const board = [
    boardEntry({ playerId: 'host', name: 'Lena', isSelf: isHost }),
    boardEntry({
      playerId: 'tom',
      name: 'Tom',
      seat: 2,
      term: 'Albert Einstein',
      roundState: 'pending',
      placementClaimId: 'claim-tom',
    }),
    boardEntry({
      playerId: 'mia',
      name: 'Mia',
      seat: 3,
      term: 'Marie Curie',
      roundState: 'finished',
      placement: 1,
      placementClaimId: 'claim-mia',
    }),
    boardEntry({ playerId: 'noah', name: 'Noah', seat: 4 }),
  ]
  if (!isHost) {
    board[0]!.isSelf = false
    board[1]!.isSelf = true
    board[1]!.term = null
  } else {
    board[0]!.term = null
  }
  return {
    code: 'ABCDEF',
    phase: 'playing',
    version: 8,
    locked: true,
    roundNumber: 1,
    you: {
      playerId: isHost ? 'host' : 'tom',
      name: isHost ? 'Lena' : 'Tom',
      seat: isHost ? 1 : 2,
      isHost,
    },
    players: board.map((entry, index) => player(entry, index === 0)),
    board,
    assignmentTarget: null,
    submittedTerm: null,
    notes: '',
    serverTime: Date.now(),
  }
}

function automaticLastView(): RoomView {
  const board = [
    boardEntry({
      playerId: 'host',
      name: 'Lena',
      roundState: 'finished',
      placement: 1,
      placementClaimId: 'claim-lena',
    }),
    boardEntry({
      playerId: 'tom',
      name: 'Tom',
      seat: 2,
      roundState: 'finished',
      placement: 2,
      placementClaimId: 'claim-tom',
    }),
    boardEntry({
      playerId: 'mia',
      name: 'Mia',
      seat: 3,
      roundState: 'finished',
      placement: 3,
      placementClaimId: 'claim-mia',
    }),
    boardEntry({
      playerId: 'noah',
      name: 'Noah',
      seat: 4,
      isSelf: true,
      term: 'Sherlock Holmes',
      roundState: 'finished',
      placement: 4,
      placementAutomatic: true,
    }),
  ]
  const view = playingView(false)
  view.you = { playerId: 'noah', name: 'Noah', seat: 4, isHost: false }
  view.board = board
  view.players = board.map((entry, index) => player(entry, index === 0))
  return view
}

function completedHostView(): RoomView {
  const view = automaticLastView()
  view.you = { playerId: 'host', name: 'Lena', seat: 1, isHost: true }
  view.board = view.board?.map((entry) => ({
    ...entry,
    isSelf: entry.playerId === 'host',
    term:
      entry.playerId === 'host'
        ? 'Taylor Swift'
        : entry.term,
  })) ?? null
  view.players = (view.board ?? []).map((entry, index) => player(entry, index === 0))
  return view
}

function lobbyView(isHost: boolean): RoomView {
  const view = playingView(isHost)
  view.phase = 'lobby'
  view.locked = false
  view.board = null
  view.assignmentTarget = { playerId: 'tom', name: 'Tom', seat: 2 }
  view.submittedTerm = null
  return view
}

function makeRoom(isHost: boolean, initialView = playingView(isHost)) {
  return reactive({
    view: initialView,
    membership: { code: 'ABCDEF', playerId: isHost ? 'host' : 'tom', rejoinToken: 'token' },
    connected: true,
    fatalError: null,
    actionError: null,
    busy: false,
    isHost,
    missingTerms: 0,
    ensure: vi.fn(() => 'ready'),
    release: vi.fn(),
    requestPlacement: vi.fn().mockResolvedValue(true),
    approvePlacement: vi.fn().mockResolvedValue(true),
    resetPlacement: vi.fn().mockResolvedValue(true),
    saveNotes: vi.fn(),
    endRound: vi.fn().mockResolvedValue(true),
    leave: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  })
}

function mountRoom(isHost: boolean, initialView = playingView(isHost)) {
  mocks.room = makeRoom(isHost, initialView)
  return mount(WhoAmIRoomView, {
    props: { code: 'ABCDEF' },
    attachTo: document.body,
    global: {
      stubs: {
        AppHeader: { template: '<header><slot name="action" /></header>' },
        NotesPanel: true,
        AppDialog: {
          props: ['open'],
          template: '<div v-if="open" data-test="dialog"><slot name="actions" /></div>',
        },
      },
    },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  mocks.router.replace.mockReset()
})

describe('Wer-bin-ich-Platzierungsoberfläche', () => {
  it('bietet einem aktiven Spieler die eigene Erraten-Meldung an', async () => {
    const wrapper = mountRoom(true)
    const claim = wrapper.findAll('button').find((button) => button.text() === 'Erraten')
    expect(claim).toBeDefined()

    await claim!.trigger('click')
    expect((mocks.room as ReturnType<typeof makeRoom>).requestPlacement).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('zeigt während der Runde keine Zwischenrangliste und markiert fertige Spieler ohne Platz', () => {
    const wrapper = mountRoom(true)

    expect(wrapper.find('ol.rankingList').exists()).toBe(false)
    expect(wrapper.find('.roundResult').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('1. Platz')
    expect(wrapper.text()).not.toContain('Dein Status')
    expect(wrapper.text()).not.toContain('Platzierung')
    expect(wrapper.findAll('.board__row.is-finished')).toHaveLength(1)
    wrapper.unmount()
  })

  it('zeigt nach vollständiger Rangfolge automatisch das Podium ohne Techniklabels', () => {
    const wrapper = mountRoom(false, automaticLastView())

    expect(wrapper.get('.roundResult__eyebrow').text()).toContain('Runde 1 beendet')
    expect(wrapper.get('.roundResult__title').text()).toBe('Das Podium')
    expect(wrapper.get('.podium__place--1 .podium__name').text()).toBe('Lena')
    expect(wrapper.get('.podium__place--2 .podium__name').text()).toBe('Tom')
    expect(wrapper.get('.podium__place--3 .podium__name').text()).toBe('Mia')
    expect(wrapper.get('.resultList__row').text()).toContain('Sherlock Holmes')
    expect(wrapper.text()).toContain('Warten auf den Host …')
    expect(wrapper.text()).not.toContain('automatisch')
    expect(wrapper.text()).not.toContain('Die Platzierung dieser Runde ist vollständig')
    expect(wrapper.find('.board').exists()).toBe(false)
    wrapper.unmount()
  })

  it('gibt dem Host am Podium direkt die nächste Runde', async () => {
    const wrapper = mountRoom(true, completedHostView())
    const nextRound = wrapper.findAll('button').find((button) => button.text().includes('Nächste Runde'))

    expect(nextRound).toBeDefined()
    expect(wrapper.text()).not.toContain('Warten auf den Host …')
    await nextRound!.trigger('click')
    expect((mocks.room as ReturnType<typeof makeRoom>).endRound).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('verwendet in der Begriffseingabe nur den tatsächlichen Spielernamen', () => {
    const wrapper = mountRoom(true, lobbyView(true))

    expect(wrapper.text()).toContain('Gib einen Begriff für Tom ein.')
    expect(wrapper.text()).not.toContain('Spieler 2')
    wrapper.unmount()
  })

  it('gibt nur dem Host eindeutig benannte Bestätigungs- und Korrekturaktionen', async () => {
    const wrapper = mountRoom(true)
    const approve = wrapper.get('button[aria-label="Erraten von Tom bestätigen"]')
    const reject = wrapper.get('button[aria-label="Meldung von Tom ablehnen"]')

    await approve.trigger('click')
    await reject.trigger('click')
    expect((mocks.room as ReturnType<typeof makeRoom>).approvePlacement).toHaveBeenCalledWith(
      'tom',
      'claim-tom',
    )
    expect((mocks.room as ReturnType<typeof makeRoom>).resetPlacement).toHaveBeenCalledWith(
      'tom',
      'claim-tom',
    )
    expect(wrapper.find('button[aria-label="Platzierung von Mia zurücknehmen"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Platzierung von Noah zurücknehmen"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('führt die bestätigte Korrektur mit der aktuellen Meldungs-ID aus', async () => {
    const wrapper = mountRoom(true)

    await wrapper.get('button[aria-label="Platzierung von Mia zurücknehmen"]').trigger('click')
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(true)
    await wrapper.get('[data-test="dialog"] button.btn--danger').trigger('click')
    await flushPromises()

    expect((mocks.room as ReturnType<typeof makeRoom>).resetPlacement).toHaveBeenCalledWith(
      'mia',
      'claim-mia',
    )
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('kündigt Moderationsänderungen an und setzt den Fokus nach dem letzten Eintrag sicher', async () => {
    const wrapper = mountRoom(true)
    const room = mocks.room as ReturnType<typeof makeRoom>
    expect(wrapper.text()).not.toContain('Albert Einstein')
    expect(wrapper.text()).toContain('Marie Curie')

    room.approvePlacement.mockImplementation(async () => {
      const tom = room.view.board?.find((entry) => entry.playerId === 'tom')
      if (tom) {
        tom.roundState = 'finished'
        tom.placement = 2
      }
      return true
    })

    await wrapper.get('button[aria-label="Erraten von Tom bestätigen"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(
      wrapper
        .findAll('[aria-live="polite"][aria-atomic="true"]')
        .map((region) => region.text())
        .join(' '),
    ).toContain('Erraten von Tom wurde bestätigt')
    expect(wrapper.text()).toContain('Albert Einstein')
    expect(wrapper.find('button[data-term-player="tom"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('h2.sr-only').element)
    wrapper.unmount()
  })

  it('verwirft das Rundenende während einer Aktion nicht still und schließt nur bei Erfolg', async () => {
    const wrapper = mountRoom(true)
    const room = mocks.room as ReturnType<typeof makeRoom>
    const endButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Runde vorzeitig beenden')!

    room.busy = true
    await nextTick()
    expect(endButton.attributes('disabled')).toBeDefined()

    room.busy = false
    room.endRound.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await nextTick()
    await endButton.trigger('click')
    await wrapper.get('[data-test="dialog"] button.btn--danger').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(true)

    await wrapper.get('[data-test="dialog"] button.btn--danger').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('zeigt Nicht-Hosts keine Moderationsaktionen', () => {
    const wrapper = mountRoom(false)

    expect(wrapper.find('[aria-label*="bestätigen"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label*="zurücknehmen"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Wartet auf Bestätigung')
    wrapper.unmount()
  })
})
