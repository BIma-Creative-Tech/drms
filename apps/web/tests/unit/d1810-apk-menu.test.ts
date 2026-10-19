import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { menuHref, visibleEntitiesOf } from '@/api/v1/endpoints/me-modules'

/**
 * User 2026-10-18: GET /api/v1/me/modules gives the APK the web launcher's modules. The endpoint feeds loadModules()
 * (same as /admin) with Payload's getAccessResults and visibleEntitiesOf — which must equal @payloadcms/ui
 * getVisibleEntities (3.90.1: hidden fn(user) / boolean; a throwing fn hides) for every restricted panel.
 */
let config: SanitizedConfig

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

function userWith(roles: Role[]) {
  return withCompanyContext({ id: 42, collection: 'users', email: 'uji@contoh.test' }, [{ company: 1, roles, employee: null }], null, false)
}

function uiVisible(user: unknown) {
  const shown = (h: unknown) => {
    if (typeof h !== 'function') return !h
    try {
      return !(h as (a: { user: unknown }) => boolean)({ user })
    } catch {
      return false
    }
  }
  return {
    collections: config.collections.filter((c) => shown(c.admin?.hidden)).map((c) => c.slug),
    globals: config.globals.filter((g) => shown(g.admin?.hidden)).map((g) => g.slug),
  }
}

describe('/me/modules visibleEntitiesOf', () => {
  it.each<[string, Role[]]>([
    ['Staff', ['pk-staff']],
    ['Operator', ['pk-operator']],
    ['PM', ['pk-pm']],
    ['Finance', ['pk-finance']],
    ['Direktur', ['pk-owner']],
    ['Owner', ['pk-principal', 'pk-owner']],
    ['Admin', ['pk-admin']],
  ])('%s: same entities as the web panel', (_label, roles) => {
    const user = userWith(roles)
    const v = visibleEntitiesOf({ payload: { config } as never, user: user as never })
    expect(v).toEqual(uiVisible(user))
  })

  it('Staff-only: the restricted whitelist only (no masters, finance or settings)', () => {
    const v = visibleEntitiesOf({ payload: { config } as never, user: userWith(['pk-staff']) as never })
    expect(v.collections).toContain('expense-requests')
    expect(v.collections).not.toContain('banks')
    expect(v.globals).toEqual([])
  })
})

/** User 2026-10-19: the APK showed every item as "Segera hadir" — hrefs went out with the /admin prefix. */
describe('menuHref (MeModules.href = relative to /admin)', () => {
  it('strips the admin route, keeps everything else', () => {
    expect(menuHref('/admin/absensi/absen')).toBe('/absensi/absen')
    expect(menuHref('/admin/collections/projects')).toBe('/collections/projects')
    expect(menuHref('/admin/globals/company-settings')).toBe('/globals/company-settings')
    expect(menuHref('/admin')).toBe('/')
    expect(menuHref('/administrasi')).toBe('/administrasi')
    expect(menuHref('/absensi/rekap')).toBe('/absensi/rekap')
  })
})
