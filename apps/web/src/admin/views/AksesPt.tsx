import Link from 'next/link'
import type { AdminViewServerProps, Where } from 'payload'
import React from 'react'

import { companyContextOf, isRole, relId, type Role } from '@/access/roles'

import { RoleMatrix } from '../components/access/RoleMatrix'
import { canUseMatrix, matrixColumns, type MatrixCell, type MatrixCompany, type MatrixEmployee, type MatrixUser, type Viewer } from '../components/access/role-matrix'
import { Frame } from './frame'

/**
 * "Pengguna & akses PT" — role matrix (MC2-4, ADR 0016 §2/§11, wireframe mc/wireframes.md §2):
 * rows = accounts, columns = PTs, cell = the account's `company-memberships` row in that PT (roles,
 * employee of that PT, active). Admin of a PT edits the column of that PT; group admin every PT.
 * Every read here runs with the CALLER's access (overrideAccess:false): users of my PTs (+ accounts
 * without membership), memberships of the PTs where I am Admin, employees of those PTs. Writes go
 * through Payload REST `company-memberships` (client), audited `role_change` server-side.
 * Query: `q` (name/email), `nonaktif=1` (include inactive accounts), `hal` (page).
 */
const PAGE_SIZE = 40

const STYLE = `
.pk-rm h1 { font-family: var(--pk-font-heading); margin: 24px 0 4px; }
.pk-rm .pk-rm__lead { color: var(--pk-muted-fg); margin: 0 0 16px; max-width: 880px; }
.pk-f3 form.pk-filter label.pk-rm__check { flex-direction: row; align-items: center; gap: 6px; min-height: 30px; }
.pk-f3 .pk-rm .pk-btn:disabled { opacity: 0.55; cursor: not-allowed; }
`

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? ''
}

