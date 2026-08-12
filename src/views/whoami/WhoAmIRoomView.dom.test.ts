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
      term: null,
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

  it('zeigt die gemeinsame Rangliste semantisch und markiert fertige Spieler', () => {
    const wrapper = mountRoom(true)

    expect(wrapper.get('ol.rankingList').text()).toContain('1.')
    expect(wrapper.get('ol.rankingList').text()).toContain('Mia')
    expect(wrapper.findAll('.board__row.is-finished')).toHaveLength(1)
    wrapper.unmount()
  })

  it('erklärt dem letzten Spieler seinen automatisch vergebenen Platz korrekt', () => {
    const wrapper = mountRoom(false, automaticLastView())

    expect(wrapper.get('ol.rankingList').text()).toContain('automatisch')
    expect(wrapper.text()).toContain('erhältst automatisch Platz 4')
    expect(wrapper.findAll('.board__row.is-finished')).toHaveLength(4)
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
    expect(wrapper.text()).toContain('Erraten gemeldet')
    wrapper.unmount()
  })
})
