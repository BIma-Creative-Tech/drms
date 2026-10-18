import type { Payload } from 'payload'

import { getKeycloakAdmin, type OtpCredential } from './keycloak-admin'

/** 2FA state of one account (ADR 0017): the web "Keamanan akun" page and GET /api/v1/me/security. */
export type TwoFactorStatus =
  | { state: 'active'; authenticators: OtpCredential[] }
  | { state: 'inactive'; authenticators: [] }
  | { state: 'unknown'; authenticators: [] }

/** Status from Keycloak (Admin API, metadata only). Never throws: unreachable/not configured → unknown. */
export async function getTwoFactorStatus(keycloakSub: string | null | undefined, log?: Payload['logger']): Promise<TwoFactorStatus> {
  if (!keycloakSub) return { state: 'unknown', authenticators: [] }
  try {
    const creds = await getKeycloakAdmin().listUserCredentials(keycloakSub)
    return creds.length > 0 ? { state: 'active', authenticators: creds } : { state: 'inactive', authenticators: [] }
  } catch (err) {
    log?.warn({ msg: '2fa status unavailable', err: (err as Error).message })
    return { state: 'unknown', authenticators: [] }
  }
}
