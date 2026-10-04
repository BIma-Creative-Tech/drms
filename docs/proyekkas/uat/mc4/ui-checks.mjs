#!/usr/bin/env node
// MC4 UAT suite — browser checks with Playwright (throwaway container mcr.microsoft.com/playwright:v1.55.0-noble,
// ≤ 2 GiB; the `playwright` package is installed into the container's /tmp, never into the repo). Runbook: README.md.
//   UAT_PLAYWRIGHT=/tmp/pw/node_modules/playwright/index.mjs node ui-checks.mjs
// Logs in through Keycloak with the same HTTP form flow as the API suite (no password is typed into the
// browser, so no screenshot can hold one) and hands the session cookie to Chromium.
// Checks: PT switcher (2 PTs: button + panel / sheet, narrowing, reset; 1 PT: static chip), /admin/akses-pt,
// the company create form with the copy-defaults fields (never saved), the consolidated dashboard + inbox +
// request list with PT chips — at 1440 and 390 px, light and dark. Screenshots: $UAT_OUT/screens (not in git).
// Output: $UAT_OUT/ui-results.{md,json}.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CFG, accounts, guard } from './lib.mjs'

guard()
const { chromium } = await import(process.env.UAT_PLAYWRIGHT ?? 'playwright')
const A = accounts()
const SHOTS = join(CFG.out, 'screens')
mkdirSync(SHOTS, { recursive: true })
const RESULTS = []
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const THEMES = ['light', 'dark']

async function kase(id, title, fn) {
  let status = 'PASS'
  let note = ''
  try {
    const r = await fn()
    if (typeof r === 'string') note = r
  } catch (e) {
    status = e instanceof Warn ? 'WARN' : 'FAIL'
    note = String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 400)
  }
  RESULTS.push({ id, title, status, note })
  console.log(`${status} ${id} ${title}${note ? ` — ${note}` : ''}`)
}
const check = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
async function page(key, vp, theme) {
  await A[key].webLogin()
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, locale: 'id-ID', timezoneId: 'Asia/Makassar' })
  const c = A[key].sessionCookie()
  await ctx.addCookies([
    { ...c, url: CFG.appUrl, httpOnly: true, secure: CFG.https, sameSite: 'Lax' },
    { name: 'payload-theme', value: theme, url: CFG.appUrl, sameSite: 'Lax' },
  ])
  const p = await ctx.newPage()
  p.setDefaultTimeout(20_000)
  return { ctx, p }
}
async function open(p, path, ready) {
  const res = await p.goto(`${CFG.appUrl}${path}`, { waitUntil: 'domcontentloaded' })
  check(res && res.status() < 400, `${path} HTTP ${res?.status()}`)
  await p.waitForSelector(ready, { state: 'attached' })
  await p.waitForLoadState('networkidle').catch(() => {})
  await p.waitForTimeout(400)
}
/** Page-level horizontal overflow (a table scrolling inside its own container is fine) + the culprit. */
async function layoutOk(p) {
  const r = await p.evaluate(() => {
    const iw = window.innerWidth
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true
      }
      return false
    }
    const culprit = [...document.querySelectorAll('body *')].find((e) => e.getBoundingClientRect().right > iw + 1 && getComputedStyle(e).position !== 'fixed' && !clipped(e))
    return { sw: document.documentElement.scrollWidth, iw, theme: document.documentElement.getAttribute('data-theme'), culprit: culprit ? `${culprit.tagName.toLowerCase()}.${String(culprit.className).split(' ')[0]}` : null }
  })
  const px = r.sw - r.iw
  return { overflow: px > 0 ? `${r.sw}px > ${r.iw}px (${r.culprit ?? 'n/a'})` : null, px, theme: r.theme }
}
/** ≤ 4 px of page overflow = WARN (cosmetic, reported as a LOW finding), more = FAIL. */
class Warn extends Error {}
const overflowCheck = (l, where) => {
  if (!l.overflow) return
  if (l.px <= 4) throw new Warn(`${where} overflow ${l.overflow}`)
  throw new Error(`${where} overflow ${l.overflow}`)
}
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false })

