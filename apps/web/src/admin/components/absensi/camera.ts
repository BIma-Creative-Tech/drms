/**
 * Item 14 (DRMS 10/10): web self check-in takes the selfie from the LIVE front camera only
 * (getUserMedia → <video> → canvas), never from a file picker / gallery. Pure helpers (unit-tested);
 * the component is CameraCapture.tsx.
 */
export const NO_CAMERA = 'Kamera tidak tersedia — gunakan aplikasi Android.'
export const CAMERA_DENIED = 'Izin kamera ditolak. Izinkan akses kamera untuk situs ini di browser, atau gunakan aplikasi Android.'
export const CAMERA_BUSY = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi, atau gunakan aplikasi Android.'

/** Message for a getUserMedia failure (DOMException name) or a missing API. */
export function cameraErrorMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return CAMERA_DENIED
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return CAMERA_BUSY
  return NO_CAMERA
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
