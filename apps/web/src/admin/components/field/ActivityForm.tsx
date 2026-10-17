'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, PO_STATUS_LABELS, PO_STATUSES, RELATES_TO_PO, type ActivityKind, type PoStatus } from '@/domain/field/rules'
import { itemsText } from '@/domain/field/views'
import { codeFrom, ptOptions } from '@/lib/pt-options'

import { RupiahInput, useRupiah } from '../RupiahInput'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { getJson } from './client'
import { Choice, LinesEditor, linesFrom, linesOut, PhotoPicker, ReasonField, usePhotos, type ExistingPhoto, type LineDraft } from './parts'
import { DateInput } from '../DateInput'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * FR1 web quick input "Aktivitas aftersales" (plan A2; APK mockup Android-Aftersales): customer, kind
 * chips, the open PO of that customer for a delivery / invoice (GET /api/v1/aftersales/open-pos),
 * document no., item rows, optional value (readable only by Direktur/Finance/Admin and the reporter),
 * follow-up date (quotation), receiver + "PO ini sudah terkirim semua" (delivery), proof photos (≤ 5),
 * notes. POST /api/v1/aftersales-activities with Idempotency-Key + clientUuid.
 *
 * UI feedback 17/10 #5 ("edit = add"): the SAME form is the edit page `/aftersales/aktivitas/:id/ubah` — `mode="edit"`
 * (reporter ≤ 24 h, PATCH) / `mode="correction"` (PM / Direktur, POST …/corrections, reason required): project,
 * customer, date, kind and PO stay in place, disabled; the value field only when the caller may see the value (else
 * disabled, empty); stored photos shown, new ones added (≤ 5 in total); "Status PO" (correction of a PO masuk) and
 * "Alasan" last. Only changed fields are sent; the server rules are unchanged.
 */
export type AsProject = { id: number; label: string; companyId: number; clientId: number | null }
export type AsClient = { id: number; name: string; companyId: number }
type OpenPo = { id: number; docNo: string | null; activityDate: string; ageDays: number; poStatus: string; items: Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null }>; project: { id: number } }

const DOC_LABEL: Record<ActivityKind, string> = { penawaran: 'No. penawaran (Q)', po_masuk: 'No. PO', pengiriman: 'No. surat jalan (SJ)', penagihan: 'No. invoice (INV)', kunjungan: 'No. dokumen', lainnya: 'No. dokumen' }
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)
type Item = { name: string; partNo?: string | null; qty: number; uom?: string | null }
const itemsJson = (xs: readonly Item[]) => JSON.stringify(xs.map((l) => ({ name: l.name, partNo: l.partNo ?? null, qty: l.qty, uom: l.uom ?? null })))
const text = (v: string) => v.trim() || null

/** The stored activity on the edit page (`mode` edit / correction). */
export type AsActivity = {
  id: number
  projectId: number
  clientId: number
  kind: ActivityKind
  activityDate: string
  docNo: string | null
  items: Item[]
  value: number | null
  /** the caller may read (and so change) the value: Direktur / Finance / Admin or the reporter */
  valueVisible: boolean
  followUpDate: string | null
  receiver: string | null
  relatesTo: { id: number; label: string } | null
  poStatus: PoStatus | null
  notes: string | null
  photos: ExistingPhoto[]
}

