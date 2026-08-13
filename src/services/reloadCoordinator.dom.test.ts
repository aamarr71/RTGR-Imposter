import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  requestDocumentReload,
  resetDocumentReloadForTest,
} from './reloadCoordinator'

describe('gemeinsame Reload-Sicherung', () => {
  beforeEach(() => resetDocumentReloadForTest())

  it('lässt PWA-Update und Chunk-Recovery zusammen nur einen Reload auslösen', () => {
    const reload = vi.fn()

    expect(requestDocumentReload(reload)).toBe(true)
    expect(requestDocumentReload(reload)).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
  })
})
