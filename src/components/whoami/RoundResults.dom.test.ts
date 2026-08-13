import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { RoomBoardEntry } from '@shared/types'
import RoundResults from './RoundResults.vue'

type RankedEntry = RoomBoardEntry & { placement: number }

function ranked(place: number, name: string, term: string): RankedEntry {
  return {
    playerId: `p${place}`,
    name,
    seat: place,
    online: true,
    isSelf: place === 1,
    term,
    roundState: 'finished',
    placement: place,
    placementClaimId: place === 5 ? null : `claim-${place}`,
    placementAutomatic: place === 5,
  }
}

describe('Rundenabschluss', () => {
  it('zentriert Platz eins auch bei weniger als drei Spielern sinnvoll', () => {
    const wrapper = mount(RoundResults, {
      props: {
        entries: [ranked(1, 'Lena', 'Taylor Swift'), ranked(2, 'Tom', 'Albert Einstein')],
        roundNumber: 3,
        isHost: false,
        busy: false,
      },
    })

    expect(wrapper.get('.roundResult__eyebrow').text()).toContain('Runde 3 beendet')
    expect(wrapper.findAll('.podium__place')).toHaveLength(2)
    expect(wrapper.get('.podium__place--1').classes()).toContain('podium__place--1')
    expect(wrapper.get('.podium__place--2').classes()).toContain('podium__place--2')
    expect(wrapper.find('.podium__place--3').exists()).toBe(false)
    expect(wrapper.find('.roundResult__remaining').exists()).toBe(false)
  })

  it('stellt weitere Spieler reduziert unter dem Dreierpodium dar', () => {
    const wrapper = mount(RoundResults, {
      props: {
        entries: [
          ranked(1, 'A', 'Alpha'),
          ranked(2, 'B', 'Bravo'),
          ranked(3, 'C', 'Charlie'),
          ranked(4, 'D', 'Delta'),
          ranked(5, 'E', 'Echo'),
        ],
        roundNumber: 1,
        isHost: true,
        busy: false,
      },
    })

    expect(wrapper.findAll('.podium__place')).toHaveLength(3)
    expect(wrapper.findAll('.resultList__row')).toHaveLength(2)
    expect(wrapper.get('.resultList').text()).toContain('4.DDelta')
    expect(wrapper.get('.resultList').text()).toContain('5.EEcho')
    expect(wrapper.text()).not.toContain('automatisch')
    expect(wrapper.findAll('[aria-label*="zurücknehmen"]')).toHaveLength(4)
  })
})
