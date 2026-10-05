import { parseMarkdown, type Block } from './markdown'
import { PRIVACY_NOTICE_SOURCE } from './privacy-notice.generated'

/**
 * Employee privacy notice (UU PDP, Q-46; ASVS 8.3.3 / gap G-06), bundled at build time from
 * docs/proyekkas/legal/pemberitahuan-privasi.md (scripts/gen-privacy-notice.mjs; CI drift check). No wording lives
 * in the code: title, version and body all come from that file.
 *
 * Versioning (docs/proyekkas/adr/0018-privacy-notice-ack-versioning.md): `PRIVACY_NOTICE_VERSION` is the integer of
 * the notice's "**Versi:** <n>" line. A user has acknowledged the CURRENT notice when `users.privacyAckVersion`
 * ≥ it; bumping the number in the markdown makes every user read and acknowledge it again (web interstitial, APK
 * full-screen notice; attendance on the APK is blocked until then).
 */
export const PRIVACY_NOTICE_VERSION: number = PRIVACY_NOTICE_SOURCE.version

export const PRIVACY_NOTICE = {
  version: PRIVACY_NOTICE_SOURCE.version as number,
  title: PRIVACY_NOTICE_SOURCE.title as string,
  markdown: PRIVACY_NOTICE_SOURCE.markdown as string,
  html: PRIVACY_NOTICE_SOURCE.html as string,
  sha256: PRIVACY_NOTICE_SOURCE.sha256 as string,
}

let blocks: Block[] | undefined
/** AST of the bundled notice for the React views (parsed once per process). */
export function privacyNoticeBlocks(): Block[] {
  blocks ??= parseMarkdown(PRIVACY_NOTICE.markdown)
  return blocks
}

/** Does an acknowledged version cover the current notice? (null / missing = never acknowledged) */
export function privacyAckCurrent(ackVersion: unknown, current: number = PRIVACY_NOTICE_VERSION): boolean {
  return typeof ackVersion === 'number' && Number.isFinite(ackVersion) && ackVersion >= current
}

export type PrivacyStatus = { currentVersion: number; ackVersion: number | null; ackAt: string | null }

/** `/me` → `privacy` of a user row (Payload returns numeric columns as numbers, dates as ISO strings). */
export function privacyStatusOf(user: { privacyAckVersion?: unknown; privacyAckAt?: unknown } | null | undefined): PrivacyStatus {
  const v = user?.privacyAckVersion
  const at = user?.privacyAckAt
  return {
    currentVersion: PRIVACY_NOTICE_VERSION,
    ackVersion: typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null,
    ackAt: typeof at === 'string' && at ? new Date(at).toISOString() : at instanceof Date ? at.toISOString() : null,
  }
}
