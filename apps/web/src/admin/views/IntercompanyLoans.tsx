import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { companiesWithRole, hasRole, hasRoleAny, membershipsOf } from '@/access/roles'
import { DocSummaryProvider } from '@/admin/components/feedback/DocContext'
import { IcLoanInstructForm } from '@/admin/components/icloans/IcLoanInstructForm'
import { IcLoanMoneyForm } from '@/admin/components/icloans/IcLoanMoneyForm'
import { ReasonAction } from '@/admin/components/kas/ReasonAction'
import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { allowedValues, pageOfFind, parseListQuery, type ListQuery } from '@/admin/list-query'
import { companyRefs } from '@/domain/companies'
import { settings } from '@/domain/expense/common'
import { IC_LOAN_STATUS_LABELS, IC_LOAN_STATUSES, IC_OVERDUE_LABEL, type IcLoanStatus } from '@/domain/intercompany/loan-rules'
import { icLoanPositions, icLoanReportScope } from '@/domain/intercompany/loan-report'
import { IC_LOAN_READ_ROLES, icLoanDetail, icLoanHref, icLoanQueue, listIcLoans, loadVisibleIcLoan, type IcLoanSummary } from '@/domain/intercompany/loans'
import type { PillTone } from '@/domain/reports/viz'
import { withReqTransaction, withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'

import { Frame } from './frame'
import { NoAccess } from './NoAccess'
import { Alert, dateId, dateTimeId } from './progress-ui'
import { PtChip } from './pt'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, Meter, rp, StatusPill, type Col } from './viz'

/**
 * ADR 0029 web: "Pinjaman antar-PT" (Keuangan) — list (D8: search, filters, numbered pages), the Owner's instruction
 * form, the detail (movements "Pencairan" / "Pengembalian ke-n" with their KK / KM numbers, linked requests, notes) with
 * the actions the server allows (cancel: Owner; disbursement + its void: Finance of the lender, G1; repayment + its
 * void: Finance of the borrower) and the "Pencairan pinjaman antar-PT" section of the transfer queue. Every action goes
 * to /api/v1/intercompany-loans (roles, G1, fund check, both PTs' lock dates re-checked, audited in both PTs).
 */
export const IC_LOAN_TONE: Record<IcLoanStatus, PillTone> = { instructed: 'wait', disbursed: 'progress', partially_repaid: 'progress', repaid: 'ok', cancelled: 'none' }

const STYLE = `
.pk-icl-flow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; }
.pk-icl-flow .arrow { font-size: 18px; color: var(--theme-elevation-500); }
.pk-icl-flow .who { font-size: 12px; color: var(--theme-elevation-600); display: block; }
.pk-icl-dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; font-size: 14px; }
.pk-icl-dl dt { color: var(--theme-elevation-600); }
.pk-icl-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
tr[data-pk-status="void"] td { color: var(--theme-elevation-500); }
@media (max-width: 640px) { .pk-icl-flow { grid-template-columns: 1fr; } .pk-icl-flow .arrow { transform: rotate(90deg); justify-self: start; } .pk-icl-dl { grid-template-columns: 1fr; gap: 2px; } }
`

const BASE = '/admin/pinjaman-antar-pt'
const back = (
  <Link className="pk-kbtn" href={BASE}>
    ← Pinjaman antar-PT
  </Link>
)

function StatusCell({ l }: { l: Pick<IcLoanSummary, 'status' | 'statusLabel' | 'overdue' | 'daysOverdue'> }) {
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      <StatusPill tone={IC_LOAN_TONE[l.status]} label={l.statusLabel} />
      {l.overdue ? <StatusPill tone="bad" label={`${IC_OVERDUE_LABEL} · ${l.daysOverdue} hari`} /> : null}
    </span>
  )
}

const pt = (c: IcLoanSummary['lender']) => (c ? c.shortCode : '—')
/** DRMS 24/10: the inter-PT loan as named in the popups (cancel, disburse, repay, void). */
const icLoanDoc = (l: Pick<IcLoanSummary, 'docNo' | 'lender' | 'borrower' | 'amount' | 'dueDate'>) => ({
  object: l.docNo,
  summary: [['Pinjaman antar-PT', l.docNo], ['PT pemberi', pt(l.lender)], ['PT peminjam', pt(l.borrower)], ['Nilai', rp(l.amount)], ['Jatuh tempo', dateId(l.dueDate)]] as const,
})

