import { describe, expect, it } from 'vitest'

import { DEFAULT_SEED_DATA, loadSeedData, normalizeSeedData, SeedDataSchema } from '@/seed/data'

describe('seed data (SEED_DATA_FILE)', () => {
  it('default (fictional) data matches the schema', () => {
    expect(SeedDataSchema.safeParse(DEFAULT_SEED_DATA).success).toBe(true)
    expect(loadSeedData({})).toEqual(DEFAULT_SEED_DATA)
    expect(loadSeedData({ SEED_DATA_FILE: '  ' })).toEqual(DEFAULT_SEED_DATA)
  })

  it('loads and validates a JSON file of the same shape', () => {
    const custom = { ...DEFAULT_SEED_DATA, employees: [...DEFAULT_SEED_DATA.employees, { code: 'EMP-099', name: 'Contoh Karyawan' }] }
    const read = (p: string) => {
      expect(p).toBe('/run/secrets/seed_data')
      return JSON.stringify(custom)
    }
    expect(normalizeSeedData(loadSeedData({ SEED_DATA_FILE: '/run/secrets/seed_data' }, read)).companies[0]!.employees).toHaveLength(DEFAULT_SEED_DATA.employees.length + 1)
  })

  it('rejects unreadable, non-JSON, wrong-shape and dangling references without echoing content', () => {
    const env = { SEED_DATA_FILE: '/x.json' }
    expect(() => loadSeedData(env, () => { throw new Error('ENOENT') })).toThrow(/not readable or not valid JSON/)
    expect(() => loadSeedData(env, () => 'secret-value{')).toThrow(/not readable or not valid JSON/)
    expect(() => loadSeedData(env, () => JSON.stringify({ ...DEFAULT_SEED_DATA, extra: 1 }))).toThrow(/does not match/)
    const badAcc = { ...DEFAULT_SEED_DATA, employeeBankAccounts: [{ employee: 'EMP-404', bank: 'MANDIRI', accountNo: '12AB', accountHolder: 'X', isDefault: true }] }
    let msg = ''
    try {
      loadSeedData(env, () => JSON.stringify(badAcc))
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toMatch(/employeeBankAccounts\.0\.accountNo/)
    expect(msg).toMatch(/employeeBankAccounts\.0\.employee: unknown employee code/)
    expect(msg).not.toMatch(/12AB/)
    const badVeh = { ...DEFAULT_SEED_DATA, vehicles: [{ plateNo: 'DA 1 A', type: 'Hilux', costCenter: 'NOPE' }] }
    expect(() => loadSeedData(env, () => JSON.stringify(badVeh))).toThrow(/vehicles\.0\.costCenter/)
  })

  it('ADR 0016: the old single-company shape normalises to company #1; the companies[] shape seeds several PTs', () => {
    const one = normalizeSeedData(DEFAULT_SEED_DATA)
    expect(one.companies).toHaveLength(1)
    expect(one.companies[0]!.company.shortCode).toBe('DRMS')
    expect(one.uoms).toBe(DEFAULT_SEED_DATA.uoms)
    const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
    const multi = {
      uoms,
      banks,
      companies: [drms, { ...drms, company: { name: 'PT Contoh Satu', shortCode: 'CS1', timezone: 'Asia/Makassar' }, vehicles: [] }],
    }
    const env = { SEED_DATA_FILE: '/x.json' }
    const parsed = normalizeSeedData(loadSeedData(env, () => JSON.stringify(multi)))
    expect(parsed.companies.map((c) => c.company.shortCode)).toEqual(['DRMS', 'CS1'])
    // references resolve per PT; duplicate short codes and dangling refs are named by path
    const dup = { ...multi, companies: [drms, drms] }
    expect(() => loadSeedData(env, () => JSON.stringify(dup))).toThrow(/companies\.1\.company\.shortCode: duplicate shortCode/)
    const dangling = { ...multi, companies: [{ ...drms, vehicles: [{ plateNo: 'DA 1 A', type: 'Hilux', costCenter: 'NOPE' }] }] }
    expect(() => loadSeedData(env, () => JSON.stringify(dangling))).toThrow(/companies\.0\.vehicles\.0\.costCenter/)
  })
})
