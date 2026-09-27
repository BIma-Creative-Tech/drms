import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRole, ROLE_LABELS } from '@/access/roles'
import { writeAudit } from '@/audit/writer'
import { PDF_MAX_ROWS } from '@/domain/reports/export'
import { reportContext } from '@/domain/reports/kpi'
import { AUDIT_REPORT, REPORTS, reportByCode, type ReportDef } from '@/domain/reports/registry'
import { officeScope, type ReportScope } from '@/domain/reports/scope'
import { withReqTransaction } from '@/lib/system-tx'
import { XLSX_MAX_ROWS, xlsxEnabled } from '@/lib/xlsx'
import { formatServerTime } from '@/pdf/format'

import { Empty, F3Root, FilterForm, ReportTable } from './f3-ui'
import { Shell } from './shared'

/**
 * F3 "Laporan" (wireframes §5) and the global "Audit Log" (§6): custom root views (wrapped in the
 * default template via Shell, like the F2 views). Filters = plain GET form; the export links reuse
 * the exact query string (same filters → same numbers). Scope and role checks are the same code as
 * the /api/v1 endpoints (registry + officeScope).
 */
function toSearchParams(sp: AdminViewServerProps['searchParams']): URLSearchParams {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(sp ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x)))
    else if (v !== undefined) out.append(k, String(v))
  }
  return out
}

const FORMAT_LABEL = { csv: 'CSV', xlsx: 'Excel (.xlsx)', pdf: 'PDF' } as const

export async function ReportsIndex(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const list = REPORTS.filter((r) => hasRole(req, ...r.roles))
  return (
    <Shell props={props} title="Laporan">
      <F3Root name="laporan">
        {list.length === 0 ? (
          <Empty text="Laporan kantor tidak tersedia untuk peran Anda." />
        ) : (
          <div className="pk-scroll">
            <table className="pk-table" data-pk-table="reports">
              <thead>
                <tr>
                  <th>Laporan</th>
                  <th className="pk-secondary">Isi</th>
                  <th className="pk-secondary">Export</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.code} data-pk-report={r.code}>
                    <td>
                      <a href={`/admin/laporan/${r.code}`}>{r.title}</a>
                    </td>
                    <td className="pk-secondary">{r.description}</td>
                    <td className="pk-secondary">
                      {r.formats
                        .filter((f) => f !== 'xlsx' || xlsxEnabled())
                        .map((f) => FORMAT_LABEL[f])
                        .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasRole(req, ...AUDIT_REPORT.roles) ? (
          <p>
            <Link href="/admin/audit-log">Audit Log →</Link>
          </p>
        ) : null}
      </F3Root>
    </Shell>
  )
}

export async function ReportView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const segments = (props.params as { segments?: string[] } | undefined)?.segments ?? []
  const code = segments[1] ?? ''
  const def = reportByCode(code)
  if (!def || def.code === 'audit-log') return <Shell props={props} title="Laporan tidak ditemukan"><p><Link href="/admin/laporan">← Daftar laporan</Link></p></Shell>
  if (!hasRole(req, ...def.roles)) return <Denied props={props} def={def} />
  const scope = def.scope ? await def.scope(req) : await officeScope(req)
  if (scope.kind === 'none') return <Denied props={props} def={def} />
  return <ReportPage props={props} def={def} scope={scope} base={`/admin/laporan/${def.code}`} />
}

export async function AuditLogView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...AUDIT_REPORT.roles)) return <Denied props={props} def={AUDIT_REPORT} />
  const sp = toSearchParams(props.searchParams)
  // K-16: opening the global audit log is itself recorded (new row, never a change).
  await withReqTransaction(req, () =>
    writeAudit(req, [{ action: 'export', docType: 'audit_log', docId: 'view', field: 'view', newValue: { filters: Object.fromEntries([...sp.entries()].slice(0, 20)) } }]),
  )
  return <ReportPage props={props} def={AUDIT_REPORT} scope={{ kind: 'all' }} base="/admin/audit-log" />
}

function Denied({ props, def }: { props: AdminViewServerProps; def: ReportDef }) {
  return (
    <Shell props={props} title={def.title}>
      <p data-pk-denied={def.code}>Halaman ini hanya untuk peran: {def.roles.map((r) => ROLE_LABELS[r]).join(', ')}.</p>
    </Shell>
  )
}

