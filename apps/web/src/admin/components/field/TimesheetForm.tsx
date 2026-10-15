'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import React, { useEffect, useId, useRef, useState } from 'react'

import { addDays, BREAKDOWN_SUGGEST_SERVICE_HOURS } from '@/domain/field/rules'
import { fmtNum, hoursCheck, inPeriod, longDate } from '@/domain/field/views'

import { fieldErrors, newIdemKey, sendJson } from '../kas/client'
import { getJson } from './client'
import { decOut, DecimalField, PhotoPicker, usePhotos } from './parts'
import { DateInput } from '../DateInput'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * FR1 web input "Timesheet harian unit" (plan B; fields of the APK mockup Android-Timesheet): contract
 * project → date → unit (only the contract's units ACTIVE on that date), HM start prefilled from the
 * previous timesheet's HM end (GET /api/v1/unit-timesheets of that unit, last 14 days) with a live
 * HM_GAP hint, work/standby/breakdown hours with a live Σ ≤ 24 check, breakdown reason, fuel, operator
 * ("Salin dari kemarin"), location, notes and the required HM meter photo. POST /api/v1/unit-timesheets
 * (Idempotency-Key + clientUuid); the server re-checks NOT_IN_CONTRACT, DUPLICATE_DATE and the hours.
 */
export type TsContractUnit = { contractUnitId: number; unitId: number; label: string; startDate: string; endDate: string | null; active: boolean; lastHm: number | null }
export type TsProject = { projectId: number; label: string; companyId: number; units: TsContractUnit[] }

type Prev = { id: number; reportDate: string; hmEnd: number; operatorName: string | null; location: string | null }
type Lookup = { key: string; prev: Prev | null; existing: { id: number } | null }

const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined)

