import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { relId } from '@/access/roles'
import { CashEntryForm, type CashEntryFormProps } from '@/admin/components/kas/CashEntryForm'
import { ReasonAction } from '@/admin/components/kas/ReasonAction'
import { KAS_STYLE } from '@/admin/components/kas/style'
import {
  accountFlows,
  canEdit,
  canVoid,
  cashBookPage,
  cashLookups,
  closablePeriods,
  kasAccess,
  minPostingDate,
  parseBookQuery,
  periodState,
  periodSummaries,
  recentPeriods,
  voidHint,
  type BookQuery,
  type BookRow,
  type Lookups,
} from '@/domain/cash/book'
import { balances, currentLockDate, type CashEntryDoc } from '@/domain/cash/ledger'
import { periodEnd } from '@/domain/cash/periods'
import { displayName, settings, today as businessToday } from '@/domain/expense/common'
import { MONTHS_SHORT, periodLabel } from '@/domain/reports/rules'
import type { PillTone } from '@/domain/reports/viz'
import { withReqTransaction } from '@/lib/system-tx'
import { formatServerTime } from '@/pdf/format'

import { ChartHover } from './ChartHover'
import { F3Root } from './f3-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, rp, rpShort, StatusPill, VIZ_STYLE, type Col } from './viz'

/**
 * E2 (fase1-golive §E2, US-23/US-24, ADR 0005): web "Kas" for Finance — buku kas with filters,
 * saldo per akun, forms kas masuk/keluar, edit before period close, Void (reason), and "Tutup buku"
 * (close; re-open = Direktur = role pk-owner, user decision G1-1). Custom root views inside the
 * default template; data read with the caller's access, every write goes to the /api/v1 domain
 * endpoints from client components (Zod, role + state re-check, audit, Idempotency-Key). The
 * collections keep create/update: denyAll. Direktur reads (and may close/re-open periods); PM,
 * Staff and Admin get no menu entry and a "no access" page (the API answers them 403).
 */

const PAGE_STYLE = `
.pk-f3 .pk-t tr:target td { background: color-mix(in oklab, var(--pk-primary) 12%, transparent); }
.pk-f3 .pk-t .links { display: block; font-size: 12px; margin-top: 2px; color: var(--pk-muted-fg); }
.pk-f3 .pk-t .links a { font-weight: 600; }
.pk-f3 .pk-t td.act { white-space: nowrap; }
.pk-f3 .pk-t .hint { font-size: 11.5px; color: var(--pk-muted-fg); white-space: normal; max-width: 22ch; display: inline-block; }
.pk-f3 form.pk-filter input[type='month'] { min-width: 150px; }
.pk-f3 form.pk-filter .pk-kbtn { align-self: flex-end; }
.pk-f3 .pk-pager { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; color: var(--pk-muted-fg); }
.pk-f3 .pk-kpi.dim { opacity: .75; }
@media (max-width: 559px) { .pk-f3 .pk-dash-head .pk-kact { width: 100%; } .pk-f3 .pk-dash-head .pk-kact > * { flex: 1 1 auto; } }
/* phones: saldo tiles 2-up and compact; ledger rows become cards (no sideways scrolling) */
@media (max-width: 559px) {
  .pk-f3 .pk-kas-tiles .pk-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pk-f3 .pk-kas-tiles .pk-kpi { padding: 12px; }
  .pk-f3 .pk-kas-tiles .pk-kpi-v { font-size: 20px; }
  .pk-f3 .pk-kas-tiles .pk-kpi-l .ic { display: none; }
  .pk-f3 .pk-kas-tiles .pk-kpi-x + .pk-kpi-x, .pk-f3 .pk-kas-tiles .pk-kpi-more { display: none; }
}
@container (max-width: 640px) {
  .pk-f3 table.pk-t[data-pk-table='kas-book'] thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .pk-f3 table.pk-t[data-pk-table='kas-book'], .pk-f3 table.pk-t[data-pk-table='kas-book'] tbody { display: block; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 0; border-bottom: 1px solid var(--pk-border); }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td { display: block; padding: 0; border: 0; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td:nth-child(1) { grid-column: 1; grid-row: 1; font-size: 12px; color: var(--pk-muted-fg); }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td:nth-child(2) { grid-column: 1 / -1; grid-row: 2; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td:nth-child(5) { grid-column: 2; grid-row: 1; justify-self: end; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td:nth-child(6) { grid-column: 1; grid-row: 3; text-align: left; font-weight: 700; font-size: 14px; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] td:nth-child(7) { grid-column: 2; grid-row: 3; justify-self: end; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] .sub { max-width: none; white-space: normal; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] .hint { max-width: 16ch; text-align: right; }
  .pk-f3 table.pk-t[data-pk-table='kas-book'] tbody tr:hover td { background: none; }
}
`

