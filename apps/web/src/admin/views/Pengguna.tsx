import Link from 'next/link'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { isGroupAdmin, userId } from '@/access/roles'
import { loadUserOnboarding, mayOnboard, OnboardingError } from '@/domain/user-onboarding/service'

import { UserOnboardingForm } from '../components/users/UserOnboardingForm'
import { Frame, PageHead } from './frame'
import { NoAccess } from './NoAccess'

/**
 * DRMS 13/10 Wave 3 — "Pengguna" (create `/admin/pengguna/baru`, edit `/admin/pengguna/<id>`): ONE tabbed form for
 * the account, its access per PT, the employee per PT and the employee's bank accounts (UserOnboardingForm), saved
 * by `/api/v1/user-onboarding` in one transaction. Entry point of the users list ("Buat baru", row click) for Admins
 * of a PT / group admins (same gate as the Akses PT matrix); everyone else keeps Payload's own user form (profile +
 * signature). Reads run with the caller's access (domain/user-onboarding/service.ts).
 */
export async function PenggunaView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!mayOnboard(req)) return <NoAccess props={props} />
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[1] ?? ''
  const create = seg === 'baru'
  const id = /^[1-9]\d{0,9}$/.test(seg) ? Number(seg) : null
  const back = (
    <Link className="pk-kbtn" href="/admin/collections/users">
      ← Pengguna
    </Link>
  )
  const detail = create || id !== null ? await loadUserOnboarding(req, create ? null : id).catch((err) => (err instanceof OnboardingError ? null : Promise.reject(err))) : null
  if (!detail) {
    return (
      <Frame props={props} name="pengguna">
        <PageHead props={props} title="Pengguna tidak ditemukan" note="Pengguna ini tidak ada atau bukan pengguna PT Anda.">
          {back}
        </PageHead>
      </Frame>
    )
  }
  const u = detail.user
  return (
    <Frame props={props} name="pengguna">
      <PageHead props={props}
        title={create ? 'Pengguna baru' : u?.name || u?.email || 'Pengguna'}
        note={create ? 'Akun login, akses per PT, data karyawan dan rekening — disimpan sekaligus.' : u?.email}
      >
        <div className="pk-kact">
          {u ? (
            <>
              <span className={`pk-badge ${u.active ? 'ok' : 'none'}`}>{u.active ? 'Aktif' : 'Nonaktif'}</span>
              {u.groupAdmin ? <span className="pk-badge">Admin grup</span> : null}
              <Link className="pk-kbtn sm" href={`/admin/collections/users/${u.id}`} prefetch={false}>
                Form akun (tanda tangan, Admin grup) ↗
              </Link>
            </>
          ) : null}
          {back}
        </div>
      </PageHead>
      <UserOnboardingForm key={u?.id ?? 'baru'} mode={create ? 'create' : 'update'} detail={detail} self={u !== null && u.id === userId(req)} groupAdmin={isGroupAdmin(req)} />
    </Frame>
  )
}

export default PenggunaView