export function ActivityForm({
  mode = 'create',
  activity,
  projects,
  clients,
  ptCodes,
  today,
  minDate,
  initial,
}: {
  /** default `create` (UI feedback 17/10 #5) */
  mode?: 'create' | 'edit' | 'correction'
  /** edit / correction */
  activity?: AsActivity
  projects: AsProject[]
  clients: AsClient[]
  /** DRMS UI 17/10 #4: PT codes while several PTs are selected — clients are tagged `[CS1]` until a project narrows them. */
  ptCodes?: Record<number, string>
  today: string
  minDate: string
  initial?: { project?: number; client?: number; kind?: ActivityKind; relatesTo?: number }
}) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const a0 = mode === 'create' ? undefined : activity
  const locked = a0 !== undefined
  const [projectId, setProjectId] = useState(a0 ? String(a0.projectId) : initial?.project ? String(initial.project) : projects.length === 1 ? String(projects[0]!.id) : '')
  const project = projects.find((p) => String(p.id) === projectId) ?? null
  // DRMS UI 17/10 #4: the project's PT only; before a project, every PT's clients tagged `[CS1]` (same names per PT)
  const clientOpts = ptOptions(
    clients.map((c) => ({ ...c, label: c.name })),
    { code: codeFrom(ptCodes), company: project?.companyId ?? null, multi: ptCodes !== undefined },
  )
  const [clientId, setClientId] = useState(a0 ? String(a0.clientId) : initial?.client ? String(initial.client) : project?.clientId ? String(project.clientId) : '')
  const client = clientOpts.find((c) => String(c.id) === clientId) ?? null
  const [kind, setKind] = useState<ActivityKind | ''>(a0?.kind ?? initial?.kind ?? '')
  const [date, setDate] = useState(a0?.activityDate ?? today)
  const [docNo, setDocNo] = useState(a0?.docNo ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() => (a0 ? linesFrom(a0.items) : []))
  const value = useRupiah(a0?.valueVisible ? a0.value : null)
  const [followUp, setFollowUp] = useState(a0?.followUpDate ?? '')
  const [receiver, setReceiver] = useState(a0?.receiver ?? '')
  const [delivered, setDelivered] = useState(false)
  const [relatesTo, setRelatesTo] = useState(a0?.relatesTo ? String(a0.relatesTo.id) : initial?.relatesTo ? String(initial.relatesTo) : '')
  const [notes, setNotes] = useState(a0?.notes ?? '')
  const [poStatus, setPoStatus] = useState<PoStatus | ''>(a0?.poStatus ?? '')
  const [reason, setReason] = useState('')
  const existing = a0?.photos ?? []
  const photos = usePhotos(Math.max(0, 5 - existing.length))
  const valueLocked = a0 !== undefined && !a0.valueVisible
  const [pos, setPos] = useState<{ key: string; items: OpenPo[] }>({ key: '', items: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const clientUuid = useRef(uuid())
  const idem = useRef<{ body: string; key: string | undefined } | null>(null)

  const prefill = useRef<number | undefined>(initial?.relatesTo)
  const kindRef = useRef(kind)
  useEffect(() => {
    kindRef.current = kind
  }, [kind])
  const needsPo = kind !== '' && RELATES_TO_PO.includes(kind)
  // edit pages: the stored PO is fixed (shown disabled) — no open-PO lookup
  const poKey = !locked && needsPo && client && project ? `${client.id}|${project.id}` : ''
  useEffect(() => {
    if (!poKey) return
    let live = true
    const [c, p] = poKey.split('|') as [string, string]
    void getJson<{ items: OpenPo[] }>(`/api/v1/aftersales/open-pos?client=${c}&project=${p}`).then((r) => {
      if (!live) return
      const items = r?.items ?? []
      setPos({ key: poKey, items })
      // "Catat pengiriman" from a PO: copy its items once as the delivered items
      const pre = prefill.current !== undefined ? items.find((x) => x.id === prefill.current) : undefined
      if (pre && kindRef.current === 'pengiriman') setLines((cur) => (cur.length ? cur : linesFrom(pre.items)))
      prefill.current = undefined
    })
    return () => {
      live = false
    }
  }, [poKey])
  const openPos = pos.key === poKey ? pos.items : []
  const poLoading = !!poKey && pos.key !== poKey
  const po = openPos.find((p) => String(p.id) === relatesTo) ?? null

  const parts = linesOut(lines, false)
  const err = (k: string) => errors[k]
  const errEl = (k: string) =>
    err(k) ? (
      <p className="err" id={id(`${k}-e`)} role="alert">
        {err(k)}
      </p>
    ) : null

  /** Edit / correction: only the changed fields (+ new photos, Status PO, reason) → PATCH / POST …/corrections. */
  const saveChanges = async (a: AsActivity) => {
    const body: Record<string, unknown> = {}
    if (text(docNo) !== a.docNo) body.docNo = text(docNo)
    if (itemsJson(parts.lines) !== itemsJson(a.items)) body.items = parts.lines
    if (a.valueVisible && value.parsed.value !== a.value) body.value = value.parsed.value
    if (a.kind === 'penawaran' && (followUp || null) !== a.followUpDate) body.followUpDate = followUp || null
    if (a.kind === 'pengiriman' && text(receiver) !== a.receiver) body.receiver = text(receiver)
    if (text(notes) !== a.notes) body.notes = text(notes)
    if (mode === 'correction' && a.kind === 'po_masuk' && poStatus && poStatus !== a.poStatus) body.poStatus = poStatus
    if (Object.keys(body).length === 0 && photos.items.length === 0) {
      setSummary('Tidak ada perubahan untuk disimpan.')
      summaryRef.current?.focus()
      return
    }
    setSummary(null)
    try {
      if (photos.items.length) {
        setBusy('Mengunggah foto…')
        body.addPhotoIds = await photos.uploadAll((d, t) => setBusy(`Mengunggah foto ${d}/${t}…`))
      }
      setBusy('Menyimpan…')
      if (reason.trim()) body.reason = reason.trim()
      const json = JSON.stringify(body)
      if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
      const r = mode === 'correction' ? await sendJson('POST', `/api/v1/aftersales-activities/${a.id}/corrections`, body, idem.current.key) : await sendJson('PATCH', `/api/v1/aftersales-activities/${a.id}`, body, idem.current.key)
      if (!r.ok) {
        setErrors(fieldErrors(r.data))
        setSummary(r.error)
        summaryRef.current?.focus()
        return
      }
      router.push(`/admin/aftersales/aktivitas/detail/${a.id}?disimpan=1`)
      router.refresh()
    } catch (x) {
      setSummary(x instanceof Error && x.message ? x.message : 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.')
      summaryRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    value.touch()
    const v: Record<string, string> = {}
    if (!project) v.projectId = 'Pilih project aftersales.'
    if (!client) v.clientId = 'Pilih pelanggan.'
    if (!kind) v.kind = 'Pilih jenis aktivitas.'
    if (!locked && (!date || date > today || date < minDate)) v.activityDate = `Tanggal antara ${minDate} dan ${today}.`
    if (!locked && kind === 'pengiriman' && !po) v.relatesTo = 'Pengiriman harus mengacu ke PO terbuka pelanggan ini.'
    if (Object.keys(parts.errors).length) v.items = 'Periksa baris item.'
    if (value.parsed.error) v.value = value.parsed.error
    if (mode === 'correction' && reason.trim().length < 3) v.reason = 'Alasan koreksi wajib diisi (minimal 3 karakter).'
    setErrors(v)
    if (Object.keys(v).length) {
      setSummary(`Periksa ${Object.keys(v).length} isian yang ditandai.`)
      summaryRef.current?.focus()
      return
    }
    if (a0) {
      await saveChanges(a0)
      return
    }
    setSummary(null)
    try {
      setBusy(photos.items.length ? 'Mengunggah foto…' : 'Menyimpan…')
      const photoIds = await photos.uploadAll((d, t) => setBusy(`Mengunggah foto ${d}/${t}…`))
      setBusy('Menyimpan…')
      const body = {
        company: project!.companyId,
        projectId: project!.id,
        clientId: client!.id,
        activityDate: date,
        kind,
        docNo: docNo.trim() || null,
        items: parts.lines,
        value: value.parsed.value,
        ...(kind === 'penawaran' ? { followUpDate: followUp || null } : {}),
        ...(kind === 'pengiriman' ? { receiver: receiver.trim() || null, poDelivered: delivered } : {}),
        ...(needsPo ? { relatesTo: po ? po.id : null } : {}),
        notes: notes.trim() || null,
        photoIds,
        ...(clientUuid.current ? { clientUuid: clientUuid.current } : {}),
      }
      const json = JSON.stringify(body)
      if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
      const r = await sendJson('POST', '/api/v1/aftersales-activities', body, idem.current.key)
      if (!r.ok) {
        setErrors(fieldErrors(r.data))
        setSummary(r.error)
        summaryRef.current?.focus()
        return
      }
      router.push(`/admin/aftersales/aktivitas/detail/${(r.data as { id: number }).id}?baru=1`)
      router.refresh()
    } catch (x) {
      setSummary(x instanceof Error && x.message ? x.message : 'Gagal menghubungi server. Coba lagi — aktivitas yang sama tidak akan tercatat dua kali.')
      summaryRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  return (
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form={mode === 'create' ? 'aftersales-activity' : `aftersales-activity-${mode}`}>
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
        {summary ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>{summary}</p>
          </div>
        ) : null}
      </div>
      <div className="pk-kgrid">
        {projects.length > 1 || locked ? (
          <div className="pk-fld">
            <label htmlFor={id('project')}>
              Project aftersales<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect
              id={id('project')}
              value={projectId}
              disabled={locked}
              data-pk-locked={locked ? 'project' : undefined}
              onChange={(e) => {
                setProjectId(e.target.value)
                setRelatesTo('')
              }}
              aria-invalid={err('projectId') ? true : undefined}
              aria-describedby={err('projectId') ? id('projectId-e') : undefined}
            >
              <option value="">— Pilih project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </WrapSelect>
            {errEl('projectId')}
          </div>
        ) : null}
        <div className="pk-fld">
          <label htmlFor={id('client')}>
            Pelanggan<span className="req" aria-hidden>*</span>
          </label>
          <WrapSelect
            id={id('client')}
            value={clientId}
            disabled={locked}
            data-pk-locked={locked ? 'client' : undefined}
            onChange={(e) => {
              setClientId(e.target.value)
              setRelatesTo('')
            }}
            aria-invalid={err('clientId') ? true : undefined}
            aria-describedby={err('clientId') ? id('clientId-e') : undefined}
          >
            <option value="">— Pilih pelanggan —</option>
            {clientOpts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </WrapSelect>
          {errEl('clientId')}
        </div>
        <div className="pk-fld">
          <label htmlFor={id('date')}>
            Tanggal<span className="req" aria-hidden>*</span>
          </label>
          <DateInput id={id('date')} type="date" value={date} min={locked ? undefined : minDate} max={locked ? undefined : today} disabled={locked} data-pk-locked={locked ? 'activityDate' : undefined} onChange={(e) => setDate(e.target.value)} aria-invalid={err('activityDate') ? true : undefined} aria-describedby={err('activityDate') ? id('activityDate-e') : undefined} />
          {errEl('activityDate')}
        </div>
      </div>
      <Choice
        label="Jenis aktivitas"
        name={`${uid}-kind`}
        value={kind}
        required
        disabled={locked}
        error={err('kind')}
        onChange={(k) => {
          setKind(k)
          if (!RELATES_TO_PO.includes(k)) setRelatesTo('')
        }}
        options={ACTIVITY_KINDS.map((k) => ({ value: k, label: ACTIVITY_KIND_LABELS[k] }))}
      />
      {needsPo ? (
        <div className="pk-fld">
          <label htmlFor={id('po')}>
            Untuk PO (PO terbuka pelanggan ini){kind === 'pengiriman' ? <span className="req" aria-hidden>*</span> : null}
          </label>
          <WrapSelect
            id={id('po')}
            value={relatesTo}
            disabled={!client || !project || locked}
            data-pk-locked={locked ? 'relatesTo' : undefined}
            onChange={(e) => {
              setRelatesTo(e.target.value)
              const p = openPos.find((x) => String(x.id) === e.target.value)
              if (p && kind === 'pengiriman' && lines.length === 0) setLines(linesFrom(p.items))
            }}
            aria-invalid={err('relatesTo') ? true : undefined}
            aria-describedby={[id('po-h'), err('relatesTo') ? id('relatesTo-e') : null].filter(Boolean).join(' ')}
          >
            <option value="">{locked ? 'Tanpa PO' : !client ? 'Pilih pelanggan dulu' : poLoading ? 'Memuat PO terbuka…' : openPos.length ? '— Pilih PO —' : 'Tidak ada PO terbuka'}</option>
            {a0?.relatesTo ? <option value={a0.relatesTo.id}>{a0.relatesTo.label}</option> : null}
            {openPos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.docNo ?? `PO #${p.id}`} · {itemsText(p.items, 2) || 'tanpa item'} ({p.ageDays} hari{p.poStatus === 'sebagian' ? ', sebagian' : ''})
              </option>
            ))}
          </WrapSelect>
          <p className="help" id={id('po-h')}>
            {kind === 'pengiriman' ? 'Item PO disalin ke baris item (ubah bila hanya sebagian yang dikirim).' : 'Opsional untuk penagihan.'}
          </p>
          {errEl('relatesTo')}
        </div>
      ) : null}
      <div className="pk-kgrid">
        <div className="pk-fld">
          <label htmlFor={id('doc')}>{kind ? DOC_LABEL[kind] : 'No. dokumen'}</label>
          <input id={id('doc')} value={docNo} maxLength={64} onChange={(e) => setDocNo(e.target.value)} />
        </div>
        {kind === 'penawaran' ? (
          <div className="pk-fld">
            <label htmlFor={id('fu')}>Tanggal follow-up</label>
            <DateInput id={id('fu')} type="date" value={followUp} min={date} onChange={(e) => setFollowUp(e.target.value)} aria-describedby={id('fu-h')} />
            <p className="help" id={id('fu-h')}>
              Pengingat ke Anda dan PM saat jatuh tempo.
            </p>
          </div>
        ) : null}
        {kind === 'pengiriman' ? (
          <div className="pk-fld">
            <label htmlFor={id('recv')}>Penerima</label>
            <WrapText id={id('recv')} value={receiver} maxLength={128} onChange={(e) => setReceiver(e.target.value)} />
          </div>
        ) : null}
      </div>
      <LinesEditor rows={lines} setRows={setLines} label={kind === 'pengiriman' ? 'Item dikirim' : 'Item'} nameLabel="Nama item" addLabel="+ Tambah item" />
      {errEl('items')}
      {/* edit pages: "sudah terkirim semua" is not stored on the delivery (the PO status is; correction → "Status PO") */}
      {kind === 'pengiriman' && !locked ? (
        <label className="pk-check">
          <input type="checkbox" checked={delivered} onChange={(e) => setDelivered(e.target.checked)} /> PO ini sudah terkirim semua
        </label>
      ) : null}
      <div className="pk-kgrid">
        <div className="pk-fld">
          <label htmlFor={id('value')}>Nilai (opsional)</label>
          <RupiahInput id={id('value')} field={value} disabled={valueLocked} describedBy={[id('value-h'), value.error ? id('value-e') : null].filter(Boolean).join(' ')} />
          <p className="help" id={id('value-h')}>
            {valueLocked ? 'Nilai hanya terlihat dan diubah oleh Direktur/Finance/Admin dan pelapor.' : 'Hanya terlihat oleh Direktur/Finance/Admin dan Anda.'}
          </p>
          {value.error ? (
            <p className="err" id={id('value-e')} role="alert">
              {value.error}
            </p>
          ) : null}
        </div>
      </div>
      <PhotoPicker photos={photos} existing={existing} name="photos" label="Foto bukti (surat jalan / serah terima)" help={locked ? `Maks. 5 foto (sudah ${existing.length}). Foto yang tersimpan tidak dapat dihapus.` : 'Maks. 5 foto.'} error={err('photoIds') ?? err('addPhotoIds')} />
      <div className="pk-fld">
        <label htmlFor={id('notes')}>Catatan</label>
        <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {mode === 'correction' && a0?.kind === 'po_masuk' && a0.poStatus ? (
        <div className="pk-fld" data-pk-field="poStatus">
          <label htmlFor={id('po-status')}>Status PO</label>
          <WrapSelect id={id('po-status')} value={poStatus} onChange={(e) => setPoStatus(e.target.value as PoStatus)} aria-describedby={id('po-status-h')}>
            {PO_STATUSES.map((st) => (
              <option key={st} value={st}>
                {PO_STATUS_LABELS[st]}
              </option>
            ))}
          </WrapSelect>
          <p className="help" id={id('po-status-h')}>
            Koreksi saja (mis. Batal). PO yang dibatalkan tidak dapat dibuka lagi.
          </p>
          {errEl('poStatus')}
        </div>
      ) : null}
      {locked ? <ReasonField id={id('reason')} required={mode === 'correction'} value={reason} onChange={setReason} error={err('reason')} /> : null}
      <div className="pk-fsubmit">
        <p className="pk-note">{client ? `${client.name}${kind ? ` · ${ACTIVITY_KIND_LABELS[kind]}` : ''}${po ? ` · ${po.docNo ?? `PO #${po.id}`}` : ''} · ${parts.lines.length} item` : ' '}</p>
        {a0 ? (
          <Link className="pk-kbtn" href={`/admin/aftersales/aktivitas/detail/${a0.id}`} prefetch={false}>
            Batal
          </Link>
        ) : null}
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit={mode === 'create' ? 'aftersales-activity' : `aftersales-activity-${mode}`}>
          {busy ?? (mode === 'create' ? 'Simpan aktivitas' : mode === 'edit' ? 'Simpan perubahan' : 'Simpan koreksi')}
        </button>
      </div>
    </form>
  )
}

export default ActivityForm