const SOURCE: Record<CashEntryDoc['sourceType'], string> = { transfer: 'Transfer', settlement_refund: 'Pengembalian LPJ', manual: 'Manual', reversal: 'Jurnal balik', opening: 'Saldo awal' }
const dayMonth = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? ''} ${date.slice(0, 4)}`
const SR: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }

/** DefaultTemplate (nav + header) around a pk-f3 root, like Shell but with the dashboard header. */
function Frame({ props, name, children }: { props: AdminViewServerProps; name: string; children: React.ReactNode }) {
  const { initPageResult, params, searchParams } = props
  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <F3Root name={name}>
          <style>{VIZ_STYLE}</style>
          <style>{KAS_STYLE}</style>
          <style>{PAGE_STYLE}</style>
          {children}
        </F3Root>
      </Gutter>
    </DefaultTemplate>
  )
}

function Denied({ props, title, roles }: { props: AdminViewServerProps; title: string; roles: string }) {
  return (
    <Frame props={props} name="kas-denied">
      <DashHead title={title} />
      <div className="pk-alert bad" data-pk-denied>
        <b aria-hidden>!</b>
        <p>Halaman ini hanya untuk {roles}.</p>
      </div>
    </Frame>
  )
}

const labelOf = (list: Array<{ id: number; label: string }>, id: number | null) => (id === null ? null : (list.find((x) => x.id === id)?.label ?? `#${id}`))

// ================================================================ Buku kas

