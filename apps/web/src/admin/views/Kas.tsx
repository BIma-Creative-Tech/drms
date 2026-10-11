import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { relId } from '@/access/roles'
import { CashEntryForm, type CashEntryFormProps } from '@/admin/components/kas/CashEntryForm'
import { ReasonAction } from '@/admin/components/kas/ReasonAction'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { AutoSubmit } from '@/admin/components/list/AutoSubmit'
import { PAGE_SIZES } from '@/admin/list-query'
import {
  accountFlows,
  canEdit,
  canVoid,
  cashBookPage,
  cashLookups,
  closablePeriods,
  kasAccessIn,
  minPostingDate,
  parseBookQuery,
  periodState,
  periodSummaries,
  recentPeriods,
  voidHint,
  type BookQuery,
  type BookRow,
  type Lookups,
  type Option,
} from '@/domain/cash/book'
import { balances, booksStartDate, currentLockDate, lockDates, type CashEntryDoc } from '@/domain/cash/ledger'
import { periodEnd } from '@/domain/cash/periods'
import { displayName, settings, today as businessToday } from '@/domain/expense/common'
import { MONTHS_SHORT, periodLabel } from '@/domain/reports/rules'
import type { PillTone } from '@/domain/reports/viz'
import { withReqTransaction } from '@/lib/system-tx'
import { formatServerTime } from '@/pdf/format'

import { ChartHover } from './ChartHover'
import { F3Root } from './f3-ui'
import { foreignPtParam, PtChip, ptView, type PtView } from './pt'
import { PtNotAllowed } from './shared'
import { PerPt } from './pt-breakdown'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, rp, rpShort, StatusPill, VIZ_STYLE, type Col } from './viz'
import { NoAccess } from './NoAccess'

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
.pk-f3 .pk-ptpick { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.pk-f3 .pk-ptpick li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.pk-f3 .pk-ptpick .pk-kbtn { gap: 8px; }
.pk-f3 .pk-pttabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 14px; font-size: 13px; color: var(--pk-muted-fg); }
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

// ---------------------------------------------------------------- PT (MC2, ADR 0016 §4 — Kas and closing are per PT)

type SP = Record<string, string | string[] | undefined>
/** `?pt=` when it is one of `allowed` (a selected PT without that right is ignored — never widens; a foreign PT → PtNotAllowed). */
function ptParam(sp: SP, allowed: readonly number[]): number | undefined {
  const v = typeof sp.pt === 'string' && /^\d{1,10}$/.test(sp.pt) ? Number(sp.pt) : undefined
  return v !== undefined && allowed.includes(v) ? v : undefined
}
/** The only PT, else the chosen one (`undefined` = the user must pick). */
const onePt = (sp: SP, allowed: readonly number[]) => (allowed.length === 1 ? allowed[0] : ptParam(sp, allowed))
const ptCode = (pt: PtView, id: number | null | undefined) => pt.ref(id)?.shortCode ?? (typeof id === 'number' ? `#${id}` : '—')
/** Options of ONE PT (form pickers; the DB rejects cross-PT references anyway). */
const lookupsOf = (lk: Lookups, company: number | undefined): Lookups => {
  if (company === undefined) return lk
  const f = <T extends Option>(l: T[]) => l.filter((o) => o.companyId === company)
  return { accounts: f(lk.accounts), projects: f(lk.projects), costCenters: f(lk.costCenters), categories: f(lk.categories), sources: f(lk.sources), vehicles: f(lk.vehicles) }
}
/** Labels prefixed `[CS1]` while several PTs are listed (mc2-contract §1 master option labels). */
const labelled = (lk: Lookups, pt: PtView, on: boolean): Lookups => {
  if (!on) return lk
  const f = <T extends Option>(l: T[]) => l.map((o) => ({ ...o, label: `[${ptCode(pt, o.companyId)}] ${o.label}` }))
  return { accounts: f(lk.accounts), projects: f(lk.projects), costCenters: f(lk.costCenters), categories: f(lk.categories), sources: f(lk.sources), vehicles: f(lk.vehicles) }
}
const lockText = (pt: PtView, locks: ReadonlyArray<{ companyId: number; lockDate: string | null }>) =>
  locks.length === 1
    ? `tutup buku ${locks[0]!.lockDate ? `s/d ${dayMonth(locks[0]!.lockDate)}` : 'belum ada'}`
    : `tutup buku ${locks.map((l) => `${ptCode(pt, l.companyId)} ${l.lockDate ? `s/d ${dayMonth(l.lockDate)}` : 'belum ada'}`).join(' · ')}`

