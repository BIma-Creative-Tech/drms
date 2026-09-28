'use client'

import { useRouter } from 'next/navigation'
import React, { useMemo, useState } from 'react'

import { ROLES, ROLE_LABELS } from '@/access/roles'

import { problemText } from '../ActionButton'
import {
  canEditCompany,
  cellKey,
  coverageWarnings,
  duplicateEmployees,
  effectiveCells,
  employeeChoices,
  forbiddenOps,
  isChanged,
  newCell,
  pendingOps,
  reasonOk,
  REASON_MIN,
  ROLE_SHORT,
  setEmployee,
  toggleRole,
  type CellDraft,
  type MatrixCell,
  type MatrixCompany,
  type MatrixEmployee,
  type MatrixUser,
  type Viewer,
} from './role-matrix'

/**
 * Client part of the role matrix (/admin/akses-pt, wireframe §2). Edits are local drafts until
 * "Simpan" (reason required); then one REST call per changed cell: PATCH/POST
 * /api/company-memberships (+ `changeReason` → audit `role_change`). Cells outside the viewer's
 * rights are never sent (no partial save of forbidden cells); the server re-checks everything.
 * TODO(mc2-contract): one atomic batch endpoint ("tidak ada simpan sebagian") — until then a failed
 * cell keeps its draft + error while the others are saved.
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

  const eff = useMemo(() => effectiveCells(stored, drafts), [stored, drafts])
  const ops = useMemo(() => pendingOps(drafts, stored), [drafts, stored])
  const warnings = useMemo(() => coverageWarnings(companies, eff.values(), new Set(activeUserIds)), [companies, eff, activeUserIds])
  const dups = useMemo(() => duplicateEmployees(eff.values()), [eff])
  const cols = companies.filter((c) => !hidden.has(c.id))

  const update = (key: string, next: CellDraft) => {
    setDrafts((d) => new Map(d).set(key, next))
    setMsg(null)
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
    const failed = new Map<string, string>()
    const remaining = new Map(drafts)
    for (const op of ops) {
      const url = op.kind === 'create' ? '/api/company-memberships?depth=0' : `/api/company-memberships/${op.id}?depth=0`
      try {
        const res = await fetch(url, {
          method: op.kind === 'create' ? 'POST' : 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ ...op.body, changeReason: reason.trim() }),
        })
        if (res.ok) remaining.delete(op.key)
        else failed.set(op.key, payloadError(await res.json().catch(() => null), res.status))
      } catch {
        failed.set(op.key, 'Gagal menghubungi server.')
      }
    }
    setErrors(failed)
    setBusy(false)
    const saved = ops.length - failed.size
    if (failed.size === 0) {
      setDrafts(new Map())
      setReason('')
      setMsg({ tone: 'ok', text: `${saved} perubahan tersimpan.` })
    } else {
      setDrafts(remaining)
      setMsg({ tone: 'bad', text: `${saved} tersimpan, ${failed.size} gagal — lihat sel bertanda merah.` })
    }
    router.refresh()
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
        <p className="pk-empty">Belum ada pengguna. Tambah dengan + Undang pengguna.</p>
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
                    <a href={`/admin/collections/users/${u.id}`}>{u.name || u.email}</a>
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
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="mis. mutasi tugas ke CS1" disabled={ops.length === 0 || busy} aria-invalid={ops.length > 0 && !reasonOk(reason)} data-pk-reason />
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

function payloadError(data: unknown, status: number): string {
  const p = (data ?? {}) as { errors?: Array<{ message?: string; data?: { errors?: Array<{ message?: string }> } }> }
  const inner = p.errors?.flatMap((e) => e.data?.errors?.map((x) => x.message ?? '') ?? [e.message ?? '']).filter(Boolean) ?? []
  if (inner.length) return inner.join('; ')
  if (status === 403) return 'Anda tidak berhak mengubah akses di PT ini.'
  return problemText(data, status)
}

function Cell({
  cell,
  user,
  company,
  editable,
  choices,
  onChange,
  duplicate,
}: {
  cell: CellDraft
  user: MatrixUser
  company: MatrixCompany
  editable: boolean
  choices: MatrixEmployee[]
  onChange: (c: CellDraft) => void
  duplicate: boolean
}) {
  const who = user.name || user.email
  const emp = choices.find((e) => e.id === cell.employee)
  return (
    <div className="pk-rmx__cell" data-inactive={!cell.active || undefined}>
      <div className="pk-rmx__roles" role="group" aria-label={`Peran ${who} di ${company.shortCode}`}>
        {ROLES.map((r) => (
          <label key={r} className="pk-rmx__role" title={ROLE_LABELS[r]} data-on={cell.roles.includes(r) || undefined}>
            <input type="checkbox" checked={cell.roles.includes(r)} disabled={!editable} onChange={() => onChange(toggleRole(cell, r))} aria-label={`${ROLE_LABELS[r]} di ${company.shortCode}`} data-pk-role={r} />
            <span aria-hidden="true">{ROLE_SHORT[r]}</span>
          </label>
        ))}
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