export async function KasBook(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!kasAccess(req.user).view) return <Denied props={props} title="Kas" roles="Finance dan Direktur" />
  const sp = (props.searchParams ?? {}) as Record<string, string | string[] | undefined>
  const q = parseBookQuery(sp)
  const canWrite = kasAccess(req.user).write
  const d = await withReqTransaction(req, async () => {
    const todayDate = await businessToday(req)
    const lockDate = await currentLockDate(req)
    const lk = await cashLookups(req)
    const page = await cashBookPage(req, q)
    const bal = await balances(req)
    const flowPeriod = q.periode ?? todayDate.slice(0, 7)
    const flows = await accountFlows(req, flowPeriod)
    const flashId = Number(typeof sp.baru === 'string' ? sp.baru : typeof sp.diubah === 'string' ? sp.diubah : NaN)
    const flash = Number.isSafeInteger(flashId) && flashId > 0 ? await req.payload.findByID({ collection: 'cash-entries', id: flashId, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null) : null
    return { todayDate, lockDate, lk, page, bal, flowPeriod, flows, flash: flash as unknown as CashEntryDoc | null }
  })
  const { todayDate, lockDate, lk, page, bal, flowPeriod, flows, flash } = d
  const total = bal.reduce((s, a) => s + a.balance, 0)
  const activeIds = new Set(lk.accounts.filter((a) => a.active).map((a) => a.id))
  const tiles = bal.filter((a) => activeIds.has(a.cashAccountId) || a.balance !== 0)
  const filtered = Boolean(q.akun || q.periode || q.project || q.pusat || q.arah || q.status)
  const flashAcc = flash ? bal.find((a) => a.cashAccountId === relId(flash.cashAccount)) : undefined
  return (
    <Frame props={props} name="kas">
      <ChartHover>
        <DashHead title="Kas" note={`Buku kas per ${dayMonth(todayDate)} (WITA) · tutup buku ${lockDate ? `s/d ${dayMonth(lockDate)}` : 'belum ada'} · termasuk void & jurnal balik`}>
          <div className="pk-kact">
            {canWrite ? (
              <>
                <Link className="pk-kbtn primary" href="/admin/kas/baru?arah=masuk" data-pk-link="kas-masuk">
                  <span aria-hidden>↓</span> Kas masuk
                </Link>
                <Link className="pk-kbtn primary" href="/admin/kas/baru?arah=keluar" data-pk-link="kas-keluar">
                  <span aria-hidden>↑</span> Kas keluar
                </Link>
              </>
            ) : null}
            <Link className="pk-kbtn" href="/admin/tutup-buku" data-pk-link="tutup-buku">
              Tutup buku
            </Link>
          </div>
        </DashHead>

        {flash ? (
          <div className="pk-alert ok" role="status" data-pk-flash={flash.entryNo}>
            <b aria-hidden>✓</b>
            <p>
              <strong>{flash.entryNo}</strong> {typeof sp.diubah === 'string' ? 'diperbarui' : 'tersimpan'} · {flash.direction === 'in' ? 'masuk' : 'keluar'} {rp(flash.amount)}
              {flashAcc ? (
                <>
                  {' '}
                  · saldo {flashAcc.name} sekarang <strong>{rp(flashAcc.balance)}</strong>
                </>
              ) : null}
              .
            </p>
          </div>
        ) : null}
        {!canWrite ? (
          <div className="pk-alert info">
            <b aria-hidden>i</b>
            <p>Tampilan baca untuk Direktur. Pencatatan, edit dan void kas dilakukan oleh Finance.</p>
          </div>
        ) : null}

        <div className="pk-kas-tiles">
        <Bento label="Saldo per akun">
          <KpiRow cols={4}>
            <KpiTile id="kas-total" icon="wallet" label="Saldo kas total" value={rpShort(total)} title={rp(total)} kpi="kas-total" i={0}>
              <p className="pk-kpi-x">{rp(total)}</p>
              <p className="pk-kpi-x">{tiles.length} akun · saldo awal + masuk − keluar</p>
            </KpiTile>
            {tiles.map((a, i) => {
              const f = flows.get(a.cashAccountId) ?? { n: 0, tin: 0, tout: 0 }
              return (
                <KpiTile key={a.cashAccountId} id={`kas-acc-${a.cashAccountId}`} icon="wallet" label={a.name} value={rpShort(a.balance)} title={rp(a.balance)} kpi={`acc-${a.cashAccountId}`} href={`/admin/kas?akun=${a.cashAccountId}`} more="Buku akun ini" i={i + 1}>
                  <p className="pk-kpi-x">{rp(a.balance)}</p>
                  <p className="pk-kpi-x">
                    {periodLabel(flowPeriod)}: masuk <b>{rpShort(f.tin)}</b> · keluar <b>{rpShort(f.tout)}</b>
                  </p>
                </KpiTile>
              )
            })}
          </KpiRow>
        </Bento>
        </div>

        <FilterBar q={q} lk={lk} filtered={filtered} />

        <Bento label="Buku kas">
          <Card
            id="kas-book"
            title="Buku kas"
            sub={`${page.totalDocs} transaksi${filtered ? ' (terfilter)' : ''} · terbaru dulu · baris void tetap tampil, jurnal baliknya tertaut`}
          >
            <LedgerTable rows={page.rows} lk={lk} lockDate={lockDate} canWrite={canWrite} filtered={filtered} />
            <Pager q={q} page={page.page} totalPages={page.totalPages} />
          </Card>
        </Bento>
      </ChartHover>
    </Frame>
  )
}

function FilterBar({ q, lk, filtered }: { q: BookQuery; lk: Lookups; filtered: boolean }) {
  const sel = (name: string, label: string, list: Array<{ id: number; label: string }>, value: number | undefined, all: string) => (
    <label>
      {label}
      <select name={name} defaultValue={value ? String(value) : ''}>
        <option value="">{all}</option>
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <form className="pk-filter" method="get" action="/admin/kas" role="search" aria-label="Filter buku kas" data-pk-filter="kas">
      {sel('akun', 'Akun', lk.accounts, q.akun, 'Semua akun')}
      <label>
        Periode
        <input type="month" name="periode" defaultValue={q.periode ?? ''} />
      </label>
      {sel('project', 'Project', lk.projects, q.project, 'Semua project')}
      {sel('pusat', 'Pusat biaya', lk.costCenters, q.pusat, 'Semua pusat biaya')}
      <label>
        Arah
        <select name="arah" defaultValue={q.arah ?? ''}>
          <option value="">Masuk & keluar</option>
          <option value="masuk">Masuk</option>
          <option value="keluar">Keluar</option>
        </select>
      </label>
      <label>
        Status
        <select name="status" defaultValue={q.status ?? ''}>
          <option value="">Semua</option>
          <option value="posted">Posted</option>
          <option value="void">Void</option>
        </select>
      </label>
      <button type="submit" className="pk-kbtn primary">
        Terapkan
      </button>
      {filtered ? (
        <Link className="pk-kbtn" href="/admin/kas">
          Reset
        </Link>
      ) : null}
    </form>
  )
}

