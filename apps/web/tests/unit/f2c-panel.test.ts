import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { isStaffOnly, PANEL_ROLES } from '@/access/roles'
import { STAFF_VISIBLE_COLLECTIONS } from '@/access/panel-visibility'
import { nextActor, timeline } from '@/domain/expense/timeline'

/** F2c: restricted staff web panel (visibility) + status timeline / next actor (pure). */
let config: SanitizedConfig

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

/** Same rule as @payloadcms/ui getVisibleEntities (3.90.1): hidden fn(user) / boolean. */
function visibleFor(user: unknown) {
  const vis = (h: unknown) => !(typeof h === 'function' ? (h as (a: { user: unknown }) => boolean)({ user }) : h)
  return {
    collections: config.collections.filter((c) => vis(c.admin?.hidden)).map((c) => c.slug),
    globals: config.globals.filter((g) => vis(g.admin?.hidden)).map((g) => g.slug),
  }
}

describe('staff panel visibility', () => {
  it('pk-staff may enter the panel; isStaffOnly only for staff without another role', () => {
    expect(PANEL_ROLES).toContain('pk-staff')
    expect(isStaffOnly({ roles: ['pk-staff'] })).toBe(true)
    expect(isStaffOnly({ roles: ['pk-staff', 'pk-pm'] })).toBe(false)
    expect(isStaffOnly({ roles: ['pk-finance'] })).toBe(false)
    expect(isStaffOnly(null)).toBe(false)
  })

  it('staff-only sees exactly: expense requests, receipts, notifications, own profile (no globals)', () => {
    const v = visibleFor({ id: 1, roles: ['pk-staff'] })
    expect(v.collections.sort()).toEqual([...STAFF_VISIBLE_COLLECTIONS].sort())
    expect(v.globals).toEqual([])
  })

  it('other roles keep the full panel (web-sessions stays admin-only)', () => {
    const pm = visibleFor({ id: 2, roles: ['pk-pm'] })
    expect(pm.collections).toEqual(expect.arrayContaining(['projects', 'expense-requests', 'approval-rules', 'settlements']))
    expect(pm.collections).not.toContain('web-sessions')
    expect(pm.globals).toEqual(['company-settings'])
    expect(visibleFor({ id: 3, roles: ['pk-admin'] }).collections).toContain('web-sessions')
    // staff + pm = PM panel (union of roles, never narrowed by the staff role)
    expect(visibleFor({ id: 4, roles: ['pk-staff', 'pk-pm'] }).collections).toContain('projects')
  })

  it('Users.access.admin admits staff (panel entry) and nobody without a role', async () => {
    const users = config.collections.find((c) => c.slug === 'users')!
    const admin = users.access.admin as (a: unknown) => boolean
    expect(await admin({ req: { user: { id: 1, roles: ['pk-staff'] } } })).toBe(true)
    expect(await admin({ req: { user: { id: 1, roles: [] } } })).toBe(false)
  })

  it('expense-requests edit view has the workflow panel ui field (server component via import map)', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    const f = er.fields.find((x) => 'name' in x && x.name === 'workflowPanel') as { type: string; admin?: { components?: { Field?: unknown } } }
    expect(f.type).toBe('ui')
    expect(f.admin?.components?.Field).toBe('@/admin/components/WorkflowPanel#WorkflowPanel')
  })
})

describe('status timeline + next actor', () => {
  const snap = {
    acknowledge: 'required' as const,
    acknowledgeBy: 'scope_manager' as const,
    acknowledgerUserId: 7,
    acknowledgeRole: null,
    steps: [
      { level: 1, approverRole: 'pk-owner' as const, approverUserId: null },
      { level: 2, approverRole: null, approverUserId: 9 },
    ],
  }
  const names = { 7: 'PM Uji', 9: 'Direktur Uji' }

  it('marks done / current / todo on the happy path', () => {
    const t = timeline('advance', 'transferred')
    expect(t.find((s) => s.state === 'current')?.status).toBe('transferred')
    expect(t.filter((s) => s.state === 'done').map((s) => s.status)).toEqual(['draft', 'pending_ack', 'pending_approval', 'approved'])
    expect(t.at(-1)).toMatchObject({ status: 'completed', state: 'todo' })
    expect(timeline('reimburse', 'draft', { skipAck: true }).map((s) => s.status)).not.toContain('pending_ack')
  })

  it('side statuses (revisions) and terminal branches are shown as current', () => {
    const r = timeline('advance', 'lpj_revision')
    expect(r.find((s) => s.state === 'current')?.status).toBe('lpj_revision')
    expect(r.find((s) => s.status === 'lpj_submitted')?.state).toBe('done')
    expect(timeline('reimburse', 'rejected').at(-1)).toMatchObject({ status: 'rejected', state: 'current' })
  })

  it('names whose turn it is', () => {
    const base = { type: 'advance' as const, currentLevel: null, snapshot: snap, requesters: 'Staff Uji', names }
    expect(nextActor({ ...base, status: 'draft' })?.who).toBe('Pemohon (Staff Uji)')
    expect(nextActor({ ...base, status: 'pending_ack' })?.who).toBe('PM Uji')
    expect(nextActor({ ...base, status: 'pending_approval', currentLevel: 1 })?.who).toBe('Direktur — approval level 1')
    expect(nextActor({ ...base, status: 'pending_approval', currentLevel: 2 })?.who).toBe('Direktur Uji — approval level 2')
    expect(nextActor({ ...base, status: 'approved' })).toMatchObject({ who: 'Finance' })
    expect(nextActor({ ...base, status: 'lpj_revision' })?.what).toMatch(/Kirim ulang LPJ/)
    expect(nextActor({ ...base, type: 'reimburse', status: 'approved' })?.what).toMatch(/verifikasi nota/)
    expect(nextActor({ ...base, status: 'completed' })).toBeNull()
    expect(nextActor({ ...base, status: 'cancelled' })).toBeNull()
  })
})
