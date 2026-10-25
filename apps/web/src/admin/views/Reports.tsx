import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny } from '@/access/roles'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { Panel } from '@/admin/components/ui/nexus'
import { Icon } from '@/admin/modules/Icon'
import { writeAudit } from '@/audit/writer'
import { exportLetterhead, PDF_MAX_ROWS } from '@/domain/reports/export'
import { reportContext } from '@/domain/reports/kpi'
import { AUDIT_REPORT, REPORTS, reportByCode, type ReportDef } from '@/domain/reports/registry'
import { auditScope, officeScope, type ReportScope } from '@/domain/reports/scope'
import { formatNumber } from '@/lib/money'
import { withReqTransaction } from '@/lib/system-tx'
import { XLSX_MAX_ROWS, xlsxEnabled } from '@/lib/xlsx'
import { formatServerTime } from '@/pdf/format'

import { Empty, F3Root, FilterForm, ReportTable } from './f3-ui'
import { foreignPtParam } from './pt'
import { Badge, NX_TABLE, PtNotAllowed, Shell, TableScroll } from './shared'
import { NoAccess } from './NoAccess'

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
  const list = REPORTS.filter((r) => hasRoleAny(req, ...r.roles))
  return (
    <Shell
      props={props}
      title="Laporan"
      actions={
        hasRoleAny(req, ...AUDIT_REPORT.roles) ? (
          <Link className="pk-kbtn sm" href="/admin/audit-log" data-pk-link="audit-log">
            <span>Audit Log</span>
            <Icon name="arrowRight" size={16} />
          </Link>
        ) : null
      }
    >
      <F3Root name="laporan">
        <style>{KAS_STYLE}</style>
        <Panel id="daftar-laporan" icon="report" title="Daftar laporan" note={list.length ? `(${list.length})` : undefined}>
        {list.length === 0 ? (
          <Empty text="Laporan kantor tidak tersedia untuk peran Anda." />
        ) : (
          <TableScroll label="Daftar laporan">
            <table className={NX_TABLE} data-pk-table="reports">
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
                      <a className="pk-nx-strong" href={`/admin/laporan/${r.code}`}>
                        {r.title}
                      </a>
                    </td>
                    <td className="pk-secondary">{r.description}</td>
                    <td className="pk-secondary">
                      <span className="pk-nx-chips">
                        {r.formats
                          .filter((f) => f !== 'xlsx' || xlsxEnabled())
                          .map((f) => (
                            <Badge key={f} tone="muted">
                              {FORMAT_LABEL[f]}
                            </Badge>
                          ))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        </Panel>
      </F3Root>
    </Shell>
  )
}

export async function ReportView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const segments = (props.params as { segments?: string[] } | undefined)?.segments ?? []
  const code = segments[1] ?? ''
  const def = reportByCode(code)
  if (!def || def.code === 'audit-log')
    return (
      <Shell
        props={props}
        title="Laporan tidak ditemukan"
        actions={
          <Link className="pk-kbtn sm" href="/admin/laporan">
            ← Daftar laporan
          </Link>
        }
      >
        <style>{KAS_STYLE}</style>
      </Shell>
    )
  if (!hasRoleAny(req, ...def.roles)) return <Denied props={props} def={def} />
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title={def.title} />
  const scope = def.scope ? await def.scope(req) : await officeScope(req)
  if (scope.kind === 'none') return <Denied props={props} def={def} />
  return <ReportPage props={props} def={def} scope={scope} base={`/admin/laporan/${def.code}`} />
}

export async function AuditLogView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRoleAny(req, ...AUDIT_REPORT.roles)) return <Denied props={props} def={AUDIT_REPORT} />
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title={AUDIT_REPORT.title} />
  const sp = toSearchParams(props.searchParams)
  // K-16: opening the global audit log is itself recorded (new row, never a change).
  await withReqTransaction(req, () =>
    writeAudit(req, [{ action: 'export', docType: 'audit_log', docId: 'view', field: 'view', newValue: { filters: Object.fromEntries([...sp.entries()].slice(0, 20)) } }]),
  )
  // mc2-contract §0.1/§1: PTs where the caller is Owner/Admin/Finance (rows without PT: Admin/Owner only)
  const scope = await auditScope(req)
  if (scope.kind === 'none') return <Denied props={props} def={AUDIT_REPORT} />
  return <ReportPage props={props} def={AUDIT_REPORT} scope={scope} base="/admin/audit-log" />
}

/** QA-20(c): uniform no-access page (no role list). */
function Denied({ props }: { props: AdminViewServerProps; def?: ReportDef }) {
  return <NoAccess props={props} />
}

