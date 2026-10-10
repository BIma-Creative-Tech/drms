import Link from 'next/link'
import type { PayloadRequest, UIFieldServerProps } from 'payload'
import React from 'react'

import { hasRole, relId } from '@/access/roles'
import { Icon } from '@/admin/modules/Icon'

/** One row of "Karyawan per PT": a membership of the user as the VIEWER may see it. */
export type EmployeeLinkRow = {
  company: number
  companyLabel: string
  active: boolean
  /** `readable` false = linked to an employee the viewer may not read (shown without a link). */
  employee: { id: number; code: string; name: string; readable: boolean } | null
  /** The viewer may create an employee in this PT (Admin of the PT) → "Buat karyawan" button. */
  canCreate: boolean
}

/**
 * Rows of the panel, read with the VIEWER's access (overrideAccess: false): memberships = own rows /
 * Admin of that PT / group admin (CompanyMemberships read); employees and PTs = their own read access
 * (an unreadable PT shows its id, an unreadable employee its id).
 */
export async function employeeLinksOf(req: PayloadRequest, userId: number): Promise<EmployeeLinkRow[]> {
  const ms = await req.payload.find({
    collection: 'company-memberships',
    where: { user: { equals: userId } },
    depth: 0,
    pagination: false,
    sort: 'company',
    select: { company: true, employee: true, active: true },
    user: req.user,
    overrideAccess: false,
    req,
  })
  const rows = ms.docs as unknown as Array<{ company?: unknown; employee?: unknown; active?: unknown }>
  if (rows.length === 0) return []
  const companyIds = [...new Set(rows.map((m) => relId(m.company)).filter((x): x is number => x !== undefined))]
  const employeeIds = [...new Set(rows.map((m) => relId(m.employee)).filter((x): x is number => x !== undefined))]
  const [companies, employees] = await Promise.all([
    req.payload.find({ collection: 'companies', where: { id: { in: companyIds } }, depth: 0, pagination: false, select: { shortCode: true, name: true }, user: req.user, overrideAccess: false, req }),
    employeeIds.length === 0
      ? Promise.resolve({ docs: [] as unknown[] })
      : req.payload.find({ collection: 'employees', where: { id: { in: employeeIds } }, depth: 0, pagination: false, select: { code: true, name: true }, user: req.user, overrideAccess: false, req }),
  ])
  const cLabel = new Map((companies.docs as unknown as Array<{ id: number; shortCode?: string | null; name?: string | null }>).map((c) => [c.id, c.shortCode || c.name || `PT #${c.id}`]))
  const emp = new Map((employees.docs as unknown as Array<{ id: number; code?: string | null; name?: string | null }>).map((e) => [e.id, e]))
  return rows.flatMap((m) => {
    const company = relId(m.company)
    if (company === undefined) return []
    const eid = relId(m.employee)
    const e = eid !== undefined ? emp.get(eid) : undefined
    return [
      {
        company,
        companyLabel: cLabel.get(company) ?? `PT #${company}`,
        active: m.active !== false,
        employee: eid === undefined ? null : { id: eid, code: e?.code ?? '', name: e?.name ?? `Karyawan #${eid}`, readable: e !== undefined },
        canCreate: hasRole(req, 'pk-admin', company),
      },
    ]
  })
}

const muted: React.CSSProperties = { color: 'var(--theme-elevation-700)', fontSize: 13 }
const cell: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid var(--theme-elevation-100)', textAlign: 'left', verticalAlign: 'middle' }

/**
 * User form "Karyawan per PT" (owner decision 2026-10-10): read-only overview of the account's PT
 * accesses and the employee each is linked to — "Buka" opens the employee, "Buat karyawan" opens the
 * employee create form with this PT and this account prefilled. The link itself is edited on the
 * employee form ("Akun pengguna") or in Akses PT.
 */
export async function EmployeeLinksPanel(props: UIFieldServerProps) {
  const { req, id } = props
  const userId = Number(id)
  const head = (
    <>
      <div className="field-label" id="pk-employee-links-label">
        Karyawan per PT
      </div>
      <p style={{ ...muted, margin: '0 0 8px' }}>
        Data karyawan yang tertaut ke akun ini di tiap PT (dibutuhkan untuk absensi di APK/web). Ubah tautan di form Karyawan, isian <em>Akun pengguna</em>.
      </p>
    </>
  )
  if (!id || !Number.isSafeInteger(userId) || !req.user) {
    return (
      <div className="field-type" data-pk-employee-links="new" style={{ marginBottom: 24 }}>
        {head}
        <p style={muted}>Simpan pengguna ini dulu dan beri akses PT (menu Akses PT); setelah itu karyawannya dapat ditautkan.</p>
      </div>
    )
  }
  let rows: EmployeeLinkRow[]
  try {
    rows = await employeeLinksOf(req, userId)
  } catch (err) {
    req.payload.logger.error({ msg: 'employee links panel failed', id: userId, err: (err as Error).message })
    return null
  }
  return (
    <div className="field-type" data-pk-employee-links={userId} style={{ marginBottom: 24 }}>
      {head}
      {rows.length === 0 ? (
        <p style={muted} data-pk-employee-links-empty>
          Belum ada akses PT yang dapat Anda lihat untuk akun ini.
        </p>
      ) : (
        <table aria-labelledby="pk-employee-links-label" style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 720, fontSize: 14 }}>
          <thead>
            <tr>
              <th scope="col" style={cell}>
                PT
              </th>
              <th scope="col" style={cell}>
                Karyawan
              </th>
              <th scope="col" style={cell}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
                  Aksi
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const label = r.employee ? [r.employee.code, r.employee.name].filter(Boolean).join(' — ') : ''
              return (
                <tr key={r.company} data-pk-employee-link={r.company}>
                  <th scope="row" style={{ ...cell, fontWeight: 600 }}>
                    {r.companyLabel}
                    {r.active ? null : <span style={{ ...muted, fontWeight: 400 }}> (akses nonaktif)</span>}
                  </th>
                  <td style={cell}>{r.employee ? label : <span style={muted}>Belum tertaut</span>}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>
                    {r.employee?.readable ? (
                      <Link href={`/admin/collections/employees/${r.employee.id}`} prefetch={false} className="pk-row-act" aria-label={`Buka karyawan ${label} (PT ${r.companyLabel})`} data-pk-row-action="open">
                        <Icon name="eye" size={16} />
                        <span>Buka</span>
                      </Link>
                    ) : !r.employee && r.canCreate && r.active ? (
                      <Link
                        href={`/admin/collections/employees/create?company=${r.company}&user=${userId}`}
                        prefetch={false}
                        className="pk-row-act"
                        data-kind="edit"
                        aria-label={`Buat karyawan untuk akun ini di PT ${r.companyLabel}`}
                        data-pk-row-action="create-employee"
                      >
                        <Icon name="add" size={16} />
                        <span>Buat karyawan</span>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default EmployeeLinksPanel