function statusPill(r: BookRow): { tone: PillTone; label: string } {
  if (r.status === 'void') return { tone: 'bad', label: 'Void' }
  if (r.sourceType === 'reversal') return { tone: 'warn', label: 'Jurnal balik' }
  return { tone: 'ok', label: 'Posted' }
}

const entryLink = (x: { id: number; entryNo: string }, onPage: Set<number>) => <a href={onPage.has(x.id) ? `#ce-${x.id}` : `/admin/collections/cash-entries/${x.id}`}>{x.entryNo}</a>

function LedgerTable({ rows, lk, lockDate, canWrite, filtered }: { rows: BookRow[]; lk: Lookups; lockDate: string | null; canWrite: boolean; filtered: boolean }) {
  const onPage = new Set(rows.map((r) => r.id))
  const cols: Col<BookRow>[] = [
    { key: 'date', label: 'Tanggal', sort: 'descending', cell: (r) => <span className="nw">{dayMonth(r.entryDate)}</span> },
    {
      key: 'no',
      label: 'Transaksi',
      cell: (r) => (
        <>
          <a href={`/admin/collections/cash-entries/${r.id}`} data-pk-entry-no={r.entryNo}>
            {r.entryNo}
          </a>
          <span className="sub" title={r.description ?? ''}>
            {r.description ?? SOURCE[r.sourceType]}
          </span>
          {r.status === 'void' ? (
            <span className="links" data-pk-void-of={r.reversedBy?.entryNo}>
              Void: {r.voidReason ?? '—'}
              {r.reversedBy ? <> · dibalik oleh {entryLink(r.reversedBy, onPage)}</> : null}
            </span>
          ) : null}
          {r.reversalOf ? (
            <span className="links" data-pk-reversal-of={r.reversalOf.entryNo}>
              Jurnal balik dari {entryLink(r.reversalOf, onPage)}
            </span>
          ) : null}
          {r.request ? (
            <span className="links">
              Pengajuan <a href={`/admin/collections/expense-requests/${r.request.id}`}>{r.request.docNo ?? `#${r.request.id}`}</a>
            </span>
          ) : null}
        </>
      ),
    },
    { key: 'acc', label: 'Akun', sec: true, cell: (r) => labelOf(lk.accounts, r.cashAccountId) },
    {
      key: 'scope',
      label: 'Dibebankan / kategori',
      sec: true,
      cell: (r) => (
        <>
          {labelOf(lk.projects, r.projectId) ?? labelOf(lk.costCenters, r.costCenterId) ?? '—'}
          <span className="sub">{[labelOf(lk.categories, r.categoryId) ?? labelOf(lk.sources, r.cashInSourceId), labelOf(lk.vehicles, r.vehicleId)].filter(Boolean).join(' · ') || SOURCE[r.sourceType]}</span>
        </>
      ),
    },
    {
      key: 'st',
      label: 'Status',
      cell: (r) => {
        const p = statusPill(r)
        return <StatusPill tone={p.tone} label={p.label} />
      },
    },
    {
      key: 'amt',
      label: 'Nominal',
      num: true,
      cell: (r) => (
        <span className="amt nw">
          <span className={`dir ${r.direction}`} aria-hidden>
            {r.direction === 'in' ? '+' : '−'}
          </span>
          <span style={SR}>{r.direction === 'in' ? 'masuk ' : 'keluar '}</span>
          {rp(r.amount)}
        </span>
      ),
    },
    {
      key: 'act',
      label: 'Aksi',
      cell: (r) => (
        <div className="pk-kact">
          {r.proofId ? (
            <a className="pk-kbtn sm" href={`/api/v1/media/attachments/${r.proofId}/file`} target="_blank" rel="noopener noreferrer">
              Bukti
            </a>
          ) : null}
          {canWrite && canEdit(r, lockDate) ? (
            <a className="pk-kbtn sm" href={`/admin/kas/${r.id}/ubah`} data-pk-action={`edit-${r.id}`}>
              Edit
            </a>
          ) : null}
          {canWrite && canVoid(r) ? (
            <ReasonAction
              url={`/api/v1/cash-entries/${r.id}/void`}
              label="Void"
              title={`Void ${r.entryNo}?`}
              description={
                <>
                  Transaksi asli <strong>tetap tercatat</strong> dengan status Void, dan sistem membuat <strong>jurnal balik</strong> {r.direction === 'in' ? 'kas keluar' : 'kas masuk'} {rp(r.amount)}
                  {lockDate && r.entryDate <= lockDate ? ' bertanggal hari ini (periode aslinya sudah ditutup)' : ` bertanggal ${dayMonth(r.entryDate)}`}. Saldo akun kembali seperti sebelum transaksi ini.
                </>
              }
              confirmLabel="Void transaksi"
              testId={`void-${r.id}`}
            />
          ) : null}
          {canWrite && voidHint(r) ? <span className="hint">{voidHint(r)}</span> : null}
        </div>
      ),
    },
  ]
  return (
    <DataTable
      id="kas-book"
      cols={canWrite ? cols : cols.filter((c) => c.key !== 'act' || rows.some((r) => r.proofId))}
      rows={rows}
      rowKey={(r) => r.id}
      rowAttrs={(r) => ({ id: `ce-${r.id}`, className: r.status === 'void' ? 'void' : undefined, 'data-pk-row': r.entryNo, 'data-pk-status': r.status })}
      caption="Buku kas"
      empty={<EmptyState text={filtered ? 'Tidak ada transaksi untuk filter ini.' : 'Belum ada transaksi kas.'} action={filtered ? { href: '/admin/kas', label: 'Hapus filter' } : canWrite ? { href: '/admin/kas/baru', label: 'Catat kas masuk/keluar' } : undefined} />}
    />
  )
}

