import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RoomPlayerView } from '@shared/types'
import SeatingList from './SeatingList.vue'

function player(id: string, name: string, seat: number, isHost = false): RoomPlayerView {
  return {
    id,
    name,
    seat,
    isHost,
    online: true,
    hasSubmittedTerm: true,
    roundState: 'active',
    placement: null,
    placementClaimId: null,
    placementAutomatic: false,
  }
}

describe('Lobby-Sitzliste', () => {
  it('zeigt auch für Nicht-Hosts jeden Namen und ergänzt Du nur als Kennzeichnung', () => {
    const wrapper = mount(SeatingList, {
      props: {
        players: [player('lena', 'Lena', 1, true), player('tom', 'Tom', 2)],
        youId: 'tom',
        canEdit: false,
        showSubmissionState: true,
      },
    })

    expect(wrapper.findAll('.seat__nameText').map((name) => name.text())).toEqual(['Lena', 'Tom'])
    expect(wrapper.get('.seat.is-you .seat__nameText').text()).toBe('Tom')
    expect(wrapper.get('.seat.is-you .seat__tag').text()).toBe('Du')
    expect(wrapper.find('.seat.is-editable').exists()).toBe(false)
    expect(wrapper.findAll('.seat__host')).toHaveLength(1)
    expect(wrapper.findAll('.seat__conn')).toHaveLength(2)
  })

  it('behält die Namen auch im editierbaren Host-Raster', () => {
    const wrapper = mount(SeatingList, {
      props: {
        players: [player('lena', 'Lena', 1, true), player('tom', 'Tom', 2)],
        youId: 'lena',
        canEdit: true,
        showSubmissionState: true,
      },
    })

    expect(wrapper.findAll('.seat.is-editable')).toHaveLength(2)
    expect(wrapper.findAll('.seat__nameText').map((name) => name.text())).toEqual(['Lena', 'Tom'])
  })
})