function loanCols(): Col<IcLoanSummary>[] {
  return [
    {
      key: 'no',
      label: 'Nomor',
      sort: 'descending',
      cell: (l) => (
        <>
          <a href={icLoanHref(l.id)} data-pk-icloan={l.docNo}>
            {l.docNo}
          </a>
          <span className="sub" title={l.reason}>
            {l.reason}
          </span>
        </>
      ),
    },
    {
      key: 'p',
      label: 'Pemberi → peminjam',
      cell: (l) => (
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <PtChip pt={l.lender} /> → <PtChip pt={l.borrower} />
          <span className="sub">{l.side === 'lender' ? 'Piutang' : l.side === 'borrower' ? 'Hutang' : 'Kedua PT'}</span>
        </span>
      ),
    },
    { key: 'st', label: 'Status', cell: (l) => <StatusCell l={l} /> },
    { key: 'due', label: 'Jatuh tempo', sec: true, cell: (l) => <span className="nw">{dateId(l.dueDate)}</span> },
    { key: 'amt', label: 'Nilai', num: true, cell: (l) => rp(l.amount) },
    { key: 'out', label: 'Sisa', num: true, cell: (l) => <b>{rp(l.outstanding)}</b> },
  ]
}

const STATUS_FILTER = { key: 'status', label: 'Status', multi: true, options: IC_LOAN_STATUSES.map((s) => ({ value: s, label: IC_LOAN_STATUS_LABELS[s] })) }
const ROLE_FILTER = { key: 'peran', label: 'Peran PT', multi: true, options: [{ value: 'lender', label: 'Pemberi (piutang)' }, { value: 'borrower', label: 'Peminjam (hutang)' }] }
const OVERDUE_FILTER = { key: 'terlambat', label: 'Terlambat', all: 'Semua', multi: true, options: [{ value: 'ya', label: 'Terlambat saja' }] }

function roleOf(lq: ListQuery): 'lender' | 'borrower' | undefined {
  const r = allowedValues(lq, 'peran', ['lender', 'borrower'] as const)
  return r.length === 1 ? r[0] : undefined
}

/** PTs where the caller is Owner (STORED pk-principal) — the borrowers he may instruct a loan for. */
function ownerPts(req: PayloadRequest): number[] {
  return membershipsOf(req.user, { all: true })
    .filter((m) => (m.exactRoles ?? m.roles).includes('pk-principal'))
    .map((m) => m.company)
}

// ================================================================ list