function Pager({ q, page, totalPages }: { q: BookQuery; page: number; totalPages: number }) {
  if (totalPages <= 1) return null
  const href = (hal: number) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && k !== 'hal') u.set(k, String(v))
    u.set('hal', String(hal))
    return `/admin/kas?${u.toString()}`
  }
  return (
    <nav className="pk-pager" aria-label="Halaman buku kas">
      <span>
        Halaman {page} dari {totalPages}
      </span>
      <span className="pk-kact">
        {page > 1 ? (
          <a className="pk-kbtn sm" href={href(page - 1)} rel="prev">
            ← Lebih baru
          </a>
        ) : null}
        {page < totalPages ? (
          <a className="pk-kbtn sm" href={href(page + 1)} rel="next">
            Lebih lama →
          </a>
        ) : null}
      </span>
    </nav>
  )
}

// ================================================================ forms

function formOptions(lk: Lookups, keep: Array<number | null | undefined> = []): CashEntryFormProps['options'] {
  const k = new Set(keep.filter((x): x is number => typeof x === 'number'))
  const pick = <T extends { id: number; label: string; active: boolean }>(list: T[]) => list.filter((x) => x.active || k.has(x.id)).map((x) => ({ ...x, label: x.active ? x.label : `${x.label} (nonaktif)` }))
  return {
    accounts: pick(lk.accounts),
    projects: pick(lk.projects),
    costCenters: pick(lk.costCenters),
    categories: pick(lk.categories),
    sources: pick(lk.sources),
    vehicles: pick(lk.vehicles),
  }
}

async function formContext(req: PayloadRequest) {
  return withReqTransaction(req, async () => ({ todayDate: await businessToday(req), lockDate: await currentLockDate(req), lk: await cashLookups(req) }))
}

