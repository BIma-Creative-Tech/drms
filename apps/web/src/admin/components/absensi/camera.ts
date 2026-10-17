/**
 * Item 14 (DRMS 10/10): web self check-in takes the selfie from the LIVE front camera only
 * (getUserMedia → <video> → canvas), never from a file picker / gallery. Pure helpers (unit-tested);
 * the component is CameraCapture.tsx.
 */
export const NO_CAMERA = 'Kamera tidak tersedia — gunakan aplikasi Android.'
export const CAMERA_DENIED = 'Izin kamera ditolak. Izinkan akses kamera untuk situs ini di browser, atau gunakan aplikasi Android.'
export const CAMERA_POLICY =
  'Kamera diblokir oleh pengaturan keamanan server (bukan oleh browser Anda). Hubungi Admin, atau gunakan aplikasi Android.'
export const GPS_POLICY =
  'GPS diblokir oleh pengaturan keamanan server (bukan oleh browser Anda). Hubungi Admin, atau pilih lokasi secara manual / gunakan aplikasi Android.'
export const GPS_DENIED = 'Izin lokasi ditolak. Izinkan akses lokasi untuk situs ini di browser lalu coba lagi.'
export const CAMERA_BUSY = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi, atau gunakan aplikasi Android.'

type PolicyDoc = { permissionsPolicy?: { allowsFeature?: (f: string) => boolean }; featurePolicy?: { allowsFeature?: (f: string) => boolean } }

/**
 * DRMS 18/10: true only when the page's Permissions-Policy header (not the user) disallows `feature`.
 * Chromium exposes document.permissionsPolicy / featurePolicy; other browsers → unknown → false.
 */
export function policyBlocks(doc: unknown, feature: 'camera' | 'geolocation'): boolean {
  const d = doc as PolicyDoc | undefined
  const p = d?.permissionsPolicy ?? d?.featurePolicy
  if (typeof p?.allowsFeature !== 'function') return false
  try {
    return !p.allowsFeature(feature)
  } catch {
    return false
  }
}

/** Message for a getUserMedia failure (DOMException name) or a missing API. */
export function cameraErrorMessage(err: unknown, blockedByPolicy = false): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
  if (blockedByPolicy && (name === 'NotAllowedError' || name === 'SecurityError')) return CAMERA_POLICY
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return CAMERA_DENIED
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return CAMERA_BUSY
  return NO_CAMERA
}

/** Message for a GeolocationPositionError (code 1 = PERMISSION_DENIED, 2 = unavailable, 3 = timeout). */
export function gpsErrorMessage(err: { code?: number; message?: string } | null | undefined, blockedByPolicy = false): string {
  if (err?.code === 1) return blockedByPolicy ? GPS_POLICY : GPS_DENIED
  if (err?.code === 3) return 'GPS tidak merespons (timeout). Pindah ke tempat terbuka lalu coba lagi.'
  return 'Gagal mengambil lokasi GPS. Aktifkan GPS perangkat lalu coba lagi.'
}

/** True when this browser can open a camera stream at all (secure context + mediaDevices.getUserMedia). */
export function cameraSupported(nav: { mediaDevices?: { getUserMedia?: unknown } } | undefined, secure: boolean): boolean {
  return secure && typeof nav?.mediaDevices?.getUserMedia === 'function'
}

/** Capture size: the video frame scaled down so the long side is ≤ `max` (server resizes to 720 px). */
export function captureSize(videoW: number, videoH: number, max = 1280): { width: number; height: number } | null {
  if (!(videoW > 0 && videoH > 0)) return null
  const k = Math.min(1, max / Math.max(videoW, videoH))
  return { width: Math.round(videoW * k), height: Math.round(videoH * k) }
}

/** getUserMedia constraints: front camera, no audio. */
export const CAMERA_CONSTRAINTS = { audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } } } as const
