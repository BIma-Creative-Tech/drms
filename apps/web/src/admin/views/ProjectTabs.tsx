import { Gutter } from '@payloadcms/ui'
import type { DocumentViewServerProps, PayloadRequest, Where } from 'payload'
import React from 'react'

import { employeeIn, hasRoleAny, relId, rolesIn, userId } from '@/access/roles'
import { KAS_STYLE } from '@/admin/components/kas/style'
import { ListToolbar, Pager } from '@/admin/components/list/ListToolbar'
import { RapExcelTools } from '@/admin/components/rap/RapExcelTools'
import { RapItemsEditor } from '@/admin/components/rap/RapItemsEditor'
import { loadRapEditor, rapEditorItems } from '@/admin/components/rap/rap-editor-data'
import { allowedValues, filterValues, matchesQuery, pageOfFind, paginate, parseListQuery, searchWhere } from '@/admin/list-query'
import { listItem } from '@/domain/expense/dto'
import type { RequestDoc } from '@/domain/expense/common'
import { BUDGET_COMMITTED, REQUEST_TYPE_LABELS, REQUEST_TYPES, type RequestStatus } from '@/domain/expense/types'
import { kindOf } from '@/domain/field/rules'
import { RAP_MISSING_MESSAGE } from '@/domain/rap/rules'
import { loadRap, rapTemplatesFor } from '@/domain/rap/service'
import { formatDateLong } from '@/pdf/format'
import { formatNumber } from '@/lib/money'
import { withReqTransaction } from '@/lib/system-tx'

import { F3Root } from './f3-ui'
import { Alert } from './progress-ui'
import { Card, DataTable, EmptyState, KpiRow, KpiTile, Meter, StatusPill, VIZ_STYLE, rp, type Col } from './viz'

/**
 * DRMS 10/10 point 7: the project detail /admin/collections/projects/:id gets three tabs — "Proyek" (the form, default
 * view), "RAP" (plan vs realisation per RAP item, D4) and "Pengajuan" (the project's expense requests). Document views
 * of the Projects collection (Payload edit tabs); the project must be readable by the caller (collection access),
 * else nothing is shown. RAP money only for the price roles (DTO of loadRap). Tables: search + filter + pages (D8);
 * at ≤ 640 px RAP items are cards (APK layout, as the request lines). D4 owner 2026-10-11: RAP for EVERY project kind
 * with a RAB — the tab also manages the RAP for the PM and the Direktur/Admin; konstruksi keeps its daily-report RAP
 * page (stage progress, weekly recap) under Laporan harian. UI feedback 17/10 #3: "Kelola RAP" = the item form
 * (RapItemsEditor "+ Tambah item" / "Ubah", as /admin/rap/:id) first, Excel import / export and the templates of the
 * project kind folded below it (RapExcelTools, closed by default).
 */
const idOf = (props: DocumentViewServerProps) => Number(props.initPageResult.docID ?? (props.doc as { id?: unknown } | undefined)?.id)

