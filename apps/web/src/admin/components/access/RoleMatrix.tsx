'use client'

import { useRouter } from 'next/navigation'
import React, { useMemo, useRef, useState } from 'react'

import { ROLE_LABELS, type Role } from '@/access/roles'

import { problemText } from '../ActionButton'
import { MultiSelect } from '../list/MultiSelect'
import { newIdemKey } from '../kas/client'
import {
  batchBody,
  batchErrors,
  canEditCompany,
  cellKey,
  coverageWarnings,
  duplicateEmployees,
  effectiveCells,
  employeeChoices,
  forbiddenOps,
  isChanged,
  lockOwner,
  newCell,
  pendingOps,
  reasonOk,
  REASON_MIN,
  ROLE_SHORT,
  roleOptionsFor,
  setEmployee,
  setRoles,
  type CellDraft,
  type MatrixCell,
  type MatrixCompany,
  type MatrixEmployee,
  type MatrixUser,
  type Viewer,
} from './role-matrix'

/**
 * Client part of the role matrix (/admin/akses-pt, wireframe §2). Edits are local drafts until
 * "Simpan" (reason required); then ONE call `POST /api/v1/company-memberships/batch` (mc2-contract §8,
 * Idempotency-Key): all-or-nothing in one transaction ("tidak ada simpan sebagian"), audit
 * `create` / `role_change` rows carry the reason. A refused batch saves nothing; the server's
 * `errors[].path = items.<i>` marks the cell, every draft stays for correction. Cells outside the
 * viewer's rights are refused client-side before anything is sent; the server re-checks everything.
 */
type Props = {
  companies: MatrixCompany[]
  users: MatrixUser[]
  cells: MatrixCell[]
  employees: MatrixEmployee[]
  activeUserIds: number[]
  viewer: Viewer
  narrowed: boolean
}

