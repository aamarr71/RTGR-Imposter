import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { storage } from '@/services/storage'
import WhoAmIEntryView from './WhoAmIEntryView.vue'

async function mountEntry(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/wer-bin-ich',
        name: 'whoami-entry',
        component: WhoAmIEntryView,
      },
    ],
  })
  await router.push(path)
  await router.isReady()

  const wrapper = mount(WhoAmIEntryView, {
    global: { plugins: [createPinia(), router] },
  })
  return { router, wrapper }
}

beforeEach(() => storage.clearNamespace())

describe('Wer-bin-ich-Deep-Link', () => {
  it('öffnet für einen gültigen Query-Code direkt das vorausgefüllte Join-Formular', async () => {
    const { wrapper } = await mountEntry('/wer-bin-ich?code=ab-cd23')

    expect((wrapper.get('input[autocomplete="off"]').element as HTMLInputElement).value).toBe(
      'ABCD23',
    )
    expect(wrapper.text()).toContain('Raum beitreten')
    wrapper.unmount()
  })

  it('bleibt bei einem ungültigen Query-Code auf der Auswahl', async () => {
    const { wrapper } = await mountEntry('/wer-bin-ich?code=000000')

    expect(wrapper.find('input[autocomplete="off"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Raum erstellen')
    wrapper.unmount()
  })

  it('übernimmt einen Deep-Link auch in eine bereits gemountete Einstiegsseite', async () => {
    const { router, wrapper } = await mountEntry('/wer-bin-ich')

    await router.push('/wer-bin-ich?code=wx-yz89')
    await nextTick()

    expect((wrapper.get('input[autocomplete="off"]').element as HTMLInputElement).value).toBe(
      'WXYZ89',
    )
    wrapper.unmount()
  })

  it('verwirft den query-gesteuerten Join-Zustand beim Browser-Zurück', async () => {
    const { router, wrapper } = await mountEntry('/wer-bin-ich?code=abcd23')

    await router.push('/wer-bin-ich')
    await nextTick()

    expect(wrapper.find('input[autocomplete="off"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Raum erstellen')
    wrapper.unmount()
  })
})