function TabRoot({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <Gutter>
      <F3Root name={name}>
        <style>{VIZ_STYLE}</style>
        <style>{KAS_STYLE}</style>
        <div style={{ paddingTop: 16 }}>{children}</div>
      </F3Root>
    </Gutter>
  )
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${formatNumber(v, 1)}%`)
const qty = (v: number) => formatNumber(v, 2)

// ---------------------------------------------------------------- RAP tab

type Rap = Awaited<ReturnType<typeof loadRap>>
type Item = Rap['items'][number]

export async function ProjectRapTab(props: DocumentViewServerProps) {
  const req = props.initPageResult.req as PayloadRequest
  const id = idOf(props)
  const data = Number.isSafeInteger(id)
    ? await withReqTransaction(req, async () => {
        const p = (await req.payload.findByID({ collection: 'projects', id, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as { kind?: string | null; status?: string | null; company?: unknown } | null
        if (!p) return null
        const rap = await loadRap(req, id)
        // the item form only for the RAP editors (same condition as the Kelola RAP card)
        const editor = rap.canEdit ? await loadRapEditor(req, { id, company: relId(p.company) ?? -1, status: p.status }, rap) : null
        return { kind: kindOf(p.kind), rap, editor, templates: rap.canEdit && rap.items.length === 0 ? await rapTemplatesFor(req, id) : [] }
      }).catch(() => null)
    : null
  if (!data) {
    return (
      <TabRoot name="project-rap">
        <EmptyState text="Project tidak ditemukan atau tidak dapat Anda buka." />
      </TabRoot>
    )
  }
  const { rap, kind, editor, templates } = data
  const prices = rap.budget !== null
  const stageOf = (i: Item) => (i.stage ? `${i.stage.name} · ` : '')
  const sp = props.searchParams as Record<string, string | string[] | undefined> | undefined
  // DRMS 13/10 Umum #4: tahapan / status are multi-select (an item matches ANY ticked status)
  const lq = parseListQuery(sp, ['tahap', 'status'])
  const tahap = filterValues(lq, 'tahap')
  const statuses = allowedValues(lq, 'status', ['melebihi', 'aktif', 'nonaktif'] as const)
  const statusOk = (i: Item) => statuses.length === 0 || statuses.some((st) => (st === 'melebihi' ? i.overBudget === true : st === 'nonaktif' ? !i.active : i.active))
  const filtered = rap.items.filter(
    (i) =>
      (i.active || (i.realisedAmount ?? 0) > 0 || statuses.length > 0) &&
      (tahap.length === 0 || tahap.includes(String(i.stage?.id ?? ''))) &&
      statusOk(i) &&
      matchesQuery([i.code, i.description, i.stage?.name ?? ''], lq.q),
  )
  const page = paginate(filtered, lq.page, lq.per)
  const b = rap.budget
  const path = `/admin/collections/projects/${id}/rap`
  const manage = hasRoleAny(req, 'pk-owner', 'pk-admin', 'pk-pm', 'pk-finance', 'pk-staff') && kind === 'konstruksi'
  const moneyCols: Col<Item>[] = [
    { key: 'pl', label: 'Rencana', num: true, cell: (i) => rp(i.planned ?? null) },
    { key: 're', label: 'Realisasi', num: true, cell: (i) => <span className={i.overBudget ? 'pk-bad' : undefined}>{rp(i.realisedAmount ?? 0)}</span> },
    { key: 'tr', label: 'Ditransfer', num: true, sec: true, cell: (i) => rp(i.transferredAmount ?? 0) },
    { key: 've', label: 'Terverifikasi', num: true, sec: true, cell: (i) => rp(i.verifiedAmount ?? 0) },
    { key: 'si', label: 'Sisa', num: true, cell: (i) => rp(i.remaining ?? null) },
    {
      key: 'pc',
      label: '%',
      num: true,
      cell: (i) => (
        <>
          {pct(i.percent)}
          {i.overBudget ? (
            <>
              {' '}
              <StatusPill tone="warn" label="Melebihi RAP" />
            </>
          ) : null}
        </>
      ),
    },
  ]
  const cols: Col<Item>[] = [
    { key: 'c', label: 'Kode', cell: (i) => <b>{i.code}</b> },
    {
      key: 'd',
      label: 'Uraian',
      cell: (i) => (
        <>
          {i.description} {i.active ? null : <small>(nonaktif)</small>}
          <span className="sub">
            {stageOf(i)}
            {qty(i.volume)} {i.uom.code}
            {prices && i.unitPrice !== null && i.unitPrice !== undefined ? ` × ${rp(i.unitPrice)}` : ''}
          </span>
        </>
      ),
    },
    ...(prices
      ? moneyCols
      : [
          { key: 'v', label: 'Volume RAP', num: true, cell: (i: Item) => `${qty(i.volume)} ${i.uom.code}` },
          // daily-report quantities exist for konstruksi only
          ...(rap.drivesProgress ? [{ key: 'r', label: 'Realisasi volume', num: true, cell: (i: Item) => `${qty(i.realised)} ${i.uom.code}` }] : []),
        ]),
  ]
  return (
    <TabRoot name="project-rap">
      {rap.items.length === 0 ? (
        rap.rapRequired ? (
          <Alert tone="bad" attr="rap-missing">
            <p>
              <b>{RAP_MISSING_MESSAGE}</b>
            </p>
            <p>
              {rap.canEdit
                ? 'Project ini punya RAB, jadi wajib punya RAP: pengajuan project ini baru bisa dikirim setelah RAP terisi. Tambah item RAP lewat form di bawah (+ Tambah item), atau impor Excel bila banyak.'
                : 'Project ini punya RAB, jadi wajib punya RAP: pengajuan project ini baru bisa dikirim setelah PM / Direktur mengisi RAP.'}
            </p>
          </Alert>
        ) : (
          <Alert tone="info" attr="rap-optional">
            <p>Project ini belum punya RAP. RAP wajib untuk project yang punya RAB; project ini belum ber-RAB, jadi RAP opsional.</p>
          </Alert>
        )
      ) : (
        <>
          {b ? (
            <KpiRow cols={4}>
              <KpiTile id="rap-planned" icon="target" label="Rencana (RAP)" value={rp(b.planned)} kpi="rap-planned" i={0}>
                <p className="pk-kpi-x">{rap.items.filter((i) => i.active).length} item aktif</p>
              </KpiTile>
              <KpiTile id="rap-realised" icon="check" label="Realisasi (disetujui)" value={rp(b.realised)} kpi="rap-realised" i={1}>
                <Meter value={b.realised} max={Math.max(1, b.planned ?? 0)} tone={b.overBudget ? 'over' : (b.percent ?? 0) >= 85 ? 'warn' : 'ok'} />
                <p className="pk-kpi-x">{pct(b.percent)} dari rencana</p>
              </KpiTile>
              <KpiTile id="rap-flow" icon="send" label="Ditransfer / terverifikasi" value={rp(b.transferred)} kpi="rap-transferred" i={2}>
                <p className="pk-kpi-x">Nota terverifikasi {rp(b.verified)}</p>
              </KpiTile>
              <KpiTile id="rap-remaining" icon="wallet" label="Sisa RAP" value={rp(b.remaining)} kpi="rap-remaining" i={3}>
                <p className="pk-kpi-x" data-pk-kpi="rap-over-items">
                  {b.overBudgetItems > 0 ? <StatusPill tone="warn" label={`${b.overBudgetItems} item melebihi RAP`} /> : <StatusPill tone="ok" label="Tidak ada item melebihi RAP" />}
                </p>
              </KpiTile>
            </KpiRow>
          ) : (
            <p className="pk-note" style={{ marginTop: 0 }}>
              Nilai RAP hanya untuk Direktur, Admin, Finance dan PM project. {rap.drivesProgress ? 'Anda melihat volume rencana dan realisasi laporan harian.' : 'Anda melihat item dan volume rencana.'}
            </p>
          )}
          <Card
            id="project-rap-items"
            title="Rincian RAP per item"
            sub={prices ? 'Realisasi = total baris pengajuan yang sudah disetujui Direktur, dibebankan ke item RAP' : rap.drivesProgress ? 'Volume rencana dan realisasi volume dari laporan harian' : 'Item dan volume rencana'}
            action={manage ? { href: `/admin/laporan-harian/rap/${id}`, label: 'RAP & laporan harian' } : undefined}
          >
            <ListToolbar
              id="project-rap"
              action={path}
              query={lq}
              label="Cari dan saring item RAP"
              search={{ placeholder: 'Kode, uraian, tahapan…' }}
              filters={[
                { key: 'tahap', label: 'Tahapan', multi: true, options: rap.stages.map((s) => ({ value: String(s.id), label: s.name })) },
                {
                  key: 'status',
                  label: 'Status',
                  multi: true,
                  options: [
                    ...(prices ? [{ value: 'melebihi', label: 'Melebihi RAP' }] : []),
                    { value: 'aktif', label: 'Aktif' },
                    { value: 'nonaktif', label: 'Nonaktif' },
                  ],
                },
              ]}
            />
            <div className="pk-lwide">
              <DataTable id="project-rap-items" paged={false} caption="Item RAP" rows={page.items} rowKey={(i) => i.id} rowAttrs={(i) => ({ 'data-pk-rap-item': i.code, 'data-pk-over': i.overBudget ? '1' : undefined })} cols={cols} empty={<EmptyState text={rap.items.length === 0 ? 'RAP project ini masih kosong.' : 'Tidak ada item yang cocok dengan pencarian / filter.'} />} />
            </div>
            <div className="pk-lcards" data-pk-rap-cards>
              {page.items.length === 0 ? <EmptyState text={rap.items.length === 0 ? 'RAP project ini masih kosong.' : 'Tidak ada item yang cocok.'} /> : null}
              {page.items.map((i) => (
                <article key={i.id} className="pk-lcard" data-pk-rap-card={i.code}>
                  <div className="pk-lcard__head">
                    <span className="pk-lcard__title">
                      {i.code} · {i.description} {i.active ? null : <small>(nonaktif)</small>}
                    </span>
                    {prices ? <span className="pk-lcard__total">{pct(i.percent)}</span> : null}
                  </div>
                  <div className="pk-lcard__meta">
                    {stageOf(i)}
                    {qty(i.volume)} {i.uom.code}
                    {prices && i.unitPrice !== null && i.unitPrice !== undefined ? ` × ${rp(i.unitPrice)}` : ''}
                  </div>
                  {prices ? (
                    <>
                      <div className="pk-lcard__meta">
                        Rencana <b style={{ color: 'var(--pk-fg)' }}>{rp(i.planned ?? null)}</b> · Realisasi <b style={{ color: 'var(--pk-fg)' }}>{rp(i.realisedAmount ?? 0)}</b>
                      </div>
                      <Meter value={i.realisedAmount ?? 0} max={Math.max(1, i.planned ?? 0)} tone={i.overBudget ? 'over' : (i.percent ?? 0) >= 85 ? 'warn' : 'ok'} />
                      <div className="pk-lcard__meta">
                        Sisa {rp(i.remaining ?? null)} · ditransfer {rp(i.transferredAmount ?? 0)}
                      </div>
                      {i.overBudget ? (
                        <div className="pk-lcard__chips">
                          <span className="pk-lchip pk-lchip--warn">Melebihi RAP</span>
                        </div>
                      ) : null}
                    </>
                  ) : rap.drivesProgress ? (
                    <div className="pk-lcard__meta">
                      Realisasi volume {qty(i.realised)} {i.uom.code}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <Pager id="project-rap" path={path} sp={sp} page={page} unit="item" />
          </Card>
        </>
      )}
      {rap.canEdit && editor ? (
        <Card
          id="project-rap-manage"
          title="Kelola RAP"
          sub={`${rap.drivesProgress ? 'Konstruksi: tahapan wajib; pekerjaan menggerakkan progress tahapan' : 'Rencana biaya project: tahapan opsional, progress tetap manual'} · item tidak pernah dihapus (nonaktifkan bila tidak dipakai)`}
          // UI feedback 17/10 #3: the item form is here; the RAP page of the project (Proyek › RAP) has the same form + filters
          action={{ href: `/admin/rap/${id}`, label: 'Halaman RAP proyek' }}
        >
          <RapItemsEditor projectId={id} items={rapEditorItems(rap)} stages={editor.stages} uoms={editor.uoms} prices={rap.totals !== null} mode={editor.mode} stageRequired={rap.drivesProgress} drivesProgress={rap.drivesProgress} />
          <RapExcelTools projectId={id} hasItems={rap.items.length > 0} templates={templates} needsReason={rap.needsReason} stageRequired={rap.drivesProgress} />
        </Card>
      ) : null}
    </TabRoot>
  )
}

// ---------------------------------------------------------------- Pengajuan tab

/** Status groups of the "Pengajuan" filter. */
const STATUS_GROUPS: Record<string, { label: string; statuses: readonly RequestStatus[] }> = {
  draft: { label: 'Draft', statuses: ['draft'] },
  menunggu: { label: 'Menunggu persetujuan', statuses: ['pending_ack', 'pending_approval'] },
  disetujui: { label: 'Disetujui & sesudahnya', statuses: BUDGET_COMMITTED },
  ditolak: { label: 'Ditolak / dibatalkan', statuses: ['rejected', 'cancelled'] },
}

type Row = ReturnType<typeof listItem>

/**
 * Staff-only in the project's PT → "created by me OR naming my employee" (the `own` rule of domain/expense/access.ts);
 * any other role there → null (the collection read scope alone). The project must be readable by the caller.
 */
async function ownOnlyWhere(req: PayloadRequest, projectId: number): Promise<Where | null> {
  const p = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, select: { company: true }, user: req.user, overrideAccess: false /* caller's read scope */, req }).catch(() => null)) as { company?: unknown } | null
  const company = relId(p?.company)
  const roles = rolesIn(req, company)
  if (!roles.includes('pk-staff') || roles.some((r) => r !== 'pk-staff')) return null
  const or: Where[] = [{ createdBy: { equals: userId(req) ?? -1 } }]
  const emp = employeeIn(req, company)
  if (emp !== undefined) or.push({ requesters: { in: [emp] } })
  return { or }
}

export async function ProjectRequestsTab(props: DocumentViewServerProps) {
  const req = props.initPageResult.req as PayloadRequest
  const id = idOf(props)
  const sp = props.searchParams as Record<string, string | string[] | undefined> | undefined
  const lq = parseListQuery(sp, ['status', 'jenis'])
  const path = `/admin/collections/projects/${id}/pengajuan`
  const and: Where[] = [{ project: { equals: id } }]
  // DRMS 13/10 Umum #4: status groups / jenis are multi-select (`?status=menunggu,selesai&jenis=advance`)
  const groups = filterValues(lq, 'status').flatMap((g) => (STATUS_GROUPS[g] ? [...STATUS_GROUPS[g].statuses] : []))
  if (groups.length) and.push({ status: { in: [...new Set(groups)] } })
  const jenis = allowedValues(lq, 'jenis', REQUEST_TYPES)
  if (jenis.length) and.push({ type: { in: jenis } })
  const text = searchWhere(['docNo', 'title'], lq.q)
  if (text) and.push(text)
  // owner 2026-10-11: a Staff (no other role in the project's PT) sees only their OWN requests of the project here
  const own = Number.isSafeInteger(id) ? await ownOnlyWhere(req, id) : null
  if (own) and.push(own)
  const res = Number.isSafeInteger(id)
    ? await req.payload
        .find({ collection: 'expense-requests', where: { and }, sort: '-id', page: lq.page, limit: lq.per, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
        .catch(() => null)
    : null
  const page = res ? pageOfFind({ ...res, docs: (res.docs as unknown as RequestDoc[]).map((d) => listItem(d)) }) : paginate<Row>([], 1, lq.per)
  const tone = (s: string) => (s === 'rejected' || s === 'cancelled' ? 'bad' : s === 'completed' ? 'ok' : s === 'draft' ? 'none' : s === 'pending_ack' || s === 'pending_approval' ? 'wait' : 'progress')
  const cols: Col<Row>[] = [
    {
      key: 'no',
      label: 'Nomor',
      cell: (r) => (
        <a href={`/admin/collections/expense-requests/${r.id}`} data-pk-doc-link={r.id}>
          {r.docNo ?? `Draft #${r.id}`}
        </a>
      ),
    },
    {
      key: 't',
      label: 'Judul',
      cell: (r) => (
        <>
          {r.title}
          <span className="sub">{r.typeLabel}</span>
        </>
      ),
    },
    { key: 'st', label: 'Status', cell: (r) => <StatusPill tone={tone(r.status)} label={r.statusLabel} /> },
    { key: 'd', label: 'Tanggal', sec: true, cell: (r) => (r.requestDate ? formatDateLong(r.requestDate) : '—') },
    { key: 'g', label: 'Total', num: true, cell: (r) => rp(r.grandTotal) },
    { key: 'a', label: 'Disetujui', num: true, sec: true, cell: (r) => rp(r.approvedAmount) },
  ]
  return (
    <TabRoot name="project-requests">
      <Card id="project-requests" title={`${own ? 'Pengajuan saya di project ini' : 'Pengajuan project ini'} (${page.total})`} sub="Nomor dapat diklik untuk membuka pengajuan">
        <ListToolbar
          id="project-requests"
          action={path}
          query={lq}
          label="Cari dan saring pengajuan project"
          search={{ placeholder: 'Nomor atau judul…' }}
          filters={[
            { key: 'status', label: 'Status', multi: true, options: Object.entries(STATUS_GROUPS).map(([value, g]) => ({ value, label: g.label })) },
            { key: 'jenis', label: 'Jenis', multi: true, options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_TYPE_LABELS[t] })) },
          ]}
        />
        <div className="pk-lwide">
          <DataTable id="project-requests" paged={false} rowHref={(r) => `/admin/collections/expense-requests/${r.id}`} caption="Pengajuan project" rows={page.items} rowKey={(r) => r.id} rowAttrs={(r) => ({ 'data-pk-request': String(r.id) })} cols={cols} empty={<EmptyState text={res === null ? 'Project tidak ditemukan atau tidak dapat Anda buka.' : 'Belum ada pengajuan yang cocok.'} />} />
        </div>
        <div className="pk-lcards" data-pk-request-cards>
          {page.items.length === 0 ? <EmptyState text="Belum ada pengajuan yang cocok." /> : null}
          {page.items.map((r) => (
            <article key={r.id} className="pk-lcard" data-pk-request-card={r.id}>
              <div className="pk-lcard__head">
                <span className="pk-lcard__title">
                  <a href={`/admin/collections/expense-requests/${r.id}`}>{r.docNo ?? `Draft #${r.id}`}</a> · {r.title}
                </span>
                <span className="pk-lcard__total">{rp(r.grandTotal)}</span>
              </div>
              <div className="pk-lcard__meta">
                {r.typeLabel}
                {r.requestDate ? ` · ${formatDateLong(r.requestDate)}` : ''}
              </div>
              <div className="pk-lcard__chips">
                <StatusPill tone={tone(r.status)} label={r.statusLabel} />
              </div>
            </article>
          ))}
        </div>
        <Pager id="project-requests" path={path} sp={sp} page={page} unit="pengajuan" />
      </Card>
    </TabRoot>
  )
}
