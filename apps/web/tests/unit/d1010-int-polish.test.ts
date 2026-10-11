import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { userNameOf } from '@/domain/user-display-name'
import { PIPELINE_STAGES } from '@/domain/reports/viz'
import { requestStatusLabel } from '@/domain/expense/timeline'
import { REQUEST_STATUSES, STATUS_LABELS, statusLabel } from '@/domain/expense/types'
import { USER_NAME_VIEW } from '@/fields/users'

/** DRMS 10/10 integration — Lead screenshot review (a)–(d), (g). */

const src = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')

type F = { name?: string; type: string; relationTo?: unknown; label?: unknown; fields?: F[]; tabs?: Array<{ fields: F[] }>; access?: unknown; admin?: { hidden?: boolean; readOnly?: boolean; condition?: unknown; components?: { Field?: unknown; Cell?: unknown } } }
const flat = (fs: F[]): F[] => fs.flatMap((f) => [f, ...(f.fields ? flat(f.fields) : []), ...(f.tabs ? f.tabs.flatMap((t) => flat(t.fields)) : [])])

describe('(b) one status wording', () => {
  it('ADR 0021 wording in types.ts; legacy snapshots keep theirs; viz + APK use the same labels', () => {
    expect(STATUS_LABELS.pending_ack).toBe('Menunggu persetujuan PM')
    expect(STATUS_LABELS.pending_approval).toBe('Menunggu persetujuan Direktur')
    expect(statusLabel('reimburse', 'pending_ack')).toBe(STATUS_LABELS.pending_ack)
    expect(requestStatusLabel('reimburse', 'pending_ack', null, null)).toBe(STATUS_LABELS.pending_ack)
    expect(PIPELINE_STAGES.find((s) => s.key === 'ack')?.label).toBe(STATUS_LABELS.pending_ack)
    expect(PIPELINE_STAGES.find((s) => s.key === 'approval')?.label).toBe(STATUS_LABELS.pending_approval)
    // APK fallback labels (apps/mobile request_status.dart) = STATUS_LABELS
    const dart = readFileSync(fileURLToPath(new URL('../../../mobile/lib/features/expense/domain/request_status.dart', import.meta.url)), 'utf8')
    const apk = new Map([...dart.matchAll(/\w+\('([a-z_]+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]))
    for (const s of REQUEST_STATUSES) expect(apk.get(s), s).toBe(STATUS_LABELS[s])
  })
})

describe('(a) user names instead of "Tanpa Judul - ID: n"', () => {
  const fake = (users: Record<number, { name?: string | null; email?: string }>, memberships: Array<{ user: number; company: number; employee: { name: string } | null }>) =>
    ({
      findByID: async ({ id }: { id: number }) => users[id] ?? null,
      find: async ({ where }: { where: { user: { equals: number } } }) => ({ docs: memberships.filter((m) => m.user === where.user.equals) }),
    }) as never
  it('users.name → employee of the document PT → email local part (never the full email)', async () => {
    const p = fake({ 1: { name: 'Budi Santoso', email: 'budi@pt.test' }, 2: { name: '', email: 'sari.w@pt.test' }, 3: { name: null, email: 'x.y@pt.test' } }, [
      { user: 2, company: 5, employee: { name: 'Sari Wulandari' } },
      { user: 3, company: 9, employee: { name: 'Nama PT lain' } },
    ])
    expect(await userNameOf(p, 1, 5)).toBe('Budi Santoso')
    expect(await userNameOf(p, 2, 5)).toBe('Sari Wulandari')
    // another PT's employee name is not shown on a document of PT 5
    expect(await userNameOf(p, 3, 5)).toBe('x.y')
    expect(await userNameOf(p, 3, null)).toBe('Nama PT lain')
    expect(await userNameOf(p, 99, 5)).toBe('Pengguna #99')
  })

  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })

  it('every read-only user relationship renders the name (form + list cell)', () => {
    const misses: string[] = []
    for (const c of config.collections) {
      for (const f of flat(c.fields as F[])) {
        if (f.type !== 'relationship' || f.relationTo !== 'users' || f.admin?.hidden) continue
        if (f.admin?.readOnly !== true) continue // pickers (projects.pm, cost-centers.manager …) list readable users of the PT
        if (f.admin?.components?.Field !== USER_NAME_VIEW.Field || f.admin?.components?.Cell !== USER_NAME_VIEW.Cell) misses.push(`${c.slug}.${f.name}`)
      }
    }
    expect(misses).toEqual([])
  })

  it('request sidebar: no "Level approval berjalan", no "Sumber"; status label + Simpan only while editable', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    const by = (n: string) => flat(er.fields as F[]).find((f) => f.name === n)!
    expect(by('currentLevel').admin?.hidden).toBe(true)
    expect(by('source').admin?.hidden).toBe(true)
    expect(by('createdBy').admin?.components?.Field).toBe(USER_NAME_VIEW.Field)
    const reason = by('changeReason').admin?.condition as (d: unknown, s: unknown, c: unknown) => boolean
    expect([reason({ status: 'draft' }, {}, {}), reason({ id: 1, status: 'draft' }, {}, {}), reason({ id: 1, status: 'receipt_revision' }, {}, {}), reason({ id: 1, status: 'pending_ack' }, {}, {})]).toEqual([false, true, true, false])
    expect(by('status').admin?.components?.Cell).toBe('@/admin/components/RequestStatusCell#RequestStatusCell')
    expect((er.admin.components?.edit as { SaveButton?: unknown } | undefined)?.SaveButton).toBe('@/admin/components/RequestSaveButton#RequestSaveButton')
    // Edit/API tabs: the API tab is off on every collection (web shell)
    expect(config.collections.filter((c) => !c.slug.startsWith('payload-') && c.admin.hideAPIURL !== true).map((c) => c.slug)).toEqual([])
  })
})

describe('(c)/(g) request detail markup', () => {
  it('no nested <form>: dialogs rendered inside Payload’s document form use role="form" (hydration error)', () => {
    for (const f of ['src/admin/components/kas/ReasonAction.tsx', 'src/admin/components/ActionDialog.tsx', 'src/admin/components/RequesterActions.tsx', 'src/admin/components/DecisionBar.tsx', 'src/admin/components/WorkflowPanel.tsx', 'src/admin/components/ReviewDetails.tsx']) {
      expect(/^\s*<form[\s>]/m.test(src(f)), f).toBe(false)
    }
  })
  it('the fixed decision bar reserves its height at the end of the page', () => {
    const s = src('src/admin/components/DecisionBar.tsx')
    expect(s).toContain('body:has([data-pk-decision-bar]) .template-default { padding-bottom: calc(var(--pk-decide-h')
    expect(s).toContain('ResizeObserver')
  })
})
