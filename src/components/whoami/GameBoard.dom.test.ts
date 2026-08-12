import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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
  it('zeigt aktive, wartende und bestätigte Spieler mit ihrem Status', () => {
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

  it('hält aktive und wartende Begriffe zunächst verdeckt', () => {
    const wrapper = mount(GameBoard, {
      props: {
        entries: [
          entry({ playerId: 'active', name: 'Lena', term: 'Taylor Swift' }),
          entry({
            playerId: 'pending',
            name: 'Tom',
            seat: 2,
            term: 'Albert Einstein',
            roundState: 'pending',
          }),
          entry({
            playerId: 'finished',
            name: 'Mia',
            seat: 3,
            term: 'Marie Curie',
            roundState: 'finished',
            placement: 1,
          }),
        ],
      },
    })

    expect(wrapper.text()).not.toContain('Taylor Swift')
    expect(wrapper.text()).not.toContain('Albert Einstein')
    expect(wrapper.text()).toContain('Marie Curie')
    expect(wrapper.findAll('.board__termToggle')).toHaveLength(2)
    expect(wrapper.find('button[data-term-player="finished"]').exists()).toBe(false)
  })

  it('deckt jeden Begriff unabhängig per Tap auf und wieder zu', async () => {
    const wrapper = mount(GameBoard, {
      props: {
        entries: [
          entry({ playerId: 'lena', name: 'Lena', term: 'Taylor Swift' }),
          entry({ playerId: 'tom', name: 'Tom', seat: 2, term: 'Albert Einstein' }),
        ],
      },
    })

    const lena = wrapper.get('button[data-term-player="lena"]')
    const tom = wrapper.get('button[data-term-player="tom"]')
    expect(lena.attributes('aria-pressed')).toBe('false')
    expect(tom.attributes('aria-pressed')).toBe('false')
    expect(lena.attributes('aria-label')).toBeUndefined()
    expect(lena.text()).toContain('Verdeckt')
    expect(lena.text()).toContain('Begriff von Lena aufdecken')

    await lena.trigger('click')
    expect(wrapper.text()).toContain('Taylor Swift')
    expect(wrapper.text()).not.toContain('Albert Einstein')
    expect(lena.attributes('aria-pressed')).toBe('true')
    // Ohne überschreibendes aria-label bilden der sichtbare Begriff und die
    // versteckte Handlungsbeschreibung gemeinsam den zugänglichen Namen.
    expect(lena.text()).toContain('Taylor Swift')
    expect(lena.text()).toContain('Begriff von Lena wieder verdecken')

    await tom.trigger('click')
    expect(wrapper.text()).toContain('Taylor Swift')
    expect(wrapper.text()).toContain('Albert Einstein')

    await lena.trigger('click')
    expect(wrapper.text()).not.toContain('Taylor Swift')
    expect(wrapper.text()).toContain('Albert Einstein')
  })

  it('erhält Fokus und kündigt einen per Host dauerhaft sichtbaren Begriff an', async () => {
    const active = entry({ playerId: 'lena', name: 'Lena', term: 'Taylor Swift' })
    const wrapper = mount(GameBoard, {
      props: { entries: [active] },
      attachTo: document.body,
    })
    const toggle = wrapper.get('button[data-term-player="lena"]')
    ;(toggle.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(toggle.element)

    await wrapper.setProps({
      entries: [{ ...active, roundState: 'finished', placement: 1 }],
    })
    await flushPromises()
    await nextTick()

    const permanentTerm = wrapper.get('[data-finished-term-player="lena"]')
    expect(document.activeElement).toBe(permanentTerm.element)
    expect(wrapper.get('[data-term-visibility-announcement]').text()).toContain(
      'Begriff von Lena ist jetzt dauerhaft sichtbar: Taylor Swift.',
    )
    wrapper.unmount()
  })

  it('behält lokale Aufdeckungen bei Server-Updates, zeigt bestätigte Begriffe dauerhaft und verdeckt sie nach einem Reset wieder', async () => {
    const active = entry({ playerId: 'p1', term: 'Taylor Swift' })
    const wrapper = mount(GameBoard, { props: { entries: [active] } })

    await wrapper.get('.board__termToggle').trigger('click')
    await wrapper.setProps({ entries: [{ ...active, roundState: 'pending' }] })
    expect(wrapper.text()).toContain('Taylor Swift')

    await wrapper.setProps({
      entries: [{ ...active, roundState: 'finished', placement: 1 }],
    })
    expect(wrapper.text()).toContain('Taylor Swift')
    expect(wrapper.find('.board__termToggle').exists()).toBe(false)

    await wrapper.setProps({ entries: [{ ...active, roundState: 'active', placement: null }] })
    await flushPromises()
    expect(wrapper.text()).not.toContain('Taylor Swift')
    expect(wrapper.get('[data-term-visibility-announcement]').text()).toBe('')
    expect(wrapper.get('.board__termToggle').attributes('aria-pressed')).toBe('false')
  })

  it('startet nach erneutem Mounten wieder mit verdeckten Begriffen', async () => {
    const entries = [entry({ playerId: 'p1', term: 'Taylor Swift' })]
    const first = mount(GameBoard, { props: { entries } })
    await first.get('.board__termToggle').trigger('click')
    expect(first.text()).toContain('Taylor Swift')
    first.unmount()

    const reopened = mount(GameBoard, { props: { entries } })
    expect(reopened.text()).not.toContain('Taylor Swift')
    expect(reopened.get('.board__termToggle').attributes('aria-pressed')).toBe('false')
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
    expect(wrapper.find('.board__termToggle').exists()).toBe(false)
    expect(wrapper.get('.board__nameText').classes()).toBeTruthy()
    expect(wrapper.get('.board__row').classes()).toContain('is-finished')
  })
})
