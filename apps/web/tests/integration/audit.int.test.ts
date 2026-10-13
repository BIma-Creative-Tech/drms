import type { CollectionSlug, PayloadRequest } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { withSystemTransaction } from '@/lib/system-tx'
import { MASTER_COLLECTIONS } from '@/payload.config'

import { ALL_ROLES, auditRows, companyId, getTestPayload, makeUser, sqlAs, type TestUser } from './helpers'

/**
 * F1 gate: "every master change produces audit rows" — for EVERY master collection: create +
 * update through the Local API with access enforced (overrideAccess:false, a web user), then the
 * audit rows are read back from the DB (same transaction id, actor, field old → new, reason).
 */
let admin: TestUser & { _strategy: string }
const ids: Record<string, number> = {}

type Fixture = { create: () => Record<string, unknown>; update: Record<string, unknown>; field: string }

const fixtures: Record<string, Fixture> = {
  employees: { create: () => ({ code: 'AUD-EMP', name: 'Audit Emp' }), update: { position: 'Mandor' }, field: 'position' },
  banks: { create: () => ({ code: 'AUD-BANK', name: 'Bank Audit' }), update: { name: 'Bank Audit 2' }, field: 'name' },
  'employee-bank-accounts': {
    create: () => ({ employee: ids.employees, bank: ids.banks, accountNo: '1234567', accountHolder: 'Audit Emp' }),
    update: { isDefault: true },
    field: 'isDefault',
  },
  clients: { create: () => ({ name: 'Klien Audit' }), update: { contact: 'Bu Audit' }, field: 'contact' },
  vendors: { create: () => ({ name: 'Vendor Audit' }), update: { npwp: '01.234.567.8-901.000' }, field: 'npwp' },
  // ADR 0025
  'vendor-bank-accounts': {
    create: () => ({ vendor: ids.vendors, bank: ids.banks, accountNo: '7654321', accountHolder: 'Vendor Audit' }),
    update: { isDefault: true },
    field: 'isDefault',
  },
  projects: { create: () => ({ code: 'AUD-PRJ', name: 'Project Audit', client: ids.clients, pm: admin.id }), update: { address: 'Jl. Audit 1' }, field: 'address' },
  'project-stages': { create: () => ({ project: ids.projects, name: 'Pondasi', weightPct: 30, sequence: 1 }), update: { weightPct: 40 }, field: 'weightPct' },
  'stage-templates': {
    create: () => ({ name: 'Tpl Audit', items: [{ name: 'A', weightPct: 100, sequence: 1 }] }),
    update: { items: [{ name: 'A', weightPct: 60, sequence: 1 }, { name: 'B', weightPct: 40, sequence: 2 }] },
    field: 'items',
  },
  uoms: { create: () => ({ code: 'AUD-U', name: 'unit audit' }), update: { name: 'unit audit 2' }, field: 'name' },
  'expense-categories': { create: () => ({ code: 'AUD-CAT', name: 'Kat Audit', allowedUoms: [ids.uoms] }), update: { allowedUoms: [] }, field: 'allowedUoms' },
  'budget-lines': { create: () => ({ project: ids.projects, category: ids['expense-categories'], amount: 1_000_000 }), update: { amount: 1_500_000 }, field: 'amount' },
  'cash-in-sources': { create: () => ({ code: 'AUD-CIS', name: 'CIS Audit' }), update: { name: 'CIS Audit 2' }, field: 'name' },
  'cash-accounts': { create: () => ({ name: 'Kas Audit', kind: 'cash' }), update: { accountHolder: 'PT DRMS' }, field: 'accountHolder' },
  'cost-centers': { create: () => ({ code: 'AUD-CC', name: 'CC Audit' }), update: { name: 'CC Audit 2' }, field: 'name' },
  // ADR 0023
  sites: { create: () => ({ code: 'AUD-SITE', name: 'Site Audit' }), update: { name: 'Site Audit 2' }, field: 'name' },
  'team-assignments': { create: () => ({ employee: ids.employees, project: ids.projects, roleInProject: 'staff' }), update: { roleInProject: 'mandor' }, field: 'roleInProject' },
  'work-schedules': { create: () => ({ name: 'Shift Audit', startTime: '08:00', endTime: '17:00' }), update: { endTime: '16:30' }, field: 'endTime' },
  holidays: { create: () => ({ date: '2026-12-25', name: 'Natal' }), update: { name: 'Hari Natal' }, field: 'name' },
  'approval-rules': {
    create: () => ({ name: 'Rule Audit', minAmount: 0, steps: [{ level: 1, approverRole: 'pk-owner' }] }),
    update: { maxAmount: 5_000_000 },
    field: 'maxAmount',
  },
  'notification-templates': { create: () => ({ event: 'audit.test', title: 'T', body: 'B' }), update: { title: 'T2' }, field: 'title' },
  vehicles: { create: () => ({ plateNo: 'kh 1 au', type: 'Pickup', costCenter: ids['cost-centers'] }), update: { brandModel: 'Toyota' }, field: 'brandModel' },
  'urgency-levels': { create: () => ({ code: 'AUD-URG', name: 'Urgensi Audit', rank: 9 }), update: { name: 'Urgensi Audit 2' }, field: 'name' },
  'document-sequences': {
    create: () => ({ docType: 'reversal', docCode: 'RV', pattern: 'RV/{YY}{MM}/{seq}', resetPolicy: 'monthly', padding: 4, startAt: 1, timezone: 'Asia/Makassar' }),
    update: { pattern: 'RVS/{YY}{MM}/{seq}' },
    field: 'pattern',
  },
}

