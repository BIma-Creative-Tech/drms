'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useId, useMemo, useRef, useState } from 'react'

import { MAX_PHOTOS, SERVICE_TYPES_REQUIRED, UNIT_STATUS_LABELS, UNIT_STATUSES, type UnitStatus } from '@/domain/field/rules'
import { fmtNum } from '@/domain/field/views'

import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { CheckGroup, Choice, decOut, DecimalField, LinesEditor, linesFrom, linesOut, PhotoPicker, ReasonField, usePhotos, type ExistingPhoto, type LineDraft } from './parts'
import { DateInput } from '../DateInput'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * FR1 web input "Laporan servis unit" (plan A; same fields as the APK mockup Android-Servis): project
 * (kontrak_unit / aftersales) → unit (contract units of the project / units of the PT), date, HM, start/
 * end time, service types, complaint, action, helper, spare parts (text only, no stock), unit status after
 * the service, photos before/after (≤ 25) and notes. DRMS owner 2026-10-17: "Jenis servis" = one or more ACTIVE
 * types of the selected project's PT master (checkbox pills, sent as `serviceTypeIds` in selection order); spare
 * parts without a "No. part" input; up to 25 photos. POST /api/v1/service-reports with an
 * Idempotency-Key (same body → same key) and a clientUuid per form (a retry is replayed, never a second
 * report). The server re-checks flag, access, kind, HM_DECREASED, unit/client and the date window.
 *
 * UI feedback 17/10 #5 ("edit = add"): the SAME form is the edit page `/laporan-servis/:id/ubah` — `mode="edit"` (the
 * reporter within 24 h, PATCH, reason optional) or `mode="correction"` (PM / Direktur, POST …/corrections, reason
 * required). Same sections, order and widgets; project, unit and date stay in place but disabled; the stored photos
 * are shown (never removed — the API only adds), new ones are added / removed before saving as on create; "Alasan"
 * is the last field. Only CHANGED fields are sent. The server rules (24 h window, team / role, HM_DECREASED, audit)
 * are unchanged.
 */
export type SvProject = { id: number; label: string; companyId: number; kind: string }
export type SvUnit = { id: number; label: string; sub: string; lastHm: number | null; status: string }
/** Active "Jenis servis" of the PTs the caller may report in (GET /service-types read model, server-side). */
export type SvServiceType = { id: number; companyId: number; name: string }

type Part = { name: string; partNo?: string | null; qty: number; uom?: string | null; note?: string | null }

/** The stored report on the edit page (`mode` edit / correction). */
export type SvReport = {
  id: number
  projectId: number
  unitId: number
  reportDate: string
  hourMeter: number | null
  startTime: string | null
  endTime: string | null
  /** selection order */
  serviceTypeIds: number[]
  complaint: string | null
  action: string
  helpers: string | null
  unitStatusAfter: UnitStatus
  spareparts: Part[]
  notes: string | null
  photos: ExistingPhoto[]
}

export type ServiceReportFormProps = {
  /** default `create` */
  mode?: 'create' | 'edit' | 'correction'
  /** edit / correction */
  report?: SvReport
  projects: SvProject[]
  units: SvUnit[]
  /** project id → unit ids offered for it */
  unitsByProject: Record<string, number[]>
  serviceTypes: SvServiceType[]
  today: string
  minDate: string
  initialProject?: number
  initialUnit?: number
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)
const partsJson = (xs: readonly Part[]) => JSON.stringify(xs.map((l) => ({ name: l.name, partNo: l.partNo ?? null, qty: l.qty, uom: l.uom ?? null, note: l.note ?? null })))
const text = (v: string) => v.trim() || null