export async function AksesPtView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const ctx = companyContextOf(req.user)
  const viewer: Viewer = {
    groupAdmin: ctx?.groupAdmin === true,
    adminOf: (ctx?.memberships ?? []).filter((m) => m.roles.includes('pk-admin')).map((m) => m.company),
  }
  if (!canUseMatrix(viewer)) {
    return (
      <Frame props={props} name="akses-pt">
        <div className="pk-rm">
          <h1>Pengguna &amp; akses PT</h1>
          <p>Halaman ini hanya untuk Admin PT dan Admin grup.</p>
        </div>
      </Frame>
    )
  }
  const sp = props.searchParams ?? {}
  const q = one(sp.q as string | string[] | undefined).trim().slice(0, 80)
  const withInactive = one(sp.nonaktif as string | string[] | undefined) === '1'
  const page = Math.max(1, Number.parseInt(one(sp.hal as string | string[] | undefined), 10) || 1)
  const user = req.user
  const read = { user, overrideAccess: false as const, req, depth: 0 as const }

  // PT columns: active PTs the caller may administer, narrowed to the switcher selection
  const companiesRes = await req.payload.find({ collection: 'companies', where: { active: { equals: true } }, sort: 'shortCode', pagination: false, select: { shortCode: true, name: true }, ...read })
  const all: MatrixCompany[] = companiesRes.docs.map((c) => ({ id: c.id as number, shortCode: String(c.shortCode), name: String(c.name ?? '') }))
  const memberIds = (ctx?.memberships ?? []).map((m) => m.company)
  const narrowed = ctx && ctx.selected.length < memberIds.length ? ctx.selected : null
  const columns = matrixColumns(all, viewer, narrowed)
  const colIds = columns.map((c) => c.id)

  // rows: accounts the caller can read (Payload access), searchable, paginated
  const and: Where[] = []
  if (!withInactive) and.push({ active: { equals: true } })
  if (q) and.push({ or: [{ name: { like: q } }, { email: { like: q } }] })
  const usersRes = await req.payload.find({
    collection: 'users',
    where: and.length ? { and } : {},
    sort: 'name',
    limit: PAGE_SIZE,
    page,
    select: { name: true, email: true, active: true },
    ...read,
  })
  const users: MatrixUser[] = usersRes.docs.map((u) => ({ id: u.id as number, name: String(u.name ?? ''), email: String(u.email ?? ''), active: u.active !== false }))

  // every membership of the column PTs (warnings + "employee already linked" need the whole PT)
  const cellsRes = colIds.length
    ? await req.payload.find({ collection: 'company-memberships', where: { company: { in: colIds } }, pagination: false, select: { user: true, company: true, roles: true, employee: true, active: true }, ...read })
    : { docs: [] }
  const cells: MatrixCell[] = (cellsRes.docs as unknown as Array<Record<string, unknown>>).map((m) => ({
    id: m.id as number,
    user: relId(m.user) ?? 0,
    company: relId(m.company) ?? 0,
    roles: (Array.isArray(m.roles) ? m.roles.filter(isRole) : []) as Role[],
    employee: relId(m.employee) ?? null,
    active: m.active !== false,
  }))

  // active flag of every account holding a membership there (coverage warnings)
  const holderIds = [...new Set(cells.map((c) => c.user))]
  const holdersRes = holderIds.length
    ? await req.payload.find({ collection: 'users', where: { and: [{ id: { in: holderIds } }, { active: { equals: true } }] }, pagination: false, select: { active: true }, ...read })
    : { docs: [] }
  const activeUserIds = holdersRes.docs.map((u) => u.id as number)

  const employeesRes = colIds.length
    ? await req.payload.find({ collection: 'employees', where: { company: { in: colIds } }, sort: 'code', pagination: false, select: { code: true, name: true, active: true, company: true }, ...read })
    : { docs: [] }
  const employees: MatrixEmployee[] = (employeesRes.docs as unknown as Array<Record<string, unknown>>).map((e) => ({
    id: e.id as number,
    company: relId(e.company) ?? 0,
    code: String(e.code ?? ''),
    name: String(e.name ?? ''),
    active: e.active !== false,
  }))

  const pageHref = (p: number) => {
    const u = new URLSearchParams()
    if (q) u.set('q', q)
    if (withInactive) u.set('nonaktif', '1')
    if (p > 1) u.set('hal', String(p))
    const s = u.toString()
    return `/admin/akses-pt${s ? `?${s}` : ''}`
  }

  return (
    <Frame props={props} name="akses-pt">
      <style>{STYLE}</style>
      <div className="pk-rm">
        <h1>Pengguna &amp; akses PT</h1>
        <p className="pk-rm__lead">
          Satu sel = peran satu pengguna di satu PT, plus data karyawannya di PT itu. Anda dapat mengubah kolom PT tempat Anda Admin
          {viewer.groupAdmin ? ' (Admin grup: semua PT)' : ''}. Mengosongkan semua peran menonaktifkan keanggotaan (riwayat tetap). Setiap perubahan tercatat di audit log
          dengan alasan.
        </p>
        <form className="pk-filter" method="get" action="/admin/akses-pt" role="search" aria-label="Cari pengguna">
          <label>
            Cari nama / email
            <input type="search" name="q" defaultValue={q} placeholder="mis. rina" maxLength={80} />
          </label>
          <label className="pk-rm__check">
            <input type="checkbox" name="nonaktif" value="1" defaultChecked={withInactive} /> tampilkan akun nonaktif
          </label>
          <button type="submit" className="pk-btn">
            Terapkan
          </button>
          <Link className="pk-btn" href="/admin/collections/users/create" data-pk-invite>
            + Undang pengguna
          </Link>
        </form>
        <RoleMatrix
          companies={columns}
          users={users}
          cells={cells}
          employees={employees}
          activeUserIds={activeUserIds}
          viewer={viewer}
          narrowed={narrowed !== null}
        />
        {usersRes.totalPages > 1 ? (
          <nav className="pk-actions" aria-label="Halaman pengguna">
            {usersRes.hasPrevPage ? (
              <a className="pk-btn" href={pageHref(page - 1)}>
                ‹ Sebelumnya
              </a>
            ) : null}
            <span>
              Halaman {usersRes.page} dari {usersRes.totalPages} · {usersRes.totalDocs} pengguna
            </span>
            {usersRes.hasNextPage ? (
              <a className="pk-btn" href={pageHref(page + 1)}>
                Berikutnya ›
              </a>
            ) : null}
          </nav>
        ) : null}
      </div>
    </Frame>
  )
}

export default AksesPtView