/** "Pilih PT" card: one link per PT (forms and closing act on exactly one PT). */
function PtChooser({ pt, pts, href, locks, title, note }: { pt: PtView; pts: readonly number[]; href: (id: number) => string; locks: ReadonlyArray<{ companyId: number; lockDate: string | null }>; title: string; note: string }) {
  return (
    <Bento label={title}>
      <Card id="pt-choose" title={title} sub={note} span={8}>
        <ul className="pk-ptpick" data-pk-pt-chooser>
          {pts.map((c) => {
            const l = locks.find((x) => x.companyId === c)?.lockDate ?? null
            return (
              <li key={c}>
                <a className="pk-kbtn" href={href(c)} data-pk-pt-choice={ptCode(pt, c)}>
                  <PtChip pt={pt.ref(c)} /> <span>{pt.ref(c)?.name ?? ''}</span>
                </a>
                <span className="hint">{l ? `terkunci s/d ${dayMonth(l)}` : 'belum pernah tutup buku'}</span>
              </li>
            )
          })}
        </ul>
      </Card>
    </Bento>
  )
}

/** PT tabs above a one-PT screen (only when the caller has several PTs for it). */
function PtTabs({ pt, pts, current, href }: { pt: PtView; pts: readonly number[]; current: number; href: (id: number) => string }) {
  if (pts.length < 2) return null
  return (
    <nav className="pk-pttabs" aria-label="Pilih PT" data-pk-pt-tabs>
      <span>PT:</span>
      {pts.map((c) =>
        c === current ? (
          <span key={c} className="pk-kbtn sm primary" aria-current="page" title={pt.ref(c)?.name ?? undefined} data-pk-pt-current={ptCode(pt, c)}>
            {ptCode(pt, c)}
          </span>
        ) : (
          <a key={c} className="pk-kbtn sm" href={href(c)} title={pt.ref(c)?.name ?? undefined}>
            {ptCode(pt, c)}
          </a>
        ),
      )}
    </nav>
  )
}

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

/** QA-20(c): uniform no-access page (title/roles kept for the call sites, never shown). */
function Denied({ props }: { props: AdminViewServerProps; title?: string; roles?: string }) {
  return <NoAccess props={props} />
}

const labelOf = (list: Array<{ id: number; label: string }>, id: number | null) => (id === null ? null : (list.find((x) => x.id === id)?.label ?? `#${id}`))

// ================================================================ Buku kas

