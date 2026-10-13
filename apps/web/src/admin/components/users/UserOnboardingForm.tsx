'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useMemo, useRef, useState } from 'react'

import { ROLE_LABELS, type Role } from '@/access/roles'
import type { OnboardingDetail } from '@/domain/user-onboarding/service'

import { problemText } from '../ActionButton'
import { lockOwner, roleOptionsFor } from '../access/role-matrix'
import { MultiSelect } from '../list/MultiSelect'
import { activeCompanies, buildBody, draftFromDetail, mapErrors, newBank, TABS, type BodyOrder, type CompanyDraft, type Draft, type EmpDraft, type TabId } from './user-onboarding-form'

/**
 * DRMS 13/10 Wave 3 — ONE tabbed form for an account (client brief: "Satu UI ber-tab: Detail Pengguna, Permissions,
 * Detail Karyawan, Rekening Karyawan"; "multiple dropdown, bukan checkbox"). Tabs: Detail Pengguna · Akses & Peran
 * (per PT one checklist dropdown of roles) · Data Karyawan (per PT) · Rekening Karyawan · Penugasan Proyek (read).
 * One "Simpan" → `POST /api/v1/user-onboarding` / `PATCH /api/v1/user-onboarding/{id}`: everything in ONE
 * transaction on the server (all-or-nothing); a refused save marks the fields and opens the first tab with an error.
 * D4 layout: label left of the input (`.pk-fgrid`), stacked on phones.
 */
/** `groupAdmin`: ADR 0026 — only a group admin grants or removes the Owner role (the server refuses others, 403). */
type Props = { mode: 'create' | 'update'; detail: OnboardingDetail; self: boolean; groupAdmin: boolean }

/** ADR 0026: the Owner role is offered to group admins only (shown, locked, where a PT admin finds it already held). */
const roleOptions = (groupAdmin: boolean, held: readonly Role[]) => roleOptionsFor(groupAdmin, held).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

