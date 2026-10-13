import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, DocumentViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRoleAny, relId, userId } from '@/access/roles'
import { DecisionBar } from '@/admin/components/DecisionBar'
import { ConfirmAction } from '@/admin/components/addendum/ConfirmAction'
import { ReasonAction } from '@/admin/components/kas/ReasonAction'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { LoanForm } from '@/admin/components/loans/LoanForm'
import { RepaymentAction } from '@/admin/components/loans/RepaymentAction'
import { pageOfFind, parseListQuery } from '@/admin/list-query'
import { settings, today } from '@/domain/expense/common'
import { loanScope, loanTotals, projectLoanFigures } from '@/domain/loans/report'
import { LOAN_STATUS_LABELS, LOAN_STATUSES, OVERDUE_LABEL, type LoanStatus } from '@/domain/loans/rules'
import { listLoans, loadVisibleLoan, loanDetail, loanInbox, loanProjectOptions, type LoanDetail as Detail, type LoanSummary } from '@/domain/loans/service'
import type { PillTone } from '@/domain/reports/viz'
import { withReqTransaction, withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'

import { F3Root } from './f3-ui'
import { Frame } from './frame'
import { NoAccess } from './NoAccess'
import { Alert, dateId, dateTimeId } from './progress-ui'
import { PtChip, ptView, type PtView } from './pt'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, Meter, rp, StatusPill, VIZ_STYLE, type Col } from './viz'

/**
 * ADR 0022 web: "Pinjaman antar project" — list (D8: search, filters, numbered pages, cards ≤ 640 px), new Draft
 * (PM of the borrower project), detail (amounts, repayments "Pengembalian ke-n", Direktur decision timeline, notes
 * "PM peminjam = PM pemberi" / direktur_self) with the actions the server allows (`allowedActions`: submit / cancel /
 * edit by the PM, Setujui / Tolak by the Direktur in the fixed decision bar, repayment by the borrower PM / Finance,
 * void by Direktur / Finance), the project tab "Pinjaman" and the section of the "Persetujuan" inbox. Every action goes
 * to /api/v1/project-loans (role, step and state re-checked, audited). No cash entry is ever created (§5).
 */
const READERS = ['pk-owner', 'pk-admin', 'pk-finance', 'pk-pm'] as const
export const loanHref = (id: number) => `/admin/pinjaman/detail/${id}`

export const LOAN_TONE: Record<LoanStatus, PillTone> = { draft: 'none', pending_approval: 'wait', approved: 'progress', partially_repaid: 'progress', repaid: 'ok', rejected: 'bad', cancelled: 'none' }

const STYLE = `
.pk-loan-flow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; }
.pk-loan-flow .arrow { font-size: 18px; color: var(--theme-elevation-500); }
.pk-loan-flow .who { font-size: 12px; color: var(--theme-elevation-600); display: block; }
.pk-loan-notes { display: grid; gap: 6px; margin-top: 12px; }
.pk-loan-dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; }
.pk-loan-dl dt { color: var(--theme-elevation-600); }
.pk-loan-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
tr[data-pk-status="void"] td { color: var(--theme-elevation-500); }
tr[data-pk-status="void"] td:nth-child(3) { text-decoration: line-through; }
@media (max-width: 640px) { .pk-loan-flow { grid-template-columns: 1fr; } .pk-loan-flow .arrow { transform: rotate(90deg); justify-self: start; } .pk-loan-dl { grid-template-columns: 1fr; gap: 2px; } .pk-loan-dl dd { margin-bottom: 8px; } }
`

function StatusCell({ l }: { l: Pick<LoanSummary, 'status' | 'statusLabel' | 'overdue' | 'daysOverdue'> }) {
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      <StatusPill tone={LOAN_TONE[l.status]} label={l.statusLabel} />
      {l.overdue ? <StatusPill tone="bad" label={`${OVERDUE_LABEL} · ${l.daysOverdue} hari`} /> : null}
    </span>
  )
}

const projectText = (p: LoanSummary['lenderProject']) => `${p.code ?? ''} ${p.name ?? ''}`.trim()

