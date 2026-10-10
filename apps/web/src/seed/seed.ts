import type { CollectionSlug, Payload, PayloadRequest, Where } from 'payload'
import sharp from 'sharp'

import { DEFAULT_URGENCY_LEVELS, SKIP_COMPANY_DEFAULTS } from '@/domain/company-defaults'
import { DEFAULT_RESOURCE_TYPES } from '@/domain/rap/rules'
import { DEFAULT_SEQUENCES } from '@/domain/numbering'
import { normalizePlate } from '@/domain/plates'
import { withSystemTransaction } from '@/lib/system-tx'

import { DEFAULT_APPROVAL_RULES, DEFAULT_SEED_DATA, normalizeSeedData, type CompanySeed, type SeedData } from './data'

export type SeedReport = Record<string, { created: number; existing: number }>

/**
 * Idempotent seed: every record is looked up by its natural key and only created when missing —
 * existing rows (possibly edited by Admin/Finance) are never overwritten. Runs through the Local
 * API as the system actor (audit rows with source=system, same transaction per record).
 * Run: `payload run src/seed/index.ts` with DATABASE_URL = the APP role (not the owner).
 * `data` defaults to the fictional DEFAULT_SEED_DATA; index.ts passes loadSeedData() (SEED_DATA_FILE).
 *
 * ADR 0016: shared masters (UoM, banks) once; everything else PER PT — the old single-company shape
 * seeds company #1 (DRMS), the `companies[]` shape one block per PT (natural keys are looked up
 * INSIDE the PT: two PTs may use the same codes). Every PT gets the default numbering sequences and
 * approval rules (ADR 0007 / 0013 defaults).
 */
