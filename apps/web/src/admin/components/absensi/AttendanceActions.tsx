'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

import { detectArea, NON_ONSITE_OUTSIDE, OUTSIDE_AREA_LABEL } from '@/domain/attendance/area'
import { geofenceError } from '@/domain/attendance/calendar'
import { errorLine } from '@/lib/field-labels'

import { confirmAction, confirmLabel, confirmTitle, failureTitle, showResult, successTitle, type Summary } from '../feedback/feedback'
import { newIdemKey, sendJson, uploadSelfie } from '../kas/client'
import { gpsErrorMessage, policyBlocks } from './camera'
import { CAMERA_STYLE, CameraCapture } from './CameraCapture'
import { DateInput } from '../DateInput'
import { ImageThumb } from '../media/ImageThumb'
import { selfieSource } from '../media/media-url'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * E6 web (S2) client actions of the attendance views. Same pattern as the Kas dialogs (native modal
 * <dialog>: focus trap, Esc, focus return; visible labels; inline errors with aria-describedby; busy
 * state; one Idempotency-Key per opened dialog). The server re-checks everything:
 * - CorrectionDialog → POST /api/v1/attendance/{id}/correct (PM team / Admin, never own, reason ≥ 3,
 *   same local date, not in the future; audit old → new).
 * - SelfieThumb → GET /api/v1/attendance/{id}/selfie as a lazy thumbnail + the shared lightbox (D2510 0.21.1; the
 *   view of someone else's selfie is audited `view_sensitive`); 404 = removed by retention.
 * Styles: KAS_STYLE + ABSENSI_STYLE rendered once by the host view.
 */
const MIN = 3

export type CorrectionDialogProps = {
  attendanceId: number
  kind: 'check_in' | 'check_out'
  date: string
  dateLabel: string
  employee: string
  location: string
  currentLocal: string
  /** "+08:00" — offset of the company timezone on `date`. */
  offset: string
  corrected: boolean
}

export function CorrectionDialog(p: CorrectionDialogProps) {
  const router = useRouter()
  const ref = useRef<HTMLDialogElement>(null)
  const key = useRef<string | undefined>(undefined)
  const [time, setTime] = useState(p.currentLocal)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<{ field: 'time' | 'reason' | 'form'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const uid = useId()
  const kindLabel = p.kind === 'check_in' ? 'masuk' : 'pulang'
  const open = () => {
    setError(null)
    setTime(p.currentLocal)
    key.current = newIdemKey()
    ref.current?.showModal()
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setError({ field: 'time', text: 'Isi jam baru (HH:MM).' })
    if (time === p.currentLocal) return setError({ field: 'time', text: 'Jam baru sama dengan jam saat ini.' })
    if (reason.trim().length < MIN) return setError({ field: 'reason', text: `Alasan wajib diisi (minimal ${MIN} karakter).` })
    setBusy(true)
    setError(null)
    try {
      const r = await sendJson('POST', `/api/v1/attendance/${p.attendanceId}/correct`, { new_time: `${p.date}T${time}:00${p.offset}`, reason: reason.trim() }, key.current)
      // DRMS 24/10: the dialog is the confirmation; the result popup follows (error: on top, dialog stays for a retry)
      if (!r.ok) {
        showResult({ ok: false, title: failureTitle(`koreksi jam ${kindLabel}`), message: r.error ?? 'Gagal menyimpan koreksi.' })
        return setError({ field: 'form', text: r.error ?? 'Gagal menyimpan koreksi.' })
      }
      ref.current?.close()
      setReason('')
      showResult({ ok: true, title: successTitle(`koreksi jam ${kindLabel}`, `${p.employee} ${p.dateLabel}`), message: `${p.currentLocal} → ${time}` })
      router.refresh()
    } catch {
      setError({ field: 'form', text: 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.' })
      showResult({ ok: false, title: failureTitle(`koreksi jam ${kindLabel}`), message: 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="pk-kbtn sm" onClick={open} data-pk-action="correct" data-pk-attendance={p.attendanceId} aria-label={`Koreksi jam ${kindLabel} ${p.employee} ${p.dateLabel}`}>
        Koreksi
      </button>
      <dialog ref={ref} className="pk-dlg" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} onCancel={(e) => busy && e.preventDefault()}>
        <form onSubmit={submit} noValidate>
          <h2 id={`${uid}-t`}>{confirmTitle(`koreksi jam ${kindLabel}`, p.employee)}</h2>
          <div id={`${uid}-d`} className="desc">
            {p.employee} · {p.dateLabel} · {p.location}
            {p.corrected ? ' · sudah pernah dikoreksi (riwayat di bawah halaman)' : ''}
          </div>
          <div className="pk-ba" aria-live="polite">
            <div>
              <span className="lbl">Sebelum</span>
              <b data-pk-before>{p.currentLocal}</b>
            </div>
            <span aria-hidden className="arrow">
              →
            </span>
            <div>
              <span className="lbl">Sesudah</span>
              <b data-pk-after>{time || '—'}</b>
            </div>
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-time`}>
              Jam {kindLabel} baru <span className="req" aria-hidden>*</span>
            </label>
            <input
              id={`${uid}-time`}
              type="time"
              value={time}
              required
              onChange={(e) => {
                setTime(e.target.value)
                key.current = newIdemKey()
              }}
              aria-invalid={error?.field === 'time' ? true : undefined}
              aria-describedby={error?.field === 'time' ? `${uid}-te` : `${uid}-th`}
              data-pk-field="new-time"
            />
            {error?.field === 'time' ? (
              <p id={`${uid}-te`} className="err">
                {error.text}
              </p>
            ) : (
              <p id={`${uid}-th`} className="help">
                Tanggal tetap {p.dateLabel} (zona perusahaan, UTC{p.offset}); tidak boleh di masa depan.
              </p>
            )}
          </div>
          <div className="pk-fld">
            <label htmlFor={`${uid}-r`}>
              Alasan <span className="req" aria-hidden>*</span>
            </label>
            <textarea
              id={`${uid}-r`}
              value={reason}
              maxLength={500}
              required
              onChange={(e) => {
                setReason(e.target.value)
                key.current = newIdemKey()
              }}
              aria-invalid={error?.field === 'reason' ? true : undefined}
              aria-describedby={error?.field === 'reason' ? `${uid}-re` : `${uid}-rh`}
              data-pk-field="reason"
            />
            {error?.field === 'reason' ? (
              <p id={`${uid}-re`} className="err">
                {error.text}
              </p>
            ) : (
              <p id={`${uid}-rh`} className="help">
                Wajib (T10). Tercatat di audit log: jam lama → baru + alasan.
              </p>
            )}
          </div>
          {error?.field === 'form' ? (
            <p className="pk-kerr" role="alert">
              {error.text}
            </p>
          ) : null}
          <div className="foot">
            <button type="button" className="pk-kbtn" onClick={() => !busy && ref.current?.close()} disabled={busy}>
              Batal
            </button>
            <button type="submit" className="pk-kbtn primary" disabled={busy} data-pk-confirm="correct">
              {busy ? 'Menyimpan…' : confirmLabel('simpan koreksi')}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

/**
 * D2510 image preview (web 0.21.1, user 2026-10-25: "user belum bisa melihat preview foto absensi"): the selfie of a
 * check-in / check-out as a thumbnail that opens the shared lightbox (was a "Selfie" text button opening a dialog —
 * no preview anywhere in the views). Same audited endpoint GET /api/v1/attendance/{id}/selfie (attendance read
 * access; viewing someone else's selfie is audited `view_sensitive`, throttled per viewer + attendance); lazy, so
 * only the rows on screen are requested. `group` = one record (a day of the rekap, a member of the board): ← → in
 * the lightbox move between its masuk / pulang selfies. Removed by retention (Q-33) → "Selfie dihapus".
 */
export function SelfieThumb({ attendanceId, label, available, group, caption, size = 48 }: { attendanceId: number; label: string; available: boolean; group?: string; caption?: string | null; size?: number }) {
  if (!available) {
    return (
      <span className="pk-chip muted" title="File selfie sudah dihapus setelah masa retensi (Q-33); data absensi tetap." data-pk-selfie-removed={attendanceId}>
        Selfie dihapus
      </span>
    )
  }
  return (
    <ImageThumb
      src={selfieSource(attendanceId)}
      group={group ?? `selfie-${attendanceId}`}
      title={`Selfie ${label}`}
      caption={caption}
      alt={`Selfie absensi ${label}`}
      label={`Lihat selfie ${label}`}
      size={size}
      data-pk-action="selfie"
      data-pk-attendance={attendanceId}
      imgAttrs={{ 'data-pk-selfie-img': '' }}
    />
  )
}

// ---------------------------------------------------------------- Payload REST saves (masters)

/** Message of a Payload REST error body ({ errors: [{ message, data: { errors: [{ path, message }] } }] }). */
export function payloadError(data: unknown, status: number): string {
  const errs = ((data ?? {}) as { errors?: Array<{ message?: string; data?: { errors?: Array<{ path?: string; message?: string }> } }> }).errors ?? []
  // QA-21: field label (or nothing), never the raw path
  const inner = errs.flatMap((e) => e.data?.errors ?? []).map((e) => errorLine(e))
  const text = inner.length ? inner.join('; ') : errs.map((e) => e.message).filter(Boolean).join('; ')
  return text || (status === 403 ? 'Anda tidak berhak mengubah data ini.' : 'Gagal menyimpan. Periksa isian lalu coba lagi.')
}

async function rest(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<{ ok: boolean; error: string | null }> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, error: res.ok ? null : payloadError(data, res.status) }
}

/** DRMS 24/10: what a save asks before it runs ("Yakin ingin <action> <object>?" + summary) and names in the result popup. */
type Ask = { action: string; object?: string | null; summary?: Summary }

function useSave() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (method: 'POST' | 'PATCH', url: string, body: unknown, okText: string, ask: Ask) => {
    if (!(await confirmAction({ title: confirmTitle(ask.action, ask.object), summary: ask.summary, confirmLabel: confirmLabel(ask.action) }))) return false
    setBusy(true)
    setMsg(null)
    try {
      const r = await rest(method, url, body)
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Gagal menyimpan.' })
      showResult(r.ok ? { ok: true, title: successTitle(ask.action, ask.object), message: okText } : { ok: false, title: failureTitle(ask.action), message: r.error ?? 'Gagal menyimpan.' })
      if (r.ok) router.refresh()
      return r.ok
    } catch {
      setMsg({ ok: false, text: 'Gagal menghubungi server. Coba lagi.' })
      showResult({ ok: false, title: failureTitle(ask.action), message: 'Gagal menghubungi server. Coba lagi.' })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, run }
}

function Msg({ msg, id }: { msg: { ok: boolean; text: string } | null; id: string }) {
  if (!msg) return null
  return (
    <p id={id} className={msg.ok ? 'pk-okmsg' : 'pk-kerr'} role={msg.ok ? 'status' : 'alert'}>
      {msg.text}
    </p>
  )
}

export type Option = { id: number; label: string }

/** Jadwal kerja of one employee (PATCH /api/employees/{id}; Admin/Owner, audited by the collection). */
export function ScheduleAssign({ employeeId, employee, current, options, disabled }: { employeeId: number; employee: string; current: number | null; options: Option[]; disabled?: boolean }) {
  const [value, setValue] = useState(current ? String(current) : '')
  const { busy, msg, run } = useSave()
  const uid = useId()
  return (
    <form
      className="pk-inline"
      onSubmit={(e) => {
        e.preventDefault()
        void run('PATCH', `/api/employees/${employeeId}?depth=0`, { workSchedule: value ? Number(value) : null }, 'Tersimpan.', {
          action: 'simpan jadwal kerja',
          object: employee,
          summary: [
            ['Karyawan', employee],
            ['Jadwal', options.find((o) => String(o.id) === value)?.label ?? 'Default perusahaan'],
          ],
        })
      }}
      data-pk-form="schedule-assign"
      data-pk-employee={employeeId}
    >
      <label htmlFor={`${uid}-s`} className="pk-sr">
        Jadwal kerja {employee}
      </label>
      <WrapSelect id={`${uid}-s`} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy} aria-describedby={msg ? `${uid}-m` : undefined}>
        <option value="">Default perusahaan</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </WrapSelect>
      {!disabled ? (
        <button type="submit" className="pk-kbtn sm" disabled={busy || value === (current ? String(current) : '')}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      ) : null}
      <Msg msg={msg} id={`${uid}-m`} />
    </form>
  )
}

/** companies.defaultWorkSchedule of the PT (PATCH /api/companies/:id; Admin/Owner of that PT, ADR 0016 §1). */
export function DefaultSchedule({ current, companyId, options, disabled }: { current: number | null; companyId: number; options: Option[]; disabled?: boolean }) {
  const [value, setValue] = useState(current ? String(current) : '')
  const { busy, msg, run } = useSave()
  const uid = useId()
  return (
    <form
      className="pk-inline"
      onSubmit={(e) => {
        e.preventDefault()
        void run('PATCH', `/api/companies/${companyId}?depth=0`, { defaultWorkSchedule: value ? Number(value) : null }, 'Jadwal default tersimpan.', {
          action: 'simpan jadwal default perusahaan',
          summary: [['Jadwal', options.find((o) => String(o.id) === value)?.label ?? 'Tidak ada (keterlambatan tidak dihitung)']],
        })
      }}
      data-pk-form="default-schedule"
    >
      <label htmlFor={`${uid}-s`}>Jadwal default perusahaan</label>
      <WrapSelect id={`${uid}-s`} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy}>
        <option value="">— tidak ada (keterlambatan tidak dihitung) —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </WrapSelect>
      {!disabled ? (
        <button type="submit" className="pk-kbtn sm primary" disabled={busy || value === (current ? String(current) : '')}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      ) : null}
      <Msg msg={msg} id={`${uid}-m`} />
    </form>
  )
}

/** New holiday (POST /api/holidays; Admin). */
/**
 * Hari libur — add (POST /api/holidays; Admin) AND, since UI feedback 17/10 #5, edit in the SAME inline widget (PATCH
 * /api/holidays/{id}; Admin / Direktur, `?libur=<id>` on /absensi/jadwal — was the full Payload page): same fields and
 * order; the edit-only "Alasan perubahan" last (the collection requires a reason on every update, audited); "Simpan
 * perubahan" / "Batal".
 */
export function HolidayAdd({ year, edit, cancelHref }: { year: string; edit?: { id: number; date: string; name: string }; cancelHref?: string }) {
  const router = useRouter()
  const [date, setDate] = useState(edit?.date ?? '')
  const [name, setName] = useState(edit?.name ?? '')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const { busy, msg, run } = useSave()
  const uid = useId()
  return (
    <form
      className="pk-inline wrap"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setErr('Pilih tanggal.')
        if (name.trim().length < 3) return setErr('Keterangan minimal 3 karakter.')
        if (edit && reason.trim().length < 3) return setErr('Alasan perubahan minimal 3 karakter.')
        setErr(null)
        if (edit) {
          const ask: Ask = { action: 'simpan perubahan hari libur', object: date, summary: [['Tanggal', date], ['Keterangan', name.trim()], ['Alasan', reason.trim()]] }
          if (await run('PATCH', `/api/holidays/${edit.id}?depth=0`, { date, name: name.trim(), changeReason: reason.trim() }, `Hari libur ${date} diperbarui.`, ask) && cancelHref) router.push(cancelHref)
          return
        }
        if (await run('POST', '/api/holidays?depth=0', { date, name: name.trim() }, `Hari libur ${date} ditambahkan.`, { action: 'tambah hari libur', object: date, summary: [['Tanggal', date], ['Keterangan', name.trim()]] })) {
          setDate('')
          setName('')
        }
      }}
      data-pk-form={edit ? 'holiday-edit' : 'holiday-add'}
      data-pk-holiday-id={edit?.id}
    >
      <div className="pk-fld">
        <label htmlFor={`${uid}-d`}>Tanggal</label>
        <DateInput id={`${uid}-d`} type="date" value={date} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setDate(e.target.value)} required aria-invalid={err && !date ? true : undefined} />
      </div>
      <div className="pk-fld grow">
        <label htmlFor={`${uid}-n`}>Keterangan</label>
        <WrapText id={`${uid}-n`} value={name} maxLength={128} onChange={(e) => setName(e.target.value)} required placeholder="mis. Hari Kemerdekaan RI" />
      </div>
      {edit ? (
        <div className="pk-fld grow" data-pk-field="changeReason">
          <label htmlFor={`${uid}-r`}>Alasan perubahan</label>
          <WrapText id={`${uid}-r`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} required placeholder="Tercatat di audit log" />
        </div>
      ) : null}
      <button type="submit" className="pk-kbtn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : edit ? 'Simpan perubahan' : '+ Tambah hari libur'}
      </button>
      {edit && cancelHref ? (
        <Link className="pk-kbtn" href={cancelHref} prefetch={false}>
          Batal
        </Link>
      ) : null}
      {err ? (
        <p className="pk-kerr" role="alert">
          {err}
        </p>
      ) : (
        <Msg msg={msg} id={`${uid}-m`} />
      )}
    </form>
  )
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/** Cost-center geofence (PATCH /api/cost-centers/{id}; Admin/Owner). Point = lat + lng; empty radius = company default (S3e). */
export function GeofenceForm({ costCenterId, name, lat, lng, radiusM, defaultRadius, disabled }: { costCenterId: number; name: string; lat: number | null; lng: number | null; radiusM: number | null; defaultRadius: number; disabled?: boolean }) {
  const [v, setV] = useState({ lat: lat === null ? '' : String(lat), lng: lng === null ? '' : String(lng), r: radiusM === null ? '' : String(radiusM) })
  const [err, setErr] = useState<string | null>(null)
  const { busy, msg, run } = useSave()
  const uid = useId()
  const check = () => geofenceError({ lat: numOrNull(v.lat), lng: numOrNull(v.lng), radiusM: numOrNull(v.r) })
  const has = v.lat.trim() !== '' && v.lng.trim() !== ''
  return (
    <form
      className="pk-geo"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const x = check()
        setErr(x)
        if (x) return
        void run('PATCH', `/api/cost-centers/${costCenterId}?depth=0`, { lat: numOrNull(v.lat), lng: numOrNull(v.lng), radiusM: numOrNull(v.r) }, 'Geofence tersimpan.', {
          action: 'simpan geofence',
          object: name,
          summary: [
            ['Lokasi', name],
            ['Latitude', v.lat.trim() || '—'],
            ['Longitude', v.lng.trim() || '—'],
            ['Radius (m)', v.r.trim() || `${defaultRadius} (default)`],
          ],
        })
      }}
      data-pk-form="geofence"
      data-pk-cost-center={costCenterId}
    >
      {(
        [
          ['lat', 'Latitude', 'mis. -2.21'],
          ['lng', 'Longitude', 'mis. 113.91'],
          ['r', 'Radius (m)', `kosong = ${defaultRadius}`],
        ] as const
      ).map(([k, label, ph]) => (
        <div key={k} className="pk-fld">
          <label htmlFor={`${uid}-${k}`}>
            {label}
            <span className="pk-sr"> {name}</span>
          </label>
          <input id={`${uid}-${k}`} inputMode="decimal" value={v[k]} placeholder={ph} disabled={disabled || busy} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-invalid={err ? true : undefined} aria-describedby={err ? `${uid}-e` : undefined} />
        </div>
      ))}
      <div className="pk-geo-act">
        {!disabled ? (
          <button type="submit" className="pk-kbtn sm primary" disabled={busy}>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
        ) : null}
        {has ? (
          <a className="pk-kbtn sm" href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(v.lat)}&mlon=${encodeURIComponent(v.lng)}#map=17/${encodeURIComponent(v.lat)}/${encodeURIComponent(v.lng)}`} target="_blank" rel="noopener noreferrer">
            Cek di peta ↗
          </a>
        ) : null}
      </div>
      {err ? (
        <p id={`${uid}-e`} className="pk-kerr" role="alert">
          {err}
        </p>
      ) : (
        <Msg msg={msg} id={`${uid}-m`} />
      )}
    </form>
  )
}

/**
 * DRMS 13/10 A2: the list is every registered location of the caller's PT with its point + effective radius (area
 * detection from the browser GPS) — ADR 0032: projects and cost centers (no site, no "Di luar area" entry);
 * `nonOnsite` = the employee there is Non-OnSite (anywhere: the registered location containing the fix, else "Di luar
 * area" at the nearest one — picked by the server, DRMS 26/10).
 */
export type SelfCheckLocation = {
  type: 'project' | 'cost_center'
  id: number
  label: string
  checkIn: string | null
  checkOut: string | null
  lat?: number
  lng?: number
  radiusM?: number
  nonOnsite?: boolean
}

const LOC_FIELD: Record<SelfCheckLocation['type'], string> = { project: 'project_id', cost_center: 'cost_center_id' }
const LOC_KIND: Record<SelfCheckLocation['type'], string> = { project: 'Project', cost_center: 'Pusat biaya' }
const locKeyOf = (l: Pick<SelfCheckLocation, 'type' | 'id'>) => `${l.type}:${l.id}`

/** DRMS 18/10: the location + action of the selected radio (matched by locKeyOf). */
export function selfCheckPick(locations: readonly SelfCheckLocation[], key: string): { loc: SelfCheckLocation | undefined; action: 'check_in' | 'check_out' | null } {
  const loc = locations.find((l) => locKeyOf(l) === key)
  return { loc, action: loc ? (!loc.checkIn ? 'check_in' : !loc.checkOut ? 'check_out' : null) : null }
}

/** `outside` (DRMS 26/10): a Non-OnSite fix outside every registered location — recorded "Di luar area". */
type AreaNote = { text: string; tone: 'ok' | 'warn'; inside: string[]; outside?: boolean }

/**
 * DRMS 13/10 A2: recognise the area from a GPS fix — one location whose geofence contains the fix → chosen; several
 * (overlapping) → the nearest is chosen and the user may pick another of them; none → manual choice (fallback) with
 * the nearest as a hint. DRMS 26/10 (ADR 0032 amendment 2026-10-26): a Non-OnSite employee outside every location
 * may still check in / out — recorded "Di luar area" at the nearest location (an open check-in of the day is closed
 * there): that location is picked and the note says so. Pure (exported for the unit test); the server re-checks and
 * decides where the record belongs.
 */
export function areaNote(locations: readonly SelfCheckLocation[], fix: { lat: number; lng: number; accuracyM: number | null }): { pick: string | null; note: AreaNote } {
  const d = detectArea(locations, fix)
  const first = d.inside[0]
  if (first && d.inside.length === 1) {
    return { pick: locKeyOf(first), note: { tone: 'ok', inside: [locKeyOf(first)], text: `Lokasi terdeteksi otomatis: ${first.label} (${first.distanceM} m dari titik).` } }
  }
  if (first) {
    return {
      pick: locKeyOf(first),
      note: {
        tone: 'ok',
        inside: d.inside.map(locKeyOf),
        text: `Anda berada di ${d.inside.length} area absen yang bertumpuk. Dipilih yang terdekat: ${first.label} (${first.distanceM} m). Pilih lokasi lain yang ditandai bila perlu.`,
      },
    }
  }
  if (d.nearest && locations.some((l) => l.nonOnsite)) {
    // the server closes the open check-in of the day there; else it records at the nearest location
    const open = locations.find((l) => l.checkIn && !l.checkOut)
    return {
      pick: locKeyOf(open ?? d.nearest),
      note: { tone: 'warn', inside: [], outside: true, text: `${NON_ONSITE_OUTSIDE} (ref. ${d.nearest.label}, ${d.nearest.distanceM} m dari titik).` },
    }
  }
  if (d.nearest) {
    return {
      pick: null,
      note: { tone: 'warn', inside: [], text: `Posisi Anda di luar semua area absen terdaftar. Terdekat: ${d.nearest.label} (${d.nearest.distanceM} m, radius ${d.nearest.radiusM} m). Mendekatlah ke lokasi atau pilih lokasi secara manual.` },
    }
  }
  return { pick: null, note: { tone: 'warn', inside: [], text: 'Belum ada lokasi absen dengan titik koordinat. Hubungi Admin.' } }
}

/**
 * DRMS 26/10: result line of a check-in / check-out recorded "Di luar area" (POST result `outsideArea`; the reference
 * = `location`); undefined for a normal one. Pure (exported for the unit test).
 */
export function outsideAreaLine(data: unknown, locations: readonly Pick<SelfCheckLocation, 'type' | 'id' | 'label'>[]): string | undefined {
  const r = data as { outsideArea?: boolean; location?: { type?: string; id?: number }; distanceM?: number } | null
  if (!r?.outsideArea) return undefined
  const ref = locations.find((l) => l.type === r.location?.type && l.id === r.location?.id)
  const dist = typeof r.distanceM === 'number' ? `, ${r.distanceM} m` : ''
  return ref ? `Tercatat "${OUTSIDE_AREA_LABEL}" (ref. ${ref.label}${dist}).` : `Tercatat "${OUTSIDE_AREA_LABEL}".`
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Perangkat/browser ini tidak mendukung GPS.'))
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(gpsErrorMessage(e, policyBlocks(document, 'geolocation')))), {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    })
  })
}

