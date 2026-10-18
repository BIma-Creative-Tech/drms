import { z } from 'zod'

/** User 2026-10-19 (APK ↔ web parity, phase 2): own profile + signature and "Keamanan akun". Pure zod (bundled by scripts/gen-openapi.mjs). */
export const MeAccount = z
  .object({
    id: z.number().int(),
    email: z.string(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    displayName: z.string(),
    signature: z
      .object({ id: z.number().int(), width: z.number().int().nullable(), height: z.number().int().nullable() })
      .nullable()
      .meta({ description: 'Profile signature (media-signatures; image via GET /media/signatures/{id}/file). null = none: decisions then need a signature drawn on screen.' }),
    editable: z.array(z.literal('signature')).meta({ description: 'Fields the caller may change on their own account (F2c self-service: signature only; Admin manages the rest).' }),
  })
  .meta({ id: 'MeAccount' })

export const MeSignatureBody = z
  .strictObject({
    signatureMediaId: z
      .number()
      .int()
      .positive()
      .nullable()
      .meta({ description: 'A media-signatures row the caller uploaded (POST /media/signatures); null removes the profile signature.' }),
  })
  .meta({ id: 'MeSignatureBody' })

export const MeSecurity = z
  .object({
    twoFactor: z.object({
      state: z.enum(['active', 'inactive', 'unknown']).meta({ description: 'unknown = Keycloak not reachable / not configured (enabling is still possible on the web, disabling is not).' }),
      authenticators: z.array(
        z.object({ id: z.string(), label: z.string().nullable(), createdAt: z.string().nullable().meta({ description: 'ISO 8601' }) }),
      ),
    }),
    manageUrl: z.string().meta({ description: 'Web page "Keamanan akun" (ADR 0017): enabling/disabling 2FA runs there (Keycloak re-login, audited); the APK opens it in the browser.' }),
  })
  .meta({ id: 'MeSecurity' })