beforeAll(async () => {
  const u = await makeUser(ALL_ROLES, { label: 'auditor' })
  admin = { ...u, _strategy: 'oidcSession' }
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('every master collection is audited (create + update, same transaction)', () => {
  it('has a fixture for every configured master collection', () => {
    expect(Object.keys(fixtures).sort()).toEqual(MASTER_COLLECTIONS.map((c) => c.slug).sort())
  })

  for (const [slug, fx] of Object.entries(fixtures)) {
    it(`${slug}: create rows + update row (old → new, reason, actor, web source)`, async () => {
      const p = await getTestPayload()
      const created = await p.create({ collection: slug as CollectionSlug, data: fx.create() as never, user: admin, overrideAccess: false, depth: 0 })
      ids[slug] = created.id as number
      const docType = (p.collections[slug as CollectionSlug].config.custom as { pkAudit: { docType: string } }).pkAudit.docType
      const afterCreate = await auditRows(docType, created.id)
      expect(afterCreate.length).toBeGreaterThan(0)
      expect(afterCreate.every((r) => r.action === 'create' && r.source === 'web' && Number(r.user_id) === admin.id)).toBe(true)
      expect(new Set(afterCreate.map((r) => r.tx_id)).size).toBe(1) // one transaction

      await p.update({
        collection: slug as CollectionSlug,
        id: created.id,
        data: { ...fx.update, changeReason: 'uji audit F1' } as never,
        user: admin,
        overrideAccess: false,
        depth: 0,
      })
      const rows = (await auditRows(docType, created.id)).slice(afterCreate.length)
      const row = rows.find((r) => r.field === fx.field)
      expect(row, `update row for ${fx.field}`).toBeDefined()
      expect(row?.action).toBe('update')
      expect(row?.reason).toBe('uji audit F1')
      expect(JSON.stringify(row?.old_value?.v)).not.toBe(JSON.stringify(row?.new_value?.v))
      expect(rows.every((r) => r.tx_id === rows[0]?.tx_id)).toBe(true)
    })
  }

  it('company-settings (global) update is audited', async () => {
    const p = await getTestPayload()
    await p.updateGlobal({ slug: 'company-settings', data: { groupName: 'Grup Uji' }, user: admin, overrideAccess: false })
    const rows = await auditRows('company_settings', 'company-settings')
    const row = rows.find((r) => r.field === 'groupName')
    expect(row?.new_value?.v).toBe('Grup Uji')
  })

  it('company (per-PT settings, ADR 0016 §1) update is audited', async () => {
    const p = await getTestPayload()
    const id = await companyId()
    await p.update({ collection: 'companies', id, data: { lateReportDays: 4 }, user: admin, overrideAccess: false })
    const row = (await auditRows('company', id)).find((r) => r.field === 'lateReportDays')
    expect(row?.new_value?.v).toBe(4)
  })
})

describe('reasons and atomicity', () => {
  it('deactivation without a reason is rejected; with a reason → deactivate row', async () => {
    const p = await getTestPayload()
    await expect(
      p.update({ collection: 'uoms', id: ids.uoms!, data: { active: false }, user: admin, overrideAccess: false }),
    ).rejects.toThrow()
    await p.update({ collection: 'uoms', id: ids.uoms!, data: { active: false, changeReason: 'tidak dipakai lagi' }, user: admin, overrideAccess: false })
    const rows = await auditRows('uom', ids.uoms!)
    const d = rows.find((r) => r.action === 'deactivate')
    expect(d).toMatchObject({ field: 'active', reason: 'tidak dipakai lagi' })
    expect(d?.new_value?.v).toBe(false)
  })

  it('changeReason is virtual (never stored as a column)', async () => {
    const r = await sqlAs('app', "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'change_reason'")
    expect(r.rows[0].n).toBe(0)
  })

  it('a failing transaction leaves neither the change nor its audit rows', async () => {
    const p = await getTestPayload()
    const before = (await auditRows('bank', ids.banks!)).length
    await expect(
      withSystemTransaction(p, admin as never, async (req: PayloadRequest) => {
        await p.update({ collection: 'banks', id: ids.banks!, data: { name: 'SHOULD ROLL BACK' }, req, user: admin, overrideAccess: false })
        throw new Error('boom after write')
      }),
    ).rejects.toThrow('boom after write')
    const bank = await p.findByID({ collection: 'banks', id: ids.banks!, depth: 0, overrideAccess: true /* SYSTEM-READ: assertion */ })
    expect(bank.name).toBe('Bank Audit 2')
    expect((await auditRows('bank', ids.banks!)).length).toBe(before)
  })
})
