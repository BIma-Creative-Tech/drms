'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { CAMERA_CONSTRAINTS, cameraErrorMessage, cameraSupported, captureSize, NO_CAMERA } from './camera'

type State = { s: 'idle' } | { s: 'starting' } | { s: 'live' } | { s: 'shot'; url: string } | { s: 'error'; text: string }

/**
 * Item 14 (DRMS 10/10): live front-camera capture for the web self check-in — no file input, so no
 * gallery photo can be sent. "Buka kamera" → preview (mirrored like a mirror) → "Ambil foto" (canvas →
 * JPEG, the server re-encodes to 720 px and stamps time/location, D7) → "Ulangi" possible. Without a
 * camera / permission the form explains it and points to the Android app.
 */
export function CameraCapture({ disabled, onChange }: { disabled?: boolean; onChange: (photo: Blob | null) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<State>({ s: 'idle' })

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }, [])
  useEffect(() => stop, [stop])
  useEffect(() => () => (state.s === 'shot' ? URL.revokeObjectURL(state.url) : undefined), [state])

  const start = async () => {
    onChange(null)
    if (!cameraSupported(navigator, window.isSecureContext)) return setState({ s: 'error', text: NO_CAMERA })
    setState({ s: 'starting' })
    try {
      const s = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      stream.current = s
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => undefined)
      }
      setState({ s: 'live' })
    } catch (err) {
      stop()
      setState({ s: 'error', text: cameraErrorMessage(err) })
    }
  }

  const shoot = () => {
    const v = video.current
    const size = v ? captureSize(v.videoWidth, v.videoHeight) : null
    if (!v || !size) return setState({ s: 'error', text: NO_CAMERA })
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d')?.drawImage(v, 0, 0, size.width, size.height)
    canvas.toBlob(
      (blob) => {
        stop()
        if (!blob) return setState({ s: 'error', text: NO_CAMERA })
        onChange(blob)
        setState({ s: 'shot', url: URL.createObjectURL(blob) })
      },
      'image/jpeg',
      0.88,
    )
  }

  return (
    <div className="pk-cam" data-pk-camera={state.s}>
      <div className="pk-cam-box" aria-live="polite">
        {/* the stream stays mounted while live; a captured photo replaces it */}
        <video ref={video} playsInline muted aria-label="Pratinjau kamera depan" style={{ display: state.s === 'live' || state.s === 'starting' ? 'block' : 'none' }} />
        {state.s === 'shot' ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview, never uploaded from here
          <img src={state.url} alt="Foto selfie yang akan dikirim" />
        ) : null}
        {state.s === 'idle' ? <p className="pk-cam-hint">Selfie diambil langsung dari kamera depan (bukan dari galeri).</p> : null}
        {state.s === 'starting' ? <p className="pk-cam-hint">Membuka kamera…</p> : null}
        {state.s === 'error' ? (
          <p className="pk-kerr" role="alert" data-pk-camera-error>
            {state.text}
          </p>
        ) : null}
      </div>
      <div className="pk-cam-act">
        {state.s === 'live' ? (
          <button type="button" className="pk-kbtn primary" onClick={shoot} disabled={disabled} data-pk-action="camera-shoot">
            Ambil foto
          </button>
        ) : (
          <button type="button" className="pk-kbtn" onClick={() => void start()} disabled={disabled || state.s === 'starting'} data-pk-action="camera-open">
            {state.s === 'shot' ? 'Ulangi foto' : state.s === 'error' ? 'Coba lagi' : 'Buka kamera'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Styles of CameraCapture (rendered once by the host view next to ABSENSI_STYLE). */
export const CAMERA_STYLE = `
.pk-cam { display: flex; flex-direction: column; gap: 8px; }
.pk-cam-box { position: relative; width: 100%; max-width: 360px; aspect-ratio: 3 / 4; background: var(--theme-elevation-100); border: 1px solid var(--theme-elevation-150); border-radius: 12px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.pk-cam-box video, .pk-cam-box img { width: 100%; height: 100%; object-fit: cover; }
.pk-cam-box video { transform: scaleX(-1); } /* mirror preview; the photo itself is not mirrored */
.pk-cam-box .pk-cam-hint, .pk-cam-box .pk-kerr { padding: 12px; text-align: center; margin: 0; font-size: 13px; }
.pk-cam-act { display: flex; gap: 8px; }
`