// ---------------------------------------------------------------- consolidated views (andi: Finance DRMS + CS1)
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    await kase(`UI-DSH-${vp.name}-${theme}`, `andi dashboard: PT switcher + per-PT breakdown DRMS/CS1 (${vp.name} px, ${theme})`, async () => {
      const { ctx, p } = await page('andi', vp, theme)
      try {
        await open(p, '/admin/dashboard', '[data-pk-pt-switcher]')
        check((await p.getAttribute('[data-pk-pt-switcher]', 'data-pk-pt-switcher')) === 'button', 'switcher is a button for 2 PTs')
        const chips = await p.$$eval('[data-pk-per-pt] [data-pk-company]', (els) => [...new Set(els.map((e) => e.getAttribute('data-pk-company')))])
        check(chips.includes('DRMS') && chips.includes(CFG.ptCode), `per-PT chips ${JSON.stringify(chips)}`)
        const l = await layoutOk(p)
        check(l.theme === theme, `theme ${l.theme}`)
        await shot(p, `dashboard-andi-${vp.name}-${theme}`)
        overflowCheck(l, 'dashboard')
        return `chips ${chips.join(',')}`
      } finally {
        await ctx.close()
      }
    })
    await kase(`UI-INB-${vp.name}-${theme}`, `inbox + request list carry PT chips (${vp.name} px, ${theme})`, async () => {
      const { ctx, p } = await page('rina', vp, theme)
      try {
        await open(p, '/admin/persetujuan', '[data-pk-pt-switcher]')
        const inbox = await p.$$eval('[data-pk-company]', (els) => els.map((e) => e.getAttribute('data-pk-company')))
        await shot(p, `inbox-rina-${vp.name}-${theme}`)
        const l1 = await layoutOk(p)
        await open(p, '/admin/collections/expense-requests', '[data-pk-pt-switcher]')
        await p.waitForSelector('.pk-pt-chip, table', { state: 'attached' })
        const list = await p.$$eval('.pk-pt-chip', (els) => [...new Set(els.map((e) => e.textContent?.trim()))])
        await shot(p, `requests-rina-${vp.name}-${theme}`)
        check(list.includes(CFG.ptCode) && list.includes('DRMS'), `request list chips ${JSON.stringify(list)}`)
        overflowCheck(l1, 'inbox')
        overflowCheck(await layoutOk(p), 'request list')
        return `inbox chips ${[...new Set(inbox)].join(',') || 'none (empty inbox)'}; list ${list.join(',')}`
      } finally {
        await ctx.close()
      }
    })
  }
}

await kase('UI-PT-01', 'PT switcher narrows to CS1 (cookie, reload) and resets to all PTs (1440, light)', async () => {
  const { ctx, p } = await page('andi', VIEWPORTS[0], 'light')
  try {
    await open(p, '/admin/dashboard', '[data-pk-pt-switcher="button"]')
    await p.click('[data-pk-pt-switcher="button"]')
    await p.waitForSelector('.pk-pt__panel')
    const opts = await p.$$eval('.pk-pt__list .pk-pt__code', (els) => els.map((e) => e.textContent?.trim()))
    check(opts.length === 2 && opts.includes('DRMS') && opts.includes(CFG.ptCode), `options ${JSON.stringify(opts)}`)
    await shot(p, 'switcher-open-1440-light')
    // keep CS1 only
    const labels = await p.$$('.pk-pt__list .pk-pt__opt')
    for (const l of labels) {
      const code = (await l.$eval('.pk-pt__code', (e) => e.textContent?.trim()))
      const box = await l.$('input[type="checkbox"]')
      const on = await box.isChecked()
      if ((code === 'DRMS') === on) await box.click()
    }
    await Promise.all([p.waitForLoadState('load'), p.click('[data-pk-pt-apply]')])
    await p.waitForTimeout(1500)
    await open(p, '/admin/dashboard', '[data-pk-pt-switcher="button"]')
    const sel = await p.evaluate(() => fetch('/api/v1/me', { credentials: 'same-origin' }).then((r) => r.json()))
    check(JSON.stringify(sel.activeCompanyIds) === JSON.stringify([sel.companies.find((c) => c.code !== 'DRMS')?.id]), `selection after narrowing ${JSON.stringify(sel.activeCompanyIds)}`)
    const label = (await p.textContent('[data-pk-pt-switcher="button"] .pk-pt__text'))?.trim()
    const chips = await p.$$eval('[data-pk-per-pt] [data-pk-company]', (els) => [...new Set(els.map((e) => e.getAttribute('data-pk-company')))])
    await shot(p, 'switcher-cs1-1440-light')
    check(!chips.includes('DRMS'), `after narrowing still DRMS chips ${JSON.stringify(chips)}`)
    check(label?.includes(CFG.ptCode) && !label.includes('DRMS'), `switcher label after narrowing "${label}"`)
    // reset: "Semua PT saya"
    await p.click('[data-pk-pt-switcher="button"]')
    await p.waitForSelector('.pk-pt__opt--all input')
    if (!(await p.isChecked('.pk-pt__opt--all input'))) await p.click('.pk-pt__opt--all input')
    await Promise.all([p.waitForLoadState('load'), p.click('[data-pk-pt-apply]')])
    await p.waitForTimeout(1500)
    const back = await p.evaluate(() => fetch('/api/v1/me', { credentials: 'same-origin' }).then((r) => r.json()))
    check(back?.activeCompanyIds?.length === 2, 'reset to all PTs')
    return `label after narrowing "${label}"; chips ${chips.join(',')}; reset → activeCompanyIds ${JSON.stringify(back?.activeCompanyIds)}`
  } finally {
    await ctx.close()
  }
})

await kase('UI-PT-02', 'PT switcher at 390 px opens as a sheet (dark)', async () => {
  const { ctx, p } = await page('andi', VIEWPORTS[1], 'dark')
  try {
    await open(p, '/admin/dashboard', '[data-pk-pt-switcher="button"]')
    await p.click('[data-pk-pt-switcher="button"]')
    await p.waitForSelector('.pk-pt__panel')
    const sheet = await p.$('.pk-pt__panel--sheet')
    await shot(p, 'switcher-open-390-dark')
    check(sheet, 'panel is a sheet on a phone')
  } finally {
    await ctx.close()
  }
})

