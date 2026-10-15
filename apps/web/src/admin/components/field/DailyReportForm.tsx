'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useMemo, useRef, useState } from 'react'

import { WEATHER, WEATHER_LABELS, type Weather } from '@/domain/daily/rules'
import { fmtNum } from '@/domain/field/views'

import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { Choice, decOut, DecimalField, PhotoPicker, usePhotos } from './parts'
import { DateInput } from '../DateInput'
import { WrapSelect } from '../WrapSelect'

/**
 * P3 web input "Laporan harian" (konstruksi; same fields as the APK): project → date, weather
 * (pagi/siang/sore), rain / stop hours, volume pekerjaan per RAP item, material masuk / terpakai per RAP
 * item, manpower and equipment per resource type, issues, notes, photos (≤ 10). One form for the three
 * writes: create (POST /api/v1/daily-reports), the reporter's edit within 24 h (PATCH) and the PM /
 * Direktur correction (POST …/corrections, reason required). Values on edit/correction are the
 * NEW totals of the report; the server books the difference to the ledger. Idempotency-Key per body.
 */
export type DrItem = { id: number; code: string; description: string; kind: 'pekerjaan' | 'material'; uom: string; volume: number; realised: number; stage: string }
export type DrResource = { id: number; kind: 'tenaga' | 'alat'; name: string }
export type DrProject = { id: number; label: string; companyId: number }
export type DrValues = {
  weather: { morning: Weather | null; noon: Weather | null; afternoon: Weather | null }
  rainHours: number | null
  stopHours: number | null
  work: Record<number, number>
  materials: Record<number, { received: number; used: number }>
  manpower: Record<number, number>
  equipment: Record<number, { count: number; hours: number | null }>
  issues: string | null
  notes: string | null
}

export type DailyReportFormProps = {
  mode: 'create' | 'edit' | 'correction'
  projects: DrProject[]
  itemsByProject: Record<string, DrItem[]>
  resourcesByCompany: Record<string, DrResource[]>
  today: string
  minDate: string
  initialProject?: number
  /** edit / correction */
  report?: { id: number; projectId: number; reportDate: string; values: DrValues; photoCount: number }
}

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)
const str = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? '' : String(n).replace('.', ','))

