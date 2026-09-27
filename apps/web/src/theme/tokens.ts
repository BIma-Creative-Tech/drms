/**
 * DRMS admin visual system = web-starter design system (bctech-adm/web-starter v0.1.0,
 * docs/design.md + src/config/brand.ts): trust blue #2563EB, CTA orange #EA580C, slate surfaces,
 * Space Grotesk / DM Sans, radius 0.875rem. Only the look changes; DRMS keeps its own name.
 *
 * Single source of truth for colours. `themeCssVariables()` renders them as CSS custom properties
 * on <html> (RootLayout `htmlProps.style`, allowed by the CSP `style-src 'unsafe-inline'`), and
 * `(payload)/custom.scss` maps them onto Payload's `--theme-*` variables inside `@layer payload`.
 * No component reads a raw hex value. Contrast pairs are checked by tests/unit/theme.test.ts.
 *
 * Pure data (no next/font import) so the unit test and the worker never load the font loader.
 */

/** Semantic tokens — identical values to web-starter brand.colors (light = skill output, dark = manual). */
export type SemanticTokens = {
  background: string
  foreground: string
  card: string
  cardForeground: string
  primary: string
  primaryHover: string
  primaryForeground: string
  accent: string
  accentHover: string
  accentForeground: string
  muted: string
  mutedForeground: string
  border: string
  input: string
  ring: string
  destructive: string
  /** Filled status badges (white text) and outlined status text on the page background. */
  ok: string
  warn: string
  bad: string
  okText: string
  warnText: string
  badText: string
}

export const semantic: { light: SemanticTokens; dark: SemanticTokens } = {
  light: {
    background: '#F8FAFC',
    foreground: '#1E293B',
    card: '#FFFFFF',
    cardForeground: '#1E293B',
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    primaryForeground: '#FFFFFF',
    accent: '#EA580C',
    accentHover: '#F97316',
    accentForeground: '#000000',
    muted: '#E9EFF8',
    mutedForeground: '#475569',
    border: '#E2E8F0',
    input: '#CBD5E1',
    ring: '#2563EB',
    destructive: '#DC2626',
    ok: '#15803D',
    warn: '#C2410C',
    bad: '#B91C1C',
    okText: '#15803D',
    warnText: '#C2410C',
    badText: '#B91C1C',
  },
  dark: {
    background: '#0B1120',
    foreground: '#E2E8F0',
    card: '#111A2E',
    cardForeground: '#E2E8F0',
    primary: '#60A5FA',
    primaryHover: '#93C5FD',
    primaryForeground: '#0B1120',
    accent: '#FB923C',
    accentHover: '#FDBA74',
    accentForeground: '#0B1120',
    muted: '#1E293B',
    mutedForeground: '#94A3B8',
    border: '#1E293B',
    input: '#334155',
    ring: '#60A5FA',
    destructive: '#F87171',
    ok: '#15803D',
    warn: '#C2410C',
    bad: '#B91C1C',
    okText: '#4ADE80',
    warnText: '#FB923C',
    badText: '#F87171',
  },
}

/** Payload palette steps (@payloadcms/ui 3.90.1 scss/colors.scss: 0–1000 for base, 50–950 otherwise). */
const STEPS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950] as const

function ramp(values: readonly string[]): Record<number, string> {
  if (values.length !== STEPS.length) throw new Error(`ramp needs ${STEPS.length} values`)
  return Object.fromEntries(STEPS.map((s, i) => [s, values[i]!]))
}

/**
 * Colour ramps replacing Payload's `--color-*` palettes. Payload swaps the ramp order itself in
 * dark mode (html[data-theme='dark'] elevation mapping), so one ramp serves both modes.
 * - base = Tailwind slate, stretched so that dark elevation-0/50/100/200 land on the web-starter
 *   dark background/card/muted/input and light elevation-800 on the foreground.
 * - success/blue = Tailwind blue (step 500 = trust blue #2563EB, Payload's "brand" hue).
 * - error = Tailwind red (500 = #DC2626), warning = Tailwind orange (500 = CTA orange #EA580C).
 */
export const ramps = {
  base: {
    0: '#FFFFFF',
    ...ramp([
      '#F8FAFC', '#F1F5F9', '#E2E8F0', '#CBD5E1', '#BCC6D3', '#A9B5C6', '#94A3B8', '#8494A9', '#74839A', '#64748B',
      '#56657A', '#475569', '#3E4C60', '#334155', '#253247', '#1E293B', '#111A2E', '#0B1120', '#070B16',
    ]),
    1000: '#020617',
  } as Record<number, string>,
  blue: ramp([
    '#EFF6FF', '#DBEAFE', '#CDE2FD', '#BFDBFE', '#A9D0FE', '#93C5FD', '#7AB5FB', '#60A5FA', '#3B82F6', '#2563EB',
    '#1F58E1', '#1D4ED8', '#1E47C0', '#1E40AF', '#1E3D9C', '#1E3A8A', '#1B3170', '#172554', '#111C3D',
  ]),
  error: ramp([
    '#FEF2F2', '#FEE2E2', '#FED6D6', '#FECACA', '#FDB8B8', '#FCA5A5', '#FA8B8B', '#F87171', '#EF4444', '#DC2626',
    '#CA2020', '#B91C1C', '#A91B1B', '#991B1B', '#8C1C1C', '#7F1D1D', '#621414', '#450A0A', '#2C0707',
  ]),
  warning: ramp([
    '#FFF7ED', '#FFEDD5', '#FEE2C0', '#FED7AA', '#FEC98F', '#FDBA74', '#FCA658', '#FB923C', '#F97316', '#EA580C',
    '#D64D0E', '#C2410C', '#AE3A0E', '#9A3412', '#8B3011', '#7C2D12', '#60210D', '#431407', '#2B0D05',
  ]),
}

/** Base radius (web-starter brand.radius); Payload's s/m/l are derived like web-starter sm/md/lg. */
export const radius = '0.875rem'

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** CSS custom properties for <html style>. Values are static literals from this file (no user input). */
export function themeCssVariables(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [step, v] of Object.entries(ramps.base)) vars[`--color-base-${step}`] = v
  for (const [step, v] of Object.entries(ramps.blue)) {
    vars[`--color-success-${step}`] = v
    vars[`--color-blue-${step}`] = v
  }
  for (const [step, v] of Object.entries(ramps.error)) vars[`--color-error-${step}`] = v
  for (const [step, v] of Object.entries(ramps.warning)) vars[`--color-warning-${step}`] = v
  for (const mode of ['light', 'dark'] as const) {
    for (const [k, v] of Object.entries(semantic[mode])) vars[`--pk-${mode}-${kebab(k)}`] = v
  }
  vars['--pk-radius'] = radius
  return vars
}

/** WCAG 2.x relative luminance / contrast ratio (used by the unit test). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace('#', '')
    const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
