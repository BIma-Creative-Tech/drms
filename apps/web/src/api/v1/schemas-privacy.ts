import { z } from 'zod'

/** Employee privacy notice + acknowledgement (Q-46, ASVS 8.3.3, ADR 0018). */
export const PrivacyNotice = z
  .object({
    version: z.number().int().meta({ description: 'Integer of the notice\'s "Versi" line; acknowledgements compare against it.' }),
    title: z.string(),
    html: z.string().meta({ description: 'Safe HTML of the notice: escaped text, attribute-less tags only (h1–h4, p, ul/ol/li, table, strong, em, code, hr). No links, images or scripts.' }),
    markdown: z.string().meta({ description: 'Source markdown (docs/proyekkas/legal/pemberitahuan-privasi.md, bundled at build time).' }),
  })
  .meta({ id: 'PrivacyNotice' })

export const PrivacyStatus = z
  .object({
    currentVersion: z.number().int().meta({ description: 'Version of the notice this server serves (GET /privacy-notice).' }),
    ackVersion: z.number().int().nullable().meta({ description: 'Version the caller acknowledged; null = never. Ask again when < currentVersion.' }),
    ackAt: z.string().nullable().meta({ description: 'When it was acknowledged (UTC ISO-8601, server clock); null = never.' }),
  })
  .meta({ id: 'PrivacyStatus', description: 'ADR 0018: the APK blocks attendance until ackVersion ≥ currentVersion; the web admin shows an interstitial.' })

export const PrivacyAckBody = z
  .object({ version: z.number().int().min(1).max(999_999).meta({ description: 'Version the user read; must equal the current version (else 409 PRIVACY_VERSION_MISMATCH).' }) })
  .strict()
  .meta({ id: 'PrivacyAckBody' })

export const PrivacyAck = z
  .object({
    version: z.number().int(),
    ackAt: z.string().meta({ description: 'UTC ISO-8601 (DB clock). Unchanged when the version was already acknowledged.' }),
    alreadyAcknowledged: z.boolean(),
  })
  .meta({ id: 'PrivacyAck' })
