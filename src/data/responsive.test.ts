/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const baseCss = readFileSync(new URL('../styles/base.css', import.meta.url), 'utf8')
const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../components/ui/AppDialog.vue', import.meta.url), 'utf8')

describe('global responsive layout contract', () => {
  it('configures a device-width viewport without disabling user zoom', () => {
    const viewport = /<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i.exec(indexHtml)?.[1]

    expect(viewport).toBeDefined()
    expect(viewport).toContain('width=device-width')
    expect(viewport).toContain('initial-scale=1')
    expect(viewport).toContain('viewport-fit=cover')
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/i)
  })

  it('orders legacy, small and dynamic viewport-height fallbacks correctly', () => {
    const legacy = baseCss.indexOf('min-height: 100vh')
    const small = baseCss.indexOf('min-height: 100svh')
    const dynamic = baseCss.indexOf('min-height: 100dvh')

    expect(legacy).toBeGreaterThan(-1)
    expect(small).toBeGreaterThan(legacy)
    expect(dynamic).toBeGreaterThan(small)
  })

  it('keeps every safe area in the shared page layout', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(tokensCss).toContain(`env(safe-area-inset-${side}, 0px)`)
      expect(baseCss).toContain(`var(--safe-${side})`)
    }
  })

  it('uses fluid mobile tokens and avoids viewport-width containers', () => {
    expect(tokensCss).toContain('--page-inline: clamp(')
    expect(tokensCss).toContain('--fs-4xl: clamp(')
    expect(tokensCss).toContain('@media (max-height: 520px)')
    expect(baseCss).toContain('@media (min-width: 600px) and (min-height: 600px)')
    expect(`${baseCss}\n${dialogSource}`).not.toMatch(/\b100vw\b/)
    expect(dialogSource).toContain('inset-inline-start: max(var(--safe-left)')
    expect(dialogSource).toContain('inset-inline-end: max(var(--safe-right)')
  })
})
