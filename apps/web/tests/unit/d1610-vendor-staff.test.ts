import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { payeeTypeOptions } from '@/collections/ExpenseRequests'
import { VendorBankAccounts } from '@/collections/VendorBankAccounts'
import { Vendors } from '@/collections/Vendors'
import { INTERCOMPANY_PAYMENT_ROLES, VENDOR_PAYMENT_ROLE_MESSAGE, VENDOR_PAYMENT_ROLES } from '@/domain/expense/drafts'
import { ruleMatches, selectRule, type RuleInput } from '@/domain/expense/rules'
import { DEFAULT_APPROVAL_RULES, DIREKTUR_RULE_NAME, FINANCE_RULE_NAME, INTERCOMPANY_FINANCE_RULE_NAME, OWNER_RULE_NAME, VENDOR_FINANCE_RULE_NAME } from '@/seed/data'

/**
 * Owner request 2026-10-16 ("untuk pengajuan vendor dibukakan di level staff"): Staff (`pk-staff`) may file a
 * "Pembayaran vendor" (ADR 0027) in its own PT — normal Staff approval flow (default rule: PM project → Direktur →
 * Owner → Finance transfer); Staff READ vendors + vendor accounts of its PTs (picker), never create / update them.
 * PT grup (ADR 0028) unchanged.
 */

const seeded = (name: string, id: number): RuleInput => ({ ...(DEFAULT_APPROVAL_RULES.find((x) => x.name === name) as unknown as RuleInput), id })
const DEFAULT_NAME = 'Default — PM project lalu Direktur (semua nominal)'
const rules = [seeded(DEFAULT_NAME, 1), seeded(OWNER_RULE_NAME, 2), seeded(DIREKTUR_RULE_NAME, 3), seeded(FINANCE_RULE_NAME, 4), seeded(VENDOR_FINANCE_RULE_NAME, 5), seeded(INTERCOMPANY_FINANCE_RULE_NAME, 6)]
const vendorFacts = (roles: Role[][], scope: { projectId?: number | null; costCenterId?: number | null }) => ({ type: 'advance' as const, grandTotal: 3_500_000, categoryIds: [], payeeType: 'vendor' as const, requesterRoles: roles, ...scope })

/** A request-like object whose user holds `roles` in PT 1 (plus the `extra` memberships). */
const reqWith = (roles: Role[], extra: Array<{ company: number; roles: Role[] }> = []) =>
  ({ user: withCompanyContext({ id: 31, collection: 'users' }, [{ company: 1, roles, employee: 501 }, ...extra.map((m) => ({ ...m, employee: 502 }))], null, false), context: {} }) as unknown as PayloadRequest

const OPTIONS = [
  { label: 'Karyawan', value: 'karyawan' },
  { label: 'Vendor', value: 'vendor' },
  { label: 'PT grup', value: 'pt_grup' },
]
const offered = (req: PayloadRequest, company = 1) => payeeTypeOptions({ options: OPTIONS, data: { company }, req }).map((o) => (typeof o === 'string' ? o : o.value))

describe('who may file a vendor payment', () => {
  it('Staff, Finance and PM (server rule + 403 sentence); PT grup stays Finance / PM / Direktur', () => {
    expect([...VENDOR_PAYMENT_ROLES].sort()).toEqual(['pk-finance', 'pk-pm', 'pk-staff'])
    expect(VENDOR_PAYMENT_ROLE_MESSAGE).toBe('Pembayaran vendor hanya dapat diajukan oleh Staff, Finance atau PM di PT ini.')
    expect([...INTERCOMPANY_PAYMENT_ROLES].sort()).toEqual(['pk-finance', 'pk-owner', 'pk-pm'])
    for (const r of ['pk-admin', 'pk-owner', 'pk-principal', 'pk-operator'] as const) expect(VENDOR_PAYMENT_ROLES).not.toContain(r)
  })

  it('"Jenis penerima" of the web form: Staff of the form PT sees Vendor (not PT grup); Staff of another PT / Admin / Direktur do not', () => {
    expect(offered(reqWith(['pk-staff']))).toEqual(['karyawan', 'vendor'])
    expect(offered(reqWith(['pk-pm']))).toEqual(['karyawan', 'vendor', 'pt_grup'])
    expect(offered(reqWith(['pk-admin']))).toEqual(['karyawan'])
    expect(offered(reqWith(['pk-owner']))).toEqual(['karyawan', 'pt_grup'])
    // Staff only in PT 2: a form of PT 1 offers no vendor (role IN the form's PT)
    expect(offered(reqWith(['pk-admin'], [{ company: 2, roles: ['pk-staff'] }]), 1)).toEqual(['karyawan'])
    expect(offered(reqWith(['pk-admin'], [{ company: 2, roles: ['pk-staff'] }]), 2)).toEqual(['karyawan', 'vendor'])
  })
})

describe('approval rule of a Staff vendor payment = the normal Staff flow', () => {
  it('project or cost center → the default rule (PM project / cost-center manager "Diketahui" → Direktur → Owner), never the Finance vendor rule', () => {
    const def = seeded(DEFAULT_NAME, 1)
    expect(def).toMatchObject({ acknowledge: 'required', acknowledgeBy: 'scope_manager' })
    expect(def.steps).toEqual([
      { level: 1, approverRole: 'pk-owner' },
      { level: 2, approverRole: 'pk-principal' },
    ])
    expect(selectRule(rules, vendorFacts([['pk-staff']], { projectId: 3 }))?.name).toBe(DEFAULT_NAME)
    expect(selectRule(rules, vendorFacts([['pk-staff']], { projectId: null, costCenterId: 7 }))?.name).toBe(DEFAULT_NAME)
    expect(ruleMatches(seeded(VENDOR_FINANCE_RULE_NAME, 5), vendorFacts([['pk-staff']], { projectId: 3 }))).toBe(false)
    // unchanged: Finance → the Finance vendor rule; a Staff who is also Finance in the PT is a Finance requester
    expect(selectRule(rules, vendorFacts([['pk-finance']], { projectId: 3 }))?.name).toBe(VENDOR_FINANCE_RULE_NAME)
    expect(selectRule(rules, vendorFacts([['pk-staff', 'pk-finance']], { projectId: 3 }))?.name).toBe(VENDOR_FINANCE_RULE_NAME)
    expect(selectRule(rules, vendorFacts([['pk-pm']], { projectId: 3 }))?.name).toBe(DEFAULT_NAME)
  })
})

describe('vendor masters: Staff read (own PTs), never write', () => {
  const read = async (access: unknown, roles: Role[]) => (access as (a: { req: PayloadRequest }) => unknown)({ req: reqWith(roles) })
  it('vendors + vendor accounts: Staff reads the rows of its PT (company filter); create / update refused', async () => {
    for (const c of [Vendors, VendorBankAccounts]) {
      expect(await read(c.access!.read, ['pk-staff']), c.slug).toEqual({ company: { in: [1] } })
      expect(await read(c.access!.create, ['pk-staff']), c.slug).toBe(false)
      expect(await read(c.access!.update, ['pk-staff']), c.slug).toBe(false)
      expect(await read(c.access!.read, ['pk-operator']), c.slug).toBe(false)
    }
  })
})