export function ServiceReportForm({ mode = 'create', report, projects, units, unitsByProject, serviceTypes, today, minDate, initialProject, initialUnit }: ServiceReportFormProps) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const r0 = mode === 'create' ? undefined : report
  const locked = r0 !== undefined
  const [projectId, setProjectId] = useState<string>(r0 ? String(r0.projectId) : initialProject ? String(initialProject) : projects.length === 1 ? String(projects[0]!.id) : '')
  const offered = useMemo(() => new Set(unitsByProject[projectId] ?? []), [unitsByProject, projectId])
  const unitOpts = units.filter((u) => offered.has(u.id))
  const [unitId, setUnitId] = useState<string>(r0 ? String(r0.unitId) : initialUnit ? String(initialUnit) : '')
  const unit = units.find((u) => String(u.id) === unitId && offered.has(u.id)) ?? null
  const [date, setDate] = useState(r0?.reportDate ?? today)
  const [hm, setHm] = useState(r0?.hourMeter !== null && r0?.hourMeter !== undefined ? fmtNum(r0.hourMeter) : '')
  const [start, setStart] = useState(r0?.startTime ?? '')
  const [end, setEnd] = useState(r0?.endTime ?? '')
  const [typeIds, setTypeIds] = useState<string[]>(() => (r0 ? r0.serviceTypeIds.map(String) : []))
  const [complaint, setComplaint] = useState(r0?.complaint ?? '')
  const [action, setAction] = useState(r0?.action ?? '')
  const [helpers, setHelpers] = useState(r0?.helpers ?? '')
  const [lines, setLines] = useState<LineDraft[]>(() => (r0 ? linesFrom(r0.spareparts) : []))
  const [status, setStatus] = useState<UnitStatus | ''>(r0?.unitStatusAfter ?? '')
  const [notes, setNotes] = useState(r0?.notes ?? '')
  const [reason, setReason] = useState('')
  const existing = r0?.photos ?? []
  const photos = usePhotos(Math.max(0, MAX_PHOTOS.service_report - existing.length))
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const clientUuid = useRef(uuid())
  const idem = useRef<{ body: string; key: string | undefined } | null>(null)

  const hmVal = decOut(hm)
  const hmLow = typeof hmVal === 'number' && unit?.lastHm !== null && unit?.lastHm !== undefined && hmVal < unit.lastHm
  const project = projects.find((p) => String(p.id) === projectId) ?? null
  const parts = linesOut(lines, true)
  /** Types of the selected project's PT (a selection never mixes PTs). */
  const typeOpts = project ? serviceTypes.filter((t) => t.companyId === project.companyId).map((t) => ({ value: String(t.id), label: t.name })) : []
  const typeSel = typeIds.filter((v) => typeOpts.some((o) => o.value === v))

  const err = (k: string) => errors[k]
  const errEl = (k: string) =>
    err(k) ? (
      <p className="err" id={id(`${k}-e`)} role="alert">
        {err(k)}
      </p>
    ) : null
  const desc = (k: string, help?: boolean) => [err(k) ? id(`${k}-e`) : null, help ? id(`${k}-h`) : null].filter(Boolean).join(' ') || undefined

  /** Edit / correction: only the changed fields (+ new photos, reason) → PATCH / POST …/corrections. */
  const saveChanges = async (r: SvReport) => {
    const body: Record<string, unknown> = {}
    if ((hmVal ?? null) !== r.hourMeter) body.hourMeter = hmVal ?? null
    if ((start || null) !== r.startTime) body.startTime = start || null
    if ((end || null) !== r.endTime) body.endTime = end || null
    if (JSON.stringify(typeSel.map(Number)) !== JSON.stringify(r.serviceTypeIds)) body.serviceTypeIds = typeSel.map(Number)
    if (text(complaint) !== r.complaint) body.complaint = text(complaint)
    if (action.trim() !== r.action) body.action = action.trim()
    if (text(helpers) !== r.helpers) body.helpers = text(helpers)
    if (status && status !== r.unitStatusAfter) body.unitStatusAfter = status
    if (partsJson(parts.lines) !== partsJson(r.spareparts)) body.spareparts = parts.lines
    if (text(notes) !== r.notes) body.notes = text(notes)
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
      const res = mode === 'correction' ? await sendJson('POST', `/api/v1/service-reports/${r.id}/corrections`, body, idem.current.key) : await sendJson('PATCH', `/api/v1/service-reports/${r.id}`, body, idem.current.key)
      if (!res.ok) {
        setErrors(fieldErrors(res.data))
        setSummary(res.error)
        summaryRef.current?.focus()
        return
      }
      router.push(`/admin/laporan-servis/detail/${r.id}?disimpan=1`)
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
    const v: Record<string, string> = {}
    if (!project) v.projectId = 'Pilih project.'
    if (!unit) v.unitId = 'Pilih unit.'
    if (!locked && (!date || date > today || date < minDate)) v.reportDate = `Tanggal antara ${minDate} dan ${today}.`
    if (hmVal === undefined) v.hourMeter = 'HM harus angka ≥ 0, maks. 2 desimal.'
    if (start && end && end <= start) v.endTime = 'Jam selesai harus setelah jam mulai.'
    if (typeSel.length === 0) v.serviceTypeIds = SERVICE_TYPES_REQUIRED
    if (action.trim().length < 3) v.action = 'Tindakan / pekerjaan wajib diisi (min. 3 karakter).'
    if (!status) v.unitStatusAfter = 'Pilih status unit setelah servis.'
    if (Object.keys(parts.errors).length) v.spareparts = 'Periksa baris sparepart.'
    if (mode === 'correction' && reason.trim().length < 3) v.reason = 'Alasan koreksi wajib diisi (minimal 3 karakter).'
    setErrors(v)
    if (Object.keys(v).length) {
      setSummary(`Periksa ${Object.keys(v).length} isian yang ditandai.`)
      summaryRef.current?.focus()
      return
    }
    if (r0) {
      await saveChanges(r0)
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
        unitId: unit!.id,
        reportDate: date,
        hourMeter: hmVal ?? null,
        startTime: start || null,
        endTime: end || null,
        serviceTypeIds: typeSel.map(Number),
        complaint: complaint.trim() || null,
        action: action.trim(),
        helpers: helpers.trim() || null,
        unitStatusAfter: status,
        spareparts: parts.lines,
        notes: notes.trim() || null,
        photoIds,
        ...(clientUuid.current ? { clientUuid: clientUuid.current } : {}),
      }
      const json = JSON.stringify(body)
      if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
      const r = await sendJson('POST', '/api/v1/service-reports', body, idem.current.key)
      if (!r.ok) {
        const fe = fieldErrors(r.data)
        setErrors(fe)
        setSummary(r.error)
        summaryRef.current?.focus()
        return
      }
      const created = r.data as { id: number }
      router.push(`/admin/laporan-servis/detail/${created.id}?baru=1`)
      router.refresh()
    } catch (x) {
      setSummary(x instanceof Error && x.message ? x.message : 'Gagal menghubungi server. Coba lagi — laporan yang sama tidak akan tercatat dua kali.')
      summaryRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  const submitLabel = mode === 'create' ? 'Kirim laporan servis' : mode === 'edit' ? 'Simpan perubahan' : 'Simpan koreksi'

  return (
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form={mode === 'create' ? 'service-report' : `service-report-${mode}`}>
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
        {summary ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>{summary}</p>
          </div>
        ) : null}
      </div>

      <section className="pk-fsec" aria-labelledby={id('s-unit')}>
        <h2 id={id('s-unit')}>Unit</h2>
        <div className="pk-kgrid">
          <div className="pk-fld full">
            <label htmlFor={id('project')}>
              Project / kontrak<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect
              id={id('project')}
              value={projectId}
              disabled={locked}
              onChange={(e) => {
                setProjectId(e.target.value)
                setUnitId('')
              }}
              aria-invalid={err('projectId') ? true : undefined}
              aria-describedby={desc('projectId')}
              data-pk-locked={locked ? 'project' : undefined}
            >
              <option value="">— Pilih project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.kind === 'kontrak_unit' ? 'kontrak unit' : 'aftersales'})
                </option>
              ))}
            </WrapSelect>
            {errEl('projectId')}
          </div>
          <div className="pk-fld full">
            <label htmlFor={id('unit')}>
              Unit<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect id={id('unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!project || locked} data-pk-locked={locked ? 'unit' : undefined} aria-invalid={err('unitId') ? true : undefined} aria-describedby={desc('unitId', true)}>
              <option value="">{project ? (unitOpts.length ? '— Pilih unit —' : 'Tidak ada unit untuk project ini') : 'Pilih project dulu'}</option>
              {unitOpts.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label} — {u.sub}
                </option>
              ))}
            </WrapSelect>
            <p className="help" id={id('unitId-h')}>
              {unit ? `${unit.sub}${unit.lastHm !== null ? ` · HM terakhir ${fmtNum(unit.lastHm)}` : ''}` : 'Kontrak unit: unit yang aktif di kontrak. Aftersales: unit milik sendiri atau pelanggan project.'}
            </p>
            {errEl('unitId')}
          </div>
          <div className="pk-fld">
            <label htmlFor={id('date')}>
              Tanggal<span className="req" aria-hidden>*</span>
            </label>
            <DateInput id={id('date')} type="date" value={date} min={locked ? undefined : minDate} max={locked ? undefined : today} disabled={locked} data-pk-locked={locked ? 'reportDate' : undefined} onChange={(e) => setDate(e.target.value)} aria-invalid={err('reportDate') ? true : undefined} aria-describedby={desc('reportDate')} />
            {errEl('reportDate')}
          </div>
          <DecimalField
            id={id('hm')}
            label="HM saat servis"
            value={hm}
            onChange={setHm}
            error={err('hourMeter') ?? (hmLow ? `HM lebih kecil dari HM terakhir unit (${fmtNum(unit!.lastHm)}) — akan ditolak. Salah ketik? Koreksi oleh PM/Direktur.` : null)}
            help="Opsional. Tidak boleh lebih kecil dari HM terakhir unit."
          />
          <div className="pk-fld">
            <label htmlFor={id('start')}>Jam mulai</label>
            <input id={id('start')} type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="pk-fld">
            <label htmlFor={id('end')}>Jam selesai</label>
            <input id={id('end')} type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={err('endTime') ? true : undefined} aria-describedby={desc('endTime')} />
            {errEl('endTime')}
          </div>
        </div>
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-job')}>
        <h2 id={id('s-job')}>Pekerjaan</h2>
        <CheckGroup
          label="Jenis servis"
          name={`${uid}-type`}
          value={typeSel}
          onChange={setTypeIds}
          required
          disabled={!project}
          error={err('serviceTypeIds') ?? err('serviceType')}
          help={project ? (typeOpts.length ? 'Boleh lebih dari satu.' : 'Belum ada jenis servis aktif di PT ini — hubungi Admin (Master Data → Jenis servis).') : 'Pilih project dulu.'}
          options={typeOpts}
        />
        <div className="pk-fld">
          <label htmlFor={id('complaint')}>Keluhan</label>
          <textarea id={id('complaint')} value={complaint} maxLength={2000} rows={2} onChange={(e) => setComplaint(e.target.value)} />
        </div>
        <div className="pk-fld">
          <label htmlFor={id('action')}>
            Tindakan / pekerjaan<span className="req" aria-hidden>*</span>
          </label>
          <textarea id={id('action')} value={action} maxLength={4000} rows={3} onChange={(e) => setAction(e.target.value)} aria-invalid={err('action') ? true : undefined} aria-describedby={desc('action')} />
          {errEl('action')}
        </div>
        <div className="pk-fld">
          <label htmlFor={id('helpers')}>Helper (opsional)</label>
          <WrapText id={id('helpers')} value={helpers} maxLength={200} onChange={(e) => setHelpers(e.target.value)} />
        </div>
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-parts')}>
        <h2 id={id('s-parts')}>Sparepart dipakai</h2>
        <LinesEditor rows={lines} setRows={setLines} label="Sparepart" nameLabel="Nama sparepart" addLabel="+ Tambah sparepart" withNote hidePartNo help="Catatan saja — stok sparepart tidak dikelola di aplikasi." />
        {errEl('spareparts')}
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-status')}>
        <h2 id={id('s-status')}>Status unit setelah servis</h2>
        <Choice label="Status unit" name={`${uid}-status`} value={status} onChange={setStatus} required error={err('unitStatusAfter')} options={UNIT_STATUSES.map((s) => ({ value: s, label: UNIT_STATUS_LABELS[s] }))} />
        {status === 'menunggu_part' ? (
          <div className="pk-alert info" role="status">
            <b aria-hidden>i</b>
            <p>PM project akan diberi notifikasi: unit {unit?.label ?? ''} menunggu part.</p>
          </div>
        ) : null}
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-photo')}>
        <h2 id={id('s-photo')}>Foto & catatan</h2>
        <PhotoPicker
          photos={photos}
          existing={existing}
          name="photos"
          label="Foto sebelum / sesudah"
          help={locked ? `Maks. 25 foto per laporan (sudah ${existing.length}). Foto yang tersimpan tidak dapat dihapus. JPEG/PNG; diperkecil ≤ 1600 px dan lokasi EXIF dihapus di server.` : 'Maks. 25 foto. JPEG/PNG; diperkecil ≤ 1600 px dan lokasi EXIF dihapus di server.'}
          error={err('photoIds') ?? err('addPhotoIds')}
        />
        <div className="pk-fld">
          <label htmlFor={id('notes')}>Catatan</label>
          <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      {locked ? <ReasonField id={id('reason')} required={mode === 'correction'} value={reason} onChange={setReason} error={err('reason')} /> : null}

      <div className="pk-fsubmit">
        <p className="pk-note" aria-live="polite">
          {unit ? unit.label : 'Unit belum dipilih'}
          {typeof hmVal === 'number' ? ` · HM ${unit?.lastHm !== null && unit?.lastHm !== undefined ? `${fmtNum(unit.lastHm)} → ` : ''}${fmtNum(hmVal)}` : ''} · {parts.lines.length} sparepart · {photos.items.length} foto
        </p>
        {r0 ? (
          <Link className="pk-kbtn" href={`/admin/laporan-servis/detail/${r0.id}`} prefetch={false}>
            Batal
          </Link>
        ) : null}
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit={mode === 'create' ? 'service-report' : `service-report-${mode}`}>
          {busy ?? submitLabel}
        </button>
      </div>
    </form>
  )
}

export default ServiceReportForm
