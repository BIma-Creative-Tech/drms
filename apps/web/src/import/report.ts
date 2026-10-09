/** Human-readable report + Keycloak CSV of the go-live import (E11). Pure. */
import type { ImportReport, KeycloakFollowUpRow, KeycloakUserRow } from './run'

const ROLE_NAMES: Record<string, string> = { 'pk-owner': 'Direktur', 'pk-finance': 'Finance', 'pk-pm': 'PM', 'pk-staff': 'Staff', 'pk-admin': 'Admin' }

export function formatReport(r: ImportReport): string {
  const out: string[] = []
  const errors = r.issues.filter((i) => i.level === 'error')
  const warnings = r.issues.filter((i) => i.level === 'warning')
  const status = !r.ok ? 'GAGAL' : r.mode === 'dry-run' ? 'LULUS (dry-run: tidak ada yang disimpan)' : r.committed ? 'TERSIMPAN' : 'TIDAK DISIMPAN'
  out.push(`Hasil: ${status} — ${errors.length} error, ${warnings.length} peringatan · sha256 ${r.sha256.slice(0, 12)} · run ${r.runId}`)
  if (r.masters.length > 0) {
    out.push('', 'Sheet          baris  baru  ubah  sama  lewati')
    for (const m of r.masters) {
      out.push(`${m.sheet.padEnd(14)} ${String(m.rows).padStart(5)} ${String(m.created).padStart(5)} ${String(m.updated).padStart(5)} ${String(m.unchanged).padStart(5)} ${String(m.skipped).padStart(7)}`)
    }
  }
  // MC2-5: one cut-over line per PT
  const cutovers = r.cutovers?.length ? r.cutovers : r.cutover ? [r.cutover] : []
  if (cutovers.length > 0) out.push('')
  for (const c of cutovers) {
    out.push(`Cut-over PT ${c.pt}: go-live ${c.goLiveDate} · PB mulai ${c.pbStartAt} (counter ${c.pbCounterBefore ?? 'belum ada'} → ${c.pbCounterAfter ?? 'belum ada'}) · PB pertama: ${c.firstPbNumber ?? '-'} · ${c.closeNote}`)
  }
  const line = (i: ImportReport['issues'][number]) => `  [${i.sheet}${i.row ? ` baris ${i.row}` : ''}${i.column ? ` kolom ${i.column}` : ''}] ${i.message}`
  if (errors.length > 0) out.push('', 'ERROR:', ...errors.map(line))
  if (warnings.length > 0) out.push('', 'PERINGATAN:', ...warnings.map(line))
  if (r.keycloakUsers.length > 0) out.push('', `Akun Keycloak yang perlu dibuat Lead (realm drms): ${r.keycloakUsers.length} — ${r.keycloakUsers.map((u) => u.username).join(', ')}`)
  out.push(...keycloakFollowUpLines(r))
  return out.join('\n')
}

/**
 * E9 B-2: ONE summary warning for the users this run (de)activated — the import never calls
 * Keycloak, so their Keycloak account stays enabled/disabled and their SSO/offline sessions stay
 * alive until the operator runs the Keycloak step of the runbook (import-data-golive §Keycloak).
 */
export function keycloakFollowUpLines(r: Pick<ImportReport, 'mode' | 'committed' | 'keycloakFollowUp'>): string[] {
  const rows = r.keycloakFollowUp ?? []
  if (rows.length === 0) return []
  const off = rows.filter((x) => x.action === 'disable_logout').map((x) => x.username)
  const on = rows.filter((x) => x.action === 'enable').map((x) => x.username)
  const done = r.mode === 'commit' && r.committed
  const verb = done ? 'dinonaktifkan' : 'akan dinonaktifkan'
  const out = ['', `PERINGATAN KEYCLOAK (realm drms) — impor TIDAK mengubah Keycloak; perangkat & sesi web RR Teams sudah dicabut, tetapi akun & sesi Keycloak belum:`]
  if (off.length > 0) out.push(`  ${off.length} pengguna ${verb} → WAJIB disable + logout di Keycloak (runbook import-data-golive §Langkah Keycloak): ${off.join(', ')}`)
  if (on.length > 0) out.push(`  ${on.length} pengguna ${done ? 'diaktifkan kembali' : 'akan diaktifkan kembali'} → enable di Keycloak bila akunnya nonaktif: ${on.join(', ')}`)
  return out
}

/** username,email,keycloakId,action — input of the runbook's kc_* loop (no secrets). */
export function keycloakFollowUpCsv(rows: KeycloakFollowUpRow[]): string {
  const head = 'username,email,keycloakId,action'
  const body = rows.map((u) => [u.username, u.email, u.keycloakSub ?? '', u.action].map(csvCell).join(','))
  return `${[head, ...body].join('\n')}\n`
}

function csvCell(v: string): string {
  // formula-injection guard (CSV opened in Excel) + quoting
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** username,email,firstName,enabled,realmRoles,roleLabels,employeeCode — no passwords. */
export function keycloakCsv(rows: KeycloakUserRow[]): string {
  const head = 'username,email,firstName,enabled,realmRoles,roleLabels,employeeCode'
  const body = rows.map((u) =>
    [u.username, u.email, u.firstName, String(u.enabled), u.realmRoles.join(' '), u.realmRoles.map((x) => ROLE_NAMES[x] ?? x).join(' '), u.employeeCode].map(csvCell).join(','),
  )
  return `${[head, ...body].join('\n')}\n`
}
