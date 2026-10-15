'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useMemo, useRef, useState } from 'react'

import { SERVICE_TYPE_LABELS, SERVICE_TYPES, UNIT_STATUS_LABELS, UNIT_STATUSES, type ServiceType, type UnitStatus } from '@/domain/field/rules'
import { fmtNum } from '@/domain/field/views'

import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { Choice, decOut, DecimalField, LinesEditor, linesOut, PhotoPicker, usePhotos, type LineDraft } from './parts'
import { DateInput } from '../DateInput'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * FR1 web input "Laporan servis unit" (plan A; same fields as the APK mockup Android-Servis): project
 * (kontrak_unit / aftersales) → unit (contract units of the project / units of the PT), date, HM, start/
 * end time, service type, complaint, action, helper, spare parts (text only, no stock), unit status after
 * the service, photos before/after (≤ 10) and notes. POST /api/v1/service-reports with an
 * Idempotency-Key (same body → same key) and a clientUuid per form (a retry is replayed, never a second
 * report). The server re-checks flag, access, kind, HM_DECREASED, unit/client and the date window.
 */
export type SvProject = { id: number; label: string; companyId: number; kind: string }
export type SvUnit = { id: number; label: string; sub: string; lastHm: number | null; status: string }

export type ServiceReportFormProps = {
  projects: SvProject[]
  units: SvUnit[]
  /** project id → unit ids offered for it */
  unitsByProject: Record<string, number[]>
  today: string
  minDate: string
  initialProject?: number
  initialUnit?: number
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

export function ServiceReportForm({ projects, units, unitsByProject, today, minDate, initialProject, initialUnit }: ServiceReportFormProps) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const [projectId, setProjectId] = useState<string>(initialProject ? String(initialProject) : projects.length === 1 ? String(projects[0]!.id) : '')
  const offered = useMemo(() => new Set(unitsByProject[projectId] ?? []), [unitsByProject, projectId])
  const unitOpts = units.filter((u) => offered.has(u.id))
  const [unitId, setUnitId] = useState<string>(initialUnit ? String(initialUnit) : '')
  const unit = units.find((u) => String(u.id) === unitId && offered.has(u.id)) ?? null
  const [date, setDate] = useState(today)
  const [hm, setHm] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [type, setType] = useState<ServiceType | ''>('')
  const [complaint, setComplaint] = useState('')
  const [action, setAction] = useState('')
  const [helpers, setHelpers] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [status, setStatus] = useState<UnitStatus | ''>('')
  const [notes, setNotes] = useState('')
  const photos = usePhotos(10)
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

  const err = (k: string) => errors[k]
  const errEl = (k: string) =>
    err(k) ? (
      <p className="err" id={id(`${k}-e`)} role="alert">
        {err(k)}
      </p>
    ) : null
  const desc = (k: string, help?: boolean) => [err(k) ? id(`${k}-e`) : null, help ? id(`${k}-h`) : null].filter(Boolean).join(' ') || undefined

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v: Record<string, string> = {}
    if (!project) v.projectId = 'Pilih project.'
    if (!unit) v.unitId = 'Pilih unit.'
    if (!date || date > today || date < minDate) v.reportDate = `Tanggal antara ${minDate} dan ${today}.`
    if (hmVal === undefined) v.hourMeter = 'HM harus angka ≥ 0, maks. 2 desimal.'
    if (start && end && end <= start) v.endTime = 'Jam selesai harus setelah jam mulai.'
    if (!type) v.serviceType = 'Pilih jenis servis.'
    if (action.trim().length < 3) v.action = 'Tindakan / pekerjaan wajib diisi (min. 3 karakter).'
    if (!status) v.unitStatusAfter = 'Pilih status unit setelah servis.'
    if (Object.keys(parts.errors).length) v.spareparts = 'Periksa baris sparepart.'
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
        unitId: unit!.id,
        reportDate: date,
        hourMeter: hmVal ?? null,
        startTime: start || null,
        endTime: end || null,
        serviceType: type,
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

  return (
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form="service-report">
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
              onChange={(e) => {
                setProjectId(e.target.value)
                setUnitId('')
              }}
              aria-invalid={err('projectId') ? true : undefined}
              aria-describedby={desc('projectId')}
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
            <WrapSelect id={id('unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)} disabled={!project} aria-invalid={err('unitId') ? true : undefined} aria-describedby={desc('unitId', true)}>
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
            <DateInput id={id('date')} type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={err('reportDate') ? true : undefined} aria-describedby={desc('reportDate')} />
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
        <Choice label="Jenis servis" name={`${uid}-type`} value={type} onChange={setType} required error={err('serviceType')} options={SERVICE_TYPES.map((t) => ({ value: t, label: SERVICE_TYPE_LABELS[t] }))} />
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
        <LinesEditor rows={lines} setRows={setLines} label="Sparepart" nameLabel="Nama sparepart" addLabel="+ Tambah sparepart" withNote help="Catatan saja — stok sparepart tidak dikelola di aplikasi." />
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
        <PhotoPicker photos={photos} name="photos" label="Foto sebelum / sesudah" help="Maks. 10 foto. JPEG/PNG; diperkecil ≤ 1600 px dan lokasi EXIF dihapus di server." error={err('photoIds')} />
        <div className="pk-fld">
          <label htmlFor={id('notes')}>Catatan</label>
          <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      <div className="pk-fsubmit">
        <p className="pk-note" aria-live="polite">
          {unit ? unit.label : 'Unit belum dipilih'}
          {typeof hmVal === 'number' ? ` · HM ${unit?.lastHm !== null && unit?.lastHm !== undefined ? `${fmtNum(unit.lastHm)} → ` : ''}${fmtNum(hmVal)}` : ''} · {parts.lines.length} sparepart · {photos.items.length} foto
        </p>
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit="service-report">
          {busy ?? 'Kirim laporan servis'}
        </button>
      </div>
    </form>
  )
}

export default ServiceReportForm
