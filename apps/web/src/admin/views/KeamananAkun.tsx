import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { getTwoFactorStatus, isTwoFactorResult, RESULT_MESSAGES } from '@/auth/two-factor'
import { DEFAULT_TZ } from '@/lib/time'

import { ConfirmSubmit, SecurityResult } from '../components/security/SecurityFeedback'
import { TwoFactorDisable } from '../components/security/TwoFactorDisable'
import { Frame, PageHead } from './frame'
import { dateTimeId } from './progress-ui'

/**
 * "Keamanan akun" (ADR 0017, optional self-service 2FA): every logged-in user, for their OWN account
 * only (avatar menu → here). Status from Keycloak (Admin API, metadata only); "Aktifkan 2FA" /
 * "Nonaktifkan 2FA" post to /auth/account-action → Keycloak application-initiated action → back here
 * with ?status=. Nothing on this page is admin-enforced; the server re-checks every action.
 */
const STYLE = `
.pk-sec { max-width: 720px; }
.pk-sec .pk-sec__card { background: var(--pk-card); border: 1px solid color-mix(in oklab, var(--pk-border) 80%, transparent); border-radius: var(--style-radius-l); box-shadow: var(--pk-shadow); padding: 18px 20px; margin: 0 0 16px; }
.pk-sec .pk-sec__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 8px; }
.pk-sec .pk-sec__head h2, .pk-sec .pk-sec__card > h2 { font-size: 15px; font-weight: 600; line-height: 1.3; margin: 0; }
.pk-sec .pk-sec__card > h2 { margin: 0 0 6px; }
/* D2510: soft badge (Nexus kit) — the tone token as text on its own 14 % tint */
.pk-sec .pk-sec__state { display: inline-flex; align-items: center; gap: 6px; min-height: 22px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; background: color-mix(in oklab, currentColor 14%, var(--pk-card)); }
.pk-sec .pk-sec__state[data-state="active"] { color: var(--pk-tone-ok-text); }
.pk-sec .pk-sec__state[data-state="inactive"] { color: var(--pk-muted-fg); }
.pk-sec .pk-sec__state[data-state="unknown"] { color: var(--pk-tone-warn-text); }
.pk-sec .pk-sec__list { list-style: none; margin: 12px 0 0; padding: 0; }
.pk-sec .pk-sec__list li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--pk-border); }
.pk-sec .pk-sec__meta { color: var(--pk-muted-fg); font-size: 12px; }
.pk-sec .pk-sec__msg { border-radius: var(--style-radius-m); padding: 10px 14px; margin: 0 0 16px; border: 1px solid color-mix(in oklab, currentColor 35%, var(--pk-border)); background: color-mix(in oklab, currentColor 8%, var(--pk-card)); font-weight: 600; }
.pk-sec .pk-sec__msg[data-tone="ok"] { color: var(--pk-tone-ok-text); }
.pk-sec .pk-sec__msg[data-tone="warn"] { color: var(--pk-tone-warn-text); }
.pk-sec .pk-sec__msg[data-tone="bad"] { color: var(--pk-tone-bad-text); }
.pk-sec ol.pk-sec__steps { margin: 8px 0 14px; padding-left: 20px; }
.pk-sec ul.pk-sec__tips { margin: 0; padding-left: 20px; }
.pk-sec ol.pk-sec__steps li { margin: 2px 0; }
.pk-sec .pk-btn--danger { background: var(--pk-tone-bad); border-color: var(--pk-tone-bad); color: #FFFFFF; }
.pk-sec .pk-btn--danger:hover { color: #FFFFFF; filter: brightness(0.95); }
.pk-sec .pk-btn:disabled { opacity: 0.6; cursor: progress; }
`

const STATE_LABEL = { active: '2FA aktif', inactive: '2FA nonaktif', unknown: 'Status tidak diketahui' } as const
const STATE_ICON = { active: '●', inactive: '○', unknown: '▲' } as const