/**
 * Owner decision 2026-10-09: web self check-in/out, every role (the APK's existing feature,
 * available from the web admin panel too — same server-side rules, POST /attendance/check-in and
 * /check-out). One location at a time: "Absen Masuk" when it has no check-in yet today, "Absen
 * Pulang" when it has a check-in but no check-out, nothing to do once both are recorded.
 */
export function SelfCheckForm({ locations, privacyBlocked }: { locations: SelfCheckLocation[]; privacyBlocked: boolean }) {
  const router = useRouter()
  // item 14 (DRMS 10/10): selfie from the live front camera only (CameraCapture), no file picker
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [camKey, setCamKey] = useState(0)
  const [locKey, setLocKey] = useState(locations[0] ? locKeyOf(locations[0]) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [area, setArea] = useState<AreaNote | null>(null)

  const detect = async () => {
    setError(null)
    setBusy(true)
    try {
      const pos = await getPosition()
      const r = areaNote(locations, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null })
      if (r.pick) setLocKey(r.pick)
      setArea(r.note)
    } catch (err) {
      setError((err as Error).message || 'Gagal mengambil lokasi GPS.')
    } finally {
      setBusy(false)
    }
  }

  // DRMS 13/10 A2: detect the area on open when the browser already allows the location (no permission prompt on
  // load; otherwise the button below asks).
  useEffect(() => {
    if (locations.length === 0 || privacyBlocked || typeof navigator === 'undefined' || !navigator.permissions?.query) return
    let alive = true
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((p) => {
        if (alive && p.state === 'granted') void detect()
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // once per page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { loc, action } = selfCheckPick(locations, locKey)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!loc || !action) return
    if (!photo) return setError('Ambil foto selfie dengan kamera dulu.')
    // DRMS 24/10: popup before (location) and after (result) the attendance
    const label = action === 'check_in' ? 'Absen masuk' : 'Absen pulang'
    const description = area?.outside ? `${NON_ONSITE_OUTSIDE}. Lokasi GPS diambil saat Anda menekan Ya.` : 'Lokasi GPS diambil saat Anda menekan Ya.'
    if (!(await confirmAction({ title: confirmTitle(label, `di ${loc.label}`), summary: [['Lokasi', loc.label], ['Masuk', loc.checkIn]], description, confirmLabel: confirmLabel(label) }))) return
    const file = new File([photo], 'selfie.jpg', { type: 'image/jpeg' })
    setBusy(true)
    try {
      const pos = await getPosition()
      const selfieId = await uploadSelfie(file)
      const body = {
        [LOC_FIELD[loc.type]]: loc.id,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        selfie_media_id: selfieId,
      }
      const r = await sendJson('POST', `/api/v1/attendance/${action === 'check_in' ? 'check-in' : 'check-out'}`, body)
      if (!r.ok) {
        showResult({ ok: false, title: failureTitle(label), message: r.error ?? 'Gagal mengirim absensi.' })
        return setError(r.error ?? 'Gagal mengirim absensi.')
      }
      showResult({ ok: true, title: successTitle(label, loc.label), message: outsideAreaLine(r.data, locations) })
      setPhoto(null)
      setCamKey((k) => k + 1)
      router.refresh()
    } catch (err) {
      setError((err as Error).message || 'Gagal mengirim absensi.')
      showResult({ ok: false, title: failureTitle(label), message: (err as Error).message || 'Gagal mengirim absensi.' })
    } finally {
      setBusy(false)
    }
  }

  if (locations.length === 0) {
    return <EmptyStateInline text="Belum ada lokasi absen untuk Anda: PT Anda belum punya lokasi terdaftar (project / pusat biaya) dengan titik koordinat. Hubungi Admin." />
  }
  if (privacyBlocked) {
    return (
      <p className="pk-kerr" role="alert">
        Anda belum menekan &quot;Saya mengerti&quot; pada pemberitahuan privasi terbaru. Baca{' '}
        <Link href="/privasi">pemberitahuan privasi</Link>, muat ulang halaman ini, lalu absen ulang.
      </p>
    )
  }
  // Field screen in the APK style (owner decision 2026-10-09): big tap targets, one location card each
  // with today's state, one wide action button.
  return (
    <form className="pk-kform pk-selfcheck" onSubmit={submit} data-pk-form="self-check">
      <div className="pk-sc-detect">
        <button type="button" className="pk-kbtn" onClick={() => void detect()} disabled={busy} data-pk-action="detect-area">
          Deteksi lokasi otomatis
        </button>
        {area ? (
          <span className="note" data-tone={area.tone} role="status" data-pk-area-note>
            {area.text}
          </span>
        ) : null}
      </div>
      <fieldset className="pk-sc-locs" disabled={busy}>
        <legend>Lokasi</legend>
        {locations.map((l) => {
          const key = locKeyOf(l)
          const state = l.checkOut ? 'selesai' : l.checkIn ? 'hadir' : 'belum'
          const inside = area?.inside.includes(key) ?? false
          return (
            <label key={key} className="pk-sc-loc" data-state={state} data-pk-loc={key} data-area={inside ? 'in' : undefined}>
              <input type="radio" name="self-check-loc" value={key} checked={locKey === key} onChange={() => setLocKey(key)} />
              <span className="name">
                {l.label}
                <span className="sub">{LOC_KIND[l.type]}</span>
              </span>
              <span className="st">
                {l.checkOut ? `Selesai · pulang ${l.checkOut}` : l.checkIn ? `Masuk ${l.checkIn}` : 'Belum absen'}
                {inside ? <span className="area"> · Anda di area ini</span> : null}
              </span>
            </label>
          )
        })}
      </fieldset>
      <div className="pk-fld">
        <span className="lbl" id="self-check-selfie">
          Foto selfie
        </span>
        <CameraCapture key={camKey} disabled={busy || !action} onChange={setPhoto} />
        <p className="help">Hanya kamera langsung (bukan galeri). Server membubuhkan tanggal, jam, dan lokasi pada foto. Lokasi GPS diambil saat menekan tombol.</p>
        <style>{CAMERA_STYLE}</style>
      </div>
      <button type="submit" className="pk-kbtn primary pk-sc-go" disabled={busy || !action} data-pk-action={action ?? 'none'}>
        {busy ? 'Mengirim…' : action === 'check_in' ? 'Absen Masuk' : action === 'check_out' ? 'Absen Pulang' : 'Sudah selesai hari ini'}
      </button>
      {error ? (
        <p className="pk-kerr" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/** ADR 0032: an employee the Admin Staff may record for (`hasAccount` false = no user account, e.g. a tukang harian). */
export type OnBehalfEmployee = { id: number; company: number; label: string; nonOnsite: boolean; hasAccount: boolean }
/** ADR 0032: a registered location of the employee's PT with its point (area detection from the Admin Staff's GPS). */
export type OnBehalfLocation = { type: 'project' | 'cost_center'; id: number; company: number; label: string; lat: number; lng: number; radiusM: number }

/**
 * ADR 0032 (DRMS 24/10): "Absenkan karyawan" — an Admin Staff records a check-in / check-out ON BEHALF of an employee of
 * its PT (also without an account). The photo of the employee comes from this device's live camera, the GPS fix from
 * this device (the employee's OnSite / Non-OnSite rule is applied to it by the server), the reason is mandatory.
 * POST /attendance/on-behalf re-checks everything; the row shows "diabsenkan oleh <Anda>".
 */
export function OnBehalfForm({ employees, locations, disabledCompanies, privacyBlocked }: { employees: OnBehalfEmployee[]; locations: OnBehalfLocation[]; disabledCompanies: number[]; privacyBlocked: boolean }) {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [locKey, setLocKey] = useState('')
  const [kind, setKind] = useState<'check_in' | 'check_out'>('check_in')
  const [reason, setReason] = useState('')
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [camKey, setCamKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [area, setArea] = useState<AreaNote | null>(null)

  const who = employees.find((e) => e.id === employeeId) ?? null
  const mine: SelfCheckLocation[] = who
    ? locations.filter((l) => l.company === who.company).map((l) => ({ type: l.type, id: l.id, label: l.label, checkIn: null, checkOut: null, lat: l.lat, lng: l.lng, radiusM: l.radiusM, nonOnsite: who.nonOnsite }))
    : []
  const loc = mine.find((l) => locKeyOf(l) === locKey) ?? mine[0] ?? null
  const disabled = who !== null && disabledCompanies.includes(who.company)

  const detect = async () => {
    setError(null)
    setBusy(true)
    try {
      const pos = await getPosition()
      const r = areaNote(mine, { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? null })
      if (r.pick) setLocKey(r.pick)
      setArea(r.note)
    } catch (err) {
      setError((err as Error).message || 'Gagal mengambil lokasi GPS.')
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(null)
    if (!who || !loc) return setError('Pilih karyawan dan lokasi dulu.')
    if (reason.trim().length < 3) return setError('Alasan wajib diisi, minimal 3 karakter.')
    if (!photo) return setError('Ambil foto karyawan dengan kamera dulu.')
    // DRMS 24/10: popup before (employee / location / reason) and after (result) the on-behalf attendance
    const label = kind === 'check_in' ? 'Absenkan masuk' : 'Absenkan pulang'
    const summary: Summary = [
      ['Karyawan', who.label],
      ['Jenis', kind === 'check_in' ? 'Absen masuk' : 'Absen pulang'],
      ['Lokasi', loc.label],
      ['Alasan', reason.trim()],
    ]
    const description = area?.outside ? `${NON_ONSITE_OUTSIDE}. Lokasi GPS perangkat ini diambil saat Anda menekan Ya.` : 'Lokasi GPS perangkat ini diambil saat Anda menekan Ya.'
    if (!(await confirmAction({ title: confirmTitle(label, who.label), summary, description, confirmLabel: confirmLabel(label), testId: 'on-behalf' }))) return
    const file = new File([photo], 'selfie.jpg', { type: 'image/jpeg' })
    setBusy(true)
    try {
      const pos = await getPosition()
      const selfieId = await uploadSelfie(file)
      const r = await sendJson('POST', '/api/v1/attendance/on-behalf', {
        employee_id: who.id,
        kind,
        [LOC_FIELD[loc.type]]: loc.id,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy ?? null,
        selfie_media_id: selfieId,
        reason: reason.trim(),
      })
      if (!r.ok) {
        showResult({ ok: false, title: failureTitle(label), message: r.error ?? 'Gagal mengirim absensi.', testId: 'on-behalf' })
        return setError(r.error ?? 'Gagal mengirim absensi.')
      }
      const outside = outsideAreaLine(r.data, mine)
      showResult({ ok: true, title: successTitle(label, who.label), message: outside ? `${outside} Diabsenkan oleh Anda.` : `${loc.label} · diabsenkan oleh Anda.`, testId: 'on-behalf' })
      setDone(`${kind === 'check_in' ? 'Absen masuk' : 'Absen pulang'} ${who.label} tercatat (diabsenkan oleh Anda).`)
      setPhoto(null)
      setReason('')
      setCamKey((k) => k + 1)
      router.refresh()
    } catch (err) {
      setError((err as Error).message || 'Gagal mengirim absensi.')
      showResult({ ok: false, title: failureTitle(label), message: (err as Error).message || 'Gagal mengirim absensi.', testId: 'on-behalf' })
    } finally {
      setBusy(false)
    }
  }

  if (employees.length === 0) return <EmptyStateInline text="Belum ada karyawan aktif di PT Anda yang dapat diabsenkan." />
  if (privacyBlocked) {
    return (
      <p className="pk-kerr" role="alert">
        Anda belum menekan &quot;Saya mengerti&quot; pada pemberitahuan privasi terbaru. Baca <Link href="/privasi">pemberitahuan privasi</Link>, muat ulang
        halaman ini, lalu coba lagi.
      </p>
    )
  }
  return (
    <form className="pk-kform pk-selfcheck" onSubmit={submit} data-pk-form="on-behalf">
      <div className="pk-fgrid">
        <label className="pk-fld">
          <span className="lbl">Karyawan</span>
          <WrapSelect
            value={employeeId ?? ''}
            disabled={busy}
            onChange={(ev) => {
              setEmployeeId(ev.target.value ? Number(ev.target.value) : null)
              setLocKey('')
              setArea(null)
              setDone(null)
            }}
            data-pk-field="employee"
          >
            <option value="">– pilih karyawan –</option>
            {employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.hasAccount ? '' : ' · tanpa akun'}
              </option>
            ))}
          </WrapSelect>
          {who ? <span className="help">{who.nonOnsite ? 'Karyawan Non-OnSite: lokasi terdaftar yang memuat posisi GPS Anda dipakai otomatis; di luar semua lokasi tercatat "Di luar area".' : 'Karyawan OnSite: posisi GPS Anda harus di dalam radius lokasi yang dipilih.'}</span> : null}
        </label>
        <label className="pk-fld">
          <span className="lbl">Jenis</span>
          <WrapSelect value={kind} disabled={busy} onChange={(ev) => setKind(ev.target.value === 'check_out' ? 'check_out' : 'check_in')} data-pk-field="kind">
            <option value="check_in">Absen masuk</option>
            <option value="check_out">Absen pulang</option>
          </WrapSelect>
        </label>
      </div>
      {who ? (
        <>
          <div className="pk-sc-detect">
            <button type="button" className="pk-kbtn" onClick={() => void detect()} disabled={busy || mine.length === 0} data-pk-action="detect-area">
              Deteksi lokasi otomatis
            </button>
            {area ? (
              <span className="note" data-tone={area.tone} role="status" data-pk-area-note>
                {area.text}
              </span>
            ) : null}
          </div>
          {mine.length === 0 ? (
            <EmptyStateInline text="PT karyawan ini belum punya lokasi terdaftar (project / pusat biaya) dengan titik koordinat. Hubungi Admin." />
          ) : (
            <fieldset className="pk-sc-locs" disabled={busy}>
              <legend>Lokasi</legend>
              {mine.map((l) => {
                const key = locKeyOf(l)
                const inside = area?.inside.includes(key) ?? false
                return (
                  <label key={key} className="pk-sc-loc" data-pk-loc={key} data-area={inside ? 'in' : undefined}>
                    <input type="radio" name="on-behalf-loc" value={key} checked={loc !== null && locKeyOf(loc) === key} onChange={() => setLocKey(key)} />
                    <span className="name">
                      {l.label}
                      <span className="sub">{LOC_KIND[l.type]}</span>
                    </span>
                    <span className="st">{inside ? 'Anda di area ini' : ''}</span>
                  </label>
                )
              })}
            </fieldset>
          )}
        </>
      ) : null}
      <label className="pk-fld">
        <span className="lbl">Alasan (wajib)</span>
        <WrapText value={reason} maxLength={500} disabled={busy} onChange={(ev) => setReason(ev.target.value)} placeholder="Contoh: tukang harian tanpa HP" data-pk-field="reason" />
      </label>
      <div className="pk-fld">
        <span className="lbl">Foto karyawan</span>
        <CameraCapture key={camKey} disabled={busy || !who || disabled} onChange={setPhoto} />
        <p className="help">Hanya kamera langsung (bukan galeri). Server membubuhkan tanggal, jam, lokasi dan nama Anda pada foto. Lokasi GPS perangkat ini diambil saat menekan tombol.</p>
        <style>{CAMERA_STYLE}</style>
      </div>
      {disabled ? <p className="pk-kerr">Absensi dari web belum diaktifkan untuk PT karyawan ini (Setting perusahaan).</p> : null}
      <button type="submit" className="pk-kbtn primary pk-sc-go" disabled={busy || !who || !loc || disabled} data-pk-action={`on-behalf-${kind}`}>
        {busy ? 'Mengirim…' : kind === 'check_in' ? 'Absenkan masuk' : 'Absenkan pulang'}
      </button>
      {error ? (
        <p className="pk-kerr" role="alert">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="pk-okmsg" role="status" data-pk-done>
          {done}
        </p>
      ) : null}
    </form>
  )
}

function EmptyStateInline({ text }: { text: string }) {
  return <p className="pk-muted">{text}</p>
}
