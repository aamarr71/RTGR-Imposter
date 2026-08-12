import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RoomBoardEntry } from '@shared/types'
import { WHO_AM_I } from '@shared/config'
import GameBoard from './GameBoard.vue'

function entry(patch: Partial<RoomBoardEntry>): RoomBoardEntry {
  return {
    playerId: 'p1',
    name: 'Lena',
    seat: 1,
    online: true,
    isSelf: false,
    term: 'Taylor Swift',
    roundState: 'active',
    placement: null,
    placementClaimId: null,
    placementAutomatic: false,
    ...patch,
  }
}

describe('GameBoard-Rundenstatus', () => {
  it('zeigt aktive, wartende und bestätigte Spieler als sichtbaren Text', () => {
    const wrapper = mount(GameBoard, {
      props: {
        entries: [
          entry({ playerId: 'p1', name: 'Lena' }),
          entry({ playerId: 'p2', name: 'Tom', seat: 2, roundState: 'pending' }),
          entry({
            playerId: 'p3',
            name: 'Mia',
            seat: 3,
            roundState: 'finished',
            placement: 1,
          }),
          entry({
            playerId: 'p4',
            name: 'Noah',
            seat: 4,
            roundState: 'finished',
            placement: 4,
            placementAutomatic: true,
          }),
        ],
      },
    })

    expect(wrapper.text()).toContain('Noch dabei')
    expect(wrapper.text()).toContain('Bestätigung offen')
    expect(wrapper.text()).toContain('1. Platz')
    expect(wrapper.text()).toContain('4. Platz · automatisch')
    expect(wrapper.findAll('.board__row.is-finished')).toHaveLength(2)
  })

  it('liefert für den eigenen Platz weiterhin nur den Platzhalter statt des Begriffs', () => {
    const wrapper = mount(GameBoard, {
      props: {
        entries: [
          entry({
            isSelf: true,
            term: null,
            roundState: 'finished',
            placement: 2,
          }),
        ],
      },
    })

    expect(wrapper.text()).toContain(WHO_AM_I.ownTermPlaceholder)
    expect(wrapper.text()).not.toContain('Taylor Swift')
    expect(wrapper.get('.board__nameText').classes()).toBeTruthy()
    expect(wrapper.get('.board__row').classes()).toContain('is-finished')
  })
})
