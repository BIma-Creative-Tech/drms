import { describe, expect, it } from 'vitest'

import { contrastRatio, ramps, semantic, themeCssVariables } from '@/theme/tokens'

/**
 * Web-starter retheme (src/theme/tokens.ts): WCAG AA contrast (≥ 4.5:1 text, ≥ 3:1 focus ring /
 * UI) for the semantic tokens AND for the Payload variables they end up in (custom.scss mapping +
 * Payload 3.90.1 dark-mode elevation swap: dark elevation-N = base-(900-N) for N ≤ 450, see
 * @payloadcms/ui/dist/scss/colors.scss).
 */
const WHITE = '#FFFFFF'

describe('theme tokens — WCAG contrast', () => {
  for (const mode of ['light', 'dark'] as const) {
    const c = semantic[mode]
    const text: [string, string, string][] = [
      ['foreground/background', c.foreground, c.background],
      ['cardForeground/card', c.cardForeground, c.card],
      ['mutedForeground/background', c.mutedForeground, c.background],
      ['mutedForeground/card', c.mutedForeground, c.card],
      ['mutedForeground/muted', c.mutedForeground, c.muted],
      ['primaryForeground/primary', c.primaryForeground, c.primary],
      ['primaryForeground/primaryHover', c.primaryForeground, c.primaryHover],
      ['primary/background (nav active, links)', c.primary, c.background],
      ['primary/card', c.primary, c.card],
      ['accentForeground/accent (SSO CTA)', c.accentForeground, c.accent],
      ['accentForeground/accentHover', c.accentForeground, c.accentHover],
      ['destructive/background', c.destructive, c.background],
      ['white/ok badge', WHITE, c.ok],
      ['white/warn badge', WHITE, c.warn],
      ['white/bad badge', WHITE, c.bad],
      ['okText/background', c.okText, c.background],
      ['warnText/background', c.warnText, c.background],
      ['badText/background', c.badText, c.background],
      ['okText/card', c.okText, c.card],
      ['warnText/card', c.warnText, c.card],
      ['badText/card', c.badText, c.card],
    ]
    for (const [name, fg, bg] of text) {
      it(`${mode}: ${name} ≥ 4.5`, () => {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
    it(`${mode}: focus ring vs background/card ≥ 3`, () => {
      expect(contrastRatio(c.ring, c.background)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(c.ring, c.card)).toBeGreaterThanOrEqual(3)
    })
  }

  const base = ramps.base
  it('light: Payload input text (elevation-800) and secondary text (elevation-400/500 = base-500) on card/background', () => {
    for (const bg of [semantic.light.card, semantic.light.background]) {
      expect(contrastRatio(base[800]!, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(base[500]!, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('dark: Payload input text (elevation-800 = base-100) and lifted elevation-400/500 (= base-400) on card/background', () => {
    for (const bg of [semantic.dark.card, semantic.dark.background]) {
      expect(contrastRatio(base[100]!, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(base[400]!, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('white on the Payload error pill (--theme-error-500) and current workflow step (success-500)', () => {
    expect(contrastRatio(WHITE, ramps.error[500]!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(WHITE, ramps.blue[500]!)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark elevation ramp lands on the web-starter dark surfaces', () => {
    // dark elevation-0 = base-900, 50 = base-850, 100 = base-800, 200 = base-700
    expect(base[900]).toBe(semantic.dark.background)
    expect(base[850]).toBe(semantic.dark.card)
    expect(base[800]).toBe(semantic.dark.muted)
    expect(base[700]).toBe(semantic.dark.input)
    expect(base[800]).toBe(semantic.light.foreground)
  })
})

describe('themeCssVariables', () => {
  const vars = themeCssVariables()

  it('covers every Payload palette step (base 0–1000, success/blue/error/warning 50–950)', () => {
    for (let s = 0; s <= 1000; s += 50) expect(vars[`--color-base-${s}`]).toBeDefined()
    for (const p of ['success', 'blue', 'error', 'warning']) {
      for (let s = 50; s <= 950; s += 50) expect(vars[`--color-${p}-${s}`]).toBeDefined()
    }
    expect(vars['--pk-light-primary']).toBe('#2563EB')
    expect(vars['--pk-light-accent']).toBe('#EA580C')
    expect(vars['--pk-dark-background']).toBe('#0B1120')
    expect(vars['--pk-radius']).toBe('0.875rem')
  })

  it('only emits static hex colours / the radius (safe for an inline style attribute)', () => {
    for (const [k, v] of Object.entries(vars)) {
      expect(k).toMatch(/^--[a-z0-9-]+$/)
      expect(v).toMatch(/^(#[0-9A-F]{6}|0\.875rem)$/)
    }
  })
})
