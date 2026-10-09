'use client'
import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, RELATES_TO_PO, type ActivityKind } from '@/domain/field/rules'
import { itemsText } from '@/domain/field/views'

import { RupiahInput, useRupiah } from '../RupiahInput'
import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { getJson } from './client'
import { Choice, LinesEditor, linesFrom, linesOut, PhotoPicker, usePhotos, type LineDraft } from './parts'

/**
 * FR1 web quick input "Aktivitas aftersales" (plan A2; APK mockup Android-Aftersales): customer, kind
 * chips, the open PO of that customer for a delivery / invoice (GET /api/v1/aftersales/open-pos),
 * document no., item rows, optional value (readable only by Direktur/Finance/Admin and the reporter),
 * follow-up date (quotation), receiver + "PO ini sudah terkirim semua" (delivery), proof photos (≤ 5),
 * notes. POST /api/v1/aftersales-activities with Idempotency-Key + clientUuid.
 */
export type AsProject = { id: number; label: string; companyId: number; clientId: number | null }
export type AsClient = { id: number; name: string; companyId: number }
type OpenPo = { id: number; docNo: string | null; activityDate: string; ageDays: number; poStatus: string; items: Array<{ name: string; partNo?: string | null; qty: number; uom?: string | null }>; project: { id: number } }

const DOC_LABEL: Record<ActivityKind, string> = { penawaran: 'No. penawaran (Q)', po_masuk: 'No. PO', pengiriman: 'No. surat jalan (SJ)', penagihan: 'No. invoice (INV)', kunjungan: 'No. dokumen', lainnya: 'No. dokumen' }
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