export function RoleMatrix({ companies, users, cells, employees, activeUserIds, viewer, narrowed }: Props) {
  const router = useRouter()
  const stored = useMemo(() => new Map(cells.map((c) => [cellKey(c.user, c.company), c])), [cells])
  const [drafts, setDrafts] = useState<Map<string, CellDraft>>(new Map())
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const idemKey = useRef<string | undefined>(undefined)

  const eff = useMemo(() => effectiveCells(stored, drafts), [stored, drafts])
  const ops = useMemo(() => pendingOps(drafts, stored), [drafts, stored])
  const warnings = useMemo(() => coverageWarnings(companies, eff.values(), new Set(activeUserIds)), [companies, eff, activeUserIds])
  const dups = useMemo(() => duplicateEmployees(eff.values()), [eff])
  const cols = companies.filter((c) => !hidden.has(c.id))

  const update = (key: string, next: CellDraft) => {
    idemKey.current = undefined // a different body needs a new Idempotency-Key
    setDrafts((d) => new Map(d).set(key, next))
    setMsg(null)
  }
  const editReason = (v: string) => {
    idemKey.current = undefined
    setReason(v)
  }
  const reset = () => {
    setDrafts(new Map())
    setErrors(new Map())
    setMsg(null)
  }

  const save = async () => {
    if (busy || ops.length === 0 || !reasonOk(reason) || dups.length > 0) return
    if (forbiddenOps(ops, viewer).length > 0) {
      setMsg({ tone: 'bad', text: 'Ada perubahan di PT yang bukan hak Anda — tidak ada yang disimpan.' })
      return
    }
    setBusy(true)
    setMsg(null)
    setErrors(new Map())
    if (!idemKey.current) idemKey.current = newIdemKey()
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
      if (idemKey.current) headers['Idempotency-Key'] = idemKey.current
      const res = await fetch('/api/v1/company-memberships/batch', { method: 'POST', credentials: 'same-origin', headers, body: JSON.stringify(batchBody(ops, reason)) })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        idemKey.current = undefined
        setDrafts(new Map())
        setReason('')
        setMsg({ tone: 'ok', text: `${ops.length} perubahan tersimpan.` })
        router.refresh()
      } else {
        // all-or-nothing: nothing saved, every draft stays; a changed body next time needs a new key
        idemKey.current = undefined
        const { cells, general } = batchErrors(data, ops)
        setErrors(cells)
        const head = res.status === 403 ? 'Anda tidak berhak mengubah akses di salah satu PT.' : cells.size > 0 ? 'Periksa sel bertanda merah.' : problemText(data, res.status)
        setMsg({ tone: 'bad', text: `Tidak ada yang disimpan — ${head}${general.length ? ` ${general.join('; ')}` : ''}` })
      }
    } catch {
      // network: same key on retry (the server replays a stored success, never saves twice)
      setMsg({ tone: 'bad', text: 'Gagal menghubungi server. Coba lagi — permintaan yang sama tidak akan tercatat dua kali.' })
    } finally {
      setBusy(false)
    }
  }

  if (companies.length === 0) {
    return <p className="pk-empty">{narrowed ? 'Tidak ada PT yang Anda kelola dalam pilihan PT saat ini. Ubah pilihan di pemilih PT.' : 'Anda belum menjadi Admin PT mana pun.'}</p>
  }

  return (
    <div className="pk-rmx" data-pk-role-matrix>
      <fieldset className="pk-rmx__cols">
        <legend>Kolom PT</legend>
        {companies.map((c) => (
          <label key={c.id} className="pk-rmx__col" title={c.name}>
            <input
              type="checkbox"
              checked={!hidden.has(c.id)}
              onChange={() => setHidden((h) => (h.has(c.id) ? new Set([...h].filter((x) => x !== c.id)) : new Set(h).add(c.id)))}
              data-pk-col-toggle={c.shortCode}
            />
            {c.shortCode}
          </label>
        ))}
      </fieldset>

      {warnings.length > 0 ? (
        <div className="pk-rmx__warn" role="status" data-pk-coverage-warning>
          {warnings.map((w) => (
            <p key={w}>
              <span aria-hidden="true">▲ </span>
              {w}
            </p>
          ))}
        </div>
      ) : null}

      {users.length === 0 ? (
        <p className="pk-empty">Belum ada pengguna. Tambah dengan + Pengguna baru.</p>
      ) : (
        <div className="pk-scroll pk-rmx__scroll">
          <table className="pk-table pk-rmx__table">
            <caption className="pk-rmx__sr">Peran pengguna per PT</caption>
            <thead>
              <tr>
                <th scope="col">Pengguna</th>
                {cols.map((c) => (
                  <th key={c.id} scope="col" data-pk-col={c.shortCode}>
                    <span className="pk-pt-chip">{c.shortCode}</span> <span className="pk-rmx__cname">{c.name}</span>
                  </th>
                ))}
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} data-pk-user-row={u.id}>
                  <th scope="row" className="pk-rmx__user">
                    <a href={`/admin/pengguna/${u.id}`}>{u.name || u.email}</a>
                    <span className="pk-rmx__email">{u.email}</span>
                  </th>
                  {cols.map((c) => {
                    const key = cellKey(u.id, c.id)
                    const cell = eff.get(key)
                    const editable = canEditCompany(viewer, c.id)
                    return (
                      <td key={c.id} data-label={`${c.shortCode} — ${c.name}`} data-changed={cell && isChanged(cell, stored.get(key)) ? '' : undefined} data-error={errors.has(key) ? '' : undefined} data-pk-cell={`${u.id}:${c.shortCode}`}>
                        {cell ? (
                          <Cell
                            cell={cell}
                            user={u}
                            company={c}
                            editable={editable && !busy}
                            choices={employeeChoices(employees, eff.values(), c.id, u.id, cell.employee)}
                            onChange={(next) => update(key, next)}
                            duplicate={cell.employee !== null && dups.includes(`${c.id}:${cell.employee}`)}
                            groupAdmin={viewer.groupAdmin}
                          />
                        ) : (
                          <div className="pk-rmx__none">
                            <span>bukan anggota</span>
                            {editable ? (
                              <button type="button" className="pk-rmx__add" onClick={() => update(key, newCell(u.id, c.id))} disabled={busy} aria-label={`Tambah ${u.name || u.email} ke ${c.shortCode}`}>
                                + Tambah
                              </button>
                            ) : null}
                          </div>
                        )}
                        {errors.has(key) ? (
                          <p className="pk-rmx__err" role="alert">
                            {errors.get(key)}
                          </p>
                        ) : null}
                      </td>
                    )
                  })}
                  <td data-label="Status">
                    <span className={`pk-badge ${u.active ? 'ok' : 'none'}`}>{u.active ? 'Aktif' : 'Nonaktif'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pk-rmx__bar" data-dirty={ops.length > 0 || undefined} aria-live="polite">
        <span className="pk-rmx__count" data-pk-pending={ops.length}>
          {ops.length === 0 ? 'Tidak ada perubahan' : `${ops.length} perubahan belum disimpan`}
        </span>
        <label className="pk-rmx__reason">
          <span>Alasan (wajib)</span>
          <input type="text" value={reason} onChange={(e) => editReason(e.target.value)} maxLength={300} placeholder="mis. mutasi tugas ke CS1" disabled={ops.length === 0 || busy} aria-invalid={ops.length > 0 && !reasonOk(reason)} data-pk-reason />
        </label>
        <button type="button" className="pk-btn primary" onClick={() => void save()} disabled={busy || ops.length === 0 || !reasonOk(reason) || dups.length > 0} data-pk-save>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button type="button" className="pk-btn" onClick={reset} disabled={busy || drafts.size === 0}>
          Batalkan
        </button>
        {ops.length > 0 && !reasonOk(reason) ? <span className="pk-rmx__hint">Alasan minimal {REASON_MIN} karakter.</span> : null}
        {dups.length > 0 ? <span className="pk-rmx__hint pk-rmx__hint--bad">Satu karyawan hanya boleh terhubung ke satu akun per PT.</span> : null}
        {msg ? (
          <span className={`pk-rmx__msg pk-rmx__msg--${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** ADR 0026: the Owner role is offered to group admins only (`roleOptionsFor`). */
const roleOptions = (groupAdmin: boolean, held: readonly Role[]) => roleOptionsFor(groupAdmin, held).map((r) => ({ value: r, label: ROLE_LABELS[r], title: ROLE_SHORT[r] }))

function Cell({
  cell,
  user,
  company,
  editable,
  choices,
  onChange,
  duplicate,
  groupAdmin,
}: {
  cell: CellDraft
  user: MatrixUser
  company: MatrixCompany
  editable: boolean
  choices: MatrixEmployee[]
  onChange: (c: CellDraft) => void
  duplicate: boolean
  groupAdmin: boolean
}) {
  const who = user.name || user.email
  const emp = choices.find((e) => e.id === cell.employee)
  return (
    <div className="pk-rmx__cell" data-inactive={!cell.active || undefined}>
      {/* DRMS 13/10 W3: the roles of the cell as ONE checklist dropdown (was a row of checkboxes) */}
      <div className="pk-rmx__roles" data-pk-roles={`${user.id}:${company.shortCode}`}>
        <MultiSelect
          name={`roles-${user.id}-${company.id}`}
          label={`Peran ${who} di ${company.shortCode}`}
          options={roleOptions(groupAdmin, cell.roles)}
          value={cell.roles}
          allLabel="Pilih peran…"
          onChange={(roles) => onChange(setRoles(cell, lockOwner(roles as Role[], cell.roles, groupAdmin)))}
          disabled={!editable}
          testKey={`roles-${company.shortCode}`}
        />
      </div>
      <div className="pk-rmx__emp">
        <label>
          <span className="pk-rmx__emp-label">Karyawan</span>
          <select value={cell.employee ?? ''} disabled={!editable} onChange={(e) => onChange(setEmployee(cell, e.target.value ? Number(e.target.value) : null))} aria-invalid={duplicate || undefined} data-pk-employee>
            <option value="">– (tanpa)</option>
            {choices.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} {e.name}
                {e.active ? '' : ' (nonaktif)'}
              </option>
            ))}
          </select>
        </label>
        {emp ? (
          <a href={`/admin/collections/employees/${emp.id}`} className="pk-rmx__emp-link" aria-label={`Buka data karyawan ${emp.name}`} title="Buka data karyawan">
            ↗
          </a>
        ) : null}
      </div>
      {!cell.active ? <span className="pk-rmx__state">{cell.id ? 'nonaktif — centang peran untuk mengaktifkan' : 'baru — pilih minimal satu peran'}</span> : null}
    </div>
  )
}

export default RoleMatrix
