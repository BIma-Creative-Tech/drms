import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import sharp from 'sharp'

import { DEFAULT_SEQUENCES } from '@/domain/numbering'
import { normalizePlate } from '@/domain/plates'
import { withSystemTransaction } from '@/lib/system-tx'

import { DEFAULT_APPROVAL_RULES, DEFAULT_SEED_DATA, type SeedData } from './data'

export type SeedReport = Record<string, { created: number; existing: number }>

/**
 * Idempotent seed: every record is looked up by its natural key and only created when missing —
 * existing rows (possibly edited by Admin/Finance) are never overwritten. Runs through the Local
 * API as the system actor (audit rows with source=system, same transaction per record).
 * Run: `payload run src/seed/index.ts` with DATABASE_URL = the APP role (not the owner).
 * `data` defaults to the fictional DEFAULT_SEED_DATA; index.ts passes loadSeedData() (SEED_DATA_FILE).
 */
export async function seed(payload: Payload, data: SeedData = DEFAULT_SEED_DATA): Promise<SeedReport> {
  const {
    company: COMPANY,
    uoms: UOMS,
    categories: CATEGORIES,
    banks: BANKS,
    cashInSources: CASH_IN_SOURCES,
    cashAccounts: CASH_ACCOUNTS,
    costCenters: COST_CENTERS,
    vehicles: VEHICLES,
    employees: EMPLOYEES,
    employeeBankAccounts: EMPLOYEE_BANK_ACCOUNTS,
  } = data
  const report: SeedReport = {}
  const tally = (k: string, created: boolean) => {
    report[k] ??= { created: 0, existing: 0 }
    report[k][created ? 'created' : 'existing']++
  }
  const ids = new Map<string, number>()

  async function ensure(collection: CollectionSlug, where: Where, data: Record<string, unknown>, key: string, extra?: (req: PayloadRequest) => Promise<void>) {
    await withSystemTransaction(
      payload,
      null,
      async (req) => {
        const found = await payload.find({ collection, where, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: seed */, req })
        let id = found.docs[0]?.id as number | undefined
        if (id === undefined) {
          const doc = await payload.create({ collection, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: seed */, req })
          id = doc.id as number
          tally(collection, true)
        } else tally(collection, false)
        ids.set(key, id)
        await extra?.(req)
      },
      { auditSource: 'system' },
    )
  }

  // Company settings (global) + placeholder logo (shapes only: no fonts in the alpine image)
  await withSystemTransaction(
    payload,
    null,
    async (req) => {
      const s = await payload.findGlobal({ slug: 'company-settings', depth: 0, overrideAccess: true /* SYSTEM-READ: seed */, req })
      const patch: Record<string, unknown> = {}
      if (!s.shortCode) patch.shortCode = COMPANY.shortCode
      if (!s.name) patch.name = COMPANY.name
      if (!s.timezone) patch.timezone = COMPANY.timezone
      if (!s.logo) {
        const png = await sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="#ffffff"/><rect x="8" y="8" width="584" height="184" fill="none" stroke="#1f3a5f" stroke-width="8"/><rect x="60" y="60" width="80" height="80" fill="#1f3a5f"/><rect x="170" y="85" width="370" height="30" fill="#9fb3c8"/></svg>`,
          ),
        )
          .png()
          .toBuffer()
        const logo = await payload.create({
          collection: 'media-company',
          data: {},
          file: { data: png, mimetype: 'image/png', name: 'logo-placeholder.png', size: png.length },
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: seed placeholder logo
          req,
        })
        patch.logo = logo.id
        tally('media-company', true)
      } else tally('media-company', false)
      if (Object.keys(patch).length > 0) {
        await payload.updateGlobal({
          slug: 'company-settings',
          data: patch as never,
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: seed
          req,
        })
      }
      tally('company-settings', Object.keys(patch).length > 0)
    },
    { auditSource: 'system' },
  )

  for (const u of UOMS) await ensure('uoms', { code: { equals: u.code } }, { ...u, active: true }, `uom:${u.code}`)
  for (const c of CATEGORIES) {
    await ensure(
      'expense-categories',
      { code: { equals: c.code } },
      {
        code: c.code,
        name: c.name,
        defaultUom: c.defaultUom ? ids.get(`uom:${c.defaultUom}`) : undefined,
        allowedUoms: c.allowed.map((a) => ids.get(`uom:${a}`)).filter((x): x is number => x !== undefined),
        requiresVehicle: c.requiresVehicle ?? false,
        active: true,
      },
      `cat:${c.code}`,
    )
  }
  for (const b of BANKS) await ensure('banks', { code: { equals: b.code } }, { ...b, active: true }, `bank:${b.code}`)
  for (const s of CASH_IN_SOURCES) await ensure('cash-in-sources', { code: { equals: s.code } }, { ...s, active: true }, `cis:${s.code}`)
  for (const a of CASH_ACCOUNTS) await ensure('cash-accounts', { name: { equals: a.name } }, { ...a, openingBalance: 0, active: true }, `ca:${a.name}`)
  for (const cc of COST_CENTERS) await ensure('cost-centers', { code: { equals: cc.code } }, { ...cc, active: true }, `cc:${cc.code}`)
  for (const v of VEHICLES) {
    const plate = normalizePlate(v.plateNo)
    await ensure('vehicles', { plateNo: { equals: plate } }, { plateNo: plate, type: v.type, costCenter: ids.get(`cc:${v.costCenter}`), active: true }, `veh:${plate}`)
  }
  for (const e of EMPLOYEES) await ensure('employees', { code: { equals: e.code } }, { ...e, active: true }, `emp:${e.code}`)
  for (const a of EMPLOYEE_BANK_ACCOUNTS) {
    await ensure(
      'employee-bank-accounts',
      { and: [{ accountNo: { equals: a.accountNo } }, { bank: { equals: ids.get(`bank:${a.bank}`) } }] },
      {
        employee: ids.get(`emp:${a.employee}`),
        bank: ids.get(`bank:${a.bank}`),
        accountNo: a.accountNo,
        accountHolder: a.accountHolder,
        isDefault: a.isDefault,
        verificationStatus: 'unverified',
        active: true,
      },
      `eba:${a.accountNo}`,
    )
  }
  for (const s of DEFAULT_SEQUENCES) {
    await ensure('document-sequences', { docType: { equals: s.docType } }, { ...s, timezone: COMPANY.timezone, active: true }, `seq:${s.docType}`)
  }

  // Approval rules (US-34), ADR 0013 (E1): "Diketahui" = Direktur (pk-owner) approval, then Finance,
  // for every amount (Q-31: no threshold yet); requester/creator never decide (G1, Q-08). The
  // threshold example is seeded INACTIVE (activate once the client names the threshold, O-4).
  for (const r of DEFAULT_APPROVAL_RULES) {
    await ensure('approval-rules', { name: { equals: r.name } }, { ...r }, `rule:${r.name}`)
  }

  // Optional first admin (staging bootstrap): links an EXISTING Keycloak user by its `sub`.
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const sub = process.env.SEED_ADMIN_KEYCLOAK_SUB?.trim()
  if (email && sub) {
    if (!/^[0-9a-f-]{36}$/i.test(sub)) throw new Error('SEED_ADMIN_KEYCLOAK_SUB must be the Keycloak user id (UUID)')
    await withSystemTransaction(
      payload,
      null,
      async (req) => {
        const found = await payload.find({ collection: 'users', where: { keycloakSub: { equals: sub } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: seed */, req })
        if (found.docs[0]) return tally('users', false)
        await payload.create({
          collection: 'users',
          data: { email, keycloakSub: sub, roles: ['pk-admin'], active: true },
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: bootstrap admin (Keycloak user created by infra)
          context: { skipKeycloakSync: true },
          req,
        })
        tally('users', true)
      },
      { auditSource: 'system' },
    )
  }
  return report
}