export function ActivityForm({ projects, clients, today, minDate, initial }: { projects: AsProject[]; clients: AsClient[]; today: string; minDate: string; initial?: { project?: number; client?: number; kind?: ActivityKind; relatesTo?: number } }) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const [projectId, setProjectId] = useState(initial?.project ? String(initial.project) : projects.length === 1 ? String(projects[0]!.id) : '')
  const project = projects.find((p) => String(p.id) === projectId) ?? null
  const clientOpts = clients.filter((c) => !project || c.companyId === project.companyId)
  const [clientId, setClientId] = useState(initial?.client ? String(initial.client) : project?.clientId ? String(project.clientId) : '')
  const client = clientOpts.find((c) => String(c.id) === clientId) ?? null
  const [kind, setKind] = useState<ActivityKind | ''>(initial?.kind ?? '')
  const [date, setDate] = useState(today)
  const [docNo, setDocNo] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const value = useRupiah(null)
  const [followUp, setFollowUp] = useState('')
  const [receiver, setReceiver] = useState('')
  const [delivered, setDelivered] = useState(false)
  const [relatesTo, setRelatesTo] = useState(initial?.relatesTo ? String(initial.relatesTo) : '')
  const [notes, setNotes] = useState('')
  const photos = usePhotos(5)
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
  const poKey = needsPo && client && project ? `${client.id}|${project.id}` : ''
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    value.touch()
    const v: Record<string, string> = {}
    if (!project) v.projectId = 'Pilih project aftersales.'
    if (!client) v.clientId = 'Pilih pelanggan.'
    if (!kind) v.kind = 'Pilih jenis aktivitas.'
    if (!date || date > today || date < minDate) v.activityDate = `Tanggal antara ${minDate} dan ${today}.`
    if (kind === 'pengiriman' && !po) v.relatesTo = 'Pengiriman harus mengacu ke PO terbuka pelanggan ini.'
    if (Object.keys(parts.errors).length) v.items = 'Periksa baris item.'
    if (value.parsed.error) v.value = value.parsed.error
    setErrors(v)
    if (Object.keys(v).length) {
      setSummary(`Periksa ${Object.keys(v).length} isian yang ditandai.`)
      summaryRef.current?.focus()
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
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form="aftersales-activity">
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
        {summary ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>{summary}</p>
          </div>
        ) : null}
      </div>
      <div className="pk-kgrid">
        {projects.length > 1 ? (
          <div className="pk-fld">
            <label htmlFor={id('project')}>
              Project aftersales<span className="req" aria-hidden>*</span>
            </label>
            <select
              id={id('project')}
              value={projectId}
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
            </select>
            {errEl('projectId')}
          </div>
        ) : null}
        <div className="pk-fld">
          <label htmlFor={id('client')}>
            Pelanggan<span className="req" aria-hidden>*</span>
          </label>
          <select
            id={id('client')}
            value={clientId}
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
                {c.name}
              </option>
            ))}
          </select>
          {errEl('clientId')}
        </div>
        <div className="pk-fld">
          <label htmlFor={id('date')}>
            Tanggal<span className="req" aria-hidden>*</span>
          </label>
          <input id={id('date')} type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={err('activityDate') ? true : undefined} aria-describedby={err('activityDate') ? id('activityDate-e') : undefined} />
          {errEl('activityDate')}
        </div>
      </div>
      <Choice
        label="Jenis aktivitas"
        name={`${uid}-kind`}
        value={kind}
        required
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
          <select
            id={id('po')}
            value={relatesTo}
            disabled={!client || !project}
            onChange={(e) => {
              setRelatesTo(e.target.value)
              const p = openPos.find((x) => String(x.id) === e.target.value)
              if (p && kind === 'pengiriman' && lines.length === 0) setLines(linesFrom(p.items))
            }}
            aria-invalid={err('relatesTo') ? true : undefined}
            aria-describedby={[id('po-h'), err('relatesTo') ? id('relatesTo-e') : null].filter(Boolean).join(' ')}
          >
            <option value="">{!client ? 'Pilih pelanggan dulu' : poLoading ? 'Memuat PO terbuka…' : openPos.length ? '— Pilih PO —' : 'Tidak ada PO terbuka'}</option>
            {openPos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.docNo ?? `PO #${p.id}`} · {itemsText(p.items, 2) || 'tanpa item'} ({p.ageDays} hari{p.poStatus === 'sebagian' ? ', sebagian' : ''})
              </option>
            ))}
          </select>
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
            <input id={id('fu')} type="date" value={followUp} min={date} onChange={(e) => setFollowUp(e.target.value)} aria-describedby={id('fu-h')} />
            <p className="help" id={id('fu-h')}>
              Pengingat ke Anda dan PM saat jatuh tempo.
            </p>
          </div>
        ) : null}
        {kind === 'pengiriman' ? (
          <div className="pk-fld">
            <label htmlFor={id('recv')}>Penerima</label>
            <input id={id('recv')} value={receiver} maxLength={128} onChange={(e) => setReceiver(e.target.value)} />
          </div>
        ) : null}
      </div>
      <LinesEditor rows={lines} setRows={setLines} label={kind === 'pengiriman' ? 'Item dikirim' : 'Item'} nameLabel="Nama item" addLabel="+ Tambah item" />
      {errEl('items')}
      {kind === 'pengiriman' ? (
        <label className="pk-check">
          <input type="checkbox" checked={delivered} onChange={(e) => setDelivered(e.target.checked)} /> PO ini sudah terkirim semua
        </label>
      ) : null}
      <div className="pk-kgrid">
        <div className="pk-fld">
          <label htmlFor={id('value')}>Nilai (opsional)</label>
          <RupiahInput id={id('value')} field={value} describedBy={[id('value-h'), value.error ? id('value-e') : null].filter(Boolean).join(' ')} />
          <p className="help" id={id('value-h')}>
            Hanya terlihat oleh Direktur/Finance/Admin dan Anda.
          </p>
          {value.error ? (
            <p className="err" id={id('value-e')} role="alert">
              {value.error}
            </p>
          ) : null}
        </div>
      </div>
      <PhotoPicker photos={photos} name="photos" label="Foto bukti (surat jalan / serah terima)" help="Maks. 5 foto." error={err('photoIds')} />
      <div className="pk-fld">
        <label htmlFor={id('notes')}>Catatan</label>
        <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="pk-fsubmit">
        <p className="pk-note">{client ? `${client.name}${kind ? ` · ${ACTIVITY_KIND_LABELS[kind]}` : ''}${po ? ` · ${po.docNo ?? `PO #${po.id}`}` : ''} · ${parts.lines.length} item` : ' '}</p>
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit="aftersales-activity">
          {busy ?? 'Simpan aktivitas'}
        </button>
      </div>
    </form>
  )
}

export default ActivityForm