export function TimesheetForm({ projects, today, minDate, initialProject, initialUnit, initialDate }: { projects: TsProject[]; today: string; minDate: string; initialProject?: number; initialUnit?: number; initialDate?: string }) {
  const router = useRouter()
  const uid = useId()
  const id = (n: string) => `${uid}-${n}`
  const [projectId, setProjectId] = useState(initialProject ? String(initialProject) : projects.length === 1 ? String(projects[0]!.projectId) : '')
  const [date, setDate] = useState(initialDate && initialDate <= today && initialDate >= minDate ? initialDate : today)
  const project = projects.find((p) => String(p.projectId) === projectId) ?? null
  const unitsOn = (project?.units ?? []).filter((u) => u.active && inPeriod(date, u))
  const [unitId, setUnitId] = useState(initialUnit ? String(initialUnit) : '')
  const unit = unitsOn.find((u) => String(u.unitId) === unitId) ?? null
  const [hmStart, setHmStart] = useState('')
  const hmStartTouched = useRef(false)
  const [hmEnd, setHmEnd] = useState('')
  const [work, setWork] = useState('')
  const [standby, setStandby] = useState('')
  const [breakdown, setBreakdown] = useState('')
  const [reason, setReason] = useState('')
  const [fuel, setFuel] = useState('')
  const [operator, setOperator] = useState('')
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const photos = usePhotos(1)
  const [look, setLook] = useState<Lookup>({ key: '', prev: null, existing: null })
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const clientUuid = useRef(uuid())
  const idem = useRef<{ body: string; key: string | undefined } | null>(null)

  // previous HM end of this unit (and an existing timesheet on the date) via the API
  const lookKey = unit ? `${unit.unitId}|${date}` : ''
  const lastHm = unit?.lastHm ?? null
  useEffect(() => {
    if (!lookKey) return
    let live = true
    const [u, d] = lookKey.split('|') as [string, string]
    const q = new URLSearchParams({ unit: u, from: addDays(d, -14), to: d, limit: '100' })
    void getJson<{ items: Array<{ id: number; reportDate: string; hmEnd: number; operatorName: string | null; location: string | null }> }>(`/api/v1/unit-timesheets?${q.toString()}`).then((r) => {
      if (!live) return
      const items = r?.items ?? []
      const existing = items.find((t) => t.reportDate === d) ?? null
      const prev = items.filter((t) => t.reportDate < d).sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1))[0] ?? null
      setLook({ key: lookKey, prev, existing: existing ? { id: existing.id } : null })
      if (!hmStartTouched.current) {
        const base = prev?.hmEnd ?? lastHm
        setHmStart(base !== null ? fmtNum(base) : '')
      }
    })
    return () => {
      live = false
    }
  }, [lookKey, lastHm])
  const cur: Lookup = look.key === lookKey ? look : { key: lookKey, prev: null, existing: null }
  const loading = !!lookKey && look.key !== lookKey

  const hs = decOut(hmStart)
  const he = decOut(hmEnd)
  const w = decOut(work, 24)
  const s = decOut(standby, 24)
  const b = decOut(breakdown, 24)
  const hc = hoursCheck(w ?? 0, s ?? 0, b ?? 0)
  const gap = typeof hs === 'number' && cur.prev && Math.abs(hs - cur.prev.hmEnd) > 0.005
  const hmBack = typeof hs === 'number' && typeof he === 'number' && he < hs

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
    if (!project) v.projectId = 'Pilih kontrak / project.'
    if (!date || date > today || date < minDate) v.reportDate = `Tanggal antara ${minDate} dan ${today}.`
    if (!unit) v.unitId = 'Pilih unit yang aktif di kontrak pada tanggal ini.'
    if (typeof hs !== 'number') v.hmStart = 'HM awal wajib (angka, maks. 2 desimal).'
    if (typeof he !== 'number') v.hmEnd = 'HM akhir wajib (angka, maks. 2 desimal).'
    else if (hmBack) v.hmEnd = 'HM akhir tidak boleh lebih kecil dari HM awal.'
    if (typeof w !== 'number') v.workHours = 'Jam kerja wajib (0–24).'
    if (s === undefined) v.standbyHours = 'Jam standby 0–24.'
    if (b === undefined) v.breakdownHours = 'Jam breakdown 0–24.'
    if (hc.over) v.workHours = `Total jam kerja + standby + breakdown maks. 24 (sekarang ${fmtNum(hc.total)}).`
    if ((b ?? 0) > 0 && !reason.trim()) v.breakdownReason = 'Alasan breakdown wajib bila ada jam breakdown.'
    if (decOut(fuel, 100_000) === undefined) v.fuelLiters = 'BBM (liter) harus angka ≥ 0.'
    if (photos.items.length !== 1) v.hmPhotoId = 'Foto meter HM wajib (1 foto).'
    if (cur.existing) v.unitId = 'Unit ini sudah punya timesheet pada tanggal tersebut.'
    setErrors(v)
    if (Object.keys(v).length) {
      setSummary(`Periksa ${Object.keys(v).length} isian yang ditandai.`)
      summaryRef.current?.focus()
      return
    }
    setSummary(null)
    try {
      setBusy('Mengunggah foto HM…')
      const [hmPhotoId] = await photos.uploadAll()
      setBusy('Menyimpan…')
      const body = {
        company: project!.companyId,
        projectId: project!.projectId,
        unitId: unit!.unitId,
        reportDate: date,
        hmStart: hs,
        hmEnd: he,
        workHours: w,
        standbyHours: s ?? 0,
        breakdownHours: b ?? 0,
        breakdownReason: (b ?? 0) > 0 ? reason.trim() : null,
        fuelLiters: decOut(fuel, 100_000) ?? null,
        operatorName: operator.trim() || null,
        location: location.trim() || null,
        notes: notes.trim() || null,
        hmPhotoId,
        ...(clientUuid.current ? { clientUuid: clientUuid.current } : {}),
      }
      const json = JSON.stringify(body)
      if (!idem.current || idem.current.body !== json) idem.current = { body: json, key: newIdemKey() }
      const r = await sendJson('POST', '/api/v1/unit-timesheets', body, idem.current.key)
      if (!r.ok) {
        setErrors(fieldErrors(r.data))
        setSummary(r.error)
        summaryRef.current?.focus()
        return
      }
      router.push(`/admin/unit-kontrak/timesheet/detail/${(r.data as { id: number }).id}?baru=1`)
      router.refresh()
    } catch (x) {
      setSummary(x instanceof Error && x.message ? x.message : 'Gagal menghubungi server. Coba lagi — timesheet yang sama tidak akan tercatat dua kali.')
      summaryRef.current?.focus()
    } finally {
      setBusy(null)
    }
  }

  const next = unitsOn.find((u) => u.unitId !== unit?.unitId)

  return (
    <form className="pk-kform" onSubmit={submit} noValidate data-pk-form="unit-timesheet">
      <div ref={summaryRef} tabIndex={-1} aria-live="assertive">
        {summary ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>{summary}</p>
          </div>
        ) : null}
      </div>

      <section className="pk-fsec" aria-labelledby={id('s-unit')}>
        <h2 id={id('s-unit')}>Kontrak & unit</h2>
        <div className="pk-kgrid">
          <div className="pk-fld full">
            <label htmlFor={id('project')}>
              Kontrak (project)<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect
              id={id('project')}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value)
                setUnitId('')
              }}
              aria-invalid={err('projectId') ? true : undefined}
              aria-describedby={err('projectId') ? id('projectId-e') : undefined}
            >
              <option value="">— Pilih kontrak —</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
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
            <DateInput id={id('date')} type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={err('reportDate') ? true : undefined} aria-describedby={err('reportDate') ? id('reportDate-e') : undefined} />
            {errEl('reportDate')}
          </div>
          <div className="pk-fld">
            <label htmlFor={id('unit')}>
              Unit<span className="req" aria-hidden>*</span>
            </label>
            <WrapSelect
              id={id('unit')}
              value={unit ? String(unit.unitId) : ''}
              onChange={(e) => {
                setUnitId(e.target.value)
                hmStartTouched.current = false
              }}
              disabled={!project}
              aria-invalid={err('unitId') ? true : undefined}
              aria-describedby={[id('unitId-h'), err('unitId') ? id('unitId-e') : null].filter(Boolean).join(' ')}
            >
              <option value="">{!project ? 'Pilih kontrak dulu' : unitsOn.length ? '— Pilih unit —' : 'Tidak ada unit aktif pada tanggal ini'}</option>
              {unitsOn.map((u) => (
                <option key={u.contractUnitId} value={u.unitId}>
                  {u.label}
                </option>
              ))}
            </WrapSelect>
            <p className="help" id={id('unitId-h')}>
              Hanya unit yang aktif di kontrak pada {longDate(date)}.
            </p>
            {errEl('unitId')}
          </div>
        </div>
        {cur.existing ? (
          <div className="pk-alert bad" role="alert">
            <b aria-hidden>!</b>
            <p>
              {unit?.label} sudah punya timesheet tanggal ini.{' '}
              <Link className="pk-kbtn sm" href={`/admin/unit-kontrak/timesheet/detail/${cur.existing.id}`}>
                Buka timesheet
              </Link>
            </p>
          </div>
        ) : null}
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-hm')}>
        <h2 id={id('s-hm')}>Hour meter (HM)</h2>
        <div className="pk-kgrid">
          <DecimalField
            id={id('hmStart')}
            label="HM awal"
            required
            value={hmStart}
            onChange={(v) => {
              hmStartTouched.current = true
              setHmStart(v)
            }}
            error={err('hmStart')}
            help={!unit ? 'Pilih unit dulu — HM awal diisi otomatis dari HM akhir sebelumnya.' : loading ? 'Mencari HM akhir terakhir…' : cur.prev ? `Diisi otomatis dari HM akhir ${longDate(cur.prev.reportDate)} (${fmtNum(cur.prev.hmEnd)}).` : unit?.lastHm !== null && unit?.lastHm !== undefined ? `Belum ada timesheet sebelumnya; HM terakhir unit ${fmtNum(unit.lastHm)}.` : 'Belum ada HM sebelumnya untuk unit ini.'}
          />
          <DecimalField id={id('hmEnd')} label="HM akhir" required value={hmEnd} onChange={setHmEnd} error={err('hmEnd') ?? (hmBack ? 'HM akhir tidak boleh lebih kecil dari HM awal.' : null)} help={typeof hs === 'number' && typeof he === 'number' && !hmBack ? `Selisih HM ${fmtNum(he - hs)} jam.` : undefined} />
        </div>
        {gap ? (
          <div className="pk-alert info" role="status" data-pk-hm-gap>
            <b aria-hidden>⚠</b>
            <p>
              HM awal {fmtNum(hs as number)} ≠ HM akhir sebelumnya {fmtNum(cur.prev!.hmEnd)} — timesheet tetap tersimpan dengan tanda <b>selisih HM</b> untuk diperiksa PM.
            </p>
          </div>
        ) : null}
        <PhotoPicker photos={photos} name="hmPhoto" label="Foto meter HM akhir" required help="Wajib 1 foto. JPEG/PNG; diperkecil di server." error={err('hmPhotoId')} />
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-hours')}>
        <h2 id={id('s-hours')}>Jam operasi</h2>
        <div className="pk-kgrid c3">
          <DecimalField id={id('work')} label="Kerja" suffix="jam" required value={work} onChange={setWork} max={24} error={err('workHours')} />
          <DecimalField id={id('standby')} label="Standby" suffix="jam" value={standby} onChange={setStandby} max={24} error={err('standbyHours')} />
          <DecimalField id={id('breakdown')} label="Breakdown" suffix="jam" value={breakdown} onChange={setBreakdown} max={24} error={err('breakdownHours')} />
        </div>
        <div className={`pk-hours${hc.over ? ' over' : ''}`} aria-hidden>
          <span className="w" style={{ width: `${hc.shares.work}%` }} />
          <span className="s" style={{ width: `${hc.shares.standby}%` }} />
          <span className="b" style={{ width: `${hc.shares.breakdown}%` }} />
        </div>
        <p className={hc.over ? 'pk-kerr' : 'pk-note'} role={hc.over ? 'alert' : undefined} aria-live="polite" data-pk-hours-total={hc.total}>
          Total {fmtNum(hc.total)} dari 24 jam{hc.over ? ' — melebihi 24 jam, kurangi salah satu.' : ' · kerja · standby · breakdown'}
        </p>
        {(b ?? 0) > 0 ? (
          <div className="pk-fld">
            <label htmlFor={id('reason')}>
              Alasan breakdown<span className="req" aria-hidden>*</span>
            </label>
            <WrapText id={id('reason')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={err('breakdownReason') ? true : undefined} aria-describedby={err('breakdownReason') ? id('breakdownReason-e') : undefined} />
            {errEl('breakdownReason')}
          </div>
        ) : null}
        {(b ?? 0) >= BREAKDOWN_SUGGEST_SERVICE_HOURS && project && unit ? (
          <div className="pk-alert info" role="status">
            <b aria-hidden>i</b>
            <p>
              Breakdown {fmtNum(b as number)} jam — sebaiknya buat laporan servis untuk unit ini.{' '}
              <Link className="pk-kbtn sm" href={`/admin/laporan-servis/baru?project=${project.projectId}&unit=${unit.unitId}`} target="_blank" rel="noopener">
                Buat laporan servis (tab baru)
              </Link>
            </p>
          </div>
        ) : null}
      </section>

      <section className="pk-fsec" aria-labelledby={id('s-op')}>
        <div className="pk-fsec-h">
          <h2 id={id('s-op')}>Operator & BBM</h2>
          {cur.prev && (cur.prev.operatorName || cur.prev.location) ? (
            <button
              type="button"
              className="pk-kbtn sm"
              onClick={() => {
                setOperator(cur.prev?.operatorName ?? '')
                setLocation(cur.prev?.location ?? '')
              }}
            >
              Salin dari kemarin
            </button>
          ) : null}
        </div>
        <div className="pk-kgrid">
          <div className="pk-fld">
            <label htmlFor={id('operator')}>Nama operator</label>
            <WrapText id={id('operator')} value={operator} maxLength={128} onChange={(e) => setOperator(e.target.value)} />
          </div>
          <DecimalField id={id('fuel')} label="BBM" suffix="liter" value={fuel} onChange={setFuel} max={100_000} error={err('fuelLiters')} />
          <div className="pk-fld">
            <label htmlFor={id('location')}>Lokasi</label>
            <WrapText id={id('location')} value={location} maxLength={200} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div className="pk-fld full">
            <label htmlFor={id('notes')}>Catatan</label>
            <textarea id={id('notes')} value={notes} maxLength={2000} rows={2} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <div className="pk-fsubmit">
        <p className="pk-note">{next && unit ? `Unit lain di kontrak ini pada tanggal tersebut: ${unitsOn.filter((u) => u.unitId !== unit?.unitId).map((u) => u.label).join(', ')}` : ' '}</p>
        <button type="submit" className="pk-kbtn primary" disabled={busy !== null} data-pk-submit="unit-timesheet">
          {busy ?? 'Simpan timesheet'}
        </button>
      </div>
    </form>
  )
}

export default TimesheetForm