export async function seed(payload: Payload, data: SeedData = DEFAULT_SEED_DATA): Promise<SeedReport> {
  const { uoms: UOMS, banks: BANKS, companies } = normalizeSeedData(data)
  const report: SeedReport = {}
  const tally = (k: string, created: boolean) => {
    report[k] ??= { created: 0, existing: 0 }
    report[k][created ? 'created' : 'existing']++
  }
  const ids = new Map<string, number>()

  async function ensure(collection: CollectionSlug, where: Where, data: Record<string, unknown>, key: string) {
    await withSystemTransaction(
      payload,
      null,
      async (req: PayloadRequest) => {
        const found = await payload.find({ collection, where, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: seed */, req })
        let id = found.docs[0]?.id as number | undefined
        if (id === undefined) {
          const doc = await payload.create({ collection, data: data as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: seed */, req })
          id = doc.id as number
          tally(collection, true)
        } else tally(collection, false)
        ids.set(key, id)
      },
      { auditSource: 'system' },
    )
  }

  // ---- shared masters (ADR 0016 D2) ----
  for (const u of UOMS) await ensure('uoms', { code: { equals: u.code } }, { ...u, active: true }, `uom:${u.code}`)
  for (const b of BANKS) await ensure('banks', { code: { equals: b.code } }, { ...b, active: true }, `bank:${b.code}`)

  async function seedCompany(block: CompanySeed, cid: number) {
    const inPt = (w: Where): Where => ({ and: [{ company: { equals: cid } }, w] })
    const k = (s: string) => `${cid}:${s}`
    for (const c of block.categories) {
      await ensure(
        'expense-categories',
        inPt({ code: { equals: c.code } }),
        {
          company: cid,
          code: c.code,
          name: c.name,
          defaultUom: c.defaultUom ? ids.get(`uom:${c.defaultUom}`) : undefined,
          allowedUoms: c.allowed.map((a) => ids.get(`uom:${a}`)).filter((x): x is number => x !== undefined),
          requiresVehicle: c.requiresVehicle ?? false,
          active: true,
        },
        k(`cat:${c.code}`),
      )
    }
    // Owner decision 2026-10-09: default "Tingkat Urgensi" (not part of the seed file schema)
    for (const r of DEFAULT_RESOURCE_TYPES) await ensure('resource-types', inPt({ code: { equals: r.code } }), { ...r, company: cid, active: true }, k(`res:${r.code}`))
    for (const u of DEFAULT_URGENCY_LEVELS) await ensure('urgency-levels', inPt({ code: { equals: u.code } }), { ...u, company: cid, active: true }, k(`urg:${u.code}`))
    for (const s of block.cashInSources) await ensure('cash-in-sources', inPt({ code: { equals: s.code } }), { ...s, company: cid, active: true }, k(`cis:${s.code}`))
    for (const a of block.cashAccounts) await ensure('cash-accounts', inPt({ name: { equals: a.name } }), { ...a, company: cid, openingBalance: 0, active: true }, k(`ca:${a.name}`))
    for (const cc of block.costCenters) await ensure('cost-centers', inPt({ code: { equals: cc.code } }), { ...cc, company: cid, active: true }, k(`cc:${cc.code}`))
    for (const v of block.vehicles) {
      const plate = normalizePlate(v.plateNo)
      // plate numbers stay GLOBALLY unique (one physical vehicle, ADR 0016 §4 / Q-61)
      await ensure('vehicles', { plateNo: { equals: plate } }, { company: cid, plateNo: plate, type: v.type, costCenter: ids.get(k(`cc:${v.costCenter}`)), active: true }, k(`veh:${plate}`))
    }
    for (const e of block.employees) await ensure('employees', inPt({ code: { equals: e.code } }), { ...e, company: cid, active: true }, k(`emp:${e.code}`))
    for (const a of block.employeeBankAccounts) {
      await ensure(
        'employee-bank-accounts',
        inPt({ and: [{ accountNo: { equals: a.accountNo } }, { bank: { equals: ids.get(`bank:${a.bank}`) } }] }),
        {
          employee: ids.get(k(`emp:${a.employee}`)),
          bank: ids.get(`bank:${a.bank}`),
          accountNo: a.accountNo,
          accountHolder: a.accountHolder,
          isDefault: a.isDefault,
          verificationStatus: 'unverified',
          active: true,
        },
        k(`eba:${a.accountNo}`),
      )
    }
    for (const s of DEFAULT_SEQUENCES) {
      await ensure('document-sequences', inPt({ docType: { equals: s.docType } }), { ...s, company: cid, timezone: block.company.timezone, active: true }, k(`seq:${s.docType}`))
    }
    // Approval rules (US-34), ADR 0013 (E1): "Diketahui" = Direktur (pk-owner) approval, then Finance,
    // for every amount (Q-31: no threshold yet); requester/creator never decide (G1, Q-08). The
    // threshold example is seeded INACTIVE (activate once the client names the threshold, O-4).
    for (const r of DEFAULT_APPROVAL_RULES) await ensure('approval-rules', inPt({ name: { equals: r.name } }), { ...r, company: cid }, k(`rule:${r.name}`))
  }

  // ---- per PT ----
  let firstCompanyId: number | undefined
  for (const block of companies) {
    const cid = await ensureCompany(payload, block.company, tally)
    firstCompanyId ??= cid
    await seedCompany(block, cid)
  }

  // Optional first admin (staging bootstrap): links an EXISTING Keycloak user by its `sub`.
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase()
  const sub = process.env.SEED_ADMIN_KEYCLOAK_SUB?.trim()
  if (email && sub && firstCompanyId !== undefined) {
    if (!/^[0-9a-f-]{36}$/i.test(sub)) throw new Error('SEED_ADMIN_KEYCLOAK_SUB must be the Keycloak user id (UUID)')
    const companyId = firstCompanyId
    await withSystemTransaction(
      payload,
      null,
      async (req) => {
        const found = await payload.find({ collection: 'users', where: { keycloakSub: { equals: sub } }, limit: 1, depth: 0, overrideAccess: true /* SYSTEM-READ: seed */, req })
        if (found.docs[0]) return tally('users', false)
        // ADR 0016 §2: bootstrap admin = group admin + Admin membership of company #1.
        const u = await payload.create({
          collection: 'users',
          data: { email, keycloakSub: sub, active: true, groupAdmin: true },
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: bootstrap admin (Keycloak user created by infra)
          context: { skipKeycloakSync: true },
          req,
        })
        await payload.create({
          collection: 'company-memberships',
          data: { user: u.id, company: companyId, roles: ['pk-admin'], active: true },
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: bootstrap admin membership
          req,
        })
        tally('users', true)
      },
      { auditSource: 'system' },
    )
  }
  return report
}

/**
 * The company row of a seed block (by shortCode; company #1 already exists after migration
 * `*_mc1_companies`) + placeholder logo (shapes only: no fonts in the alpine image). Existing values
 * are never overwritten.
 */
async function ensureCompany(payload: Payload, c: CompanySeed['company'], tally: (k: string, created: boolean) => void): Promise<number> {
  let id = 0
  await withSystemTransaction(
    payload,
    null,
    async (req) => {
      const found = await payload.find({ collection: 'companies', where: { shortCode: { equals: c.shortCode } }, limit: 1, depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: seed */, req })
      let doc = found.docs[0] as { id: number; name?: string | null; timezone?: string | null; logo?: unknown } | undefined
      if (!doc) {
        doc = (await payload.create({
          collection: 'companies',
          data: { name: c.name, legalName: c.name, shortCode: c.shortCode, timezone: c.timezone, active: true } as never,
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: seed
          // the seed applies its own built-in defaults per PT (seedCompany), not a copy of DRMS
          context: { [SKIP_COMPANY_DEFAULTS]: true },
          req,
        })) as unknown as { id: number }
        tally('companies', true)
      } else tally('companies', false)
      id = doc.id
      const patch: Record<string, unknown> = {}
      if (!doc.name) patch.name = c.name
      if (!doc.timezone) patch.timezone = c.timezone
      if (!doc.logo) {
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
        await payload.update({ collection: 'companies', id: doc.id, data: patch as never, depth: 0, overrideAccess: true /* SYSTEM-WRITE: seed */, req })
      }
    },
    { auditSource: 'system' },
  )
  return id
}
