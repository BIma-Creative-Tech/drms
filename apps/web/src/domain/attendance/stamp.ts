import { rename, readFile, writeFile } from 'node:fs/promises'

import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import sharp from 'sharp'

import { drawText, GLYPH_H, GLYPH_W, textWidth, toAscii } from '@/lib/bitmap-font'
import { withImageSlot } from '@/lib/image-queue'
import { mediaPath } from '@/lib/media-files'
import { withSystemTransaction } from '@/lib/system-tx'
import { DEFAULT_TZ } from '@/lib/time'
import { getRequestTx } from '@/lib/tx'

/**
 * D7 (owner decision DRMS 10/10, item 14; ADR 0010 addendum 2026-10-12): every attendance selfie gets a
 * timestamp band burnt into the STORED image — date + time of the attendance as the SERVER accepted it
 * (`attendances.attendance_time`, never the raw device clock) in the PT time zone, GPS (5 decimals) +
 * accuracy, project / cost center, employee (and the PM for "diabsenkan PM"), "RR Teams".
 *
 * When: the sync contract uploads the selfie BEFORE the attendance item exists (media first, then the
 * batch), so the upload cannot know the accepted time. `recordAttendance` (the single write path: APK
 * sync, web self check-in, PM on-behalf) queues the job `stampSelfie` in the attendance's transaction;
 * the WORKER re-encodes the file once (CPU off the web process, Q-34) and marks `stamped_at` (DB:
 * write-once). Idempotent: a row already stamped or removed by retention is skipped.
 * Text is drawn with a built-in 5×7 bitmap font (the runtime image has no system fonts).
 */
export type StampInfo = {
  time: Date
  timeZone: string
  timeTrust?: string | null
  kind: 'check_in' | 'check_out'
  employee: string
  onBehalfBy?: string | null
  location: string
  lat: number
  lng: number
  accuracyM: number | null
}

/** Selfie size target (ADR 0004 §2: 720 px, ≤ 150 KB). */
export const SELFIE_MAX_BYTES = 150 * 1024
export const BRAND = 'RR Teams'

const TZ_ABBR: Record<string, string> = { 'Asia/Makassar': 'WITA', 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Jayapura': 'WIT' }

/** "WITA" / "WIB" / "WIT", else "UTC+hh:mm" of the zone at `at`. */
export function tzLabel(timeZone: string, at: Date): string {
  const known = TZ_ABBR[timeZone]
  if (known) return known
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(at)
  const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  return off === 'GMT' ? 'UTC' : off.replace('GMT', 'UTC')
}

/** "dd/mm/yyyy HH:MM:SS" of `at` in `timeZone`. */
export function localStamp(at: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`
}

/** The band's text: left lines (top → bottom) + the brand on the right of the first line. */
export function stampLines(i: StampInfo): { lines: string[]; right: string } {
  const trust = i.timeTrust === 'estimated' ? ' (perkiraan server)' : i.timeTrust === 'device_only' ? ' (jam perangkat)' : ''
  const who = `${i.kind === 'check_in' ? 'Masuk' : 'Pulang'} - ${i.employee}${i.onBehalfBy ? ` (diabsenkan ${i.onBehalfBy})` : ''}`
  const gps = `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}${i.accuracyM !== null && Number.isFinite(i.accuracyM) ? ` - akurasi ${Math.round(i.accuracyM)} m` : ''}`
  return { lines: [`${localStamp(i.time, i.timeZone)} ${tzLabel(i.timeZone, i.time)}${trust}`, who, i.location, gps], right: BRAND }
}

/** Cuts `text` to `maxPx` at `scale` (ellipsis ".."). */
export function fit(text: string, maxPx: number, scale: number): string {
  const s = toAscii(text)
  const max = Math.floor(maxPx / ((GLYPH_W + 1) * scale))
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 2))}..`
}

export type BandGeometry = { scale: number; pad: number; lineH: number; height: number }

/** Band size for an image `width` px wide with `lines` text lines (scale 2 at 720 px). */
export function bandGeometry(width: number, lines: number): BandGeometry {
  const scale = Math.max(1, Math.min(4, Math.floor(width / 330)))
  const pad = 4 * scale
  const lineH = (GLYPH_H + 3) * scale
  return { scale, pad, lineH, height: pad * 2 + lines * lineH - 3 * scale }
}

/** RGBA pixels of the band (semi-transparent black, white text). */
export function renderBand(width: number, info: StampInfo): { data: Buffer; height: number } {
  const { lines, right } = stampLines(info)
  const g = bandGeometry(width, lines.length)
  const buf = Buffer.alloc(width * g.height * 4)
  for (let o = 0; o < buf.length; o += 4) buf[o + 3] = 150 // black, ~60 % opaque
  const white = [255, 255, 255, 255] as const
  const amber = [255, 200, 40, 255] as const
  const rightW = textWidth(right, g.scale)
  lines.forEach((line, n) => {
    const room = width - g.pad * 2 - (n === 0 ? rightW + 4 * g.scale : 0)
    drawText(buf, width, g.height, g.pad, g.pad + n * g.lineH, fit(line, room, g.scale), g.scale, white)
  })
  drawText(buf, width, g.height, width - g.pad - rightW, g.pad, right, g.scale, amber)
  return { data: buf, height: g.height }
}