export async function KasNew(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!kasAccess(req.user).write) return <Denied props={props} title="Catat kas" roles="Finance" />
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const { todayDate, lockDate, lk } = await formContext(req)
  return (
    <Frame props={props} name="kas-baru">
      <DashHead title="Catat kas masuk / keluar" note="Nomor KM/KK diberikan otomatis saat disimpan. Saldo akun langsung berubah.">
        <Link className="pk-kbtn" href="/admin/kas">
          ← Buku kas
        </Link>
      </DashHead>
      <Bento>
        <Card id="kas-form" title="Transaksi baru" span={8}>
          <CashEntryForm mode="create" today={todayDate} minDate={minPostingDate(lockDate)} lockDate={lockDate} initialDirection={sp.arah === 'keluar' ? 'out' : 'in'} options={formOptions(lk)} />
        </Card>
        <Card id="kas-help" title="Aturan" span={4}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
            <li>Kas masuk wajib sumber; kas keluar wajib kategori.</li>
            <li>Dibebankan ke project <em>atau</em> pusat biaya, tidak keduanya.</li>
            <li>Tanggal tidak boleh di masa depan atau di periode yang sudah ditutup{lockDate ? ` (s/d ${dayMonth(lockDate)})` : ''}.</li>
            <li>Setelah tersimpan, nominal/tanggal/akun tidak bisa diedit — gunakan Void lalu catat ulang.</li>
          </ul>
        </Card>
      </Bento>
    </Frame>
  )
}

export async function KasEdit(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!kasAccess(req.user).write) return <Denied props={props} title="Edit transaksi kas" roles="Finance" />
  const segments = (props.params as { segments?: string[] } | undefined)?.segments ?? []
  const idText = segments[1] ?? ''
  const id = /^\d{1,10}$/.test(idText) ? Number(idText) : 0
  const { todayDate, lockDate, lk } = await formContext(req)
  const e = id
    ? ((await withReqTransaction(req, () => req.payload.findByID({ collection: 'cash-entries', id, depth: 0, user: req.user, overrideAccess: false, req })).catch(() => null)) as unknown as CashEntryDoc | null)
    : null
  const back = (
    <Link className="pk-kbtn" href="/admin/kas">
      ← Buku kas
    </Link>
  )
  if (!e) {
    return (
      <Frame props={props} name="kas-ubah">
        <DashHead title="Transaksi tidak ditemukan">{back}</DashHead>
      </Frame>
    )
  }
  const editable = canEdit(e, lockDate)
  return (
    <Frame props={props} name="kas-ubah">
      <DashHead title={`Edit ${e.entryNo}`} note="Hanya keterangan, sumber/kategori, pembebanan dan kendaraan. Alasan wajib.">
        {back}
      </DashHead>
      {editable ? (
        <Bento>
          <Card id="kas-form" title="Ubah transaksi" span={8}>
            <CashEntryForm
              mode="edit"
              today={todayDate}
              minDate={minPostingDate(lockDate)}
              lockDate={lockDate}
              initialDirection={e.direction}
              options={formOptions(lk, [relId(e.category), relId(e.cashInSource), relId(e.project), relId(e.costCenter), relId(e.vehicle)])}
              entry={{
                id: e.id,
                entryNo: e.entryNo,
                direction: e.direction,
                entryDate: e.entryDate,
                amount: e.amount,
                account: labelOf(lk.accounts, relId(e.cashAccount) ?? null) ?? '',
                description: e.description ?? '',
                categoryId: relId(e.category) ?? null,
                cashInSourceId: relId(e.cashInSource) ?? null,
                projectId: relId(e.project) ?? null,
                costCenterId: relId(e.costCenter) ?? null,
                vehicleId: relId(e.vehicle) ?? null,
              }}
            />
          </Card>
        </Bento>
      ) : (
        <div className="pk-alert bad" data-pk-not-editable>
          <b aria-hidden>!</b>
          <p>
            {e.status === 'void'
              ? 'Transaksi sudah di-void.'
              : e.sourceType !== 'manual'
                ? 'Hanya transaksi kas manual yang dapat diedit.'
                : `Periode transaksi sudah ditutup (tutup buku s/d ${lockDate}). Koreksi dengan Void — jurnal balik dicatat di periode berjalan.`}
          </p>
        </div>
      )}
    </Frame>
  )
}

// ================================================================ Tutup buku