async function ReportPage({ props, def, scope, base }: { props: AdminViewServerProps; def: ReportDef; scope: ReportScope; base: string }) {
  const req = props.initPageResult.req as PayloadRequest
  const sp = toSearchParams(props.searchParams)
  const cursor = sp.get('cursor') ?? undefined
  const filterSp = new URLSearchParams([...sp.entries()].filter(([k]) => k !== 'cursor'))
  let loaded: {
    res: Awaited<ReturnType<ReportDef['run']>>
    fields: Awaited<ReturnType<ReportDef['filters']>>
    ctx: Awaited<ReturnType<typeof reportContext>>
    kop: Awaited<ReturnType<typeof exportLetterhead>>
  } | null = null
  try {
    loaded = await withReqTransaction(req, async () => ({
      res: await def.run(req, scope, sp, { cursor: cursor && /^[A-Za-z0-9_-]{1,200}$/.test(cursor) ? cursor : undefined, limit: def.pageSize }),
      fields: await def.filters(req, scope, filterSp),
      ctx: await reportContext(req),
      // mc2-contract §1: letterhead of the effective PTs (the `pt` parameter narrows) — same as the exports
      kop: await exportLetterhead(req, def, scope, filterSp),
    }))
  } catch (err) {
    req.payload.logger.error({ msg: 'report view failed', report: def.code, err: (err as Error).message })
  }
  const body = loaded ? <ReportBody def={def} scope={scope} base={base} cursor={cursor} filterSp={filterSp} {...loaded} /> : <Empty text="Data tidak dapat dimuat. Coba lagi atau persempit filter." />
  return (
    <Shell
      props={props}
      title={def.code === 'audit-log' ? 'Audit Log' : `Laporan › ${def.title}`}
      sub={def.description}
      actions={
        def.code === 'audit-log' ? null : (
          <Link className="pk-kbtn sm" href="/admin/laporan" data-pk-link="daftar-laporan">
            <Icon name="arrowLeft" size={16} />
            Daftar laporan
          </Link>
        )
      }
    >
      <F3Root name={`laporan-${def.code}`}>
        <style>{KAS_STYLE}</style>
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
  kop,
}: {
  def: ReportDef
  scope: ReportScope
  base: string
  cursor: string | undefined
  filterSp: URLSearchParams
  res: Awaited<ReturnType<ReportDef['run']>>
  fields: Awaited<ReturnType<ReportDef['filters']>>
  ctx: Awaited<ReturnType<typeof reportContext>>
  kop: Awaited<ReturnType<typeof exportLetterhead>>
}) {
    const q = filterSp.toString()
    const rowCount = def.paged ? res.count : res.main.rows.length
    const formats = def.formats.filter((f) => f !== 'xlsx' || xlsxEnabled())
    return (
      <>
        <FilterForm fields={fields} action={base} />
        <Panel
          id={`${def.code}-main`}
          icon="report"
          title={res.main.title}
          actions={
            <div className="pk-nx-exports" data-pk-exports>
              <span>Export:</span>
              {formats.map((f) => {
                const tooBig = (f === 'xlsx' && rowCount > XLSX_MAX_ROWS) || (f === 'pdf' && rowCount > PDF_MAX_ROWS)
                return tooBig ? (
                  <span key={f} className="pk-btn sm" aria-disabled="true" title="Persempit filter atau pakai CSV" data-pk-export={f} data-pk-disabled="true">
                    {FORMAT_LABEL[f]} (terlalu banyak baris)
                  </span>
                ) : (
                  <a key={f} className="pk-btn sm" href={`/api/v1/reports/${def.code}/${f}${q ? `?${q}` : ''}`} data-pk-export={f}>
                    {FORMAT_LABEL[f]}
                  </a>
                )
              })}
            </div>
          }
          foot={
            <>
              <span data-pk-letterhead={kop.kind}>
                {kop.kind === 'group' ? (
                  <>
                    {kop.name} · PT: {kop.companies.map((c) => c.shortCode).join(', ')}
                  </>
                ) : (
                  kop.name
                )}
              </span>
              {' · '}
              <span data-pk-row-count={rowCount}>
                Dibuat {formatServerTime(new Date().toISOString(), ctx.tz)} · {formatNumber(rowCount)} baris
                {scope.kind === 'team' ? ' · cakupan tim saya' : ''}
              </span>
            </>
          }
        >
          <ReportTable t={res.main} id={`${def.code}-main`} />
          {def.paged ? (
            <p className="pk-actions">
              {cursor ? (
                <a className="pk-btn sm" href={`${base}${q ? `?${q}` : ''}`} rel="first" data-pk-action="first-page">
                  « Halaman pertama
                </a>
              ) : null}
              {res.next ? (
                <a className="pk-btn sm" href={`${base}?${new URLSearchParams([...filterSp.entries(), ['cursor', res.next]]).toString()}`} rel="next" data-pk-action="next-page">
                  Berikutnya ›
                </a>
              ) : null}
            </p>
          ) : null}
        </Panel>
        {res.extra.map((t) => (
          <Panel key={t.key} id={`${def.code}-${t.key}`} icon="tChart" title={t.title}>
            <ReportTable t={t} id={`${def.code}-${t.key}`} />
          </Panel>
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