/** Columns of a loan table (list, project tab). `focus` = the project of the tab (shows the direction). */
function loanCols(pt: PtView, focus?: number): Col<LoanSummary>[] {
  return [
    ...(pt.multi ? [{ key: 'pt', label: 'PT', cell: (l: LoanSummary) => <PtChip pt={pt.ref(l.companyId)} /> }] : []),
    {
      key: 'no',
      label: 'Nomor',
      sort: 'descending',
      cell: (l) => (
        <>
          <a href={loanHref(l.id)} data-pk-loan={l.docNo ?? l.id}>
            {l.docNo ?? `Draft #${l.id}`}
          </a>
          <span className="sub" title={l.reason}>
            {l.kindLabel} · {l.reason}
          </span>
        </>
      ),
    },
    {
      key: 'p',
      label: focus ? 'Dengan project' : 'Pemberi → peminjam',
      cell: (l) =>
        focus ? (
          <>
            {l.borrowerProject.id === focus ? projectText(l.lenderProject) : projectText(l.borrowerProject)}
            <span className="sub">{l.borrowerProject.id === focus ? 'Pinjaman diterima' : 'Pinjaman diberikan'}</span>
          </>
        ) : (
          <>
            {projectText(l.lenderProject)}
            <span className="sub">→ {projectText(l.borrowerProject)}</span>
          </>
        ),
    },
    { key: 'st', label: 'Status', cell: (l) => <StatusCell l={l} /> },
    { key: 'due', label: 'Jatuh tempo', sec: true, cell: (l) => <span className="nw">{dateId(l.dueDate)}</span> },
    { key: 'amt', label: 'Nilai', num: true, cell: (l) => rp(l.amount) },
    { key: 'out', label: 'Sisa', num: true, cell: (l) => <b>{rp(l.outstanding)}</b> },
  ]
}

function LoanCards({ items, focus, empty }: { items: LoanSummary[]; focus?: number; empty: string }) {
  return (
    <div className="pk-lcards" data-pk-loan-cards>
      {items.length === 0 ? <EmptyState text={empty} /> : null}
      {items.map((l) => (
        <article key={l.id} className="pk-lcard" data-pk-loan-card={l.id}>
          <div className="pk-lcard__head">
            <span className="pk-lcard__title">
              <a href={loanHref(l.id)}>{l.docNo ?? `Draft #${l.id}`}</a> · {l.kindLabel}
            </span>
            <span className="pk-lcard__total">{rp(l.amount)}</span>
          </div>
          <div className="pk-lcard__meta">
            {focus ? (l.borrowerProject.id === focus ? `Dari ${projectText(l.lenderProject)}` : `Ke ${projectText(l.borrowerProject)}`) : `${projectText(l.lenderProject)} → ${projectText(l.borrowerProject)}`}
          </div>
          <div className="pk-lcard__meta">
            Sisa <b style={{ color: 'var(--pk-fg)' }}>{rp(l.outstanding)}</b> · jatuh tempo {dateId(l.dueDate)}
          </div>
          <div className="pk-lcard__chips">
            <StatusCell l={l} />
          </div>
        </article>
      ))}
    </div>
  )
}

const STATUS_FILTER = { key: 'status', label: 'Status', options: LOAN_STATUSES.map((s) => ({ value: s, label: LOAN_STATUS_LABELS[s] })) }
const OVERDUE_FILTER = { key: 'terlambat', label: 'Terlambat', all: 'Semua', options: [{ value: 'ya', label: 'Terlambat saja' }] }

async function tzOf(req: PayloadRequest): Promise<string> {
  return (await settings(req)).timezone || process.env.TZ || DEFAULT_TZ
}

// ================================================================ list

