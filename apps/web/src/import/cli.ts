/**
 * Go-live import CLI (E11) — runs in the migrate image like the seed (APP role DSN):
 *   node /app/node_modules/payload/bin.js run src/import/cli.ts -- --dry-run --file /import/data.xlsx [--out /import/out]
 *   node /app/node_modules/payload/bin.js run src/import/cli.ts -- --commit  --file /import/data.xlsx --kc-map /import/kc.csv --out /import/out
 * (`--` is required: `payload run` drops flags placed before it.) Runbook:
 * docs/proyekkas/runbooks/import-data-golive.md. Exit code 0 = ok, 1 = errors in the file/run, 2 = usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import config from '@payload-config'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { getPayload } from 'payload'

import { formatReport, keycloakCsv, keycloakFollowUpCsv } from './report'
import { parseKcMap } from './resolve'
import { runImport, type Mode } from './run'

const USAGE = 'Pemakaian: payload run src/import/cli.ts -- (--dry-run | --commit) --file <data.xlsx> [--kc-map <username,id.csv|json>] [--out <folder>] [--operator <nama>]'

function args(argv: string[]) {
  const out: { mode?: Mode; file?: string; kcMap?: string; out?: string; operator?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} butuh nilai`)
      return v
    }
    if (a === '--') continue
    else if (a === '--dry-run') out.mode = out.mode === 'commit' ? undefined : 'dry-run'
    else if (a === '--commit') out.mode = out.mode === 'dry-run' ? undefined : 'commit'
    else if (a === '--file') out.file = next()
    else if (a === '--kc-map') out.kcMap = next()
    else if (a === '--out') out.out = next()
    else if (a === '--operator') out.operator = next()
    else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  return out
}

let opts: ReturnType<typeof args>
try {
  opts = args(process.argv.slice(2))
  if (!opts.mode || !opts.file) throw new Error('pilih tepat satu dari --dry-run / --commit, dan --file wajib')
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}

let kcMap = new Map<string, string>()
if (opts.kcMap) {
  const parsed = parseKcMap(readFileSync(opts.kcMap, 'utf8'))
  if (parsed.errors.length > 0) {
    console.error(`File pemetaan Keycloak tidak valid:\n  ${parsed.errors.join('\n  ')}`)
    process.exit(2)
  }
  kcMap = parsed.map
}

const payload = await getPayload({ config })
let code = 0
try {
  const who = (await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`SELECT current_user::text AS u, current_database()::text AS d`)) as unknown as { rows: Array<{ u: string; d: string }> }
  const { u, d } = who.rows[0]!
  if (/_owner$/.test(u)) throw new Error(`jalankan dengan role APP (bukan ${u}) — sama seperti seed`)
  console.log(`RR Teams impor go-live — mode ${opts.mode}, database ${d} (role ${u}), file ${path.basename(opts.file!)}`)
  const bytes = new Uint8Array(readFileSync(opts.file!))
  const report = await runImport(payload, { bytes, fileName: path.basename(opts.file!), mode: opts.mode!, kcMap, operator: opts.operator })
  console.log(formatReport(report))
  if (opts.out) {
    mkdirSync(opts.out, { recursive: true })
    const stamp = report.startedAt.replace(/[-:]/g, '').slice(0, 15)
    const base = path.join(opts.out, `impor-${opts.mode}-${stamp}`)
    writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log(`Laporan: ${base}.json`)
    if (report.keycloakUsers.length > 0) {
      writeFileSync(`${base}-keycloak-users.json`, `${JSON.stringify(report.keycloakUsers, null, 2)}\n`, { mode: 0o600 })
      writeFileSync(`${base}-keycloak-users.csv`, keycloakCsv(report.keycloakUsers), { mode: 0o600 })
      console.log(`Pengguna untuk Keycloak (realm drms): ${base}-keycloak-users.{json,csv}`)
    }
    if (report.keycloakFollowUp.length > 0) {
      writeFileSync(`${base}-keycloak-tindak-lanjut.csv`, keycloakFollowUpCsv(report.keycloakFollowUp), { mode: 0o600 })
      console.log(`Langkah Keycloak (disable + logout / enable): ${base}-keycloak-tindak-lanjut.csv`)
    }
  }
  code = report.ok ? 0 : 1
} catch (err) {
  console.error(`impor gagal: ${(err as Error).message}`)
  code = 1
} finally {
  await payload.destroy()
}
process.exit(code)