export async function IcLoanList(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRoleAny(req, ...IC_LOAN_READ_ROLES)) return <NoAccess props={props} />
  const sp = props.searchParams as Record<string, string | string[] | undefined> | undefined
  const lq = parseListQuery(sp, ['status', 'peran', 'terlambat'])
  const status = allowedValues(lq, 'status', IC_LOAN_STATUSES)
  const role = roleOf(lq)
  const d = await withReqTransaction(req, async () => {
    const page = await listIcLoans(req, { role, status, overdue: lq.filters.terlambat === 'ya', q: lq.q, page: lq.page, limit: lq.per })
    const positions = await icLoanPositions(req, await icLoanReportScope(req))
    const queue = await icLoanQueue(req)
    return { page, positions, queue: queue.count }
  })
  const page = pageOfFind({ docs: d.page.items, page: d.page.page, totalDocs: d.page.totalDocs, totalPages: d.page.totalPages, limit: d.page.limit })
  const sum = (k: 'receivable' | 'payable' | 'overdue') => d.positions.reduce((s, x) => s + x[k], 0)
  const canInstruct = ownerPts(req).length > 1
  const filtered = Boolean(status.length || role || lq.q || lq.filters.terlambat)
  return (
    <Frame props={props} name="pinjaman-antar-pt">
      <style>{STYLE}</style>
      <DashHead title="Pinjaman antar-PT" note="Diperintahkan Owner · dicairkan Finance PT pemberi · dikembalikan Finance PT peminjam · uang nyata antar PT grup (KK + KM otomatis), tanpa bunga">
        <div className="pk-kact">
          {canInstruct ? (
            <Link className="pk-kbtn primary" href={`${BASE}/baru`} data-pk-link="icloan-baru">
              + Perintahkan pinjaman
            </Link>
          ) : null}
          {d.queue > 0 ? (
            <Link className="pk-kbtn" href="/admin/antrian-transfer#pencairan-pinjaman">
              Menunggu pencairan Anda ({d.queue})
            </Link>
          ) : null}
          <Link className="pk-kbtn" href="/admin/laporan/pinjaman-antar-pt">
            Laporan
          </Link>
        </div>
      </DashHead>
      <Bento label="Ringkasan pinjaman antar-PT">
        <KpiRow cols={3}>
          <KpiTile id="icl-receivable" icon="up" label="Piutang antar-PT (sisa)" value={rp(sum('receivable'))} title={rp(sum('receivable'))} kpi="icloan-receivable" href={`${BASE}?peran=lender`} more="Lihat" i={0} />
          <KpiTile id="icl-payable" icon="down" label="Hutang antar-PT (sisa)" value={rp(sum('payable'))} title={rp(sum('payable'))} kpi="icloan-payable" href={`${BASE}?peran=borrower`} more="Lihat" i={1} />
          <KpiTile id="icl-overdue" icon="clock" label={IC_OVERDUE_LABEL} value={rp(sum('overdue'))} title={rp(sum('overdue'))} kpi="icloan-overdue" href={`${BASE}?terlambat=ya`} more="Lihat" i={2} />
        </KpiRow>
        <Card id="icloans" title="Daftar pinjaman antar-PT" sub="Terbaru dulu · nomor dapat diklik">
          <ListToolbar id="pinjaman-antar-pt" action={BASE} query={lq} label="Cari dan saring pinjaman antar-PT" search={{ placeholder: 'Nomor, alasan, kode PT…' }} filters={[STATUS_FILTER, ROLE_FILTER, OVERDUE_FILTER]} />
          <DataTable
            id="icloans"
            paged={false}
            rowHref={(l) => icLoanHref(l.id)}
            cols={loanCols()}
            rows={page.items}
            rowKey={(l) => l.id}
            rowAttrs={(l) => ({ 'data-pk-row': l.docNo, 'data-pk-status': l.status })}
            caption="Pinjaman antar-PT"
            empty={<EmptyState text={filtered ? 'Tidak ada pinjaman untuk filter ini.' : 'Belum ada pinjaman antar-PT.'} action={canInstruct ? { href: `${BASE}/baru`, label: '+ Perintahkan pinjaman' } : undefined} />}
          />
          <Pager id="pinjaman-antar-pt" path={BASE} sp={sp} page={page} unit="pinjaman" />
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ new (Owner)

export async function IcLoanNew(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const mine = ownerPts(req)
  const head = (
    <DashHead title="Perintahkan pinjaman antar-PT" note="Nomor PJA dari PT pemberi. Finance PT pemberi mencairkan dari Antrian Transfer; Owner menyetujui ulang pengajuan setelah dana masuk.">
      {back}
    </DashHead>
  )
  if (mine.length < 2) {
    return (
      <Frame props={props} name="pinjaman-antar-pt-baru">
        {head}
        <Alert tone="bad" attr="denied">
          <p>Pinjaman antar-PT diperintahkan oleh Owner (peran Owner di PT pemberi dan PT peminjam).</p>
        </Alert>
      </Frame>
    )
  }
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const borrowers = await withSystemTransaction(req.payload, req.user, async (r) => companyRefs(r, mine))
  const initialBorrower = sp.borrower && /^\d{1,10}$/.test(sp.borrower) && mine.includes(Number(sp.borrower)) ? Number(sp.borrower) : undefined
  const initialRequestIds = (sp.requests ?? '')
    .split(',')
    .filter((x) => /^\d{1,10}$/.test(x))
    .map(Number)
  const initialAmount = sp.amount && /^\d{1,13}$/.test(sp.amount) ? Number(sp.amount) : undefined
  return (
    <Frame props={props} name="pinjaman-antar-pt-baru">
      {head}
      <Bento>
        <Card id="icloan-form" title="Perintah pinjaman" span={8}>
          <IcLoanInstructForm borrowers={borrowers} initialBorrower={initialBorrower} initialRequestIds={initialRequestIds} initialAmount={initialAmount} />
        </Card>
        <Card id="icloan-help" title="Alur" span={4}>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>Owner memilih PT pemberi yang dana tersedianya cukup; nilai dicadangkan di PT pemberi.</li>
            <li>Finance PT pemberi mencairkan (KK di PT pemberi, KM otomatis di rekening penerimaan antar-PT PT peminjam).</li>
            <li>Owner menyetujui ulang pengajuan yang tertahan — cek dana diulang saat itu.</li>
            <li>Finance PT peminjam mencatat pengembalian (boleh bertahap) sampai Lunas. Tanpa bunga; lewat jatuh tempo = Terlambat (pengingat harian).</li>
          </ol>
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ detail

/** Active accounts of PT `company` the caller reads (source of a loan movement; DRMS 24/10: no site exclusion). */
async function poolAccounts(req: PayloadRequest, company: number): Promise<Array<{ id: number; name: string }>> {
  const res = await req.payload.find({
    collection: 'cash-accounts',
    where: { and: [{ company: { equals: company } }, { active: { not_equals: false } }] },
    depth: 0,
    pagination: false,
    sort: 'name',
    select: { name: true },
    user: req.user,
    overrideAccess: false, // caller's read scope (Finance of that PT)
    req,
  })
  return res.docs.map((a) => ({ id: a.id as number, name: String((a as { name?: string }).name ?? '') }))
}

export async function IcLoanDetail(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRoleAny(req, ...IC_LOAN_READ_ROLES)) return <NoAccess props={props} />
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[2] ?? ''
  const id = /^\d{1,10}$/.test(seg) ? Number(seg) : 0
  const d = await withReqTransaction(req, async () => {
    const loan = id ? await loadVisibleIcLoan(req, id).catch(() => null) : null
    if (!loan) return null
    const l = await icLoanDetail(req, loan)
    const acts = new Set(l.allowedActions)
    const lenderAccounts = acts.has('disburse') ? await poolAccounts(req, loan.lenderId) : []
    const borrowerAccounts = acts.has('repay') ? await poolAccounts(req, loan.borrowerId) : []
    return { l, lenderAccounts, borrowerAccounts, tz: (await settings(req)).timezone || process.env.TZ || DEFAULT_TZ }
  })
  if (!d) {
    return (
      <Frame props={props} name="pinjaman-antar-pt-detail">
        <DashHead title="Pinjaman antar-PT tidak ditemukan">{back}</DashHead>
      </Frame>
    )
  }
  const { l, tz } = d
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const acts = new Set(l.allowedActions)
  const active = l.status === 'disbursed' || l.status === 'partially_repaid' || l.status === 'repaid'
  const lender = pt(l.lender)
  const borrower = pt(l.borrower)
  const mvCols: Col<(typeof l.movements)[number]>[] = [
    { key: 'n', label: 'Pergerakan', cell: (m) => (m.status === 'void' ? <StatusPill tone="none" label={`${m.label} (void)`} /> : m.label) },
    { key: 'd', label: 'Tanggal', cell: (m) => <span className="nw">{m.transferAt ? dateTimeId(m.transferAt, tz) : dateId(m.transferDate)}</span> },
    { key: 'a', label: 'Nominal', num: true, cell: (m) => rp(m.amount) },
    {
      key: 'e',
      label: 'KK / KM',
      sec: true,
      cell: (m) => (
        <>
          {m.kk ? m.kk.id ? <a href={`/admin/collections/cash-entries/${m.kk.id}`}>{m.kk.entryNo}</a> : m.kk.entryNo : '—'} → {m.km ? m.km.id ? <a href={`/admin/collections/cash-entries/${m.km.id}`}>{m.km.entryNo}</a> : m.km.entryNo : '—'}
          <span className="sub">
            {m.bankRef ? `Ref ${m.bankRef} · ` : ''}
            {m.executedBy.name ?? '—'}
            {m.proofId ? (
              <>
                {' · '}
                <a href={`/api/v1/media/transfer-proofs/${m.proofId}/file`} target="_blank" rel="noopener noreferrer">
                  bukti
                </a>
              </>
            ) : null}
            {m.status === 'void' ? ` · Void: ${m.voidReason ?? ''}` : ''}
          </span>
        </>
      ),
    },
    {
      key: 'x',
      label: 'Aksi',
      cell: (m) =>
        m.status !== 'posted' ? (
          '—'
        ) : m.kind === 'disbursement' && acts.has('void_disbursement') ? (
          <ReasonAction
            url={`/api/v1/intercompany-loans/${l.id}/disbursement/void`}
            label="Void pencairan"
            title={`Void pencairan ${l.docNo}?`}
            description={<>KK di PT {lender} dan KM di PT {borrower} dibalik (jurnal balik), pinjaman kembali menunggu pencairan. Pengajuan yang sudah disetujui tetap disetujui. Untuk pengembalian dana pakai &quot;Catat pengembalian&quot;, bukan void.</>}
            confirmLabel="Void pencairan"
            confirm={{ field: 'confirmBorrowerShortfall', label: `Saya mengerti dana tersedia PT ${borrower} bisa menjadi minus (dana sudah terpakai / dijanjikan).` }}
            testId={`icloan-void-disbursement-${m.id}`}
          />
        ) : m.kind === 'repayment' && acts.has('void_repayment') ? (
          <ReasonAction
            url={`/api/v1/intercompany-loans/${l.id}/repayments/${m.id}/void`}
            label="Void"
            title={`Void ${m.label.toLowerCase()}?`}
            description={<>KK di PT {borrower} dan KM di PT {lender} dibalik; sisa pinjaman bertambah lagi.</>}
            confirmLabel="Void pengembalian"
            summary={[...icLoanDoc(l).summary, ['Pengembalian', m.label], ['Nominal pengembalian', rp(m.amount)]]}
            testId={`icloan-void-repayment-${m.id}`}
          />
        ) : (
          '—'
        ),
    },
  ]
  const page = (
    <Frame props={props} name="pinjaman-antar-pt-detail">
      <style>{STYLE}</style>
      <DashHead title={l.docNo} note={`PT ${lender} → PT ${borrower} · diperintahkan ${l.createdBy.name ?? '—'} · ${dateId(l.instructionDate)}`}>
        <div className="pk-kact">{back}</div>
      </DashHead>
      {sp.baru ? (
        <Alert tone="ok" attr="instructed">
          <p>
            <strong>{l.docNo}</strong> diperintahkan · Finance PT {lender} diberi tahu untuk mencairkan.
          </p>
        </Alert>
      ) : null}
      {l.status === 'cancelled' ? (
        <Alert tone="info" attr="cancelled">
          <p>Dibatalkan: {l.cancelReason}</p>
        </Alert>
      ) : l.overdue ? (
        <Alert tone="bad" attr="overdue">
          <p>
            {IC_OVERDUE_LABEL} {l.daysOverdue} hari: jatuh tempo {dateId(l.dueDate)}, sisa {rp(l.outstanding)}.
          </p>
        </Alert>
      ) : null}
      {[l.ownRequestNote, l.droppedRequestNote, l.disburseBlockedByG1 ? 'Anda yang memerintahkan pinjaman ini — pencairan harus dicatat Finance lain (G1).' : null, !l.lenderHasReceivingAccount && active ? `PT ${lender} belum menetapkan rekening penerimaan antar-PT — pengembalian belum dapat dicatat.` : null]
        .filter((x): x is string => !!x)
        .map((n) => (
          <p key={n} className="pk-note" data-pk-icloan-note style={{ margin: '0 0 8px' }}>
            <StatusPill tone="warn" label="Catatan" /> {n}
          </p>
        ))}
      {acts.has('cancel') ? (
        <div className="pk-actions" style={{ gap: 8, marginBottom: 12 }}>
          <ReasonAction
            url={`/api/v1/intercompany-loans/${l.id}/cancel`}
            label="Batalkan perintah"
            size="md"
            variant="secondary"
            title={`Batalkan ${l.docNo}?`}
            description={<>Perintah dibatalkan (nomor tetap tercatat), cadangan dana PT {lender} dilepas. Alasan wajib.</>}
            confirmLabel="Batalkan perintah"
            testId="icloan-cancel"
          />
        </div>
      ) : null}
      {acts.has('disburse') ? (
        <section style={{ marginBottom: 16 }} data-pk-icloan-disburse>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Cairkan pinjaman</h2>
          <IcLoanMoneyForm url={`/api/v1/intercompany-loans/${l.id}/disburse`} submitLabel="Catat pencairan" accounts={d.lenderAccounts} amountText={`Transfer ${rp(l.amount)} dari PT ${lender} ke rekening penerimaan antar-PT PT ${borrower}`} testId="icloan-disburse" />
        </section>
      ) : null}
      {acts.has('repay') ? (
        <section style={{ marginBottom: 16 }} data-pk-icloan-repay>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Catat pengembalian</h2>
          <IcLoanMoneyForm
            url={`/api/v1/intercompany-loans/${l.id}/repayments`}
            submitLabel="Catat pengembalian"
            accounts={d.borrowerAccounts}
            amountText={`Pengembalian dari PT ${borrower} ke rekening penerimaan antar-PT PT ${lender} · sisa ${rp(l.outstanding)}`}
            amount={{ max: l.outstanding }}
            testId="icloan-repay"
          />
        </section>
      ) : null}
      <Bento label="Pinjaman antar-PT">
        <KpiRow cols={4}>
          <KpiTile id="icl-amount" icon="wallet" label="Nilai pinjaman" value={rp(l.amount)} title={rp(l.amount)} kpi="icloan-amount" i={0}>
            <p className="pk-kpi-x">
              <StatusCell l={l} />
            </p>
          </KpiTile>
          <KpiTile id="icl-repaid" icon="check" label="Sudah kembali" value={active ? rp(l.repaidTotal) : '—'} title={rp(l.repaidTotal)} kpi="icloan-repaid" i={1}>
            {active ? <Meter value={l.repaidTotal} max={Math.max(1, l.amount)} tone={l.status === 'repaid' ? 'ok' : l.overdue ? 'over' : 'warn'} /> : null}
          </KpiTile>
          <KpiTile id="icl-outstanding" icon="target" label="Sisa pinjaman" value={active ? rp(l.outstanding) : '—'} title={rp(l.outstanding)} kpi="icloan-outstanding" i={2}>
            <p className="pk-kpi-x">{active ? `dari ${rp(l.amount)}` : l.status === 'instructed' ? 'Menunggu pencairan' : 'Tidak ada'}</p>
          </KpiTile>
          <KpiTile id="icl-due" icon="doc" label="Jatuh tempo" value={dateId(l.dueDate)} kpi="icloan-due" i={3}>
            <p className="pk-kpi-x">Tanpa bunga</p>
          </KpiTile>
        </KpiRow>
        <Card id="icloan-detail" title="Rincian" span={7} i={4}>
          <div className="pk-icl-flow" data-pk-icloan-flow>
            <div>
              <span className="who">PT pemberi (piutang)</span>
              <b>
                {lender} {l.lender?.name ?? ''}
              </b>
            </div>
            <span className="arrow" aria-hidden>
              →
            </span>
            <div>
              <span className="who">PT peminjam (hutang)</span>
              <b>
                {borrower} {l.borrower?.name ?? ''}
              </b>
            </div>
          </div>
          <dl className="pk-icl-dl" style={{ marginTop: 16 }}>
            <dt>Alasan</dt>
            <dd className="pk-pre" data-pk-field="reason">
              {l.reason}
            </dd>
            <dt>Pengajuan terkait</dt>
            <dd data-pk-icloan-requests>
              {l.requests.length === 0
                ? '—'
                : l.requests.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 ? ', ' : ''}
                      {r.title !== null ? <a href={`/admin/collections/expense-requests/${r.id}`}>{r.docNo ?? `#${r.id}`}</a> : (r.docNo ?? `#${r.id}`)}
                      {r.statusLabel ? ` (${r.statusLabel})` : ''}
                    </span>
                  ))}
            </dd>
            {l.snapshot ? (
              <>
                <dt>Saat diperintahkan</dt>
                <dd>
                  Dana tersedia PT {borrower} {rp(Number(l.snapshot.borrowerAvailable ?? 0))} · PT {lender} {rp(Number(l.snapshot.lenderAvailable ?? 0))}
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card id="icloan-movements" title="Pencairan & pengembalian" sub={'KK di PT pembayar + KM otomatis "Antar PT" di PT penerima'} span={5} i={5}>
          <DataTable id="icloan-movements" caption="Pergerakan dana pinjaman" cols={mvCols} rows={l.movements} rowKey={(m) => m.id} rowAttrs={(m) => ({ 'data-pk-movement': String(m.id), 'data-pk-status': m.status })} empty={<EmptyState text="Belum dicairkan." />} />
        </Card>
      </Bento>
    </Frame>
  )
  // DRMS 24/10: every action of the page names the loan in its popups
  return <DocSummaryProvider {...icLoanDoc(l)}>{page}</DocSummaryProvider>
}

// ================================================================ transfer queue section (lender Finance)

/** Second part of "Antrian Transfer": "Pencairan pinjaman antar-PT" (instructed loans of the caller's lender PTs). */
export async function IcLoanQueueSection({ req }: { req: PayloadRequest }) {
  if (companiesWithRole(req, ['pk-finance']).length === 0) return null
  // own transaction: rendered next to the request queue
  const d = await withSystemTransaction(req.payload, req.user, async (r) => {
    const q = await icLoanQueue(r)
    const accounts = new Map<number, Array<{ id: number; name: string }>>()
    for (const it of q.items) if (it.lender && !accounts.has(it.lender.id)) accounts.set(it.lender.id, await poolAccounts(r, it.lender.id))
    return { q, accounts }
  })
  return (
    <section id="pencairan-pinjaman" style={{ marginTop: 32 }} data-pk-queue="icloan">
      <h2 style={{ margin: '0 0 8px' }}>Pencairan pinjaman antar-PT ({d.q.count})</h2>
      <p style={{ fontSize: 13, color: 'var(--pk-muted-fg)', margin: '0 0 8px' }}>
        Perintah Owner: transfer dari PT pemberi ke rekening penerimaan antar-PT PT peminjam. KK tercatat di PT Anda, KM otomatis di PT peminjam. Pencairan tidak boleh dicatat oleh pembuat perintah (G1); dana tersedia PT diperiksa ulang.
      </p>
      {d.q.items.length === 0 ? (
        <p style={{ fontSize: 13 }}>Tidak ada pinjaman antar-PT yang menunggu pencairan.</p>
      ) : (
        d.q.items.map((it) => (
          <article key={it.id} data-pk-icloan-queue-item={it.id} style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 12, marginBottom: 12 }}>
            <p style={{ margin: '0 0 6px' }}>
              <a href={icLoanHref(it.id)}>
                <strong>{it.docNo}</strong>
              </a>{' '}
              · PT {pt(it.lender)} → PT {pt(it.borrower)} · {rp(it.amount)} · jatuh tempo {dateId(it.dueDate)} · diperintahkan {it.createdBy.name ?? '—'}
            </p>
            <p style={{ margin: '0 0 6px', fontSize: 13 }}>
              Tujuan: {it.destination ? `${it.destination.bankName ?? ''} · ${it.destination.accountHolder} · ${it.destination.accountNoMasked ?? ''}` : 'PT peminjam belum menetapkan rekening penerimaan antar-PT'} · {it.reason}
            </p>
            {it.canDisburse && it.lender && hasRole(req, 'pk-finance', it.lender.id) ? (
              <DocSummaryProvider {...icLoanDoc(it)}>
                <IcLoanMoneyForm url={`/api/v1/intercompany-loans/${it.id}/disburse`} submitLabel="Catat pencairan" accounts={d.accounts.get(it.lender.id) ?? []} amountText={`Transfer ${rp(it.amount)}`} testId={`icloan-disburse-${it.id}`} />
              </DocSummaryProvider>
            ) : it.g1Note ? (
              <p className="pk-note" style={{ margin: 0 }}>
                <StatusPill tone="warn" label="G1" /> {it.g1Note}
              </p>
            ) : null}
          </article>
        ))
      )}
    </section>
  )
}

export default IcLoanList
