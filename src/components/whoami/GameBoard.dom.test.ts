import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('zeigt Fortschritt nur dezent an der eigenen Spielerkarte und keine Zwischenplätze', () => {
    const wrapper = mount(GameBoard, {
      props: {
        entries: [
          entry({ playerId: 'p1', name: 'Lena' }),
          entry({ playerId: 'p2', name: 'Tom', seat: 2, isSelf: true, term: null, roundState: 'pending' }),
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

    expect(wrapper.get('.board__progress').text()).toContain('Wartet auf Bestätigung')
    expect(wrapper.findAll('.board__progress')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('1. Platz')
    expect(wrapper.text()).not.toContain('4. Platz')
    expect(wrapper.text()).not.toContain('automatisch')
    expect(wrapper.get('.board__nameText').text()).toBe('Lena')
    expect(wrapper.findAll('.board__nameText').map((name) => name.text())).toEqual([
      'Lena',
      'Tom',
      'Mia',
      'Noah',
    ])
    expect(wrapper.findAll('.board__row.is-finished')).toHaveLength(2)
  })

  it('meldet den eigenen Erfolg an und zeigt einen bestätigten Platz nur kurz', async () => {
    vi.useFakeTimers()
    const active = entry({ isSelf: true, term: null })
    const wrapper = mount(GameBoard, { props: { entries: [active] } })

    await wrapper.get('.board__claim').trigger('click')
    expect(wrapper.emitted('claim')).toHaveLength(1)

    await wrapper.setProps({
      entries: [{ ...active, roundState: 'finished', placement: 2 }],
    })
    expect(wrapper.get('.board__progress').text()).toContain('Platz 2 gesichert')

    await vi.advanceTimersByTimeAsync(2400)
    await nextTick()
    expect(wrapper.get('.board__progress').text()).toContain('Geschafft')
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

  it('liefert während der Spielansicht für den eigenen Platz nur den Platzhalter', () => {
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
    expect(wrapper.get('.board__nameText').text()).toBe('Lena')
    expect(wrapper.get('.board__selfTag').text()).toBe('Du')
    expect(wrapper.text()).not.toContain('automatisch')
    expect(wrapper.get('.board__row').classes()).toContain('is-finished')
  })
})
