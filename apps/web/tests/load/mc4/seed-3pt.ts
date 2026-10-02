/**
 * MC4 QA — LOCAL THROWAWAY perf DB only (docs/proyekkas/qa/mc4-qa-report.md §Perf): masters of three
 * fictional PTs (DRMS defaults copied to "PT Contoh Satu" CS1 / "PT Contoh Dua" CS2), all active, sync
 * flags on. Bulk users / employees / history come from `bulk-3pt.sql`.
 * Run: DATABASE_URL=<app role of pk_perf*> npx payload run tests/load/mc4/seed-3pt.ts
 * Refuses any database whose name does not start with `pk_perf`.
 */
import config from '@payload-config'
import { getPayload } from 'payload'

import { DEFAULT_SEED_DATA } from '@/seed/data'
import { seed } from '@/seed/seed'

const db = new URL(process.env.DATABASE_URL ?? 'postgres://x/none').pathname.slice(1)
if (!/^pk_perf[a-z0-9_]*$/.test(db)) throw new Error(`refusing to seed non-perf database "${db}"`)

const payload = await getPayload({ config })
const { uoms, banks, ...drms } = DEFAULT_SEED_DATA
await seed(payload, {
  uoms,
  banks,
  companies: [
    drms,
    { ...drms, company: { name: 'PT Contoh Satu', shortCode: 'CS1', timezone: 'Asia/Makassar' }, vehicles: [] },
    { ...drms, company: { name: 'PT Contoh Dua', shortCode: 'CS2', timezone: 'Asia/Makassar' }, vehicles: [] },
  ],
})
const all = await payload.find({ collection: 'companies', depth: 0, pagination: false, overrideAccess: true /* SYSTEM-READ: perf fixture */ })
for (const c of all.docs) {
  await payload.update({
    collection: 'companies',
    id: c.id,
    data: { active: true, syncAttendanceEnabled: true, syncProgressReportsEnabled: true, syncExpenseDraftsEnabled: true, changeReason: 'perf fixture' } as never,
    overrideAccess: true, // SYSTEM-WRITE: perf fixture
  })
}
payload.logger.warn({ msg: 'perf seed done', companies: all.docs.map((c) => `${c.id}:${(c as { shortCode?: string }).shortCode}`) })
await payload.destroy()
process.exit(0)
