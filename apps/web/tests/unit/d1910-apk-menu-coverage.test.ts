import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { itemHref, MODULES } from '@/admin/modules/registry'
import { menuHref } from '@/api/v1/endpoints/me-modules'

/**
 * User 2026-10-19 ("pastikan ini untuk semua, bukan hanya absen"): EVERY web menu item reaches the APK as the href
 * relative to /admin (MeModules.href) — the list below is the APK fixture `test/fixtures/web_menu_hrefs.json`, whose
 * Dart test (d1810_apk_nav_test) checks that each one opens an APK screen. A new web menu item changes this list →
 * this test fails until the fixture (and so the APK map) is updated. `UPDATE_APK_MENU_FIXTURE=1` rewrites it.
 */
const fixture = path.resolve(__dirname, '../../../mobile/test/fixtures/web_menu_hrefs.json')

const allHrefs = (): string[] =>
  [...new Set(MODULES.flatMap((m) => m.sections.flatMap((s) => s.items.map((i) => menuHref(itemHref(i))))))].sort()

describe('APK menu coverage', () => {
  it('every registry href is relative to /admin', () => {
    for (const h of allHrefs()) {
      expect(h.startsWith('/')).toBe(true)
      expect(h.startsWith('/admin/')).toBe(false)
    }
  })

  it('the APK fixture lists exactly the web menu items', () => {
    const want = allHrefs()
    if (process.env.UPDATE_APK_MENU_FIXTURE === '1') writeFileSync(fixture, `${JSON.stringify(want, null, 2)}\n`)
    expect(JSON.parse(readFileSync(fixture, 'utf8'))).toEqual(want)
  })
})