export async function LoanList(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRoleAny(req, ...READERS)) return <NoAccess props={props} />
  const sp = props.searchParams as Record<string, string | string[] | undefined> | undefined
  const lq = parseListQuery(sp, ['status', 'project', 'peran', 'terlambat'])
  const status = (LOAN_STATUSES as readonly string[]).includes(lq.filters.status ?? '') ? (lq.filters.status as LoanStatus) : undefined
  const projectId = /^\d{1,10}$/.test(lq.filters.project ?? '') ? Number(lq.filters.project) : undefined
  const role = lq.filters.peran === 'borrower' || lq.filters.peran === 'lender' ? lq.filters.peran : undefined
  const d = await withReqTransaction(req, async () => {
    const page = await listLoans(req, { projectId, role, status, overdue: lq.filters.terlambat === 'ya', q: lq.q, page: lq.page, limit: lq.per })
    const totals = await loanTotals(req, await loanScope(req))
    const inbox = (await loanInbox(req)).items.length
    const options = await loanProjectOptions(req)
    const projects = (await req.payload.find({ collection: 'projects', sort: 'code', depth: 0, pagination: false, select: { code: true, name: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; code: string; name: string }>
    return { page, totals, inbox, canCreate: options.borrowers.length > 0, projects }
  })
  const pt = await ptView(req)
  const page = pageOfFind({ docs: d.page.items, page: d.page.page, totalDocs: d.page.totalDocs, totalPages: d.page.totalPages, limit: d.page.limit })
  const filtered = Boolean(status || projectId || role || lq.q || lq.filters.terlambat)
  const empty = filtered ? 'Tidak ada pinjaman untuk filter ini.' : 'Belum ada pinjaman antar project.'
  return (
    <Frame props={props} name="pinjaman">
      <style>{STYLE}</style>
      <DashHead title="Pinjaman antar project" note="Diajukan PM project peminjam · disetujui Direktur · tanpa transaksi kas (klaim tercatat antar project dalam satu PT)">
        <div className="pk-kact">
          {d.canCreate ? (
            <Link className="pk-kbtn primary" href="/admin/pinjaman/baru" data-pk-link="pinjaman-baru">
              + Ajukan pinjaman
            </Link>
          ) : null}
          {d.inbox > 0 ? (
            <Link className="pk-kbtn" href="/admin/persetujuan#pinjaman">
              Menunggu saya ({d.inbox})
            </Link>
          ) : null}
          <Link className="pk-kbtn" href="/admin/laporan/pinjaman-antar-project">
            Laporan
          </Link>
        </div>
      </DashHead>
      <Bento label="Ringkasan pinjaman">
        <KpiRow cols={3}>
          <KpiTile id="loan-pending" icon="clock" label="Menunggu persetujuan" value={String(d.totals.pending)} kpi="loan-pending" href={`/admin/pinjaman?status=pending_approval`} more="Lihat" i={0}>
            <p className="pk-kpi-x">{d.inbox === 0 ? 'Tidak ada yang menunggu Anda ✓' : `${d.inbox} menunggu keputusan Anda`}</p>
          </KpiTile>
          <KpiTile id="loan-outstanding" icon="wallet" label="Sisa pinjaman" value={rp(d.totals.outstanding)} title={rp(d.totals.outstanding)} kpi="loan-outstanding" i={1}>
            <p className="pk-kpi-x">
              Disetujui <b>{rp(d.totals.amount)}</b> · kembali {rp(d.totals.repaid)}
            </p>
          </KpiTile>
          <KpiTile id="loan-overdue" icon="clock" label={OVERDUE_LABEL} value={String(d.totals.overdueCount)} kpi="loan-overdue" href="/admin/pinjaman?terlambat=ya" more="Lihat" i={2}>
            <p className="pk-kpi-x">{d.totals.overdueCount === 0 ? 'Tidak ada yang terlambat ✓' : <>Sisa terlambat <b>{rp(d.totals.overdue)}</b></>}</p>
          </KpiTile>
        </KpiRow>
        <Card id="loans" title="Daftar pinjaman" sub="Terbaru dulu · nomor dapat diklik">
          <ListToolbar
            id="pinjaman"
            action="/admin/pinjaman"
            query={lq}
            label="Cari dan saring pinjaman"
            search={{ placeholder: 'Nomor atau alasan…' }}
            filters={[
              STATUS_FILTER,
              { key: 'project', label: 'Project', options: d.projects.map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })) },
              { key: 'peran', label: 'Peran project', options: [{ value: 'borrower', label: 'Peminjam' }, { value: 'lender', label: 'Pemberi' }] },
              OVERDUE_FILTER,
            ]}
          />
          <div className="pk-lwide">
            <DataTable id="loans" cols={loanCols(pt)} rows={page.items} rowKey={(l) => l.id} rowAttrs={(l) => ({ 'data-pk-row': l.docNo ?? String(l.id), 'data-pk-status': l.status })} caption="Pinjaman antar project" empty={<EmptyState text={empty} action={d.canCreate ? { href: '/admin/pinjaman/baru', label: '+ Ajukan pinjaman' } : undefined} />} />
          </div>
          <LoanCards items={page.items} empty={empty} />
          <Pager id="pinjaman" path="/admin/pinjaman" sp={sp} page={page} unit="pinjaman" />
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ new

export async function LoanNew(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const d = hasRoleAny(req, 'pk-pm') ? await withReqTransaction(req, async () => ({ options: await loanProjectOptions(req), today: await today(req) })) : null
  const back = (
    <Link className="pk-kbtn" href="/admin/pinjaman">
      ← Pinjaman antar project
    </Link>
  )
  if (!d || d.options.borrowers.length === 0) {
    return (
      <Frame props={props} name="pinjaman-baru">
        <DashHead title="Ajukan pinjaman antar project">{back}</DashHead>
        <Alert tone="bad" attr="denied">
          <p>Pinjaman antar project diajukan oleh PM project peminjam. Anda belum menjadi PM project yang aktif.</p>
        </Alert>
      </Frame>
    )
  }
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const initial = sp.project && /^\d{1,10}$/.test(sp.project) ? Number(sp.project) : undefined
  return (
    <Frame props={props} name="pinjaman-baru">
      <DashHead title="Ajukan pinjaman antar project" note="Nomor PJ diberikan saat diajukan. Direktur menyetujui; PM project pemberi diberi tahu.">
        {back}
      </DashHead>
      <Bento>
        <Card id="loan-form" title="Pinjaman baru" span={8}>
          <LoanForm borrowers={d.options.borrowers} lenders={d.options.lenders} today={d.today} initialBorrower={d.options.borrowers.some((p) => p.id === initial) ? initial : undefined} />
        </Card>
        <Card id="loan-help" title="Alur" span={4}>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>PM project peminjam mengajukan nilai, jatuh tempo dan alasan.</li>
            <li>Direktur menyetujui atau menolak dengan alasan. PM project pemberi diberi tahu.</li>
            <li>Tidak ada transaksi kas: pinjaman tercatat sebagai klaim antar project (sisa dipantau).</li>
            <li>Pengembalian dicatat PM peminjam atau Finance sampai Lunas; lewat jatuh tempo = Terlambat.</li>
          </ol>
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ detail

function Notes({ l }: { l: Detail }) {
  const notes = [l.samePmNote, l.g1Note].filter((x): x is string => !!x)
  if (notes.length === 0) return null
  return (
    <div className="pk-loan-notes" data-pk-loan-notes>
      {notes.map((n) => (
        <p key={n} className="pk-note" style={{ margin: 0 }}>
          <StatusPill tone="warn" label="Catatan" /> {n}
        </p>
      ))}
    </div>
  )
}

export async function LoanDetail(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRoleAny(req, ...READERS)) return <NoAccess props={props} />
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[2] ?? ''
  const id = /^\d{1,10}$/.test(seg) ? Number(seg) : 0
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await loadVisibleLoan(req, id).catch(() => null) : null
    if (!doc) return null
    const l = await loanDetail(req, doc)
    const edit = l.allowedActions.includes('edit') ? await loanProjectOptions(req) : null
    return { l, tz: await tzOf(req), today: await today(req, l.companyId), edit }
  })
  const back = (
    <Link className="pk-kbtn" href="/admin/pinjaman">
      ← Pinjaman antar project
    </Link>
  )
  if (!d) {
    return (
      <Frame props={props} name="pinjaman-detail">
        <DashHead title="Pinjaman tidak ditemukan">{back}</DashHead>
      </Frame>
    )
  }
  const { l, tz } = d
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const acts = new Set(l.allowedActions)
  const title = l.docNo ?? `Draft pinjaman #${l.id}`
  const decision = l.decisions.at(-1)
  const pending = l.status === 'pending_approval'
  const active = l.status === 'approved' || l.status === 'partially_repaid' || l.status === 'repaid'
  const steps = [
    { key: 'submit', label: 'Diajukan PM peminjam', when: l.submittedAt, who: l.createdBy.name, tone: (l.submittedAt ? 'ok' : 'none') as PillTone, state: l.submittedAt ? 'Selesai' : 'Belum' },
    decision
      ? { key: 'direktur', label: 'Persetujuan Direktur', when: decision.decidedAt, who: decision.actor.name, tone: (decision.decision === 'approved' ? 'ok' : 'bad') as PillTone, state: decision.decision === 'approved' ? 'Disetujui' : 'Ditolak', reason: decision.reason }
      : { key: 'direktur', label: 'Persetujuan Direktur', when: null, who: null, tone: (pending ? 'wait' : 'none') as PillTone, state: pending ? 'Menunggu' : l.status === 'cancelled' ? 'Dibatalkan' : 'Belum' },
  ]
  const amountText = `${projectText(l.borrowerProject)} meminjam ${rp(l.amount)} dari ${projectText(l.lenderProject)}.`
  const repayCols: Col<Detail['repayments'][number]>[] = [
    { key: 'n', label: 'Pengembalian', cell: (r) => (r.seq ? `Pengembalian ke-${r.seq}` : <StatusPill tone="none" label={r.statusLabel} />) },
    { key: 'd', label: 'Tanggal', cell: (r) => <span className="nw">{dateId(r.repayDate)}</span> },
    { key: 'a', label: 'Nominal', num: true, cell: (r) => rp(r.amount) },
    {
      key: 'by',
      label: 'Dicatat oleh',
      sec: true,
      cell: (r) => (
        <>
          {r.recordedBy.name ?? '—'}
          {r.note ? <span className="sub">{r.note}</span> : null}
          {r.status === 'void' ? <span className="sub">Void: {r.voidReason}</span> : null}
        </>
      ),
    },
    {
      key: 'x',
      label: 'Aksi',
      cell: (r) =>
        r.status === 'posted' && l.mayVoidRepayment ? (
          <ReasonAction
            url={`/api/v1/project-loans/${l.id}/repayments/${r.id}/void`}
            label="Void"
            title={`Void pengembalian ke-${r.seq}?`}
            description={<>Pengembalian {rp(r.amount)} dibatalkan (tidak dihapus); sisa pinjaman bertambah lagi. Alasan wajib.</>}
            confirmLabel="Void pengembalian"
            testId={`loan-void-${r.id}`}
          />
        ) : r.status === 'void' ? (
          <StatusPill tone="none" label="Dibatalkan (void)" />
        ) : (
          '—'
        ),
    },
  ]
  return (
    <Frame props={props} name="pinjaman-detail">
      <style>{STYLE}</style>
      <DashHead title={title} note={`${l.kindLabel} · ${projectText(l.lenderProject)} → ${projectText(l.borrowerProject)} · diajukan ${l.createdBy.name ?? '—'}`}>
        <div className="pk-kact">
          {back}
          <Link className="pk-kbtn" href={`/admin/collections/projects/${l.borrowerProject.id}/pinjaman`}>
            Project peminjam
          </Link>
        </div>
      </DashHead>
      {sp.diajukan ? (
        <Alert tone="ok" attr="submitted">
          <p>
            <strong>{l.docNo}</strong> diajukan · menunggu persetujuan Direktur.
          </p>
        </Alert>
      ) : sp.tersimpan ? (
        <Alert tone="ok" attr="saved">
          <p>Draft tersimpan. Ajukan bila sudah siap.</p>
        </Alert>
      ) : null}
      {l.status === 'rejected' ? (
        <Alert tone="bad" attr="rejected">
          <p>Ditolak: {l.rejectReason}</p>
        </Alert>
      ) : l.status === 'cancelled' ? (
        <Alert tone="info" attr="cancelled">
          <p>Dibatalkan: {l.cancelReason}</p>
        </Alert>
      ) : l.overdue ? (
        <Alert tone="bad" attr="overdue">
          <p>
            {OVERDUE_LABEL} {l.daysOverdue} hari: jatuh tempo {dateId(l.dueDate)}, sisa {rp(l.outstanding)}.
          </p>
        </Alert>
      ) : null}

      {acts.has('submit') || acts.has('cancel') || acts.has('repay') ? (
        <div className="pk-actions" data-pk-actions={[...acts].join(',')} style={{ gap: 8 }}>
          {acts.has('submit') ? (
            <ConfirmAction url={`/api/v1/project-loans/${l.id}/submit`} label="Ajukan ke Direktur" size="md" title="Ajukan pinjaman?" description={<>Nomor PJ diberikan dan Direktur diberi tahu. Isi pinjaman tidak dapat diubah lagi.</>} confirmLabel="Ajukan" testId="loan-submit" />
          ) : null}
          {acts.has('repay') ? <RepaymentAction loanId={l.id} outstanding={l.outstanding} loanDate={l.loanDate} today={d.today} /> : null}
          {acts.has('cancel') ? (
            <ReasonAction
              url={`/api/v1/project-loans/${l.id}/cancel`}
              label="Batalkan"
              size="md"
              variant="secondary"
              title={`Batalkan ${title}?`}
              description={<>{l.status === 'approved' ? 'Pinjaman yang sudah disetujui dibatalkan (belum ada pengembalian).' : 'Pinjaman dibatalkan (tidak dihapus).'} Alasan wajib.</>}
              confirmLabel="Batalkan pinjaman"
              testId="loan-cancel"
            />
          ) : null}
        </div>
      ) : null}

      <Bento label="Pinjaman antar project">
        <KpiRow cols={4}>
          <KpiTile id="l-amount" icon="wallet" label="Nilai pinjaman" value={rp(l.amount)} title={rp(l.amount)} kpi="loan-amount" i={0}>
            <p className="pk-kpi-x">
              <StatusCell l={l} />
            </p>
          </KpiTile>
          <KpiTile id="l-repaid" icon="check" label="Sudah kembali" value={active ? rp(l.repaidTotal) : '—'} title={rp(l.repaidTotal)} kpi="loan-repaid" i={1}>
            {active ? <Meter value={l.repaidTotal} max={Math.max(1, l.amount)} tone={l.status === 'repaid' ? 'ok' : l.overdue ? 'over' : 'warn'} /> : null}
            <p className="pk-kpi-x">{active ? `${l.repayments.filter((r) => r.status === 'posted').length} pengembalian` : 'Dicatat setelah disetujui'}</p>
          </KpiTile>
          <KpiTile id="l-outstanding" icon="target" label="Sisa pinjaman" value={active ? rp(l.outstanding) : '—'} title={rp(l.outstanding)} kpi="loan-outstanding" i={2}>
            <p className="pk-kpi-x">{active ? `dari ${rp(l.amount)}` : pending ? 'Diajukan, belum disetujui' : 'Tidak ada'}</p>
          </KpiTile>
          <KpiTile id="l-due" icon="doc" label="Jatuh tempo" value={dateId(l.dueDate)} kpi="loan-due" i={3}>
            <p className="pk-kpi-x">Tanggal pinjaman {dateId(l.loanDate)}</p>
            {l.overdue ? (
              <p className="pk-kpi-x">
                <StatusPill tone="bad" label={`${OVERDUE_LABEL} · ${l.daysOverdue} hari`} />
              </p>
            ) : null}
          </KpiTile>
        </KpiRow>
        <Card id="loan-detail" title="Rincian" span={7} i={4}>
          <div className="pk-loan-flow" data-pk-loan-flow>
            <div>
              <span className="who">Project pemberi pinjaman</span>
              <b>{projectText(l.lenderProject)}</b>
              <span className="who">PM {l.lenderProject.pm?.name ?? '—'}</span>
            </div>
            <span className="arrow" aria-hidden>
              →
            </span>
            <div>
              <span className="who">Project peminjam</span>
              <b>{projectText(l.borrowerProject)}</b>
              <span className="who">PM {l.borrowerProject.pm?.name ?? '—'}</span>
            </div>
          </div>
          <dl className="pk-loan-dl" style={{ marginTop: 16 }}>
            <dt>Jenis</dt>
            <dd>{l.kindLabel}</dd>
            <dt>Alasan</dt>
            <dd className="pk-pre" data-pk-field="reason">
              {l.reason}
            </dd>
          </dl>
          <Notes l={l} />
          {acts.has('edit') && d.edit ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Ubah draft</h3>
              <LoanForm
                borrowers={d.edit.borrowers}
                lenders={d.edit.lenders}
                today={d.today}
                edit={{ id: l.id, borrowerProjectId: l.borrowerProject.id, lenderProjectId: l.lenderProject.id, kind: l.kind, amount: l.amount, reason: l.reason, loanDate: l.loanDate, dueDate: l.dueDate }}
              />
            </div>
          ) : null}
        </Card>
        <Card id="loan-flow" title="Alur persetujuan" sub="PM peminjam mengajukan · Direktur memutuskan" span={5} i={5}>
          <ol className="pk-tl" data-pk-flow>
            {steps.map((s) => (
              <li key={s.key} data-pk-step={s.key} data-pk-done={s.when ? 'yes' : 'no'}>
                <div className="when">
                  {s.label}
                  {s.when ? ` · ${dateTimeId(s.when, tz)}` : ''}
                </div>
                <p className="what">
                  <StatusPill tone={s.tone} label={s.state} /> {s.who ? <b>{s.who}</b> : null}
                  {'reason' in s && s.reason ? <span className="sub"> — {s.reason}</span> : null}
                </p>
              </li>
            ))}
          </ol>
        </Card>
        <Card id="loan-repayments" title="Pengembalian" sub={active ? `Sisa ${rp(l.outstanding)} · dicatat PM peminjam atau Finance tanpa persetujuan Direktur` : 'Dicatat setelah pinjaman disetujui'} i={6}>
          <DataTable
            id="loan-repayments"
            caption="Pengembalian pinjaman"
            cols={repayCols}
            rows={l.repayments}
            rowKey={(r) => r.id}
            rowAttrs={(r) => ({ 'data-pk-repayment': String(r.id), 'data-pk-status': r.status })}
            empty={<EmptyState text="Belum ada pengembalian." />}
          />
        </Card>
      </Bento>
      {acts.has('approve') || acts.has('reject') ? (
        <DecisionBar
          id={l.id}
          base="/api/v1/project-loans"
          regionLabel="Keputusan pinjaman"
          step={acts.has('approve') ? 'approve' : null}
          label="Setujui"
          confirm={`Setujui ${title}? ${amountText} Tidak ada transaksi kas yang dibuat; pinjaman tercatat sebagai piutang antar project.`}
          canReject={acts.has('reject')}
          stepLabel={`Persetujuan Direktur — ${title}`}
          rejectPrompt={{ field: 'reason', message: 'Alasan penolakan dikirim ke PM peminjam (wajib, minimal 3 karakter):', minLength: 3 }}
        />
      ) : null}
    </Frame>
  )
}

