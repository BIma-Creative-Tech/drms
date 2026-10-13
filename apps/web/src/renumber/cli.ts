/**
 * ONE-TIME document renumbering CLI (DRMS 13/10 Wave 4, ADR 0007 "Amendment 2026-10-13"). Runs in the MIGRATE image
 * (it contains `src/` and the dependencies) with the OWNER DSN in `DATABASE_URL` / `DATABASE_URL_FILE` — like `payload migrate`, never as
 * the app role. Arguments after `--` (`payload run` drops flags placed before it):
 *
 *   node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --dry-run --all --out /out
 *   node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --apply   --all --out /out --operator "<nama>" --expect-sha256 <sha256 dari dry-run>
 *   node /app/node_modules/payload/bin.js run src/renumber/cli.ts -- --verify  --all --out /out
 *
 * `--company <KODE>` (repeatable / comma-separated) instead of `--all` limits the run to those PTs. Exit codes:
 * 0 ok · 1 errors (plan errors, failed apply, failed verification) · 2 usage · 3 refused: already renumbered ·
 * 4 refused: the plan differs from the reviewed dry-run (`--expect-sha256`). Runbook:
 * docs/proyekkas/runbooks/penomoran-ulang.md. No Payload instance is started (plain `pg` client, one transaction).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import pg from 'pg'

import { readSecret } from '@/lib/env'

import { applyRenumber, dryRun, RenumberRefused, verifyRenumber, type Scope, type TextChange } from './db'
import { planCsv, type RenumberPlan } from './plan'

type Mode = 'dry-run' | 'apply' | 'verify'
const USAGE =
  'Pemakaian: payload run src/renumber/cli.ts -- (--dry-run | --apply | --verify) (--all | --company <KODE>[,<KODE>…]) [--out <folder>] [--operator <nama>] [--expect-sha256 <hex>]\n' +
  '  --apply wajib --operator dan --expect-sha256 (sha256 dari dry-run yang sudah direview).'

function parse(argv: string[]) {
  const out: { modes: Mode[]; all: boolean; codes: string[]; out?: string; operator?: string; sha?: string } = { modes: [], all: false, codes: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} butuh nilai`)
      return v
    }
    if (a === '--') continue
    else if (a === '--dry-run') out.modes.push('dry-run')
    else if (a === '--apply') out.modes.push('apply')
    else if (a === '--verify') out.modes.push('verify')
    else if (a === '--all') out.all = true
    else if (a === '--company') out.codes.push(...next().split(','))
    else if (a === '--out') out.out = next()
    else if (a === '--operator') out.operator = next()
    else if (a === '--expect-sha256') out.sha = next()
    else throw new Error(`argumen tidak dikenal: ${a}`)
  }
  if (out.modes.length !== 1) throw new Error('pilih tepat satu dari --dry-run / --apply / --verify')
  if (out.all === out.codes.length > 0) throw new Error('pilih --all ATAU --company <KODE>')
  if (out.modes[0] === 'apply') {
    if (!out.operator?.trim()) throw new Error('--apply butuh --operator "<nama pelaksana>"')
    if (!out.sha || !/^[0-9a-f]{64}$/i.test(out.sha)) throw new Error('--apply butuh --expect-sha256 <sha256 dari dry-run yang direview>')
  }
  return out
}

function summary(plan: RenumberPlan, text: readonly TextChange[], codes: ReadonlyMap<number, string>): string {
  const lines: string[] = []
  const per = new Map<string, { n: number; changed: number }>()
  for (const i of plan.items) {
    const k = `${codes.get(i.companyId) ?? `#${i.companyId}`} ${i.docType}`
    const v = per.get(k) ?? { n: 0, changed: 0 }
    v.n += 1
    if (i.changed) v.changed += 1
    per.set(k, v)
  }
  lines.push(`Dokumen: ${plan.summary.documents} (berubah ${plan.summary.changed}, tetap ${plan.summary.unchanged}) dalam ${plan.summary.groups} kelompok PT × jenis × periode`)
  for (const [k, v] of [...per].sort()) lines.push(`  ${k.padEnd(28)} ${String(v.n).padStart(6)} dokumen, ${String(v.changed).padStart(6)} berubah`)
  lines.push(`Pola penomoran diperbaiki: ${plan.patternFixes.length}`)
  for (const f of plan.patternFixes) lines.push(`  ${codes.get(f.companyId) ?? `#${f.companyId}`} ${f.docType}: "${f.from.pattern}" → "${f.to.pattern}" (reset ${f.to.resetPolicy}, mulai ${f.to.startAt})`)
  lines.push(`Counter diubah: ${plan.counters.length}; dibiarkan: ${plan.countersKept.length}`)
  const byTable = new Map<string, number>()
  for (const t of text) byTable.set(`${t.table}.${t.column}`, (byTable.get(`${t.table}.${t.column}`) ?? 0) + 1)
  lines.push(`Teks turunan diubah: ${text.length}${byTable.size ? ` (${[...byTable].map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`)
  const sample = plan.items.filter((i) => i.changed).slice(0, 15)
  if (sample.length) {
    lines.push('Contoh (maks. 15):')
    for (const i of sample) lines.push(`  ${i.table} #${i.id}: ${i.oldNo} → ${i.newNo}`)
  }
  for (const w of plan.warnings) lines.push(`PERINGATAN: ${w}`)
  for (const e of plan.errors) lines.push(`ERROR: ${e}`)
  lines.push(`sha256 rencana: ${plan.sha256}`)
  return lines.join('\n')
}

function writeReport(dir: string | undefined, mode: Mode, body: unknown, csv?: string): void {
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const base = path.join(dir, `penomoran-ulang-${mode}-${stamp}`)
  writeFileSync(`${base}.json`, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  if (csv !== undefined) writeFileSync(`${base}.csv`, csv, { mode: 0o600 })
  console.log(`Laporan: ${base}.json${csv !== undefined ? ` + .csv` : ''}`)
}

let opts: ReturnType<typeof parse>
try {
  opts = parse(process.argv.slice(2))
} catch (e) {
  console.error(`${(e as Error).message}\n${USAGE}`)
  process.exit(2)
}

const dsn = readSecret('DATABASE_URL') // DATABASE_URL or DATABASE_URL_FILE (Compose secret), like the app
if (!dsn) {
  console.error('DATABASE_URL / DATABASE_URL_FILE (DSN role owner) wajib diisi')
  process.exit(2)
}
const scope: Scope = opts.all ? { all: true } : { codes: opts.codes }
const mode = opts.modes[0]!
const client = new pg.Client({ connectionString: dsn, application_name: `pk-renumber-${mode}` })
let code = 0
try {
  await client.connect()
  const who = await client.query<{ u: string; d: string }>('SELECT current_user::text AS u, current_database()::text AS d')
  const { u, d } = who.rows[0]!
  console.log(`Penomoran ulang dokumen — mode ${mode}, database ${d} (role ${u}), cakupan ${opts.all ? 'semua PT' : opts.codes.join(', ')}`)
  if (mode !== 'dry-run' && !/_owner$/.test(u)) throw new RenumberRefused(`${mode} harus dengan role <prefix>_owner (sekarang ${u})`, 'not_owner')

  if (mode === 'dry-run') {
    const r = await dryRun(client, scope)
    const codes = new Map(r.companies.map((c) => [c.id, c.shortCode ?? `#${c.id}`]))
    console.log(summary(r.plan, r.text, codes))
    if (r.alreadyApplied.length) console.log(`SUDAH DIJALANKAN untuk: ${r.alreadyApplied.map((a) => `${codes.get(a.companyId)} (${a.finishedAt})`).join(', ')} — apply akan ditolak.`)
    writeReport(opts.out, mode, { mode, database: d, role: u, ...r }, planCsv(r.plan, codes))
    code = r.plan.errors.length > 0 ? 1 : 0
  } else if (mode === 'apply') {
    const r = await applyRenumber(client, { scope, operator: opts.operator!.trim(), expectSha256: opts.sha })
    const codes = new Map(r.companies.map((c) => [c.id, c.shortCode ?? `#${c.id}`]))
    console.log(summary(r.plan, r.text, codes))
    console.log(`TERSIMPAN (satu transaksi, txid ${r.txId}). Verifikasi:`)
    const v = await verifyRenumber(client, scope)
    for (const c of v.checks) console.log(`  [${c.ok ? 'OK' : 'GAGAL'}] ${c.name}: ${c.detail}`)
    writeReport(opts.out, mode, { mode, database: d, role: u, ...r, verify: v }, planCsv(r.plan, codes))
    code = v.ok ? 0 : 1
  } else {
    const v = await verifyRenumber(client, scope)
    for (const c of v.checks) console.log(`  [${c.ok ? 'OK' : 'GAGAL'}] ${c.name}: ${c.detail}`)
    writeReport(opts.out, mode, { mode, database: d, role: u, ...v })
    code = v.ok ? 0 : 1
  }
} catch (err) {
  if (err instanceof RenumberRefused) {
    console.error(`DITOLAK: ${err.message}`)
    code = err.code === 'already_applied' ? 3 : err.code === 'sha_mismatch' ? 4 : 1
  } else {
    console.error(`penomoran ulang gagal (tidak ada perubahan — transaksi dibatalkan): ${(err as Error).message}`)
    code = 1
  }
} finally {
  await client.end().catch(() => undefined)
}
process.exit(code)