export function DailyReportForm({ mode, projects, itemsByProject, resourcesByCompany, today, minDate, initialProject, report }: DailyReportFormProps) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const init = report?.values
  const [projectId, setProjectId] = useState<string>(report ? String(report.projectId) : initialProject ? String(initialProject) : projects.length === 1 ? String(projects[0]!.id) : '')
  const project = projects.find((p) => String(p.id) === projectId) ?? null
  const items = useMemo(() => itemsByProject[projectId] ?? [], [itemsByProject, projectId])
  const resources = project ? (resourcesByCompany[String(project.companyId)] ?? []) : []
  const [date, setDate] = useState(report?.reportDate ?? today)
  const [wMorning, setWMorning] = useState<Weather | ''>(init?.weather.morning ?? '')
  const [wNoon, setWNoon] = useState<Weather | ''>(init?.weather.noon ?? '')
  const [wAfternoon, setWAfternoon] = useState<Weather | ''>(init?.weather.afternoon ?? '')
  const [rain, setRain] = useState(str(init?.rainHours))
  const [stop, setStop] = useState(str(init?.stopHours))
  const [work, setWork] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.work ?? {}).map(([k, v]) => [k, str(v)])))
  const [matIn, setMatIn] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.materials ?? {}).map(([k, v]) => [k, str(v.received)])))
  const [matUsed, setMatUsed] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.materials ?? {}).map(([k, v]) => [k, str(v.used)])))
  const [men, setMen] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.manpower ?? {}).map(([k, v]) => [k, String(v)])))
  const [eqCount, setEqCount] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.equipment ?? {}).map(([k, v]) => [k, String(v.count)])))
  const [eqHours, setEqHours] = useState<Record<number, string>>(() => Object.fromEntries(Object.entries(init?.equipment ?? {}).map(([k, v]) => [k, str(v.hours)])))
  const [issues, setIssues] = useState(init?.issues ?? '')
  const [notes, setNotes] = useState(init?.notes ?? '')
  const [reason, setReason] = useState('')
  const photos = usePhotos(Math.max(0, 10 - (report?.photoCount ?? 0)))
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const clientUuid = useRef(uuid())
  const idem = useRef<{ body: string; key: string | undefined } | null>(null)

  const workItems = items.filter((i) => i.kind === 'pekerjaan')
  const matItems = items.filter((i) => i.kind === 'material')
  const stages = [...new Set(workItems.map((i) => i.stage))]
  const tenaga = resources.filter((r) => r.kind === 'tenaga')
  const alat = resources.filter((r) => r.kind === 'alat')

  /** Realisation after this form: the item's realisation minus this report's booked value plus the new one. */
  const after = (i: DrItem) => {
    const v = decOut(work[i.id] ?? '') ?? 0
    return Math.round((i.realised - (init?.work[i.id] ?? 0) + (typeof v === 'number' ? v : 0)) * 100) / 100
  }
  const over = workItems.filter((i) => {
    const v = decOut(work[i.id] ?? '')
    return typeof v === 'number' && v > (init?.work[i.id] ?? 0) && after(i) > i.volume
  })
  const workerCount = tenaga.reduce((s, r) => s + (Number.parseInt(men[r.id] ?? '', 10) || 0), 0)

  const err = (k: string) => errors[k]
  const errEl = (k: string) =>
    err(k) ? (
      <p className="err" id={id(`${k}-e`)} role="alert">
        {err(k)}
      </p>
    ) : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v: Record<string, string> = {}
    if (!project) v.projectId = 'Pilih project.'
    if (mode === 'create' && (!date || date > today || date < minDate)) v.reportDate = `Tanggal antara ${minDate} dan ${today}.`
    const rainH = decOut(rain, 24)
    const stopH = decOut(stop, 24)
    if (rainH === undefined) v.rainHours = 'Jam hujan 0–24.'
    if (stopH === undefined) v.stopHours = 'Jam berhenti 0–24.'
    const workOut: Array<{ rapItemId: number; qty: number }> = []
    for (const i of workItems) {
      const raw = work[i.id] ?? ''
      const q = decOut(raw)
      if (q === undefined) v[`work.${i.id}`] = `${i.code}: angka tidak valid.`
      else if ((q ?? 0) > 0 || (init?.work[i.id] ?? 0) !== 0) workOut.push({ rapItemId: i.id, qty: q ?? 0 })
    }
    const matOut: Array<{ rapItemId: number; received: number; used: number }> = []
    for (const i of matItems) {
      const a = decOut(matIn[i.id] ?? '')
      const b = decOut(matUsed[i.id] ?? '')
      if (a === undefined || b === undefined) v[`mat.${i.id}`] = `${i.code}: angka tidak valid.`
      else if ((a ?? 0) > 0 || (b ?? 0) > 0 || init?.materials[i.id]) matOut.push({ rapItemId: i.id, received: a ?? 0, used: b ?? 0 })
    }
    const menOut: Array<{ resourceTypeId: number; count: number }> = []
    for (const r of tenaga) {
      const raw = (men[r.id] ?? '').trim()
      if (!raw) continue
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0 || n > 9999) v[`men.${r.id}`] = `${r.name}: jumlah 0–9999.`
      else if (n > 0) menOut.push({ resourceTypeId: r.id, count: n })
    }
    const eqOut: Array<{ resourceTypeId: number; count: number; hours: number | null }> = []
    for (const r of alat) {
      const raw = (eqCount[r.id] ?? '').trim()
      if (!raw) continue
      const n = Number(raw)
      const h = decOut(eqHours[r.id] ?? '', 24)
      if (!Number.isInteger(n) || n < 0 || n > 9999) v[`eq.${r.id}`] = `${r.name}: jumlah 0–9999.`
      else if (h === undefined) v[`eq.${r.id}`] = `${r.name}: jam 0–24.`
      else if (n > 0) eqOut.push({ resourceTypeId: r.id, count: n, hours: h ?? null })
    }
    if (over.length > 0 && notes.trim().length === 0) v.notes = `Volume melebihi RAP (${over.map((i) => i.code).join(', ')}): isi catatan penjelasan.`
    if (mode === 'correction' && reason.trim().length < 3) v.reason = 'Alasan koreksi wajib (min. 3 karakter).'
    if (mode === 'create' && workOut.length === 0 && matOut.length === 0 && menOut.length === 0 && !issues.trim() && !notes.trim()) v.work = 'Isi minimal satu volume pekerjaan, material, tenaga, kendala atau catatan.'
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
      const content = {
        weather: { morning: wMorning || null, noon: wNoon || null, afternoon: wAfternoon || null },
        rainHours: rainH ?? null,
        stopHours: stopH ?? null,
        work: workOut,
        materials: matOut,
        manpower: menOut,
        equipment: eqOut,
        issues: issues.trim() || null,
        notes: notes.trim() || null,
      }
      const body =
        mode === 'create'
          ? { company: project!.companyId, projectId: project!.id, reportDate: date, ...content, photoIds, ...(clientUuid.current ? { clientUuid: clientUuid.current } : {}) }
          : { ...content, ...(photoIds.length ? { addPhotoIds: photoIds } : {}), ...(reason.trim() ? { reason: reason.trim() } : {}) }
      const url = mode === 'create' ? '/api/v1/daily-reports' : mode === 'edit' ? `/api/v1/daily-reports/${report!.id}` : `/api/v1/daily-reports/${report!.id}/corrections`
      const json = JSON.stringify(body)
      if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
      const r = await sendJson(mode === 'edit' ? 'PATCH' : 'POST', url, body, idem.current.key)
      if (!r.ok) {
        setErrors(fieldErrors(r.data))
        setSummary(r.error)
        summaryRef.current?.focus()
        return
      }
      const saved = r.data as { id: number }
      router.push(`/admin/laporan-harian/detail/${saved.id}?${mode === 'create' ? 'baru' : 'disimpan'}=1`)
      router.refresh()
    } catch (x) {
      setSummary(x instanceof Error && x.message ? x.message : 'Gagal menghubungi server. Coba lagi — laporan yang sama tidak akan tercatat dua kali.')
      summaryRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  const weatherOpts = WEATHER.map((w) => ({ value: w, label: WEATHER_LABELS[w] }))
  const submitLabel = mode === 'create' ? 'Kirim laporan harian' : mode === 'edit' ? 'Simpan perubahan' : 'Simpan koreksi'

  return (
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form={`daily-report-${mode}`}>
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
        {summary ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>{summary}</p>
          </div>
        ) : null}
      </div>

      <section className="pk-fsec" aria-labelledby={id('s-head')}>
        <h2 id={id('s-head')}>Project & cuaca</h2>
        <div className="pk-kgrid">
          <div className="pk-fld full">
            <label htmlFor={id('project')}>
              Project konstruksi<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect id={id('project')} value={projectId} disabled={mode !== 'create'} onChange={(e) => setProjectId(e.target.value)} aria-invalid={err('projectId') ? true : undefined}>
              <option value="">— Pilih project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </WrapSelect>
            {errEl('projectId')}
          </div>
          <div className="pk-fld">
            <label htmlFor={id('date')}>
              Tanggal<span className="req" aria-hidden>*</span>
            </label>
            <DateInput id={id('date')} type="date" value={date} min={minDate} max={today} disabled={mode !== 'create'} onChange={(e) => setDate(e.target.value)} aria-invalid={err('reportDate') ? true : undefined} />
            {errEl('reportDate')}
          </div>
          <DecimalField id={id('rain')} label="Jam hujan" value={rain} onChange={setRain} max={24} error={err('rainHours')} />
          <DecimalField id={id('stop')} label="Jam kerja berhenti" value={stop} onChange={setStop} max={24} error={err('stopHours')} />
        </div>
        <Choice label="Cuaca pagi" name={`${uid}-wm`} value={wMorning} onChange={setWMorning} options={weatherOpts} />
        <Choice label="Cuaca siang" name={`${uid}-wn`} value={wNoon} onChange={setWNoon} options={weatherOpts} />
        <Choice label="Cuaca sore" name={`${uid}-wa`} value={wAfternoon} onChange={setWAfternoon} options={weatherOpts} />
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-work')}>
        <h2 id={id('s-work')}>Volume pekerjaan hari ini</h2>
        {!project ? (
          <p className="help">Pilih project dulu.</p>
        ) : workItems.length === 0 ? (
          <p className="help">Project ini belum punya item pekerjaan di RAP — minta PM / Direktur mengisi RAP dulu.</p>
        ) : (
          stages.map((st) => (
            <fieldset key={st} className="pk-dr-stage" data-pk-stage={st}>
              <legend>{st}</legend>
              {workItems
                .filter((i) => i.stage === st)
                .map((i) => {
                  const a = after(i)
                  const isOver = over.some((o) => o.id === i.id)
                  return (
                    <DecimalField
                      key={i.id}
                      id={id(`w-${i.id}`)}
                      label={`${i.code} ${i.description}`}
                      suffix={i.uom}
                      value={work[i.id] ?? ''}
                      onChange={(val) => setWork((w) => ({ ...w, [i.id]: val }))}
                      error={err(`work.${i.id}`) ?? (isOver ? `Melebihi RAP: ${fmtNum(a)} dari ${fmtNum(i.volume)} ${i.uom} — isi catatan.` : null)}
                      help={`Realisasi ${fmtNum(i.realised)} / ${fmtNum(i.volume)} ${i.uom}`}
                    />
                  )
                })}
            </fieldset>
          ))
        )}
        {errEl('work')}
      </section>

      {matItems.length > 0 ? (
        <section className="pk-fsec" aria-labelledby={id('s-mat')}>
          <h2 id={id('s-mat')}>Material</h2>
          <p className="help">Masuk = diterima di lokasi hari ini; terpakai = dipakai hari ini. Material tidak dihitung ke progress.</p>
          {matItems.map((i) => (
            <div key={i.id} className="pk-kgrid" data-pk-material={i.code}>
              <DecimalField id={id(`mi-${i.id}`)} label={`${i.code} ${i.description} — masuk`} suffix={i.uom} value={matIn[i.id] ?? ''} onChange={(val) => setMatIn((m) => ({ ...m, [i.id]: val }))} error={err(`mat.${i.id}`)} />
              <DecimalField id={id(`mu-${i.id}`)} label="terpakai" suffix={i.uom} value={matUsed[i.id] ?? ''} onChange={(val) => setMatUsed((m) => ({ ...m, [i.id]: val }))} />
            </div>
          ))}
        </section>
      ) : null}

      <section className="pk-fsec" aria-labelledby={id('s-men')}>
        <h2 id={id('s-men')}>Tenaga & alat</h2>
        <div className="pk-kgrid">
          {tenaga.map((r) => (
            <div className="pk-fld" key={r.id}>
              <label htmlFor={id(`m-${r.id}`)}>{r.name} (orang)</label>
              <input id={id(`m-${r.id}`)} inputMode="numeric" value={men[r.id] ?? ''} maxLength={4} onChange={(e) => setMen((m) => ({ ...m, [r.id]: e.target.value }))} aria-invalid={err(`men.${r.id}`) ? true : undefined} />
              {errEl(`men.${r.id}`)}
            </div>
          ))}
        </div>
        {alat.length ? (
          <div className="pk-kgrid" style={{ marginTop: 12 }}>
            {alat.map((r) => (
              <React.Fragment key={r.id}>
                <div className="pk-fld">
                  <label htmlFor={id(`e-${r.id}`)}>{r.name} (unit)</label>
                  <input id={id(`e-${r.id}`)} inputMode="numeric" value={eqCount[r.id] ?? ''} maxLength={4} onChange={(e) => setEqCount((m) => ({ ...m, [r.id]: e.target.value }))} aria-invalid={err(`eq.${r.id}`) ? true : undefined} />
                  {errEl(`eq.${r.id}`)}
                </div>
                <DecimalField id={id(`eh-${r.id}`)} label={`${r.name} — jam kerja`} value={eqHours[r.id] ?? ''} onChange={(val) => setEqHours((m) => ({ ...m, [r.id]: val }))} max={24} />
              </React.Fragment>
            ))}
          </div>
        ) : null}
        <p className="help">Total pekerja: {workerCount}</p>
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-notes')}>
        <h2 id={id('s-notes')}>Kendala, catatan & foto</h2>
        <div className="pk-fld">
          <label htmlFor={id('issues')}>Kendala</label>
          <textarea id={id('issues')} value={issues} maxLength={2000} rows={2} onChange={(e) => setIssues(e.target.value)} />
        </div>
        <div className="pk-fld">
          <label htmlFor={id('notes')}>
            Catatan{over.length ? <span className="req" aria-hidden>*</span> : null}
          </label>
          <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} aria-invalid={err('notes') ? true : undefined} />
          {errEl('notes')}
        </div>
        <PhotoPicker photos={photos} name="photos" label={mode === 'create' ? 'Foto pekerjaan' : 'Tambah foto'} help={`Maks. 10 foto per laporan${report ? ` (sudah ${report.photoCount})` : ''}. Diperkecil dan lokasi EXIF dihapus di server.`} error={err('photoIds')} />
        {mode !== 'create' ? (
          <div className="pk-fld">
            <label htmlFor={id('reason')}>
              Alasan{mode === 'correction' ? <span className="req" aria-hidden>*</span> : ' (opsional)'}
            </label>
            <textarea id={id('reason')} value={reason} maxLength={1000} rows={2} onChange={(e) => setReason(e.target.value)} aria-invalid={err('reason') ? true : undefined} />
            {errEl('reason')}
          </div>
        ) : null}
      </section>

      <div className="pk-fsubmit">
        <p className="pk-note" aria-live="polite">
          {Object.values(work).filter((x) => (decOut(x) ?? 0) > 0).length} item pekerjaan · {workerCount} pekerja · {photos.items.length} foto
          {over.length ? ` · ⚠ ${over.length} melebihi RAP` : ''}
        </p>
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit={`daily-report-${mode}`}>
          {busy ?? submitLabel}
        </button>
      </div>
    </form>
  )
}

export default DailyReportForm
