import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'
import SwipeRevealCard from './SwipeRevealCard.vue'

/**
 * Die Swipe-Aufdeckung ist sicherheitsrelevant: der Rolleninhalt darf erst nach
 * einer vollständigen Geste als aufgedeckt gelten, und ein zu kurzer Zug muss
 * folgenlos bleiben.
 */

beforeAll(() => {
  // jsdom kennt Pointer Capture nicht.
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
})

const TRAVEL = 200

function mountCard() {
  return mount(SwipeRevealCard, {
    props: { playerName: 'Lena', distance: TRAVEL },
    slots: { default: '<p class="secret">Impostor</p>' },
  })
}

/**
 * jsdom kann `PointerEvent` nicht mit Koordinaten konstruieren; ein MouseEvent
 * mit passendem Typ löst dieselben Listener aus.
 */
function pointer(type: string, clientY: number): Event {
  const event = new MouseEvent(type, { bubbles: true, clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

async function drag(wrapper: ReturnType<typeof mountCard>, distance: number) {
  const cover = wrapper.get('.reveal__cover').element
  cover.dispatchEvent(pointer('pointerdown', 500))
  cover.dispatchEvent(pointer('pointermove', 500 - distance))
  cover.dispatchEvent(pointer('pointerup', 500 - distance))
  await nextTick()
}

describe('SwipeRevealCard', () => {
  it('zeigt zunächst nur den Namen und hält den Inhalt verdeckt', () => {
    const wrapper = mountCard()
    expect(wrapper.get('.reveal__name').text()).toBe('Lena')
    expect(wrapper.get('.reveal__content').attributes('aria-hidden')).toBe('true')
    expect(wrapper.emitted('revealed')).toBeUndefined()
  })

  it('koppelt die Karte direkt an die Fingerposition', async () => {
    const wrapper = mountCard()
    const cover = wrapper.get('.reveal__cover')
    cover.element.dispatchEvent(pointer('pointerdown', 500))
    cover.element.dispatchEvent(pointer('pointermove', 440))
    await nextTick()
    expect(cover.attributes('style')).toContain('translate3d(0, -60px, 0)')
  })

  it('enthüllt den Inhalt proportional zur Zugdistanz', async () => {
    const wrapper = mountCard()
    const cover = wrapper.get('.reveal__cover')
    cover.element.dispatchEvent(pointer('pointerdown', 500))
    cover.element.dispatchEvent(pointer('pointermove', 500 - TRAVEL / 2))
    await nextTick()
    expect(wrapper.get('.reveal').attributes('style')).toContain('--p: 0.5')
  })

  it('federt bei einem zu kurzen Zug zurück, ohne aufzudecken', async () => {
    const wrapper = mountCard()
    await drag(wrapper, TRAVEL * 0.4)

    expect(wrapper.emitted('revealed')).toBeUndefined()
    expect(wrapper.get('.reveal__cover').attributes('style')).toContain('translate3d(0, 0px, 0)')
    expect(wrapper.get('.reveal__content').attributes('aria-hidden')).toBe('true')
  })

  it('gilt erst bei vollständiger Enthüllung als aufgedeckt', async () => {
    const wrapper = mountCard()
    await drag(wrapper, TRAVEL)

    expect(wrapper.emitted('revealed')).toHaveLength(1)
    expect(wrapper.get('.reveal__content').attributes('aria-hidden')).toBe('false')
    expect(wrapper.get('.reveal__cover').classes()).toContain('is-open')
  })

  it('lässt sich nach dem Aufdecken nicht erneut ziehen', async () => {
    const wrapper = mountCard()
    await drag(wrapper, TRAVEL)
    await drag(wrapper, TRAVEL)
    expect(wrapper.emitted('revealed')).toHaveLength(1)
  })

  it('ist auch per Tastatur bedienbar', async () => {
    const wrapper = mountCard()
    await wrapper.get('.reveal__cover').trigger('keydown.enter')
    expect(wrapper.emitted('revealed')).toHaveLength(1)
  })

  it('bleibt nach einer Viewport-Vergrößerung vollständig aufgedeckt', async () => {
    const originalHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    const wrapper = mount(SwipeRevealCard, { props: { playerName: 'Lena' } })

    try {
      await wrapper.get('.reveal__cover').trigger('keydown.enter')
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
      window.dispatchEvent(new Event('resize'))
      await nextTick()

      expect(wrapper.get('.reveal').attributes('style')).toContain('--p: 1')
    } finally {
      wrapper.unmount()
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
    }
  })
})