await kase('UI-PT-03', '1-PT user: static PT chip (no switcher), CS1 only', async () => {
  const { ctx, p } = await page('dir', VIEWPORTS[0], 'light')
  try {
    await open(p, '/admin/dashboard', '[data-pk-pt-switcher]')
    check((await p.getAttribute('[data-pk-pt-switcher]', 'data-pk-pt-switcher')) === 'static', 'static chip')
    const t = (await p.textContent('[data-pk-pt-switcher] .pk-pt__text'))?.trim()
    check(t?.includes(CFG.ptCode), `label ${t}`)
    const chips = await p.$$eval('[data-pk-company]', (els) => [...new Set(els.map((e) => e.getAttribute('data-pk-company')))])
    check(!chips.includes('DRMS'), `DRMS chip shown to a CS1-only user ${JSON.stringify(chips)}`)
    await shot(p, 'dashboard-dir-1440-light')
  } finally {
    await ctx.close()
  }
})

// ---------------------------------------------------------------- admin.uji (group admin): role matrix + company form
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    await kase(`UI-AKS-${vp.name}-${theme}`, `/admin/akses-pt role matrix with the CS1 column (${vp.name} px, ${theme})`, async () => {
      const { ctx, p } = await page('admin', vp, theme)
      try {
        await open(p, '/admin/akses-pt', '[data-pk-role-matrix]')
        const cols = await p.$$eval('[data-pk-col]', (els) => els.map((e) => e.getAttribute('data-pk-col')))
        check(cols.includes(CFG.ptCode), `columns ${JSON.stringify(cols)}`)
        const cells = await p.$$eval(`[data-pk-cell$=":${CFG.ptCode}"] [data-pk-role]:checked`, (els) => els.length)
        check(cells >= 1, 'checked role cells in CS1')
        const l = await layoutOk(p)
        await shot(p, `akses-pt-${vp.name}-${theme}`)
        overflowCheck(l, 'akses-pt')
        return `columns ${cols.join(',')}; ${cells} roles in ${CFG.ptCode}`
      } finally {
        await ctx.close()
      }
    })
    await kase(`UI-CO-${vp.name}-${theme}`, `company create form shows "Salin default saat dibuat" + "Salin dari PT" (${vp.name} px, ${theme}; not saved)`, async () => {
      const { ctx, p } = await page('admin', vp, theme)
      try {
        await open(p, '/admin/collections/companies/create', '#field-shortCode')
        await shot(p, `company-create-${vp.name}-${theme}`)
        const visible = async (label) => p.getByText(label, { exact: true }).first().isVisible().catch(() => false)
        check(await visible('Salin default saat dibuat'), 'field "Salin default saat dibuat" is not rendered in the create form (sidebar shows only Aktif + Alasan perubahan)')
        check(await p.isChecked('#field-copyDefaults'), 'copyDefaults ticked by default')
        check(await visible('Salin dari PT'), '"Salin dari PT" visible while ticked')
        await p.click('#field-copyDefaults')
        // Payload 3 re-evaluates admin.condition via a debounced server form-state request → poll up to 5 s
        let hidden = false
        for (let i = 0; i < 25 && !hidden; i++) { await p.waitForTimeout(200); hidden = !(await visible('Salin dari PT')) }
        check(hidden, '"Salin dari PT" hidden when unticked')
        overflowCheck(await layoutOk(p), 'company form')
      } finally {
        await ctx.close() // never submitted
      }
    })
  }
}

await browser.close()
const n = (s) => RESULTS.filter((r) => r.status === s).length
const md = `# MC4 UAT — browser results\n\n- Target: \`${CFG.target}\` ${CFG.appUrl}\n- Run: ${new Date().toISOString()} · screenshots: \`${SHOTS}\`\n- **PASS ${n('PASS')} · WARN ${n('WARN')} · FAIL ${n('FAIL')}** (of ${RESULTS.length}; WARN = ≤ 4 px page overflow at 390 px, cosmetic)\n\n| ID | Check | Result | Note |\n|---|---|---|---|\n${RESULTS.map((r) => `| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${r.status} | ${r.note.replace(/\|/g, '/')} |`).join('\n')}\n`
writeFileSync(join(CFG.out, 'ui-results.md'), md)
writeFileSync(join(CFG.out, 'ui-results.json'), `${JSON.stringify({ target: CFG.target, at: new Date().toISOString(), counts: { pass: n('PASS'), warn: n('WARN'), fail: n('FAIL') }, results: RESULTS }, null, 2)}\n`)
console.log(`\nMC4 UAT UI: PASS ${n('PASS')} · WARN ${n('WARN')} · FAIL ${n('FAIL')} → ${join(CFG.out, 'ui-results.md')}`)
process.exit(n('FAIL') ? 1 : 0)