type Closing = { id: number; period: string; status: 'closed' | 'reopened'; note: string | null; closedBy: string | null; closedAt: string | null; reopenedBy: string | null; reopenedAt: string | null; reopenReason: string | null }

function stateTone(s: ReturnType<typeof periodState>, explicit: boolean): { tone: PillTone; label: string } {
  // months before the latest close are locked too (lock date = end of the latest closed month)
  return s === 'closed' ? (explicit ? { tone: 'ok', label: 'Ditutup' } : { tone: 'none', label: 'Terkunci' }) : s === 'current' ? { tone: 'progress', label: 'Berjalan' } : { tone: 'wait', label: 'Terbuka' }
}

export async function TutupBuku(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!kasAccess(req.user).view) return <Denied props={props} title="Tutup buku" roles="Finance dan Direktur" />
  const isDirektur = kasAccess(req.user).reopen
  const d = await withReqTransaction(req, async () => {
    const todayDate = await businessToday(req)
    const lockDate = await currentLockDate(req)
    const tz = (await settings(req)).timezone || process.env.TZ || 'Asia/Makassar'
    const periods = recentPeriods(todayDate, 13)
    const sums = await periodSummaries(req, periods)
    const res = await req.payload.find({ collection: 'period-closings', sort: '-id', limit: 100, depth: 0, user: req.user, overrideAccess: false, req })
    const names = new Map<number, string>()
    const docs = res.docs as unknown as Array<Record<string, unknown>>
    for (const u of new Set(docs.flatMap((x) => [relId(x.closedBy), relId(x.reopenedBy)]).filter((x): x is number => x !== undefined))) names.set(u, await displayName(req, u))
    const nm = (v: unknown) => (relId(v) !== undefined ? (names.get(relId(v)!) ?? null) : null)
    const closings: Closing[] = docs.map((x) => ({
      id: x.id as number,
      period: x.period as string,
      status: x.status as Closing['status'],
      note: (x.note as string) ?? null,
      closedBy: nm(x.closedBy),
      closedAt: formatServerTime(x.closedAt as string, tz) || null,
      reopenedBy: nm(x.reopenedBy),
      reopenedAt: formatServerTime(x.reopenedAt as string, tz) || null,
      reopenReason: (x.reopenReason as string) ?? null,
    }))
    return { todayDate, lockDate, periods, sums, closings }
  })
  const { todayDate, lockDate, periods, sums, closings } = d
  const closable = new Set(closablePeriods(todayDate, lockDate))
  const closedSet = new Set(closings.filter((c) => c.status === 'closed').map((c) => c.period))
  const latestClosed = closings.filter((c) => c.status === 'closed').map((c) => c.period).sort().at(-1) ?? null
  type Row = { period: string; state: ReturnType<typeof periodState>; n: number; tin: number; tout: number; voids: number }
  const rows: Row[] = periods.map((p) => ({ period: p, state: periodState(p, todayDate, lockDate), ...(sums.get(p) ?? { n: 0, tin: 0, tout: 0, voids: 0 }) }))
  const cols: Col<Row>[] = [
    {
      key: 'p',
      label: 'Periode',
      sort: 'descending',
      cell: (r) => (
        <a href={`/admin/kas?periode=${r.period}`} data-pk-period={r.period}>
          {periodLabel(r.period)}
        </a>
      ),
    },
    {
      key: 's',
      label: 'Status',
      cell: (r) => {
        const t = stateTone(r.state, closedSet.has(r.period))
        return <StatusPill tone={t.tone} label={t.label} />
      },
    },
    { key: 'n', label: 'Transaksi', num: true, cell: (r) => `${r.n}${r.voids ? ` (${r.voids} void)` : ''}` },
    { key: 'in', label: 'Masuk', num: true, sec: true, cell: (r) => rp(r.tin) },
    { key: 'out', label: 'Keluar', num: true, sec: true, cell: (r) => rp(r.tout) },
    {
      key: 'a',
      label: 'Aksi',
      cell: (r) => {
        if (closable.has(r.period)) {
          return (
            <ReasonAction
              url="/api/v1/period-closings"
              body={{ period: r.period }}
              field="note"
              fieldLabel="Catatan (opsional)"
              required={false}
              variant="primary"
              label="Tutup buku"
              title={`Tutup buku ${periodLabel(r.period)}?`}
              description={
                <>
                  Semua transaksi kas dan transfer bertanggal <strong>s/d {dayMonth(periodEnd(r.period))}</strong> dikunci: tidak dapat dicatat, diedit, atau di-void dengan tanggal itu. Koreksi
                  setelahnya dicatat sebagai jurnal balik di periode berjalan. Membuka kembali hanya oleh Direktur.
                </>
              }
              confirmLabel="Tutup buku"
              testId={`close-${r.period}`}
            />
          )
        }
        if (r.state === 'closed' && r.period === latestClosed) {
          return isDirektur ? (
            <ReasonAction
              url={`/api/v1/period-closings/${r.period}/reopen`}
              label="Buka kembali"
              title={`Buka kembali ${periodLabel(r.period)}?`}
              description={<>Periode ini dapat diposting dan dikoreksi lagi sampai ditutup kembali. Alasan wajib dan tercatat di audit log.</>}
              confirmLabel="Buka kembali"
              testId={`reopen-${r.period}`}
            />
          ) : (
            <span className="hint">Buka kembali: Direktur</span>
          )
        }
        return null
      },
    },
  ]
  const hist: Col<Closing>[] = [
    { key: 'p', label: 'Periode', cell: (c) => periodLabel(c.period) },
    {
      key: 's',
      label: 'Status',
      cell: (c) => <StatusPill tone={c.status === 'closed' ? 'ok' : 'warn'} label={c.status === 'closed' ? 'Ditutup' : 'Dibuka kembali'} />,
    },
    {
      key: 'by',
      label: 'Oleh',
      cell: (c) => (
        <>
          {c.closedBy ?? '—'}
          <span className="sub">{c.closedAt}</span>
          {c.note ? <span className="sub">Catatan: {c.note}</span> : null}
          {c.status === 'reopened' ? (
            <span className="links">
              Dibuka {c.reopenedBy ?? '—'} · {c.reopenedAt} — {c.reopenReason}
            </span>
          ) : null}
        </>
      ),
    },
  ]
  return (
    <Frame props={props} name="tutup-buku">
      <DashHead title="Tutup buku" note="Tutup bulan yang sudah lewat. Buka kembali hanya oleh Direktur, untuk periode tertutup terakhir, dengan alasan.">
        <Link className="pk-kbtn" href="/admin/kas">
          ← Buku kas
        </Link>
      </DashHead>
      <Bento label="Status periode">
        <KpiRow cols={3}>
          <KpiTile id="lock" icon="clock" label="Terkunci s/d" value={lockDate ? dayMonth(lockDate) : 'Belum ada'} kpi="lock-date" i={0}>
            <p className="pk-kpi-x">Posting bertanggal ≤ tanggal ini ditolak.</p>
          </KpiTile>
          <KpiTile id="last" icon="check" label="Periode tertutup terakhir" value={latestClosed ? periodLabel(latestClosed) : '—'} kpi="last-closed" i={1}>
            <p className="pk-kpi-x">{closings.length} kali tutup/buka tercatat</p>
          </KpiTile>
          <KpiTile id="closable" icon="inbox" label="Bulan siap ditutup" value={String(closable.size)} kpi="closable" i={2}>
            <p className="pk-kpi-x">{closable.size ? [...closable].map(periodLabel).join(', ') : 'Tidak ada — bulan berjalan belum bisa ditutup.'}</p>
          </KpiTile>
        </KpiRow>
        <Card id="periods" title="Per bulan" sub="13 bulan terakhir, semua baris (void + jurnal balik saling meniadakan)" span={8} i={3}>
          <DataTable id="periods" cols={cols} rows={rows} rowKey={(r) => r.period} rowAttrs={(r) => ({ 'data-pk-period-row': r.period, 'data-pk-state': r.state })} caption="Ringkasan kas per bulan" empty={<EmptyState text="Belum ada data." />} />
        </Card>
        <Card id="history" title="Riwayat" sub="Tutup & buka kembali" span={4} i={4}>
          <DataTable id="closings" cols={hist} rows={closings} rowKey={(c) => c.id} caption="Riwayat tutup buku" empty={<EmptyState text="Belum pernah tutup buku." />} />
        </Card>
      </Bento>
    </Frame>
  )
}
