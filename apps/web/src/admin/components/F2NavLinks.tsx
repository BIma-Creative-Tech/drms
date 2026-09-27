import type { Payload, TypedUser } from 'payload'
import Link from 'next/link'
import React from 'react'

import { isStaffOnly, rolesOf } from '@/access/roles'
import { TRANSFER_QUEUE_WHERE } from '@/domain/expense/types'

/**
 * admin.components.afterNavLinks: entries of the F2 work views with badge counts (US-19 "badge
 * jumlah antrian"). Counts respect the user's read access (overrideAccess:false).
 * F2c: staff-only users get the requester shortcuts instead (own requests, new request, profile
 * signature); the approval/finance views are not linked for them. F2d: "Profil & tanda tangan" for
 * every panel role (Owner signs approvals). S3e (S-07): the Antrian Transfer badge counts exactly
 * the transfer queue of the page title (Reimburse receipts waiting for verification are listed in a
 * separate section of the same page, not in the badge).
 */
export async function F2NavLinks({ payload, user }: { payload: Payload; user?: TypedUser }) {
  if (!user) return null
  const roles = rolesOf(user)
  const box: React.CSSProperties = { margin: '12px 0', paddingTop: 8, borderTop: '1px solid var(--theme-elevation-100)' }
  const plain: React.CSSProperties = { display: 'block', padding: '4px 0', textDecoration: 'none' }
  // Creating requests: Staff/PM/Admin/Finance (collection create access, Q-09). The profile (own
  // signature, US-43) is linked for EVERY panel role — Owner approves and needs a signature too.
  const creator = roles.some((r) => r === 'pk-staff' || r === 'pk-pm' || r === 'pk-admin' || r === 'pk-finance')
  const requesterLinks = (
    <>
      {creator ? (
        <Link href="/admin/collections/expense-requests/create" style={plain}>
          + Buat pengajuan
        </Link>
      ) : null}
      <Link href={`/admin/collections/users/${user.id}`} style={plain} data-pk-nav-link="profile">
        Profil &amp; tanda tangan
      </Link>
    </>
  )
  if (isStaffOnly(user)) {
    return (
      <div style={box} data-pk-nav="staff">
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Pengajuan saya</div>
        <Link href="/admin/collections/expense-requests" style={plain}>
          Daftar pengajuan
        </Link>
        {/* E6: own monthly attendance recap (US-09) */}
        <Link href="/admin/absensi/rekap" style={plain} data-pk-nav-link="absensi-saya">
          Rekap absensi saya
        </Link>
        {requesterLinks}
      </div>
    )
  }
  const office = roles.includes('pk-finance') || roles.includes('pk-owner')
  let transfers = 0
  let lpj = 0
  if (office) {
    const [t, l] = await Promise.all([
      payload.count({
        collection: 'expense-requests',
        where: TRANSFER_QUEUE_WHERE, // S3e (S-07): same set as the page title "Antrian Transfer (n)"
        user,
        overrideAccess: false,
      }),
      payload.count({ collection: 'expense-requests', where: { status: { in: ['lpj_submitted', 'lpj_verified'] } }, user, overrideAccess: false }),
    ])
    transfers = t.totalDocs
    lpj = l.totalDocs
  }
  const link: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', textDecoration: 'none' }
  const pill: React.CSSProperties = { background: 'var(--pk-tone-bad)', color: '#FFFFFF', borderRadius: 10, padding: '0 7px', fontSize: 11, fontWeight: 700 }
  return (
    <div style={box}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Alur kerja</div>
      {office ? (
        // ADR 0013: decisions are Direktur/Finance only — the PM monitors (team list, dashboard, reports).
        <Link href="/admin/persetujuan" style={link}>
          Persetujuan
        </Link>
      ) : null}
      {office ? (
        <>
          <Link href="/admin/antrian-transfer" style={link}>
            Antrian Transfer {transfers > 0 ? <span style={pill}>{transfers}</span> : null}
          </Link>
          <Link href="/admin/verifikasi-lpj" style={link}>
            Verifikasi LPJ {lpj > 0 ? <span style={pill}>{lpj}</span> : null}
          </Link>
          {/* E2: cash book + period close (Finance writes, Direktur = pk-owner reads / re-opens) */}
          <Link href="/admin/kas" style={link} data-pk-nav-link="kas">
            Kas
          </Link>
          <Link href="/admin/tutup-buku" style={link} data-pk-nav-link="tutup-buku">
            Tutup buku
          </Link>
        </>
      ) : null}
      {/* S2 web A: E4 progress (Direktur/Finance all, PM team) + E5 Addendum RAB (PM submits, Direktur/Finance decide) */}
      {office || roles.includes('pk-pm') ? (
        <>
          <Link href="/admin/progress" style={link} data-pk-nav-link="progress">
            Progress project
          </Link>
          <Link href="/admin/progress/laporan" style={link} data-pk-nav-link="laporan-progress">
            Laporan progress
          </Link>
          <Link href="/admin/addendum" style={link} data-pk-nav-link="addendum">
            Addendum RAB
          </Link>
        </>
      ) : null}
      {/* F3: reports (Finance/Owner all, PM team) and the global audit log (Owner/Admin/Finance, Q-F3-4) */}
      {/* S3e (S-23): Admin gets the attendance report (only report besides the audit log) */}
      {office || roles.includes('pk-pm') || roles.includes('pk-admin') ? (
        <Link href="/admin/laporan" style={link} data-pk-nav-link="laporan">
          Laporan
        </Link>
      ) : null}
      {/* E6: attendance (Tim hari ini, rekap, jadwal) — PM team, office roles + Admin all */}
      {office || roles.includes('pk-pm') || roles.includes('pk-admin') ? (
        <Link href="/admin/absensi" style={link} data-pk-nav-link="absensi">
          Absensi
        </Link>
      ) : null}
      {office || roles.includes('pk-admin') ? (
        <Link href="/admin/audit-log" style={link} data-pk-nav-link="audit-log">
          Audit Log
        </Link>
      ) : null}
      {requesterLinks}
    </div>
  )
}

export default F2NavLinks
