import type { AdminViewServerProps, PayloadRequest } from 'payload'
import Link from 'next/link'
import React from 'react'

import { hasRole } from '@/access/roles'
import { AddendumForm } from '@/admin/components/addendum/AddendumForm'
import { ConfirmAction } from '@/admin/components/addendum/ConfirmAction'
import { ReasonAction } from '@/admin/components/kas/ReasonAction'
import { ADDENDUM_STATUSES, ADDENDUM_STATUS_LABELS, type AddendumStatus } from '@/domain/addendum/rules'
import { addendumDetail, addendumInbox, addendumProjectOptions, listAddenda, loadVisibleAddendum, type AddendumSummary } from '@/domain/addendum/service'
import { settings } from '@/domain/expense/common'
import type { PillTone } from '@/domain/reports/viz'
import { withReqTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'

import { KAS_STYLE } from '@/admin/components/kas/style'

import { F3Root } from './f3-ui'
import { Frame } from './frame'
import { Alert, dateTimeId } from './progress-ui'
import { Bento, Card, DashHead, DataTable, EmptyState, KpiRow, KpiTile, pctText, rp, rpShort, StatusPill, VIZ_STYLE, type Col } from './viz'

/**
 * E5 web (T12, US-18/US-30): Addendum RAB list (filters status/project), new/draft form (PM of the
 * team), detail with RAB impact, decision timeline and the actions the caller may take (server
 * `allowedActions`: PM submit/cancel, Direktur "Setujui" = Diketahui, Finance approve, reject with
 * reason). Every action goes to /api/v1/budget-addenda (role + step re-checked, audited).
 */
const READERS = ['pk-owner', 'pk-finance', 'pk-pm'] as const
export const addendumHref = (id: number) => `/admin/addendum/detail/${id}`

export const ADDENDUM_TONE: Record<AddendumStatus, PillTone> = { draft: 'none', pending_ack: 'wait', pending_approval: 'progress', approved: 'ok', rejected: 'bad', cancelled: 'none' }

function Denied({ props, title }: { props: AdminViewServerProps; title: string }) {
  return (
    <Frame props={props} name="addendum-denied">
      <DashHead title={title} />
      <Alert tone="bad" attr="denied">
        <p>Halaman ini hanya untuk PM, Direktur dan Finance.</p>
      </Alert>
    </Frame>
  )
}

// ================================================================ list

export async function AddendumList(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Addendum RAB" />
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const status = ADDENDUM_STATUSES.includes(sp.status as AddendumStatus) ? (sp.status as AddendumStatus) : undefined
  const project = sp.project && /^\d{1,10}$/.test(sp.project) ? Number(sp.project) : undefined
  const before = sp.sebelum && /^\d{1,10}$/.test(sp.sebelum) ? Number(sp.sebelum) : undefined
  const d = await withReqTransaction(req, async () => {
    const page = await listAddenda(req, { projectId: project, status, limit: 25, after: before })
    const all = await listAddenda(req, { projectId: project, limit: 100 })
    const projects = (await req.payload.find({ collection: 'projects', sort: 'code', depth: 0, pagination: false, select: { code: true, name: true }, user: req.user, overrideAccess: false, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; code: string; name: string }>
    const inbox = await addendumInbox(req)
    const canCreate = (await addendumProjectOptions(req)).length > 0
    return { page, all: all.items, projects, inbox: inbox.items.length, canCreate }
  })
  const pending = d.all.filter((a) => a.status === 'pending_ack' || a.status === 'pending_approval')
  const approved = d.all.filter((a) => a.status === 'approved')
  const filtered = Boolean(status || project)
  const cols: Col<AddendumSummary>[] = [
    {
      key: 'no',
      label: 'Addendum',
      sort: 'descending',
      cell: (a) => (
        <>
          <a href={addendumHref(a.id)} data-pk-addendum={a.docNo ?? a.id}>
            {a.docNo ?? `Draft #${a.id}`}
          </a>
          <span className="sub" title={a.reason}>
            {a.reason}
          </span>
        </>
      ),
    },
    {
      key: 'p',
      label: 'Project',
      cell: (a) => (
        <>
          {a.project.code} {a.project.name}
          <span className="sub">RAB {rp(a.project.budget)}</span>
        </>
      ),
    },
    { key: 'st', label: 'Status', cell: (a) => <StatusPill tone={ADDENDUM_TONE[a.status]} label={a.stepLabel ?? a.statusLabel} /> },
    { key: 'by', label: 'Diajukan', sec: true, cell: (a) => a.createdBy.name ?? '—' },
    { key: 'amt', label: 'Tambahan', num: true, cell: (a) => <b>+{rp(a.addition)}</b> },
  ]
  const keep = (extra: Record<string, string>) => {
    const u = new URLSearchParams()
    if (status) u.set('status', status)
    if (project) u.set('project', String(project))
    for (const [k, v] of Object.entries(extra)) u.set(k, v)
    return `/admin/addendum?${u.toString()}`
  }
  return (
    <Frame props={props} name="addendum">
      <DashHead title="Addendum RAB" note="Diajukan PM project · disetujui Direktur lalu Finance · RAB project bertambah otomatis setelah disetujui">
        <div className="pk-kact">
          {d.canCreate ? (
            <Link className="pk-kbtn primary" href={`/admin/addendum/baru${project ? `?project=${project}` : ''}`} data-pk-link="addendum-baru">
              + Ajukan addendum
            </Link>
          ) : null}
          {d.inbox > 0 ? (
            <Link className="pk-kbtn" href="/admin/persetujuan#addendum">
              Menunggu saya ({d.inbox})
            </Link>
          ) : null}
        </div>
      </DashHead>
      <Bento label="Ringkasan addendum">
        <KpiRow cols={3}>
          <KpiTile id="add-pending" icon="clock" label="Menunggu persetujuan" value={String(pending.length)} kpi="addendum-pending" href={keep({ status: 'pending_ack' })} more="Menunggu Direktur" i={0}>
            <p className="pk-kpi-x">
              <b>+{rpShort(pending.reduce((s, a) => s + a.addition, 0))}</b> diajukan
            </p>
          </KpiTile>
          <KpiTile id="add-mine" icon="inbox" label="Menunggu keputusan saya" value={String(d.inbox)} kpi="addendum-inbox" href="/admin/persetujuan#addendum" more="Buka Persetujuan" i={1}>
            <p className="pk-kpi-x">{d.inbox === 0 ? 'Tidak ada yang menunggu Anda ✓' : 'Direktur: Setujui · Finance: approval'}</p>
          </KpiTile>
          <KpiTile id="add-approved" icon="check" label="Disetujui" value={String(approved.length)} kpi="addendum-approved" href={keep({ status: 'approved' })} more="Lihat" i={2}>
            <p className="pk-kpi-x">
              RAB bertambah <b>{rpShort(approved.reduce((s, a) => s + a.addition, 0))}</b>
            </p>
          </KpiTile>
        </KpiRow>
      </Bento>
      <form className="pk-filter" method="get" action="/admin/addendum" role="search" aria-label="Filter addendum" data-pk-filter="addendum">
        <label>
          Status
          <select name="status" defaultValue={status ?? ''}>
            <option value="">Semua status</option>
            {ADDENDUM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ADDENDUM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Project
          <select name="project" defaultValue={project ? String(project) : ''}>
            <option value="">Semua project</option>
            {d.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="pk-kbtn primary">
          Terapkan
        </button>
        {filtered ? (
          <Link className="pk-kbtn" href="/admin/addendum">
            Reset
          </Link>
        ) : null}
      </form>
      <Bento label="Daftar addendum">
        <Card id="addenda" title="Daftar addendum" sub="Terbaru dulu">
          <DataTable
            id="addenda"
            cols={cols}
            rows={d.page.items}
            rowKey={(a) => a.id}
            rowAttrs={(a) => ({ 'data-pk-row': a.docNo ?? String(a.id), 'data-pk-status': a.status })}
            caption="Addendum RAB"
            empty={<EmptyState text={filtered ? 'Tidak ada addendum untuk filter ini.' : 'Belum ada addendum RAB.'} action={d.canCreate ? { href: '/admin/addendum/baru', label: '+ Ajukan addendum' } : undefined} />}
          />
          {d.page.nextCursor || before ? (
            <nav className="pk-actions" aria-label="Halaman addendum" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              {before ? (
                <a className="pk-kbtn sm" href={keep({})}>
                  ← Terbaru
                </a>
              ) : null}
              {d.page.nextCursor ? (
                <a className="pk-kbtn sm" href={keep({ sebelum: String(d.page.nextCursor) })} rel="next">
                  Lebih lama →
                </a>
              ) : null}
            </nav>
          ) : null}
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ new

export async function AddendumNew(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const projects = hasRole(req, 'pk-pm') ? await withReqTransaction(req, () => addendumProjectOptions(req)) : []
  if (projects.length === 0) {
    return (
      <Frame props={props} name="addendum-baru">
        <DashHead title="Ajukan addendum RAB">
          <Link className="pk-kbtn" href="/admin/addendum">
            ← Addendum RAB
          </Link>
        </DashHead>
        <Alert tone="bad" attr="denied">
          <p>Addendum RAB diajukan oleh PM project (project tim Anda). Anda belum menjadi PM project yang aktif.</p>
        </Alert>
      </Frame>
    )
  }
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const initial = sp.project && /^\d{1,10}$/.test(sp.project) ? Number(sp.project) : undefined
  return (
    <Frame props={props} name="addendum-baru">
      <DashHead title="Ajukan addendum RAB" note="Nomor ADD/YYMM/#### diberikan saat diajukan. Direktur menyetujui, lalu Finance.">
        <Link className="pk-kbtn" href="/admin/addendum">
          ← Addendum RAB
        </Link>
      </DashHead>
      <Bento>
        <Card id="addendum-form" title="Addendum baru" span={8}>
          <AddendumForm projects={projects} initialProject={projects.some((p) => p.id === initial) ? initial : undefined} />
        </Card>
        <Card id="addendum-help" title="Alur" span={4}>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li>PM mengajukan nominal tambahan + alasan.</li>
            <li>Direktur menyetujui (Diketahui) atau menolak dengan alasan.</li>
            <li>Finance menyetujui atau menolak dengan alasan.</li>
            <li>Setelah disetujui, RAB project = RAB terkini + tambahan (tercatat di audit log).</li>
          </ol>
        </Card>
      </Bento>
    </Frame>
  )
}

// ================================================================ detail

async function tzOf(req: PayloadRequest): Promise<string> {
  return (await settings(req)).timezone || process.env.TZ || DEFAULT_TZ
}

const POSITION: Record<string, string> = { diketahui: 'Direktur (Diketahui)', approval: 'Finance' }
const DECISION: Record<string, { tone: PillTone; label: string }> = {
  acknowledged: { tone: 'ok', label: 'Disetujui' },
  approved: { tone: 'ok', label: 'Disetujui' },
  rejected: { tone: 'bad', label: 'Ditolak' },
}

export async function AddendumDetail(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!hasRole(req, ...READERS)) return <Denied props={props} title="Addendum RAB" />
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[2] ?? ''
  const id = /^\d{1,10}$/.test(seg) ? Number(seg) : 0
  const d = await withReqTransaction(req, async () => {
    const doc = id ? await loadVisibleAddendum(req, id).catch(() => null) : null
    if (!doc) return null
    const projects = await addendumProjectOptions(req)
    return { a: await addendumDetail(req, doc), tz: await tzOf(req), projects }
  })
  const back = (
    <Link className="pk-kbtn" href="/admin/addendum">
      ← Addendum RAB
    </Link>
  )
  if (!d) {
    return (
      <Frame props={props} name="addendum-detail">
        <DashHead title="Addendum tidak ditemukan">{back}</DashHead>
      </Frame>
    )
  }
  const { a, tz } = d
  const sp = (props.searchParams ?? {}) as Record<string, string | undefined>
  const acts = new Set(a.allowedActions)
  const title = a.docNo ?? `Draft addendum #${a.id}`
  const b = a.budget
  const approved = a.status === 'approved'
  const steps = [
    { key: 'submit', label: 'Diajukan PM', done: a.submittedAt !== null, when: a.submittedAt, who: a.createdBy.name },
    ...(a.approvalRule?.skipped.some((s) => s.position === 'diketahui') ? [] : [{ key: 'ack', label: 'Direktur (Diketahui)', ...decided(a, 'diketahui') }]),
    ...Array.from({ length: a.approvalRule?.levels ?? 1 }, (_, i) => ({ key: `ap${i + 1}`, label: (a.approvalRule?.levels ?? 1) > 1 ? `Finance level ${i + 1}` : 'Finance', ...decided(a, 'approval', i + 1) })),
  ]
  return (
    <Frame props={props} name="addendum-detail">
      <DashHead title={title} note={`${a.project.code} ${a.project.name} · diajukan ${a.createdBy.name ?? '—'}`}>
        <div className="pk-kact">
          {back}
          <Link className="pk-kbtn" href={`/admin/progress/project/${a.project.id}`}>
            Project
          </Link>
        </div>
      </DashHead>
      {sp.diajukan ? (
        <Alert tone="ok" attr="submitted">
          <p>
            <strong>{a.docNo}</strong> diajukan · menunggu {a.stepLabel ?? 'keputusan'}.
          </p>
        </Alert>
      ) : sp.tersimpan ? (
        <Alert tone="ok" attr="saved">
          <p>Draft tersimpan. Ajukan bila sudah siap.</p>
        </Alert>
      ) : null}
      {a.status === 'rejected' ? (
        <Alert tone="bad" attr="rejected">
          <p>Ditolak: {a.rejectReason}</p>
        </Alert>
      ) : a.status === 'cancelled' ? (
        <Alert tone="info" attr="cancelled">
          <p>Dibatalkan: {a.cancelReason}</p>
        </Alert>
      ) : null}

      {acts.size > 0 ? (
        <div className="pk-actions" data-pk-actions={[...acts].join(',')} style={{ gap: 8 }}>
          {acts.has('acknowledge') ? (
            <ConfirmAction
              url={`/api/v1/budget-addenda/${a.id}/acknowledge`}
              label="Setujui (Direktur)"
              size="md"
              title={`Setujui ${title}?`}
              description={
                <>
                  Tambahan <strong>{rp(a.addition)}</strong> untuk {a.project.code}. Setelah Anda setujui, addendum menunggu approval Finance. Tanda tangan profil Anda (bila ada) dicatat.
                </>
              }
              confirmLabel="Setujui"
              testId="addendum-acknowledge"
            />
          ) : null}
          {acts.has('approve') ? (
            <ConfirmAction
              url={`/api/v1/budget-addenda/${a.id}/approve`}
              label="Setujui (Finance)"
              size="md"
              title={`Setujui ${title}?`}
              description={
                <>
                  RAB {a.project.code} menjadi RAB terkini <strong>+ {rp(a.addition)}</strong> (sekarang {rp(b.current)} → {rp(b.afterAddition)}), langsung dan tercatat di audit log.
                </>
              }
              confirmLabel="Setujui & tambah RAB"
              testId="addendum-approve"
            />
          ) : null}
          {acts.has('reject') ? <ReasonAction url={`/api/v1/budget-addenda/${a.id}/reject`} label="Tolak" size="md" title={`Tolak ${title}?`} description={<>Alasan penolakan dikirim ke PM pengaju dan tercatat di audit log.</>} confirmLabel="Tolak addendum" testId="addendum-reject" /> : null}
          {acts.has('submit') ? (
            <ConfirmAction url={`/api/v1/budget-addenda/${a.id}/submit`} label="Ajukan ke Direktur" size="md" title="Ajukan addendum?" description={<>Nomor ADD diberikan dan Direktur diberi tahu. Nominal dan alasan tidak dapat diubah lagi.</>} confirmLabel="Ajukan" testId="addendum-submit" />
          ) : null}
          {acts.has('cancel') ? <ReasonAction url={`/api/v1/budget-addenda/${a.id}/cancel`} label="Batalkan" size="md" variant="secondary" title={`Batalkan ${title}?`} description={<>Addendum dibatalkan (tidak dihapus). Alasan wajib.</>} confirmLabel="Batalkan addendum" testId="addendum-cancel" /> : null}
        </div>
      ) : null}

      <Bento label="Addendum RAB">
        <KpiRow cols={3}>
          <KpiTile id="a-add" icon="up" label="Tambahan" value={`+${rpShort(a.addition)}`} title={rp(a.addition)} kpi="addendum-addition" i={0}>
            <p className="pk-kpi-x">{rp(a.addition)}</p>
            <p className="pk-kpi-x">
              <StatusPill tone={ADDENDUM_TONE[a.status]} label={a.stepLabel ?? a.statusLabel} />
            </p>
          </KpiTile>
          <KpiTile id="a-rab" icon="wallet" label={approved ? 'RAB lama → baru' : 'RAB sekarang → setelah disetujui'} value={approved ? rpShort(a.newBudget ?? 0) : rpShort(b.afterAddition)} title={approved ? rp(a.newBudget) : rp(b.afterAddition)} kpi="addendum-rab" i={1}>
            <p className="pk-kpi-x">
              {approved ? (
                <>
                  {rp(a.oldBudget)} → <b>{rp(a.newBudget)}</b>
                </>
              ) : (
                <>
                  {rp(b.current)} → <b>{rp(b.afterAddition)}</b>
                </>
              )}
            </p>
            {a.budgetAtSubmit !== null && !approved ? <p className="pk-kpi-x">RAB saat diajukan {rp(a.budgetAtSubmit)}</p> : null}
          </KpiTile>
          <KpiTile id="a-committed" icon="target" label="Komitmen terhadap RAB" value={`${pctText(b.committedPctBefore)} → ${pctText(b.committedPctAfter)}`} kpi="addendum-committed" i={2}>
            <p className="pk-kpi-x">
              Komitmen (K-07) <b>{rp(b.committed)}</b>
            </p>
          </KpiTile>
        </KpiRow>
        <Card id="addendum-reason" title="Alasan" span={7} i={3}>
          <p className="pk-pre" data-pk-field="reason">
            {a.reason}
          </p>
          {acts.has('edit') ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Ubah draft</h3>
              <AddendumForm projects={d.projects} edit={{ id: a.id, projectId: a.project.id, addition: a.addition, reason: a.reason }} />
            </div>
          ) : null}
        </Card>
        <Card id="addendum-flow" title="Alur persetujuan" sub={a.approvalRule ? `Aturan: ${a.approvalRule.name}` : 'Aturan ditentukan saat diajukan'} span={5} i={4}>
          <ol className="pk-tl" data-pk-flow>
            {steps.map((s) => (
              <li key={s.key} data-pk-step={s.key} data-pk-done={s.done ? 'yes' : 'no'}>
                <div className="when">
                  {s.label}
                  {s.when ? ` · ${dateTimeId(s.when, tz)}` : ''}
                </div>
                <p className="what">
                  {'tone' in s && s.tone ? <StatusPill tone={s.tone} label={s.state ?? ''} /> : s.done ? <StatusPill tone="ok" label="Selesai" /> : <StatusPill tone="none" label="Belum" />} {s.who ? <b>{s.who}</b> : null}
                  {'reason' in s && s.reason ? <span className="sub"> — {s.reason}</span> : null}
                </p>
              </li>
            ))}
            {(a.approvalRule?.skipped ?? []).map((s) => (
              <li key={`skip-${s.position}-${s.level}`}>
                <div className="when">{POSITION[s.position] ?? s.position}</div>
                <p className="what">
                  <StatusPill tone="none" label="Tidak berlaku — pemohon" /> {s.reason}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </Bento>
    </Frame>
  )
}

type Detail = Awaited<ReturnType<typeof addendumDetail>>

function decided(a: Detail, position: 'diketahui' | 'approval', level = 0): { done: boolean; when: string | null; who: string | null; tone?: PillTone; state?: string; reason?: string | null } {
  const row = a.decisions.find((x) => x.position === position && (position === 'diketahui' || x.level === level))
  if (!row) {
    const waiting = (position === 'diketahui' && a.status === 'pending_ack') || (position === 'approval' && a.status === 'pending_approval' && (a.currentLevel ?? 1) === level)
    return { done: false, when: null, who: null, tone: waiting ? 'wait' : 'none', state: waiting ? 'Menunggu' : 'Belum' }
  }
  const dd = DECISION[row.decision]!
  return { done: true, when: row.decidedAt, who: row.actor.name, tone: dd.tone, state: dd.label, reason: row.reason }
}

// ================================================================ approval inbox section

/** Section for the "Persetujuan" view (ApprovalInbox): addenda waiting for the caller. */
export async function AddendumInboxSection({ req }: { req: PayloadRequest }) {
  const { items } = await withReqTransaction(req, () => addendumInbox(req))
  return (
    <F3Root name="addendum-inbox">
    <style>{VIZ_STYLE}</style>
    <style>{KAS_STYLE}</style>
    <section id="addendum" style={{ marginTop: 32 }} data-pk-inbox="addendum">
      <h2 style={{ margin: '0 0 8px' }}>Addendum RAB</h2>
      {items.length === 0 ? (
        <EmptyState text="Tidak ada addendum RAB yang menunggu keputusan Anda." />
      ) : (
        <DataTable
          id="addendum-inbox"
          caption="Addendum RAB yang menunggu keputusan saya"
          rows={items}
          rowKey={(r) => r.id}
          cols={[
            {
              key: 'no',
              label: 'Addendum',
              cell: (r) => (
                <>
                  <a href={addendumHref(r.id)}>{r.docNo}</a>
                  <span className="sub" title={r.reason}>
                    {r.reason}
                  </span>
                </>
              ),
            },
            { key: 'p', label: 'Project', cell: (r) => `${r.project.code} ${r.project.name}` },
            { key: 'by', label: 'Diajukan', sec: true, cell: (r) => r.createdBy.name ?? '—' },
            { key: 'amt', label: 'Tambahan', num: true, cell: (r) => <b>+{rp(r.addition)}</b> },
            {
              key: 'rab',
              label: 'RAB',
              num: true,
              sec: true,
              cell: (r) => (
                <span className="nw">
                  {rpShort(r.budget.current)} → {rpShort(r.budget.afterAddition)}
                </span>
              ),
            },
            { key: 'step', label: 'Langkah', cell: (r) => <StatusPill tone="wait" label={r.stepLabel ?? ''} /> },
            {
              key: 'act',
              label: 'Aksi',
              cell: (r) => (
                <div className="pk-kact">
                  <ConfirmAction
                    url={`/api/v1/budget-addenda/${r.id}/${r.step}`}
                    label="Setujui"
                    title={`Setujui ${r.docNo}?`}
                    description={r.step === 'approve' ? <>RAB {r.project.code} bertambah {rp(r.addition)} (sekarang {rp(r.budget.current)}).</> : <>Tambahan {rp(r.addition)} untuk {r.project.code}; berikutnya approval Finance.</>}
                    confirmLabel="Setujui"
                    testId={`addendum-inbox-${r.step}-${r.id}`}
                  />
                  <ReasonAction url={`/api/v1/budget-addenda/${r.id}/reject`} label="Tolak" title={`Tolak ${r.docNo}?`} description={<>Alasan dikirim ke PM pengaju.</>} confirmLabel="Tolak addendum" testId={`addendum-inbox-reject-${r.id}`} />
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