/**
 * Burns the band into the bottom of a JPEG selfie (same dimensions, re-encoded JPEG ≤ 150 KB: quality
 * steps down from 75 when needed). Pure (buffer in → buffer out).
 */
export async function stampImage(input: Buffer, info: StampInfo, maxBytes = SELFIE_MAX_BYTES): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) throw new Error('stamp: image without dimensions')
  const band = renderBand(width, info)
  const top = Math.max(0, height - band.height)
  let out: Buffer = Buffer.alloc(0)
  for (const quality of [75, 68, 60, 52, 45]) {
    out = await sharp(input)
      .composite([{ input: band.data, raw: { width, height: band.height, channels: 4 }, top, left: 0 }])
      .jpeg({ quality, mozjpeg: true })
      .toBuffer()
    if (out.length <= maxBytes) break
  }
  return { data: out, width, height }
}

type Row = {
  attendance_id: number
  kind: 'check_in' | 'check_out'
  attendance_time: string
  time_trust: string | null
  lat: number
  lng: number
  accuracy_m: number | null
  source: string
  employee: string | null
  recorder: string | null
  location: string | null
  timezone: string | null
  media_id: number
  filename: string | null
  stamped_at: string | null
  removed_at: string | null
}

export type StampResult = { status: 'stamped' | 'already' | 'removed' | 'missing'; mediaId?: number; bytes?: number }

/**
 * Worker side of D7: stamps the selfie of attendance `attendanceId` once. The media row is locked
 * (FOR UPDATE) for the run; the file is written to a temp name and renamed over the original (a
 * reader never sees a half-written file), then `stamped_at` is set in the same transaction.
 */
export async function stampAttendanceSelfie(payload: Payload, attendanceId: number): Promise<StampResult> {
  return withSystemTransaction(payload, null, async (req) => {
    const tx = await getRequestTx(req)
    const r = (await tx.execute(sql`
      SELECT a.id AS attendance_id, a.kind::text AS kind, a.attendance_time, a.time_trust::text AS time_trust, a.lat, a.lng, a.accuracy_m, a.source::text AS source,
             e.name AS employee, ru.name AS recorder,
             coalesce(CASE WHEN p.id IS NOT NULL THEN 'Project ' || p.code || ' ' || p.name END, CASE WHEN cc.id IS NOT NULL THEN 'Pusat biaya ' || cc.code || ' ' || cc.name END) AS location,
             co.timezone, m.id AS media_id, m.filename, m.stamped_at, m.removed_at
      FROM attendances a
      JOIN media_selfies m ON m.id = a.selfie_id
      LEFT JOIN employees e ON e.id = a.employee_id
      LEFT JOIN users ru ON ru.id = a.recorded_by_id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
      LEFT JOIN companies co ON co.id = coalesce(p.company_id, cc.company_id)
      WHERE a.id = ${attendanceId}
      FOR UPDATE OF m`)) as unknown as { rows: Row[] }
    const row = r.rows[0]
    if (!row) return { status: 'missing' }
    if (row.removed_at) return { status: 'removed', mediaId: row.media_id }
    if (row.stamped_at) return { status: 'already', mediaId: row.media_id }
    const file = mediaPath(payload, 'media-selfies', row.filename)
    if (!file) return { status: 'missing', mediaId: row.media_id }
    let input: Buffer
    try {
      input = await readFile(file)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', mediaId: row.media_id }
      throw err
    }
    const info: StampInfo = {
      time: new Date(row.attendance_time),
      timeZone: row.timezone || process.env.TZ || DEFAULT_TZ,
      timeTrust: row.time_trust,
      kind: row.kind,
      employee: row.employee ?? '-',
      // US-14 "diabsenkan PM <nama>"; ADR 0032 "diabsenkan Admin Staff <nama>"
      onBehalfBy: row.source === 'pm' ? `PM ${row.recorder ?? ''}`.trim() : row.source === 'admin' ? `Admin Staff ${row.recorder ?? ''}`.trim() : null,
      location: row.location ?? '-',
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
    }
    const out = await withImageSlot(() => stampImage(input, info), 'selfie-stamp')
    const tmp = `${file}.stamp-${process.pid}.tmp`
    await writeFile(tmp, out.data)
    await rename(tmp, file)
    await tx.execute(sql`UPDATE media_selfies SET stamped_at = clock_timestamp(), filesize = ${out.data.length}, width = ${out.width}, height = ${out.height} WHERE id = ${row.media_id}`)
    return { status: 'stamped', mediaId: row.media_id, bytes: out.data.length }
  })
}
