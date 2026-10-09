'use client'
import { problemText } from '../ActionButton'

/**
 * FR1 web forms — client helpers. Photos go through the same upload as the APK and the progress
 * photos: POST /api/v1/media/progress-photos (multipart `file`; the server re-encodes to ≤ 1600 px
 * JPEG and strips EXIF/GPS, ADR 0004). That collection takes JPEG only, so another image type
 * (PNG/WebP/HEIC the browser can decode) is converted to JPEG in the browser first. The returned id
 * is referenced by the report (photoIds / hmPhotoId); ownership is linked by the report service.
 */
const MAX_EDGE = 2000

async function toJpeg(file: File): Promise<Blob> {
  if (file.type === 'image/jpeg') return file
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error('Format foto harus JPEG.')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error(`Foto "${file.name}" tidak dapat dibaca. Gunakan JPEG atau PNG.`)
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Browser tidak dapat mengubah foto ke JPEG.')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  bmp.close?.()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal mengubah foto ke JPEG.'))), 'image/jpeg', 0.85))
}

/** Uploads one field photo; returns the media id. Retries are safe (a new media row, claimed only once used). */
export async function uploadFieldPhoto(file: File): Promise<number> {
  const blob = await toJpeg(file)
  const fd = new FormData()
  fd.append('file', blob, file.name.replace(/\.[^.]+$/, '') + '.jpg')
  const res = await fetch('/api/v1/media/progress-photos', { method: 'POST', credentials: 'same-origin', body: fd })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(problemText(data, res.status))
  return (data as { id: number }).id
}

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as T | null
}
