import { DEFAULT_TZ } from '@/lib/time'

import { PRIVACY_NOTICE_VERSION, privacyAckCurrent } from './privacy-notice'

export type PrivacyAckState = 'none' | 'current' | 'outdated'

/** Label of the Users list column "Privasi dibaca (versi/tanggal)" (pure; unit-tested). */
export function privacyAckLabel(version: unknown, at: unknown, current: number = PRIVACY_NOTICE_VERSION, timeZone: string = process.env.TZ || DEFAULT_TZ): { text: string; state: PrivacyAckState } {
  const v = typeof version === 'number' ? version : typeof version === 'string' && /^\d+$/.test(version) ? Number(version) : null
  if (v === null) return { text: 'Belum', state: 'none' }
  const d = typeof at === 'string' || at instanceof Date ? new Date(at) : null
  const when =
    d && !Number.isNaN(d.getTime())
      ? new Intl.DateTimeFormat('id-ID', { timeZone, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)
      : '—'
  const state: PrivacyAckState = privacyAckCurrent(v, current) ? 'current' : 'outdated'
  return { text: `v${v} · ${when}${state === 'outdated' ? ` (terbaru v${current})` : ''}`, state }
}