export async function KeamananAkunView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const user = req.user as { id: number; email?: string | null; keycloakSub?: string | null } | null
  if (!user) return null
  const status = await getTwoFactorStatus(user.keycloakSub, req.payload.logger)
  const raw = (props.searchParams ?? {}).status
  const result = isTwoFactorResult(raw) ? RESULT_MESSAGES[raw] : null
  const tz = process.env.TZ || DEFAULT_TZ
  return (
    <Frame props={props} name="keamanan-akun">
      <style>{STYLE}</style>
      <PageHead
        props={props}
        title="Keamanan akun"
        note={
          <>
            Pengaturan ini hanya untuk akun Anda sendiri{user.email ? <> ({user.email})</> : null}. 2FA bersifat pilihan: Anda yang memutuskan untuk
            mengaktifkan atau menonaktifkannya.
          </>
        }
      />
      <div className="pk-sec">
        {result ? (
          <div className="pk-sec__msg" data-tone={result.tone} role={result.tone === 'bad' ? 'alert' : 'status'} data-pk-2fa-result={String(raw)}>
            {result.text}
            {/* DRMS 24/10: the outcome also as the result popup */}
            <SecurityResult ok={result.tone === 'ok'} title={raw === 'enabled' ? 'Berhasil: aktifkan 2FA' : raw === 'disabled' ? 'Berhasil: nonaktifkan 2FA' : raw === 'cancelled' ? 'Dibatalkan' : 'Gagal: ubah 2FA'} message={result.text} />
          </div>
        ) : null}

        <section className="pk-sec__card" aria-labelledby="pk-sec-2fa">
          <div className="pk-sec__head">
            <h2 id="pk-sec-2fa">Verifikasi dua langkah (2FA)</h2>
            <span className="pk-sec__state" data-state={status.state} data-pk-2fa-state={status.state}>
              <span aria-hidden="true">{STATE_ICON[status.state]}</span>
              {STATE_LABEL[status.state]}
            </span>
          </div>

          {status.state === 'active' ? (
            <>
              <p>Setiap login di web dan aplikasi Android meminta kode 6 digit dari aplikasi autentikator Anda setelah kata sandi.</p>
              <ul className="pk-sec__list" aria-label="Autentikator terdaftar">
                {status.authenticators.map((c) => {
                  const label = c.userLabel ?? 'Aplikasi autentikator'
                  return (
                    <li key={c.id} data-pk-2fa-authenticator>
                      <span>
                        <strong>{label}</strong>
                        <br />
                        <span className="pk-sec__meta">Didaftarkan {c.createdDate ? `${dateTimeId(new Date(c.createdDate).toISOString(), tz)} WITA` : '—'}</span>
                      </span>
                      <TwoFactorDisable credentialId={c.id} label={label} />
                    </li>
                  )
                })}
              </ul>
            </>
          ) : status.state === 'inactive' ? (
            <>
              <p>Dengan 2FA, login juga meminta kode 6 digit dari aplikasi autentikator di HP Anda — kata sandi yang bocor saja tidak cukup untuk masuk.</p>
              <ol className="pk-sec__steps">
                <li>Pasang aplikasi autentikator di HP (mis. Google Authenticator, Microsoft Authenticator, atau FreeOTP).</li>
                <li>Tekan <strong>Aktifkan 2FA</strong>. Anda diminta login ulang, lalu memindai kode QR di halaman login.</li>
                <li>Masukkan kode 6 digit dari aplikasi dan beri nama perangkat (mis. &quot;HP pribadi&quot;).</li>
              </ol>
              <form method="post" action="/auth/account-action" data-pk-2fa-enable>
                <input type="hidden" name="action" value="enable" />
                <ConfirmSubmit className="pk-btn primary" action="Aktifkan 2FA" description="Anda diminta login ulang lalu memindai kode QR dengan aplikasi autentikator.">
                  Aktifkan 2FA
                </ConfirmSubmit>
              </form>
            </>
          ) : (
            <>
              <p>Status 2FA tidak dapat diperiksa saat ini (server login tidak terjangkau atau belum dikonfigurasi). Anda tetap dapat mengaktifkan 2FA; menonaktifkan hanya bisa setelah status terbaca.</p>
              <form method="post" action="/auth/account-action" data-pk-2fa-enable>
                <input type="hidden" name="action" value="enable" />
                <ConfirmSubmit className="pk-btn" action="Aktifkan 2FA" description="Anda diminta login ulang lalu memindai kode QR dengan aplikasi autentikator.">
                  Aktifkan 2FA
                </ConfirmSubmit>
              </form>
            </>
          )}
        </section>

        <section className="pk-sec__card" aria-labelledby="pk-sec-tips">
          <h2 id="pk-sec-tips">Perlu diketahui</h2>
          <ul className="pk-sec__tips">
            <li>Aplikasi Android: bila 2FA aktif, isi kolom &quot;Kode autentikator&quot; yang muncul setelah login pertama gagal.</li>
            <li>HP hilang atau aplikasi autentikator terhapus? Hubungi Admin untuk mereset 2FA akun Anda.</li>
            <li>Setiap perubahan 2FA dicatat di audit log.</li>
          </ul>
        </section>
      </div>
    </Frame>
  )
}

export default KeamananAkunView
