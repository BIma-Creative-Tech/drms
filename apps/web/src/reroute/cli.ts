/**
 * d1510 (owner decision 2026-10-15) — READ-ONLY dry-run of migrations 20261015_200000_d1510_approval_reroute (which
 * default rules are aligned and which in-flight requests are re-routed: old → new flow, status, first approver, or
 * kept and why) and 20261015_210000_d1510_approval_inflight_trim (which in-flight requests lose their undecided Finance
 * level, get an Owner level instead, or go "Disetujui"; computed for the state AFTER 200000: the requests it re-routes
 * are left out). Exactly the plans the migrations compute (same code, `./db.ts` planReroute, `./trim-db.ts`
 * planInflightTrim), in ONE read-only transaction that is rolled back — nothing is written. Case 3 ("Disetujui") is
 * listed as such; its fund check (ADR 0029) runs only in the migration. Runs in the MIGRATE image (it contains `src/`) with the DSN in
 * `DATABASE_URL` / `DATABASE_URL_FILE` (owner DSN of the migrate service; any role that may read the tables works):
 *
 *   node /app/node_modules/payload/bin.js run src/reroute/cli.ts -- --dry-run [--out /out]
 *
 * Exit codes: 0 ok · 1 error · 2 usage. `--out`: JSON report `alur-persetujuan-dry-run-<time>.json` (mode 0600; it
 * names requests and people → keep it outside the repo). Runbook: docs/proyekkas/runbooks/alur-persetujuan-2026-10-15.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { PgDialect } from 'drizzle-orm/pg-core'
import pg from 'pg'

import { readSecret } from '@/lib/env'

import { companyCodes, planReroute, type Exec } from './db'
import { planSummary } from './plan'
import { planInflightTrim, reroutedIds } from './trim-db'
import { trimSummary } from './trim-plan'

const USAGE = 'Pemakaian: payload run src/reroute/cli.ts -- --dry-run [--out <folder>]'

function parse(argv: string[]): { out?: string } {
  let dry = false
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue
    else if (a === '--dry-run') dry = true
    else if (a === '--out') {
      out = argv[++i]
      if (!out || out.startsWith('--')) throw new Error('--out butuh folder')
    } else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  if (!dry) throw new Error('hanya --dry-run yang tersedia (perubahan dijalankan oleh migrasi 20261015_200000_d1510_approval_reroute dan 20261015_210000_d1510_approval_inflight_trim)')
  return { out }
}

/** A `pg` client as the drizzle-style executor of `./db.ts`. */
function pgExec(client: pg.Client): Exec {
  const dialect = new PgDialect()
  return {
    execute: async (q) => {
      const x = dialect.sqlToQuery(q as never)
      return client.query(x.sql, x.params as unknown[])
    },
  }
}

let opts: { out?: string }
try {
  opts = parse(process.argv.slice(2))
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}

const dsn = readSecret('DATABASE_URL')
if (!dsn) {
  console.error('DATABASE_URL / DATABASE_URL_FILE wajib diisi')
  process.exit(2)
}
const client = new pg.Client({ connectionString: dsn, application_name: 'pk-d1510-dry-run' })
let code = 0
try {
  await client.connect()
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const who = (await client.query<{ u: string; d: string }>('SELECT current_user::text AS u, current_database()::text AS d')).rows[0]!
  const exec = pgExec(client)
  const plan = await planReroute(exec)
  const codes = await companyCodes(exec)
  console.log(`Alur persetujuan (keputusan owner 2026-10-15) — DRY-RUN, database ${who.d} (role ${who.u}), tidak ada yang diubah`)
  console.log(planSummary(plan, codes))
  const trim = await planInflightTrim(exec, { skip: reroutedIds(plan.requests) })
  console.log(`\nLevel Finance pada pengajuan berjalan (migrasi 20261015_210000, sesudah 20261015_200000):`)
  console.log(trimSummary(trim, codes))
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true })
    const file = path.join(opts.out, `alur-persetujuan-dry-run-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.json`)
    writeFileSync(file, `${JSON.stringify({ database: who.d, role: who.u, at: new Date().toISOString(), ...plan, trim }, null, 2)}\n`, { mode: 0o600 })
    console.log(`Laporan: ${file}`)
  }
} catch (err) {
  console.error(`dry-run gagal: ${(err as Error).message}`)
  code = 1
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end().catch(() => undefined)
}
process.exit(code)