// ================================================================ project tab "Pinjaman"

/** ADR 0022 §8: the project's loans (as borrower and lender) + "Pinjaman diterima / diberikan (outstanding)". */
export async function ProjectLoansTab(props: DocumentViewServerProps) {
  const req = props.initPageResult.req as PayloadRequest
  const id = Number(props.initPageResult.docID ?? (props.doc as { id?: unknown } | undefined)?.id)
  const sp = props.searchParams as Record<string, string | string[] | undefined> | undefined
  const lq = parseListQuery(sp, ['status', 'peran', 'terlambat'])
  const path = `/admin/collections/projects/${id}/pinjaman`
  const readers = hasRoleAny(req, ...READERS)
  const d =
    Number.isSafeInteger(id) && readers
      ? await withReqTransaction(req, async () => {
          const p = (await req.payload.findByID({ collection: 'projects', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as { pm?: unknown; company?: unknown } | null
          if (!p) return null
          const status = (LOAN_STATUSES as readonly string[]).includes(lq.filters.status ?? '') ? (lq.filters.status as LoanStatus) : undefined
          const role = lq.filters.peran === 'borrower' || lq.filters.peran === 'lender' ? lq.filters.peran : undefined
          const page = await listLoans(req, { projectId: id, role, status, overdue: lq.filters.terlambat === 'ya', q: lq.q, page: lq.page, limit: lq.per })
          const fig = (await projectLoanFigures(req, await loanScope(req), { projectId: id }))[0] ?? null
          return { page, fig, canCreate: relId(p.pm) === userId(req) && hasRoleAny(req, 'pk-pm') }
        }).catch(() => null)
      : null
  const pt = await ptView(req)
  return (
    <Gutter>
      <F3Root name="project-loans">
        <style>{VIZ_STYLE}</style>
        <style>{KAS_STYLE}</style>
        <style>{STYLE}</style>
        <div style={{ paddingTop: 16 }}>
          {!d ? (
            <EmptyState text={readers ? 'Project tidak ditemukan atau tidak dapat Anda buka.' : 'Pinjaman antar project hanya untuk Direktur, Admin, Finance dan PM.'} />
          ) : (
            <>
              <KpiRow cols={3}>
                <KpiTile id="pl-borrowed" icon="down" label="Pinjaman diterima (sisa)" value={rp(d.fig?.outstandingBorrowed ?? 0)} title={rp(d.fig?.outstandingBorrowed ?? 0)} kpi="project-loan-borrowed" i={0}>
                  <p className="pk-kpi-x">Disetujui {rp(d.fig?.borrowed ?? 0)}</p>
                </KpiTile>
                <KpiTile id="pl-lent" icon="up" label="Pinjaman diberikan (sisa)" value={rp(d.fig?.outstandingLent ?? 0)} title={rp(d.fig?.outstandingLent ?? 0)} kpi="project-loan-lent" i={1}>
                  <p className="pk-kpi-x">Disetujui {rp(d.fig?.lent ?? 0)}</p>
                </KpiTile>
                <KpiTile id="pl-overdue" icon="clock" label={OVERDUE_LABEL} value={String(d.fig?.overdueCount ?? 0)} kpi="project-loan-overdue" i={2}>
                  <p className="pk-kpi-x">{(d.fig?.overdueBorrowed ?? 0) > 0 ? <>Sisa diterima terlambat <b>{rp(d.fig!.overdueBorrowed)}</b></> : 'Tidak ada yang terlambat ✓'}</p>
                </KpiTile>
              </KpiRow>
              <Card
                id="project-loans"
                title={`Pinjaman antar project (${d.page.totalDocs})`}
                sub="Tidak mengubah RAB/RAP · nomor dapat diklik"
                action={d.canCreate ? { href: `/admin/pinjaman/baru?project=${id}`, label: '+ Ajukan pinjaman' } : { href: '/admin/laporan/pinjaman-antar-project', label: 'Laporan' }}
              >
                <ListToolbar
                  id="project-loans"
                  action={path}
                  query={lq}
                  label="Cari dan saring pinjaman project"
                  search={{ placeholder: 'Nomor atau alasan…' }}
                  filters={[STATUS_FILTER, { key: 'peran', label: 'Peran', options: [{ value: 'borrower', label: 'Pinjaman diterima' }, { value: 'lender', label: 'Pinjaman diberikan' }] }, OVERDUE_FILTER]}
                />
                <div className="pk-lwide">
                  <DataTable id="project-loans" cols={loanCols(pt, id)} rows={d.page.items} rowKey={(l) => l.id} rowAttrs={(l) => ({ 'data-pk-loan-row': String(l.id) })} caption="Pinjaman project" empty={<EmptyState text="Belum ada pinjaman antar project." />} />
                </div>
                <LoanCards items={d.page.items} focus={id} empty="Belum ada pinjaman antar project." />
                <Pager id="project-loans" path={path} sp={sp} page={pageOfFind({ docs: d.page.items, page: d.page.page, totalDocs: d.page.totalDocs, totalPages: d.page.totalPages, limit: d.page.limit })} unit="pinjaman" />
              </Card>
            </>
          )}
        </div>
      </F3Root>
    </Gutter>
  )
}

// ================================================================ approval inbox section

/** Section of the "Persetujuan" view: loans waiting for the caller (Direktur pool, G1). */
export async function LoanInboxSection({ req }: { req: PayloadRequest }) {
  if (!hasRoleAny(req, 'pk-owner')) return null
  // own transaction: the inbox sections render concurrently (a shared req transaction would be committed under us)
  const { items } = await withSystemTransaction(req.payload, req.user, (r) => loanInbox(r))
  return (
    <F3Root name="loan-inbox">
      <style>{VIZ_STYLE}</style>
      <style>{KAS_STYLE}</style>
      <section id="pinjaman" style={{ marginTop: 32 }} data-pk-inbox="pinjaman">
        <h2 style={{ margin: '0 0 8px' }}>Pinjaman antar project</h2>
        {items.length === 0 ? (
          <EmptyState text="Tidak ada pinjaman antar project yang menunggu keputusan Anda." />
        ) : (
          <DataTable
            id="loan-inbox"
            caption="Pinjaman antar project yang menunggu keputusan saya"
            rows={items}
            rowKey={(r) => r.id}
            cols={[
              {
                key: 'no',
                label: 'Pinjaman',
                cell: (r) => (
                  <>
                    <a href={loanHref(r.id)}>{r.docNo}</a>
                    <span className="sub" title={r.reason}>
                      {r.kindLabel} · {r.reason}
                    </span>
                  </>
                ),
              },
              {
                key: 'p',
                label: 'Pemberi → peminjam',
                cell: (r) => (
                  <>
                    {projectText(r.lenderProject)}
                    <span className="sub">→ {projectText(r.borrowerProject)}</span>
                  </>
                ),
              },
              { key: 'by', label: 'Diajukan', sec: true, cell: (r) => r.createdBy.name ?? '—' },
              { key: 'due', label: 'Jatuh tempo', sec: true, cell: (r) => dateId(r.dueDate) },
              { key: 'amt', label: 'Nilai', num: true, cell: (r) => <b>{rp(r.amount)}</b> },
              {
                key: 'act',
                label: 'Aksi',
                cell: (r) => (
                  <div className="pk-kact">
                    <ConfirmAction
                      url={`/api/v1/project-loans/${r.id}/approve`}
                      label="Setujui"
                      title={`Setujui ${r.docNo}?`}
                      description={
                        <>
                          {projectText(r.borrowerProject)} meminjam {rp(r.amount)} dari {projectText(r.lenderProject)}. Tidak ada transaksi kas yang dibuat; pinjaman tercatat sebagai piutang antar project.
                          {r.samePmNote ? ` ${r.samePmNote}.` : ''}
                        </>
                      }
                      confirmLabel="Setujui"
                      testId={`loan-inbox-approve-${r.id}`}
                    />
                    <ReasonAction url={`/api/v1/project-loans/${r.id}/reject`} label="Tolak" title={`Tolak ${r.docNo}?`} description={<>Alasan penolakan dikirim ke PM peminjam.</>} confirmLabel="Tolak pinjaman" testId={`loan-inbox-reject-${r.id}`} />
                  </div>
                ),
              },
            ]}
            empty={null}
          />
        )}
      </section>
    </F3Root>
  )
}