export async function KasBook(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  // mc2-contract §4: PT sets per right (selected PTs where the caller is Finance / Direktur)
  const acc = kasAccessIn(req)
  if (acc.view.length === 0) return <Denied props={props} title="Kas" roles="Finance dan Direktur" />
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title="Kas" />
  const pt = await ptView(req)
  const sp = (props.searchParams ?? {}) as SP
  const q = parseBookQuery(sp)
  if (q.pt !== undefined && !acc.view.includes(q.pt)) delete q.pt // a selected PT without Kas rights → ignored (never widens); foreign → PtNotAllowed above
  const multi = acc.view.length > 1
  const shown = q.pt !== undefined ? [q.pt] : acc.view
  const canWrite = acc.write.some((c) => shown.includes(c))
  const d = await withReqTransaction(req, async () => {
    const todayDate = await businessToday(req, shown[0])
    const locks = await lockDates(req, shown)
    const lk = await cashLookups(req)
    const page = await cashBookPage(req, q)
    const bal = await balances(req, undefined, { companyIds: shown })
    const flowPeriod = q.periode ?? todayDate.slice(0, 7)
    const flows = await accountFlows(req, flowPeriod, shown)
    const flashId = Number(typeof sp.baru === 'string' ? sp.baru : typeof sp.diubah === 'string' ? sp.diubah : NaN)
    const flash = Number.isSafeInteger(flashId) && flashId > 0 ? await req.payload.findByID({ collection: 'cash-entries', id: flashId, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null) : null
    return { todayDate, locks, lk, page, bal, flowPeriod, flows, flash: flash as unknown as CashEntryDoc | null }
  })
  const { todayDate, locks, page, bal, flowPeriod, flows, flash } = d
  const lk = labelled(lookupsOf(d.lk, q.pt), pt, multi && q.pt === undefined)
  const lockOf = (c: number | null) => locks.find((l) => l.companyId === c)?.lockDate ?? null
  const writeIn = (c: number | null) => c !== null && acc.write.includes(c)
  const total = bal.reduce((s, a) => s + a.balance, 0)
  // combined balance = Σ per PT (mc2-contract §4: show both)
  const byPt = shown.map((c) => ({ companyId: c, total: bal.filter((a) => a.companyId === c).reduce((s, a) => s + a.balance, 0) }))
  const activeIds = new Set(lk.accounts.filter((a) => a.active).map((a) => a.id))
  const tiles = bal.filter((a) => activeIds.has(a.cashAccountId) || a.balance !== 0)
  const filtered = Boolean(q.akun || q.periode || q.project || q.pusat || q.arah || q.status || q.pt || q.q)
  const flashAcc = flash ? bal.find((a) => a.cashAccountId === relId(flash.cashAccount)) : undefined
  return (
    <Frame props={props} name="kas">
      <ChartHover>
        <DashHead title="Kas" note={`Buku kas per ${dayMonth(todayDate)} (WITA) · ${lockText(pt, locks)} · termasuk void & jurnal balik`}>
          <div className="pk-kact">
            {canWrite ? (
              <>
                <Link className="pk-kbtn primary" href={`/admin/kas/baru?arah=masuk${q.pt ? `&pt=${q.pt}` : ''}`} data-pk-link="kas-masuk">
                  <span aria-hidden>↓</span> Kas masuk
                </Link>
                <Link className="pk-kbtn primary" href={`/admin/kas/baru?arah=keluar${q.pt ? `&pt=${q.pt}` : ''}`} data-pk-link="kas-keluar">
                  <span aria-hidden>↑</span> Kas keluar
                </Link>
              </>
            ) : null}
            <Link className="pk-kbtn" href={`/admin/tutup-buku${q.pt ? `?pt=${q.pt}` : ''}`} data-pk-link="tutup-buku">
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
            <p>Tampilan baca untuk Direktur. Pencatatan, edit dan void kas dilakukan oleh Finance{multi ? ' PT tersebut' : ''}.</p>
          </div>
        ) : null}

        <div className="pk-kas-tiles">
        <Bento label="Saldo per akun">
          <KpiRow cols={4}>
            <KpiTile id="kas-total" icon="wallet" label="Saldo kas total" value={rpShort(total)} title={rp(total)} kpi="kas-total" i={0}>
              <p className="pk-kpi-x">{rp(total)}</p>
              <p className="pk-kpi-x">{tiles.length} akun · saldo awal + masuk − keluar</p>
              <PerPt pt={pt} rows={byPt} value={(r) => r.total} fmt={rpShort} label="Saldo kas" />
            </KpiTile>
            {tiles.map((a, i) => {
              const f = flows.get(a.cashAccountId) ?? { n: 0, tin: 0, tout: 0 }
              return (
                <KpiTile key={a.cashAccountId} id={`kas-acc-${a.cashAccountId}`} icon="wallet" label={multi && q.pt === undefined ? `${ptCode(pt, a.companyId)} · ${a.name}` : a.name} value={rpShort(a.balance)} title={rp(a.balance)} kpi={`acc-${a.cashAccountId}`} href={`/admin/kas?akun=${a.cashAccountId}`} more="Buku akun ini" i={i + 1}>
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

        <FilterBar q={q} lk={lk} filtered={filtered} pt={pt} pts={multi ? acc.view : []} />

        <Bento label="Buku kas">
          <Card
            id="kas-book"
            title="Buku kas"
            sub={`${page.totalDocs} transaksi${filtered ? ' (terfilter)' : ''} · terbaru dulu · baris void tetap tampil, jurnal baliknya tertaut`}
          >
            <LedgerTable rows={page.rows} lk={d.lk} lockOf={lockOf} writeIn={writeIn} canWrite={canWrite} filtered={filtered} pt={multi && q.pt === undefined ? pt : null} />
            <Pager q={q} page={page.page} totalPages={page.totalPages} />
          </Card>
        </Bento>
      </ChartHover>
    </Frame>
  )
}

function FilterBar({ q, lk, filtered, pt, pts }: { q: BookQuery; lk: Lookups; filtered: boolean; pt: PtView; pts: readonly number[] }) {
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
      {/* DRMS 10/10 D8: search + page size (shared AutoSubmit: debounced, URL state) */}
      <label className="pk-filter__search">
        Cari
        <input type="search" name="q" defaultValue={q.q ?? ''} placeholder="Nomor atau keterangan…" maxLength={100} autoComplete="off" data-pk-search="kas" />
      </label>
      {pts.length > 1 ? sel('pt', 'PT', pts.map((c) => ({ id: c, label: `${ptCode(pt, c)} — ${pt.ref(c)?.name ?? ''}` })), q.pt, 'Semua PT') : null}
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
      <label>
        Per halaman
        <select name="per" defaultValue={String(q.per ?? 50)} data-pk-page-size="kas">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
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
      <AutoSubmit />
    </form>
  )
}

function statusPill(r: BookRow): { tone: PillTone; label: string } {
  if (r.status === 'void') return { tone: 'bad', label: 'Void' }
  if (r.sourceType === 'reversal') return { tone: 'warn', label: 'Jurnal balik' }
  return { tone: 'ok', label: 'Posted' }
}

const entryLink = (x: { id: number; entryNo: string }, onPage: Set<number>) => <a href={onPage.has(x.id) ? `#ce-${x.id}` : `/admin/collections/cash-entries/${x.id}`}>{x.entryNo}</a>

function LedgerTable({
  rows,
  lk,
  lockOf,
  writeIn,
  canWrite,
  filtered,
  pt,
}: {
  rows: BookRow[]
  lk: Lookups
  /** Lock date of the row's PT (closing is per PT). */
  lockOf: (company: number | null) => string | null
  /** Caller is Finance of the row's PT (edit / void). */
  writeIn: (company: number | null) => boolean
  canWrite: boolean
  filtered: boolean
  /** Set = PT column (several PTs listed). */
  pt: PtView | null
}) {
  const onPage = new Set(rows.map((r) => r.id))
  const cols: Col<BookRow>[] = [
    // PT chip inside the date cell (the phone card layout below addresses cells by position)
    {
      key: 'date',
      label: pt ? 'PT · Tanggal' : 'Tanggal',
      sort: 'descending',
      cell: (r) => (
        <span className="nw">
          {pt ? (
            <>
              <PtChip pt={pt.ref(r.companyId)} />{' '}
            </>
          ) : null}
          {dayMonth(r.entryDate)}
        </span>
      ),
    },
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
            <a className="pk-kbtn sm" href={`/api/v1/media/attachments/${r.proofId}/file`} target="_blank" rel="noopener noreferrer" data-pk-lightbox="kas-proofs" data-pk-lightbox-title={`Bukti ${r.entryNo}`}>
              Bukti
            </a>
          ) : null}
          {writeIn(r.companyId) && canEdit(r, lockOf(r.companyId)) ? (
            <a className="pk-kbtn sm" href={`/admin/kas/${r.id}/ubah`} data-pk-action={`edit-${r.id}`}>
              Edit
            </a>
          ) : null}
          {writeIn(r.companyId) && canVoid(r) ? (
            <ReasonAction
              url={`/api/v1/cash-entries/${r.id}/void`}
              label="Void"
              title={`Void ${r.entryNo}?`}
              description={
                <>
                  Transaksi asli <strong>tetap tercatat</strong> dengan status Void, dan sistem membuat <strong>jurnal balik</strong> {r.direction === 'in' ? 'kas keluar' : 'kas masuk'} {rp(r.amount)}
                  {lockOf(r.companyId) && r.entryDate <= lockOf(r.companyId)! ? ' bertanggal hari ini (periode aslinya sudah ditutup)' : ` bertanggal ${dayMonth(r.entryDate)}`}. Saldo akun kembali seperti sebelum transaksi ini.
                </>
              }
              confirmLabel="Void transaksi"
              testId={`void-${r.id}`}
            />
          ) : null}
          {writeIn(r.companyId) && voidHint(r) ? <span className="hint">{voidHint(r)}</span> : null}
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

const emptyLookups: Lookups = { accounts: [], projects: [], costCenters: [], categories: [], sources: [], vehicles: [] }

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

/** Today, lock date and pickers of ONE PT (a cash entry belongs to the PT of its account). */
async function formContext(req: PayloadRequest, company: number) {
  return withReqTransaction(req, async () => ({ todayDate: await businessToday(req, company), lockDate: await currentLockDate(req, company), lk: lookupsOf(await cashLookups(req), company) }))
}

export async function KasNew(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const acc = kasAccessIn(req)
  if (acc.write.length === 0) return <Denied props={props} title="Catat kas" roles="Finance" />
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title="Catat kas" />
  const sp = (props.searchParams ?? {}) as SP
  const arah = sp.arah === 'keluar' ? 'keluar' : 'masuk'
  const pt = await ptView(req)
  const company = onePt(sp, acc.write)
  const back = (
    <Link className="pk-kbtn" href="/admin/kas">
      ← Buku kas
    </Link>
  )
  if (company === undefined) {
    // mc2-contract §0.3: a mutation names its PT — Finance of several PTs picks one first
    const locks = await withReqTransaction(req, () => lockDates(req, acc.write))
    return (
      <Frame props={props} name="kas-baru">
        <DashHead title="Catat kas masuk / keluar" note="Anda Finance di beberapa PT. Pilih PT transaksi ini — akun, project, pusat biaya dan kategori mengikuti PT tersebut.">
          {back}
        </DashHead>
        <PtChooser pt={pt} pts={acc.write} locks={locks} href={(c) => `/admin/kas/baru?arah=${arah}&pt=${c}`} title="Pilih PT" note="Kas masuk/keluar dicatat di buku kas satu PT." />
      </Frame>
    )
  }
  const { todayDate, lockDate, lk } = await formContext(req, company)
  return (
    <Frame props={props} name="kas-baru">
      <DashHead title="Catat kas masuk / keluar" note={`${acc.write.length > 1 ? `PT ${ptCode(pt, company)} — ${pt.ref(company)?.name ?? ''} · ` : ''}Nomor KM/KK diberikan otomatis saat disimpan. Saldo akun langsung berubah.`}>
        {back}
      </DashHead>
      <PtTabs pt={pt} pts={acc.write} current={company} href={(c) => `/admin/kas/baru?arah=${arah}&pt=${c}`} />
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
  const acc = kasAccessIn(req)
  if (acc.write.length === 0) return <Denied props={props} title="Edit transaksi kas" roles="Finance" />
  const segments = (props.params as { segments?: string[] } | undefined)?.segments ?? []
  const idText = segments[1] ?? ''
  const id = /^\d{1,10}$/.test(idText) ? Number(idText) : 0
  const found = id
    ? ((await withReqTransaction(req, () => req.payload.findByID({ collection: 'cash-entries', id, depth: 0, user: req.user, overrideAccess: false, req })).catch(() => null)) as unknown as CashEntryDoc | null)
    : null
  // Finance of the ENTRY's PT only (a Direktur of that PT reads it in the book, no edit form)
  const company = found ? relId((found as { company?: unknown }).company) : undefined
  const e = found && company !== undefined && acc.write.includes(company) ? found : null
  const { todayDate, lockDate, lk } = e && company !== undefined ? await formContext(req, company) : { todayDate: '', lockDate: null, lk: lookupsOf(emptyLookups, undefined) }
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
      <DashHead title={`Edit ${e.entryNo}`} note="Keterangan, sumber/kategori, pembebanan, kendaraan dan bukti. Tanggal, akun dan nominal terkunci. Alasan wajib.">
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
                proofId: relId((e as { proof?: unknown }).proof) ?? null,
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

/**
 * "Tutup buku" is per PT (ADR 0016 §4, mc2-contract §4): closing PT A never locks PT B. One PT per
 * screen — the only Kas PT of the caller, else the `?pt=` chosen on the PT chooser (lock date per PT).
 * Close / reopen always send `company` explicitly (the API answers 400 "PT wajib dipilih" otherwise).
 */
export async function TutupBuku(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const acc = kasAccessIn(req)
  if (acc.close.length === 0) return <Denied props={props} title="Tutup buku" roles="Finance dan Direktur" />
  if (foreignPtParam(req, props.searchParams)) return <PtNotAllowed props={props} title="Tutup buku" />
  const pt = await ptView(req)
  const sp = (props.searchParams ?? {}) as SP
  const company = onePt(sp, acc.close)
  if (company === undefined) {
    const locks = await withReqTransaction(req, () => lockDates(req, acc.close))
    return (
      <Frame props={props} name="tutup-buku">
        <DashHead title="Tutup buku" note="Tutup buku dilakukan per PT: menutup satu PT tidak mengunci PT lain. Pilih PT yang akan dikelola.">
          <Link className="pk-kbtn" href="/admin/kas">
            ← Buku kas
          </Link>
        </DashHead>
        <PtChooser pt={pt} pts={acc.close} locks={locks} href={(c) => `/admin/tutup-buku?pt=${c}`} title="Pilih PT" note="Tanggal kunci saat ini per PT." />
      </Frame>
    )
  }
  const isDirektur = acc.reopen.includes(company)
  const d = await withReqTransaction(req, async () => {
    const todayDate = await businessToday(req, company)
    const lockDate = await currentLockDate(req, company)
    const tz = (await settings(req, company)).timezone || process.env.TZ || 'Asia/Makassar'
    // QA-30: months before the PT's books start (earliest opening-balance date) are neither listed nor closable
    const booksStart = await booksStartDate(req, company)
    const periods = recentPeriods(todayDate, 13, booksStart)
    const sums = await periodSummaries(req, periods, [company])
    const res = await req.payload.find({ collection: 'period-closings', where: { company: { equals: company } }, sort: '-id', limit: 100, depth: 0, user: req.user, overrideAccess: false, req })
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
    return { todayDate, lockDate, periods, sums, closings, booksStart }
  })
  const { todayDate, lockDate, periods, sums, closings, booksStart } = d
  const closable = new Set(closablePeriods(todayDate, lockDate, 12, booksStart))
  const closedSet = new Set(closings.filter((c) => c.status === 'closed').map((c) => c.period))
  const latestClosed = closings.filter((c) => c.status === 'closed').map((c) => c.period).sort().at(-1) ?? null
  type Row = { period: string; state: ReturnType<typeof periodState>; n: number; tin: number; tout: number; voids: number; nKoreksi: number; koreksi: number }
  const rows: Row[] = periods.map((p) => ({ period: p, state: periodState(p, todayDate, lockDate), ...(sums.get(p) ?? { n: 0, tin: 0, tout: 0, voids: 0, nKoreksi: 0, koreksi: 0 }) }))
  const cols: Col<Row>[] = [
    {
      key: 'p',
      label: 'Periode',
      sort: 'descending',
      cell: (r) => (
        <a href={`/admin/kas?periode=${r.period}${acc.close.length > 1 ? `&pt=${company}` : ''}`} data-pk-period={r.period}>
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
    // QA-30: Masuk/Keluar without void pairs (K-02b); the void pairs in their own column (book net = bersih + koreksi)
    { key: 'in', label: 'Masuk', num: true, sec: true, cell: (r) => rp(r.tin) },
    { key: 'out', label: 'Keluar', num: true, sec: true, cell: (r) => rp(r.tout) },
    { key: 'net', label: 'Bersih', num: true, cell: (r) => rp(r.tin - r.tout) },
    {
      key: 'kor',
      label: 'Koreksi (void)',
      num: true,
      sec: true,
      cell: (r) => (r.nKoreksi ? <span data-pk-koreksi={r.period}>{`${rp(r.koreksi)} (${r.nKoreksi} baris)`}</span> : '—'),
    },
    {
      key: 'a',
      label: 'Aksi',
      cell: (r) => {
        if (closable.has(r.period)) {
          return (
            <ReasonAction
              url="/api/v1/period-closings"
              body={{ period: r.period, company }}
              field="note"
              fieldLabel="Catatan (opsional)"
              required={false}
              variant="primary"
              label="Tutup buku"
              title={`Tutup buku ${periodLabel(r.period)}${acc.close.length > 1 ? ` — ${ptCode(pt, company)}` : ''}?`}
              description={
                <>
                  Semua transaksi kas dan transfer bertanggal <strong>s/d {dayMonth(periodEnd(r.period))}</strong> dikunci: tidak dapat dicatat, diedit, atau di-void dengan tanggal itu. Koreksi
                  setelahnya dicatat sebagai jurnal balik di periode berjalan. Membuka kembali hanya oleh Direktur.
                  {acc.close.length > 1 ? (
                    <>
                      {' '}
                      Hanya PT <strong>{pt.ref(company)?.name ?? ptCode(pt, company)}</strong> yang dikunci.
                    </>
                  ) : null}
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
              url={`/api/v1/period-closings/${r.period}/reopen?company=${company}`}
              label="Buka kembali"
              title={`Buka kembali ${periodLabel(r.period)}${acc.close.length > 1 ? ` — ${ptCode(pt, company)}` : ''}?`}
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
      <DashHead
        title={acc.close.length > 1 ? `Tutup buku · ${ptCode(pt, company)}` : 'Tutup buku'}
        note={`${acc.close.length > 1 ? `${pt.ref(company)?.name ?? ''} · ` : ''}Tutup bulan yang sudah lewat. Buka kembali hanya oleh Direktur, untuk periode tertutup terakhir, dengan alasan.`}
      >
        <Link className="pk-kbtn" href={`/admin/kas${acc.close.length > 1 ? `?pt=${company}` : ''}`}>
          ← Buku kas
        </Link>
      </DashHead>
      <PtTabs pt={pt} pts={acc.close} current={company} href={(c) => `/admin/tutup-buku?pt=${c}`} />
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
        <Card
          id="periods"
          title="Per bulan"
          sub={`13 bulan terakhir${booksStart ? ` sejak buku kas dimulai (${dayMonth(booksStart)})` : ''}. Masuk/Keluar tanpa pasangan void; koreksi void terpisah.`}
          span={8}
          i={3}
        >
          <DataTable id="periods" cols={cols} rows={rows} rowKey={(r) => r.period} rowAttrs={(r) => ({ 'data-pk-period-row': r.period, 'data-pk-state': r.state })} caption="Ringkasan kas per bulan" empty={<EmptyState text="Belum ada data." />} />
        </Card>
        <Card id="history" title="Riwayat" sub="Tutup & buka kembali" span={4} i={4}>
          <DataTable id="closings" cols={hist} rows={closings} rowKey={(c) => c.id} caption="Riwayat tutup buku" empty={<EmptyState text="Belum pernah tutup buku." />} />
        </Card>
      </Bento>
    </Frame>
  )
}