async function ReportPage({ props, def, scope, base }: { props: AdminViewServerProps; def: ReportDef; scope: ReportScope; base: string }) {
  const req = props.initPageResult.req as PayloadRequest
  const sp = toSearchParams(props.searchParams)
  const cursor = sp.get('cursor') ?? undefined
  const filterSp = new URLSearchParams([...sp.entries()].filter(([k]) => k !== 'cursor'))
  let loaded: { res: Awaited<ReturnType<ReportDef['run']>>; fields: Awaited<ReturnType<ReportDef['filters']>>; ctx: Awaited<ReturnType<typeof reportContext>> } | null = null
  try {
    loaded = await withReqTransaction(req, async () => ({
      res: await def.run(req, scope, sp, { cursor: cursor && /^[A-Za-z0-9_-]{1,200}$/.test(cursor) ? cursor : undefined, limit: def.pageSize }),
      fields: await def.filters(req, scope, filterSp),
      ctx: await reportContext(req),
    }))
  } catch (err) {
    req.payload.logger.error({ msg: 'report view failed', report: def.code, err: (err as Error).message })
  }
  const body = loaded ? <ReportBody def={def} scope={scope} base={base} cursor={cursor} filterSp={filterSp} {...loaded} /> : <Empty text="Data tidak dapat dimuat. Coba lagi atau persempit filter." />
  return (
    <Shell props={props} title={def.code === 'audit-log' ? 'Audit Log' : `Laporan › ${def.title}`}>
      <F3Root name={`laporan-${def.code}`}>
        {def.code === 'audit-log' ? null : (
          <p>
            <Link href="/admin/laporan">← Daftar laporan</Link>
          </p>
        )}
        {body}
      </F3Root>
    </Shell>
  )
}

function ReportBody({
  def,
  scope,
  base,
  cursor,
  filterSp,
  res,
  fields,
  ctx,
}: {
  def: ReportDef
  scope: ReportScope
  base: string
  cursor: string | undefined
  filterSp: URLSearchParams
  res: Awaited<ReturnType<ReportDef['run']>>
  fields: Awaited<ReturnType<ReportDef['filters']>>
  ctx: Awaited<ReturnType<typeof reportContext>>
}) {
    const q = filterSp.toString()
    const rowCount = def.paged ? res.count : res.main.rows.length
    const formats = def.formats.filter((f) => f !== 'xlsx' || xlsxEnabled())
    return (
      <>
        <FilterForm fields={fields} action={base} />
        <div className="pk-actions" data-pk-exports>
          <span>Export:</span>
          {formats.map((f) => {
            const tooBig = (f === 'xlsx' && rowCount > XLSX_MAX_ROWS) || (f === 'pdf' && rowCount > PDF_MAX_ROWS)
            return tooBig ? (
              <span key={f} className="pk-btn" aria-disabled="true" title="Persempit filter atau pakai CSV" data-pk-export={f} data-pk-disabled="true">
                {FORMAT_LABEL[f]} (terlalu banyak baris)
              </span>
            ) : (
              <a key={f} className="pk-btn" href={`/api/v1/reports/${def.code}/${f}${q ? `?${q}` : ''}`} data-pk-export={f}>
                {FORMAT_LABEL[f]}
              </a>
            )
          })}
          <span className="pk-note" data-pk-row-count={rowCount}>
            Dibuat {formatServerTime(new Date().toISOString(), ctx.tz)} · {rowCount.toLocaleString('id-ID')} baris
            {scope.kind === 'team' ? ' · cakupan tim saya' : ''}
          </span>
        </div>
        <section className="pk-block">
          <h2>{res.main.title}</h2>
          <ReportTable t={res.main} id={`${def.code}-main`} />
          {def.paged ? (
            <p className="pk-actions">
              {cursor ? <a href={`${base}${q ? `?${q}` : ''}`}>« Halaman pertama</a> : null}
              {res.next ? (
                <a href={`${base}?${new URLSearchParams([...filterSp.entries(), ['cursor', res.next]]).toString()}`} data-pk-action="next-page">
                  Berikutnya ›
                </a>
              ) : null}
            </p>
          ) : null}
        </section>
        {res.extra.map((t) => (
          <section key={t.key} className="pk-block">
            <h2>{t.title}</h2>
            <ReportTable t={t} id={`${def.code}-${t.key}`} />
          </section>
        ))}
        {res.notes.map((n, i) => (
          <p key={i} className="pk-note">
            * {n}
          </p>
        ))}
      </>
    )
}

export default ReportsIndex
