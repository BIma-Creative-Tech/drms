'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

import { geofenceError } from '@/domain/attendance/calendar'

import { newIdemKey, sendJson } from '../kas/client'

/**
 * E6 web (S2) client actions of the attendance views. Same pattern as the Kas dialogs (native modal
 * <dialog>: focus trap, Esc, focus return; visible labels; inline errors with aria-describedby; busy
 * state; one Idempotency-Key per opened dialog). The server re-checks everything:
 * - CorrectionDialog → POST /api/v1/attendance/{id}/correct (PM team / Admin, never own, reason ≥ 3,
 *   same local date, not in the future; audit old → new).
 * - SelfieButton → GET /api/v1/attendance/{id}/selfie, requested ONLY when the dialog opens (the
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
      if (!r.ok) return setError({ field: 'form', text: r.error ?? 'Gagal menyimpan koreksi.' })
      ref.current?.close()
      setReason('')
      router.refresh()
    } catch {
      setError({ field: 'form', text: 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.' })
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
          <h2 id={`${uid}-t`}>Koreksi jam {kindLabel}</h2>
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
              {busy ? 'Menyimpan…' : 'Simpan koreksi'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export function SelfieButton({ attendanceId, label, available, own }: { attendanceId: number; label: string; available: boolean; own: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [shown, setShown] = useState(false)
  const [failed, setFailed] = useState(false)
  const uid = useId()
  if (!available) {
    return (
      <span className="pk-chip muted" title="File selfie sudah dihapus setelah masa retensi (Q-33); data absensi tetap." data-pk-selfie-removed={attendanceId}>
        Selfie dihapus
      </span>
    )
  }
  return (
    <>
      <button
        type="button"
        className="pk-kbtn sm"
        onClick={() => {
          setFailed(false)
          setShown(true)
          ref.current?.showModal()
        }}
        data-pk-action="selfie"
        data-pk-attendance={attendanceId}
        aria-label={`Lihat selfie ${label}`}
      >
        Selfie
      </button>
      <dialog ref={ref} className="pk-dlg pk-selfie-dlg" aria-labelledby={`${uid}-t`} onClose={() => setShown(false)}>
        <form method="dialog">
          <h2 id={`${uid}-t`}>Selfie · {label}</h2>
          {!own ? <p className="desc">Data pribadi (UU PDP). Membuka selfie orang lain tercatat di audit log.</p> : null}
          <div className="pk-selfie-box">
            {shown && !failed ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, audited, no-store image from /api/v1 (next/image would cache it)
              <img src={`/api/v1/attendance/${attendanceId}/selfie`} alt={`Selfie absensi ${label}`} onError={() => setFailed(true)} referrerPolicy="no-referrer" data-pk-selfie-img />
            ) : null}
            {failed ? <p className="pk-kerr">Selfie tidak tersedia (mungkin sudah melewati masa retensi).</p> : null}
          </div>
          <div className="foot">
            <button type="submit" className="pk-kbtn">
              Tutup
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

// ---------------------------------------------------------------- Payload REST saves (masters)

/** Message of a Payload REST error body ({ errors: [{ message, data: { errors: [{ path, message }] } }] }). */
export function payloadError(data: unknown, status: number): string {
  const errs = ((data ?? {}) as { errors?: Array<{ message?: string; data?: { errors?: Array<{ path?: string; message?: string }> } }> }).errors ?? []
  const inner = errs.flatMap((e) => e.data?.errors ?? []).map((e) => `${e.path ? `${e.path}: ` : ''}${e.message ?? ''}`)
  const text = inner.length ? inner.join('; ') : errs.map((e) => e.message).filter(Boolean).join('; ')
  return text || (status === 403 ? 'Anda tidak berhak mengubah data ini.' : `Gagal menyimpan (HTTP ${status}).`)
}

async function rest(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<{ ok: boolean; error: string | null }> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, error: res.ok ? null : payloadError(data, res.status) }
}

function useSave() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (method: 'POST' | 'PATCH', url: string, body: unknown, okText: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await rest(method, url, body)
      setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Gagal menyimpan.' })
      if (r.ok) router.refresh()
      return r.ok
    } catch {
      setMsg({ ok: false, text: 'Gagal menghubungi server. Coba lagi.' })
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
        void run('PATCH', `/api/employees/${employeeId}?depth=0`, { workSchedule: value ? Number(value) : null }, 'Tersimpan.')
      }}
      data-pk-form="schedule-assign"
      data-pk-employee={employeeId}
    >
      <label htmlFor={`${uid}-s`} className="pk-sr">
        Jadwal kerja {employee}
      </label>
      <select id={`${uid}-s`} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy} aria-describedby={msg ? `${uid}-m` : undefined}>
        <option value="">Default perusahaan</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {!disabled ? (
        <button type="submit" className="pk-kbtn sm" disabled={busy || value === (current ? String(current) : '')}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
      ) : null}
      <Msg msg={msg} id={`${uid}-m`} />
    </form>
  )
}

/** company-settings.defaultWorkSchedule (POST /api/globals/company-settings; Admin/Owner). */
export function DefaultSchedule({ current, options, disabled }: { current: number | null; options: Option[]; disabled?: boolean }) {
  const [value, setValue] = useState(current ? String(current) : '')
  const { busy, msg, run } = useSave()
  const uid = useId()
  return (
    <form
      className="pk-inline"
      onSubmit={(e) => {
        e.preventDefault()
        void run('POST', '/api/globals/company-settings?depth=0', { defaultWorkSchedule: value ? Number(value) : null }, 'Jadwal default tersimpan.')
      }}
      data-pk-form="default-schedule"
    >
      <label htmlFor={`${uid}-s`}>Jadwal default perusahaan</label>
      <select id={`${uid}-s`} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || busy}>
        <option value="">— tidak ada (keterlambatan tidak dihitung) —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
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
export function HolidayAdd({ year }: { year: string }) {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
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
        setErr(null)
        if (await run('POST', '/api/holidays?depth=0', { date, name: name.trim() }, `Hari libur ${date} ditambahkan.`)) {
          setDate('')
          setName('')
        }
      }}
      data-pk-form="holiday-add"
    >
      <div className="pk-fld">
        <label htmlFor={`${uid}-d`}>Tanggal</label>
        <input id={`${uid}-d`} type="date" value={date} min={`${year}-01-01`} max={`${year}-12-31`} onChange={(e) => setDate(e.target.value)} required aria-invalid={err && !date ? true : undefined} />
      </div>
      <div className="pk-fld grow">
        <label htmlFor={`${uid}-n`}>Keterangan</label>
        <input id={`${uid}-n`} type="text" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} required placeholder="mis. Hari Kemerdekaan RI" />
      </div>
      <button type="submit" className="pk-kbtn primary" disabled={busy}>
        {busy ? 'Menyimpan…' : '+ Tambah hari libur'}
      </button>
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
        void run('PATCH', `/api/cost-centers/${costCenterId}?depth=0`, { lat: numOrNull(v.lat), lng: numOrNull(v.lng), radiusM: numOrNull(v.r) }, 'Geofence tersimpan.')
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