export function UserOnboardingForm({ mode, detail: initial, self, groupAdmin }: Props) {
  const router = useRouter()
  const [detail, setDetail] = useState(initial)
  const [draft, setDraft] = useState<Draft>(() => draftFromDetail(initial))
  const [tab, setTab] = useState<TabId>('detail')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [created, setCreated] = useState<{ id: number; password: string | null; linked: boolean } | null>(null)
  const seq = useRef(0)

  const { body, order, changed } = useMemo(() => buildBody(detail, draft, mode), [detail, draft, mode])
  const shownCompanies = activeCompanies(detail, draft)
  const identityLocked = mode === 'update' && detail.user?.identityEditable === false
  const err = (key: string) => errors.get(key)

  const patch = (fn: (d: Draft) => Draft) => {
    setDraft(fn)
    setMsg(null)
  }
  const patchCompany = (cid: number, fn: (c: CompanyDraft) => CompanyDraft) => patch((d) => ({ ...d, companies: { ...d.companies, [String(cid)]: fn(d.companies[String(cid)]!) } }))
  const patchEmp = (cid: number, fn: (e: EmpDraft) => EmpDraft) => patchCompany(cid, (c) => ({ ...c, emp: fn(c.emp) }))

  const save = async () => {
    if (busy || !changed) return
    setBusy(true)
    setMsg(null)
    setErrors(new Map())
    const sentOrder: BodyOrder = order
    try {
      const url = mode === 'create' ? '/api/v1/user-onboarding' : `/api/v1/user-onboarding/${detail.user!.id}`
      const res = await fetch(url, { method: mode === 'create' ? 'POST' : 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => null)) as { userId?: number; temporaryPassword?: string | null; linkedExistingAccount?: boolean; detail?: OnboardingDetail } | null
      if (res.ok && data?.detail) {
        if (mode === 'create') {
          setCreated({ id: data.userId!, password: data.temporaryPassword ?? null, linked: data.linkedExistingAccount === true })
          return
        }
        setDetail(data.detail)
        setDraft(draftFromDetail(data.detail))
        setMsg({ tone: 'ok', text: 'Perubahan tersimpan.' })
        router.refresh()
      } else {
        const { byKey, tab: errTab } = mapErrors(data, sentOrder)
        setErrors(byKey)
        if (errTab) setTab(errTab)
        setMsg({ tone: 'bad', text: `Tidak ada yang disimpan — ${problemText(data, res.status)}` })
      }
    } catch {
      setMsg({ tone: 'bad', text: 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.' })
    } finally {
      setBusy(false)
    }
  }

  if (created) {
    return (
      <div className="pk-uo" data-pk-onboarding="created">
        <div className="pk-alert ok" role="status">
          <b>Pengguna dibuat.</b>
          {created.password ? (
            <>
              <p>
                Kata sandi sementara (hanya ditampilkan sekali — berikan langsung ke pengguna; wajib diganti saat login pertama):
              </p>
              <p className="pk-uo__pw">
                <code data-pk-temp-password>{created.password}</code>{' '}
                <button type="button" className="pk-kbtn sm" onClick={() => void navigator.clipboard?.writeText(created.password ?? '')}>
                  Salin
                </button>
              </p>
            </>
          ) : created.linked ? (
            <p>Akun login dengan email ini sudah ada di sistem login dan ditautkan — kata sandinya tidak diubah.</p>
          ) : null}
        </div>
        <div className="pk-kact">
          <Link className="pk-kbtn primary" prefetch={false} href={`/admin/pengguna/${created.id}`}>
            Selesai — buka data pengguna
          </Link>
          <button
            type="button"
            className="pk-kbtn"
            onClick={() => {
              setCreated(null)
              setDraft(draftFromDetail(initial))
              setTab('detail')
              setMsg(null)
            }}
          >
            + Pengguna baru lagi
          </button>
        </div>
      </div>
    )
  }

  const field = (key: string, label: string, control: React.ReactNode, opts: { help?: string; wide?: boolean; required?: boolean } = {}) => {
    const id = `uo-${key.replace(/[^a-z0-9]/gi, '-')}`
    return (
      <div className={`pk-fgrid__row${opts.wide ? ' pk-fgrid__wide' : ''}`} key={key}>
        <label className="pk-fgrid__label" htmlFor={id}>
          {label}
          {opts.required ? <span className="pk-uo__req" aria-hidden="true"> *</span> : null}
        </label>
        <div className="pk-fgrid__ctl pk-fld">
          {React.isValidElement(control) ? React.cloneElement(control as React.ReactElement<Record<string, unknown>>, { id, 'aria-invalid': err(key) ? true : undefined }) : control}
          {opts.help ? <span className="help">{opts.help}</span> : null}
          {err(key) ? (
            <span className="err" role="alert" data-pk-error={key}>
              {err(key)}
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  const tabErrors = (t: TabId) => {
    for (const k of errors.keys()) {
      if (t === 'detail' && k.startsWith('user')) return true
      if (t === 'akses' && (/^c\.\d+\.roles/.test(k) || k === 'companies')) return true
      if (t === 'karyawan' && /^c\.\d+\.employee/.test(k)) return true
      if (t === 'rekening' && /^c\.\d+\.bank/.test(k)) return true
    }
    return false
  }

  return (
    <div className="pk-uo" data-pk-onboarding={mode}>
      <div className="pk-uo__tabs" role="tablist" aria-label="Bagian data pengguna">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`uo-tab-${t.id}`}
            aria-controls={`uo-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="pk-uo__tab"
            data-error={tabErrors(t.id) || undefined}
            data-pk-tab={t.id}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              const i = TABS.findIndex((x) => x.id === tab)
              const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!
              setTab(next.id)
              document.getElementById(`uo-tab-${next.id}`)?.focus()
            }}
          >
            {t.label}
            {tabErrors(t.id) ? <span className="pk-uo__dot" aria-label="ada kesalahan" /> : null}
          </button>
        ))}
      </div>

      {/* ---- Detail Pengguna ---- */}
      <section id="uo-panel-detail" role="tabpanel" aria-labelledby="uo-tab-detail" hidden={tab !== 'detail'} className="pk-uo__panel">
        {identityLocked ? (
          <p className="pk-alert info" data-pk-identity-locked>
            Akun ini juga terdaftar di PT yang bukan wewenang Anda (atau Admin grup) — email, nama, No. HP dan status hanya dapat diubah oleh Admin PT
            tersebut / Admin grup.
          </p>
        ) : null}
        <div className="pk-fgrid">
          {field('user.email', 'Email', <input type="email" value={draft.user.email} maxLength={254} autoComplete="off" disabled={identityLocked || busy} onChange={(e) => patch((d) => ({ ...d, user: { ...d.user, email: e.target.value } }))} />, { required: true, help: 'Dipakai untuk login. Satu orang = satu akun, walau bekerja di beberapa PT.' })}
          {field('user.name', 'Nama', <input type="text" value={draft.user.name} maxLength={128} disabled={identityLocked || busy} onChange={(e) => patch((d) => ({ ...d, user: { ...d.user, name: e.target.value } }))} />, { required: true })}
          {field('user.phone', 'No. HP', <input type="tel" value={draft.user.phone} maxLength={32} disabled={identityLocked || busy} onChange={(e) => patch((d) => ({ ...d, user: { ...d.user, phone: e.target.value } }))} />)}
          {field(
            'user.active',
            'Status',
            <select value={draft.user.active ? '1' : '0'} disabled={identityLocked || busy || (self && mode === 'update')} onChange={(e) => patch((d) => ({ ...d, user: { ...d.user, active: e.target.value === '1' } }))}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </select>,
            { help: mode === 'create' ? 'Akun baru mendapat kata sandi sementara yang wajib diganti saat login pertama.' : 'Nonaktif = login, sesi web dan HP langsung dicabut di semua PT (alasan wajib).' },
          )}
        </div>
      </section>

      {/* ---- Akses & Peran ---- */}
      <section id="uo-panel-akses" role="tabpanel" aria-labelledby="uo-tab-akses" hidden={tab !== 'akses'} className="pk-uo__panel">
        <p className="pk-uo__lead">Peran per PT (boleh lebih dari satu). Mengosongkan semua peran di satu PT = akses di PT itu dinonaktifkan (riwayat tetap).</p>
        {err('companies') ? (
          <p className="pk-alert bad" role="alert">
            {err('companies')}
          </p>
        ) : null}
        {detail.companies.length === 0 ? (
          <p className="pk-empty">Tidak ada PT yang Anda kelola dalam pilihan PT saat ini. Ubah pilihan di pemilih PT.</p>
        ) : (
          <div className="pk-fgrid">
            {detail.companies.map((c) => {
              const d = draft.companies[String(c.id)]!
              const status = c.membership ? (d.roles.length === 0 ? 'akses akan dinonaktifkan' : c.membership.active ? 'anggota aktif' : 'nonaktif — pilih peran untuk mengaktifkan') : d.roles.length ? 'akses baru' : 'bukan anggota'
              const key = `c.${c.id}.roles`
              return (
                <div className="pk-fgrid__row" key={c.id} data-pk-company={c.shortCode}>
                  <span className="pk-fgrid__label">
                    <span className="pk-pt-chip">{c.shortCode}</span> {c.name}
                  </span>
                  <div className="pk-fgrid__ctl pk-fld">
                    <MultiSelect name={`roles-${c.id}`} label={`Peran di ${c.shortCode}`} options={roleOptions(groupAdmin, d.roles as Role[])} value={d.roles} allLabel="Pilih peran…" onChange={(roles) => patchCompany(c.id, (x) => ({ ...x, roles: lockOwner(roles as Role[], x.roles as Role[], groupAdmin) }))} disabled={busy} invalid={!!err(key)} testKey={`roles-${c.shortCode}`} />
                    <span className="help">{status}</span>
                    {err(key) ? (
                      <span className="err" role="alert" data-pk-error={key}>
                        {err(key)}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ---- Data Karyawan ---- */}
      <section id="uo-panel-karyawan" role="tabpanel" aria-labelledby="uo-tab-karyawan" hidden={tab !== 'karyawan'} className="pk-uo__panel">
        <p className="pk-uo__lead">1 data karyawan = 1 PT. Data karyawan dibutuhkan untuk absensi dan pengajuan di PT itu.</p>
        {shownCompanies.length === 0 ? <p className="pk-empty">Pilih dulu peran di tab Akses &amp; Peran.</p> : null}
        {shownCompanies.map((c) => {
          const d = draft.companies[String(c.id)]!
          const e = d.emp
          const k = `c.${c.id}.employee`
          const locked = !c.canManageEmployees || busy
          const modes: Array<{ v: EmpDraft['mode']; label: string }> = [
            ...(c.employee ? [{ v: 'linked' as const, label: `${c.employee.code} ${c.employee.name}` }] : []),
            { v: 'pick', label: 'Pilih karyawan yang sudah ada' },
            { v: 'new', label: 'Buat data karyawan baru' },
            { v: 'none', label: c.employee ? 'Lepas tautan (data karyawan tetap ada)' : 'Tanpa data karyawan' },
          ]
          return (
            <fieldset key={c.id} className="pk-uo__group" data-pk-employee-company={c.shortCode}>
              <legend>
                <span className="pk-pt-chip">{c.shortCode}</span> {c.name}
              </legend>
              {!c.canManageEmployees ? <p className="pk-alert info">Data karyawan PT ini hanya dapat diubah oleh Admin PT ini.</p> : null}
              <div className="pk-fgrid">
                {field(
                  `${k}.mode`,
                  'Data karyawan',
                  <select
                    value={e.mode}
                    disabled={locked}
                    onChange={(ev) => {
                      const mode = ev.target.value as EmpDraft['mode']
                      patchEmp(c.id, (x) =>
                        mode === 'linked' && c.employee
                          ? { mode, id: c.employee.id, code: c.employee.code, name: c.employee.name, nickname: c.employee.nickname ?? '', position: c.employee.position ?? '', phone: c.employee.phone ?? '', active: c.employee.active }
                          : mode === 'new'
                            ? { ...x, mode, id: null, code: '', name: draft.user.name, nickname: '', position: '', phone: draft.user.phone, active: true }
                            : { ...x, mode, id: mode === 'pick' ? null : x.id },
                      )
                    }}
                  >
                    {modes.map((m) => (
                      <option key={m.v} value={m.v}>
                        {m.label}
                      </option>
                    ))}
                  </select>,
                )}
                {e.mode === 'pick'
                  ? field(
                      k,
                      'Karyawan',
                      <select value={e.id ?? ''} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, id: ev.target.value ? Number(ev.target.value) : null }))}>
                        <option value="">– pilih karyawan –</option>
                        {c.employeeChoices
                          .filter((x) => x.id !== c.employee?.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.code} {x.name}
                              {x.active ? '' : ' (nonaktif)'}
                            </option>
                          ))}
                      </select>,
                      { help: 'Hanya karyawan PT ini yang belum terhubung ke akun lain.' },
                    )
                  : null}
                {e.mode === 'linked' || e.mode === 'new' ? (
                  <>
                    {field(`${k}.code`, 'Kode', <input type="text" value={e.code} maxLength={32} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, code: ev.target.value }))} />, { required: true })}
                    {field(`${k}.name`, 'Nama lengkap', <input type="text" value={e.name} maxLength={128} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, name: ev.target.value }))} />, { required: true })}
                    {field(`${k}.nickname`, 'Nama panggilan', <input type="text" value={e.nickname} maxLength={64} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, nickname: ev.target.value }))} />)}
                    {field(`${k}.position`, 'Jabatan', <input type="text" value={e.position} maxLength={128} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, position: ev.target.value }))} />)}
                    {field(`${k}.phone`, 'No. HP', <input type="tel" value={e.phone} maxLength={32} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, phone: ev.target.value }))} />)}
                    {field(
                      `${k}.active`,
                      'Status karyawan',
                      <select value={e.active ? '1' : '0'} disabled={locked} onChange={(ev) => patchEmp(c.id, (x) => ({ ...x, active: ev.target.value === '1' }))}>
                        <option value="1">Aktif</option>
                        <option value="0">Nonaktif</option>
                      </select>,
                    )}
                  </>
                ) : null}
              </div>
              {err(k) ? (
                <p className="pk-alert bad" role="alert" data-pk-error={k}>
                  {err(k)}
                </p>
              ) : null}
              {c.employee ? (
                <p className="pk-uo__more">
                  <Link prefetch={false} href={`/admin/collections/employees/${c.employee.id}`}>Buka data karyawan lengkap ↗</Link> (jadwal kerja, site penempatan, foto wajah)
                </p>
              ) : null}
            </fieldset>
          )
        })}
      </section>

      {/* ---- Rekening Karyawan ---- */}
      <section id="uo-panel-rekening" role="tabpanel" aria-labelledby="uo-tab-rekening" hidden={tab !== 'rekening'} className="pk-uo__panel">
        <p className="pk-uo__lead">Rekening tujuan transfer per data karyawan. Mengubah nomor, nama pemilik atau bank, dan menonaktifkan rekening, wajib dengan alasan.</p>
        {shownCompanies.length === 0 ? <p className="pk-empty">Pilih dulu peran di tab Akses &amp; Peran.</p> : null}
        {shownCompanies.map((c) => {
          const d = draft.companies[String(c.id)]!
          const hasEmp = d.emp.mode === 'linked' || d.emp.mode === 'new' || (d.emp.mode === 'pick' && d.emp.id !== null)
          const locked = !c.canManageEmployees || busy
          const bk = `c.${c.id}.bank`
          return (
            <fieldset key={c.id} className="pk-uo__group" data-pk-bank-company={c.shortCode}>
              <legend>
                <span className="pk-pt-chip">{c.shortCode}</span> {c.name}
              </legend>
              {!hasEmp ? (
                <p className="pk-empty">Belum ada data karyawan di PT ini — pilih atau buat di tab Data Karyawan.</p>
              ) : (
                <>
                  {d.banks.length === 0 ? <p className="pk-empty">Belum ada rekening.</p> : null}
                  {d.banks.map((b, j) => {
                    const p = `${bk}.${b.key}`
                    const set = (fn: (x: typeof b) => typeof b) => patchCompany(c.id, (x) => ({ ...x, banks: x.banks.map((y) => (y.key === b.key ? fn(y) : y)) }))
                    return (
                      <div className="pk-uo__bank" key={b.key} data-pk-bank={b.id ?? 'baru'}>
                        <p className="pk-uo__bank-title">
                          {b.id ? `Rekening ${j + 1}` : 'Rekening baru'}
                          {b.id && b.verificationStatus === 'verified' ? <span className="pk-badge ok">Terverifikasi</span> : b.id ? <span className="pk-badge none">Belum diverifikasi</span> : null}
                        </p>
                        <div className="pk-fgrid">
                          {field(
                            `${p}.bank`,
                            'Bank',
                            <select value={b.bank ?? ''} disabled={locked} onChange={(ev) => set((x) => ({ ...x, bank: ev.target.value ? Number(ev.target.value) : null }))}>
                              <option value="">– pilih bank –</option>
                              {detail.banks.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.name}
                                </option>
                              ))}
                            </select>,
                            { required: true },
                          )}
                          {field(`${p}.accountNo`, 'Nomor rekening', <input type="text" inputMode="numeric" value={b.accountNo} maxLength={40} disabled={locked} onChange={(ev) => set((x) => ({ ...x, accountNo: ev.target.value }))} />, { required: true, help: 'Hanya angka (5–34 digit).' })}
                          {field(`${p}.accountHolder`, 'Atas nama', <input type="text" value={b.accountHolder} maxLength={128} disabled={locked} onChange={(ev) => set((x) => ({ ...x, accountHolder: ev.target.value }))} />, { required: true })}
                          {field(
                            `${p}.verificationStatus`,
                            'Status verifikasi',
                            <select value={b.verificationStatus} disabled={locked} onChange={(ev) => set((x) => ({ ...x, verificationStatus: ev.target.value === 'verified' ? 'verified' : 'unverified' }))}>
                              <option value="unverified">Belum diverifikasi</option>
                              <option value="verified">Terverifikasi</option>
                            </select>,
                          )}
                          {field(
                            `${p}.isDefault`,
                            'Rekening default',
                            <select value={b.isDefault ? '1' : '0'} disabled={locked} onChange={(ev) => set((x) => ({ ...x, isDefault: ev.target.value === '1' }))}>
                              <option value="0">Tidak</option>
                              <option value="1">Ya</option>
                            </select>,
                          )}
                          {field(
                            `${p}.active`,
                            'Status',
                            <select value={b.active ? '1' : '0'} disabled={locked} onChange={(ev) => set((x) => ({ ...x, active: ev.target.value === '1' }))}>
                              <option value="1">Aktif</option>
                              <option value="0">Nonaktif</option>
                            </select>,
                          )}
                        </div>
                        {err(p) ? (
                          <p className="pk-alert bad" role="alert" data-pk-error={p}>
                            {err(p)}
                          </p>
                        ) : null}
                        {!b.id ? (
                          <button type="button" className="pk-kbtn sm" disabled={busy} onClick={() => patchCompany(c.id, (x) => ({ ...x, banks: x.banks.filter((y) => y.key !== b.key) }))}>
                            Hapus baris baru
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                  {err(bk) ? (
                    <p className="pk-alert bad" role="alert">
                      {err(bk)}
                    </p>
                  ) : null}
                  {c.canManageEmployees ? (
                    <button
                      type="button"
                      className="pk-kbtn"
                      disabled={busy}
                      data-pk-add-bank={c.shortCode}
                      onClick={() => patchCompany(c.id, (x) => ({ ...x, banks: [...x.banks, newBank(`n${++seq.current}`, x.emp.name || draft.user.name)] }))}
                    >
                      + Tambah rekening
                    </button>
                  ) : null}
                </>
              )}
            </fieldset>
          )
        })}
      </section>

      {/* ---- Penugasan Proyek (read-only) ---- */}
      <section id="uo-panel-penugasan" role="tabpanel" aria-labelledby="uo-tab-penugasan" hidden={tab !== 'penugasan'} className="pk-uo__panel">
        <p className="pk-uo__lead">Penugasan tim dari data karyawan per PT (dibuat dan diubah di Proyek → Penugasan tim).</p>
        {shownCompanies.every((c) => c.assignments.length === 0) ? <p className="pk-empty">{mode === 'create' ? 'Simpan pengguna dulu, lalu tambah penugasan di Proyek → Penugasan tim.' : 'Belum ada penugasan.'}</p> : null}
        {shownCompanies
          .filter((c) => c.assignments.length > 0)
          .map((c) => (
            <div key={c.id} className="pk-uo__group">
              <p className="pk-uo__bank-title">
                <span className="pk-pt-chip">{c.shortCode}</span> {c.name}
              </p>
              <ul className="pk-uo__list">
                {c.assignments.map((a) => (
                  <li key={a.id}>
                    <Link prefetch={false} href={`/admin/collections/team-assignments/${a.id}`}>{a.label}</Link> · {a.roleInProject === 'pm' ? 'PM' : a.roleInProject === 'mandor' ? 'Mandor' : 'Staff'}
                    {a.startDate ? ` · mulai ${a.startDate.slice(0, 10)}` : ''}
                    {a.endDate ? ` · selesai ${a.endDate.slice(0, 10)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        <p>
          <Link className="pk-kbtn sm" prefetch={false} href="/admin/collections/team-assignments/create">
            + Penugasan tim
          </Link>
        </p>
      </section>

      {/* ---- one save bar ---- */}
      <div className="pk-uo__bar" aria-live="polite">
        {mode === 'update' ? (
          <label className="pk-uo__reason pk-fld">
            <span className="lbl">Alasan perubahan</span>
            <input type="text" value={draft.reason} maxLength={300} placeholder="mis. mutasi ke CS1 / rekening baru" disabled={busy} aria-invalid={err('reason') ? true : undefined} onChange={(e) => patch((d) => ({ ...d, reason: e.target.value }))} data-pk-reason />
            {err('reason') ? (
              <span className="err" role="alert" data-pk-error="reason">
                {err('reason')}
              </span>
            ) : (
              <span className="help">Wajib saat menonaktifkan atau mengubah data rekening.</span>
            )}
          </label>
        ) : null}
        <div className="pk-kact">
          <button type="button" className="pk-kbtn primary" onClick={() => void save()} disabled={busy || !changed} data-pk-save>
            {busy ? 'Menyimpan…' : 'Simpan'}
          </button>
          <Link className="pk-kbtn" prefetch={false} href="/admin/collections/users">
            {mode === 'create' ? 'Batal' : 'Kembali ke daftar'}
          </Link>
          {mode === 'update' && !changed && !msg ? <span className="pk-uo__hint">Belum ada perubahan.</span> : null}
          {msg ? (
            <span className={`pk-uo__msg pk-uo__msg--${msg.tone}`} role={msg.tone === 'bad' ? 'alert' : 'status'}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default UserOnboardingForm
