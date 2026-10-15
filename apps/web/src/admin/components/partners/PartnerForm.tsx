'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { partnerFormHref, projectForClientHref } from '@/admin/partner-routes'
import type { ClientFormDetail, VendorFormDetail } from '@/domain/partners/service'

import { problemText } from '../ActionButton'
import {
  buildBody,
  canManageBanks,
  draftFromDetail,
  formUrl,
  mapErrors,
  newBank,
  newContact,
  PROJECT_STATUS_LABELS,
  removeContact,
  setDefaultBank,
  setPrimary,
  tabHasError,
  tabsOf,
  type BankDraft,
  type BodyOrder,
  type ContactDraft,
  type Draft,
  type PartnerKind,
  type TabId,
} from './partner-form'

/**
 * DRMS 16/10 (owner: "Dalam pembuatan client dan vendor, tanpa harus masuk ke sub menu lain, tab dapat mengakomodir
 * penambahan record yang disesuaikan tabnya") — ONE tabbed form per client / vendor with ONE "Simpan":
 * - Klien: Detail Klien · Kontak PIC (rows added inline) · Proyek (the client's projects + "+ Proyek baru", which opens
 *   the project form with this client and its PT already chosen — server defaults, domain/partners/project-prefill.ts);
 * - Vendor: Detail Vendor · Rekening (bank-account rows added / changed inline, same rules as Rekening vendor) ·
 *   Kontak PIC.
 * The save → `POST /api/v1/{client,vendor}-form` / `PATCH …/{id}`: everything in ONE transaction on the server
 * (all-or-nothing); a refused save marks the fields and opens the first tab with an error. Same layout as the
 * "Pengguna" form (`.pk-uo` tabs, `.pk-fgrid` label left of the input, stacked on phones, one sticky save bar).
 *
 * Standalone (the /admin/klien and /admin/vendor pages) or inside a drawer: `onSaved(id, detail)` replaces the
 * navigation after a save, `onCancel` replaces the back link, `initialCompany` preselects the PT of a new record.
 */
type Common = {
  mode: 'create' | 'update'
  /** Called after a successful save INSTEAD of navigating (drawer). */
  onSaved?: (id: number, detail: ClientFormDetail | VendorFormDetail) => void
  /** Drawer: the "Batal" button calls this instead of linking back to the list. */
  onCancel?: () => void
  /** PT preselected for a new record (used when it is one of the PTs the caller may create in). */
  initialCompany?: number | null
  /** Message shown once (e.g. "Klien tersimpan." after the create page moved to the edit page). */
  notice?: string | null
}

export type ClientFormProps = Common & { detail: ClientFormDetail }
export type VendorFormProps = Common & { detail: VendorFormDetail }

export function ClientForm(props: ClientFormProps) {
  return <PartnerForm kind="client" {...props} />
}

export function VendorForm(props: VendorFormProps) {
  return <PartnerForm kind="vendor" {...props} />
}

/**
 * Drawer / quick-create entry (no server page around it): loads the form data from `GET /api/v1/{client,vendor}-form`
 * (`id` null = a new record: the PTs the caller may create in) and renders the same form — `onSaved(id, detail)`
 * instead of any navigation, `onCancel` for the close button, `initialCompany` = the PT of the form that opened it
 * (used when the caller may create there). The FORM state is built once from the loaded data (its initial state);
 * nothing is prefilled into a mounted form.
 */
export function PartnerFormLoader({ kind, id, ...common }: Omit<Common, 'mode'> & { kind: PartnerKind; id: number | null }) {
  const [state, setState] = useState<{ detail: ClientFormDetail | VendorFormDetail } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    fetch(formUrl(kind, id), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as ClientFormDetail | VendorFormDetail | null
        if (live) setState(res.ok && data ? { detail: data } : { error: problemText(data, res.status) })
      })
      .catch(() => live && setState({ error: 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.' }))
    return () => {
      live = false
    }
  }, [kind, id])
  if (state === null) return <p className="pk-uo__hint" role="status">Memuat…</p>
  if ('error' in state) {
    return (
      <div className="pk-uo">
        <p className="pk-alert bad" role="alert">
          {state.error}
        </p>
        {common.onCancel ? (
          <div className="pk-kact">
            <button type="button" className="pk-kbtn" onClick={common.onCancel}>
              Tutup
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  return <PartnerForm kind={kind} mode={id === null ? 'create' : 'update'} detail={state.detail} {...common} />
}

const REASON_MESSAGE = 'Alasan wajib diisi saat menonaktifkan data atau mengubah / menonaktifkan rekening.'
const LIST_HREF: Record<PartnerKind, string> = { client: '/admin/collections/clients', vendor: '/admin/collections/vendors' }
const NOUN: Record<PartnerKind, string> = { client: 'klien', vendor: 'vendor' }

function PartnerForm({ kind, mode, detail: initial, onSaved, onCancel, initialCompany, notice }: Common & { kind: PartnerKind; detail: ClientFormDetail | VendorFormDetail }) {
  const router = useRouter()
  const [detail, setDetail] = useState(initial)
  const [draft, setDraft] = useState<Draft>(() => draftFromDetail(initial, initialCompany))
  const [tab, setTab] = useState<TabId>('detail')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(notice ? { tone: 'ok', text: notice } : null)
  const seq = useRef(0)

  const record = 'client' in detail ? detail.client : detail.vendor
  const vendor = 'vendor' in detail ? detail : null
  const client = 'client' in detail ? detail : null
  const tabs = tabsOf(kind)
  const readOnly = !detail.canEdit
  const locked = readOnly || busy
  const { body, order, changed, needsReason } = useMemo(() => buildBody(kind, detail, draft, mode), [kind, detail, draft, mode])
  const bankRights = vendor ? canManageBanks(vendor, draft) : false
  const err = (key: string) => errors.get(key)
  const p = `pf-${kind}`

  const patch = (fn: (d: Draft) => Draft) => {
    setDraft(fn)
    setMsg(null)
  }
  const setContact = (key: string, fn: (c: ContactDraft) => ContactDraft) => patch((d) => ({ ...d, contacts: d.contacts.map((c) => (c.key === key ? fn(c) : c)) }))
  const setBank = (key: string, fn: (b: BankDraft) => BankDraft) => patch((d) => ({ ...d, banks: d.banks.map((b) => (b.key === key ? fn(b) : b)) }))

  const save = async () => {
    if (busy || !changed || readOnly) return
    if (mode === 'update' && needsReason && draft.reason.trim().length < 3) {
      // same rule as the server (reasonOnDeactivate / VendorBankAccounts reasonOnChange) — answered without a round trip
      setErrors(new Map([['reason', REASON_MESSAGE]]))
      setMsg({ tone: 'bad', text: 'Tidak ada yang disimpan — isi alasan perubahan.' })
      return
    }
    setBusy(true)
    setMsg(null)
    setErrors(new Map())
    const sentOrder: BodyOrder = order
    let leaving = false
    try {
      const res = await fetch(formUrl(kind, mode === 'create' ? null : (record?.id ?? null)), {
        method: mode === 'create' ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as { id?: number; detail?: ClientFormDetail | VendorFormDetail } | null
      if (res.ok && data?.detail && typeof data.id === 'number') {
        if (onSaved) {
          onSaved(data.id, data.detail)
          if (mode === 'update') {
            setDetail(data.detail)
            setDraft(draftFromDetail(data.detail))
            setMsg({ tone: 'ok', text: 'Perubahan tersimpan.' })
          }
          return
        }
        if (mode === 'create') {
          leaving = true
          router.replace(`${partnerFormHref(kind === 'client' ? 'clients' : 'vendors', data.id)}?tersimpan=1`)
          return
        }
        setDetail(data.detail)
        setDraft(draftFromDetail(data.detail))
        setMsg({ tone: 'ok', text: 'Perubahan tersimpan.' })
        router.refresh()
      } else {
        const { byKey, tab: errTab } = mapErrors(kind, data, sentOrder)
        setErrors(byKey)
        if (errTab) setTab(errTab)
        setMsg({ tone: 'bad', text: `Tidak ada yang disimpan — ${problemText(data, res.status)}` })
      }
    } catch {
      setMsg({ tone: 'bad', text: 'Gagal menghubungi server. Periksa koneksi lalu coba lagi.' })
    } finally {
      if (!leaving) setBusy(false)
    }
  }

  const field = (key: string, label: string, control: React.ReactNode, opts: { help?: string; required?: boolean } = {}) => {
    const id = `${p}-${key.replace(/[^a-z0-9]/gi, '-')}`
    return (
      <div className="pk-fgrid__row" key={key}>
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

  const rowError = (key: string) =>
    err(key) ? (
      <p className="pk-alert bad" role="alert" data-pk-error={key}>
        {err(key)}
      </p>
    ) : null

  const companyName = (id: number | null) => {
    const c = detail.companies.find((x) => x.id === id)
    return c ? (
      <>
        <span className="pk-pt-chip">{c.shortCode}</span> {c.name}
      </>
    ) : (
      '—'
    )
  }

  return (
    <div className="pk-uo" data-pk-partner-form={kind} data-pk-mode={mode}>
      <div className="pk-uo__tabs" role="tablist" aria-label={`Bagian data ${NOUN[kind]}`}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${p}-tab-${t.id}`}
            aria-controls={`${p}-panel-${t.id}`}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="pk-uo__tab"
            data-error={tabHasError(t.id, errors.keys()) || undefined}
            data-pk-tab={t.id}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              const i = tabs.findIndex((x) => x.id === tab)
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!
              setTab(next.id)
              document.getElementById(`${p}-tab-${next.id}`)?.focus()
            }}
          >
            {t.label}
            {t.id === 'kontak' && draft.contacts.length ? <span className="pk-uo__hint">({draft.contacts.length})</span> : null}
            {t.id === 'rekening' && draft.banks.length ? <span className="pk-uo__hint">({draft.banks.length})</span> : null}
            {t.id === 'proyek' && client?.projects.length ? <span className="pk-uo__hint">({client.projects.length})</span> : null}
            {tabHasError(t.id, errors.keys()) ? <span className="pk-uo__dot" aria-label="ada kesalahan" /> : null}
          </button>
        ))}
      </div>

      {readOnly ? (
        <p className="pk-alert info" data-pk-read-only>
          Hanya baca — Anda tidak berhak mengubah {NOUN[kind]} ini.
        </p>
      ) : null}

      {/* ---- Detail ---- */}
      <section id={`${p}-panel-detail`} role="tabpanel" aria-labelledby={`${p}-tab-detail`} hidden={tab !== 'detail'} className="pk-uo__panel">
        <div className="pk-fgrid">
          {mode === 'create' && detail.companies.length > 1
            ? field(
                'd.company',
                'PT',
                <select value={draft.company ?? ''} disabled={locked} onChange={(e) => patch((d) => ({ ...d, company: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">– pilih PT –</option>
                  {detail.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortCode} — {c.name}
                    </option>
                  ))}
                </select>,
                { required: true, help: 'Tidak dapat diubah setelah disimpan.' },
              )
            : field('d.company', 'PT', <span className="pk-fgrid__value">{companyName(draft.company)}</span>)}
          {field('d.name', 'Nama', <input type="text" value={draft.name} maxLength={160} disabled={locked} onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))} />, { required: true })}
          {kind === 'vendor'
            ? field('d.npwp', 'NPWP', <input type="text" inputMode="numeric" value={draft.npwp} maxLength={32} disabled={locked} onChange={(e) => patch((d) => ({ ...d, npwp: e.target.value }))} />, { help: 'Angka, titik dan minus (15–20 karakter).' })
            : null}
          {field('d.address', 'Alamat', <textarea value={draft.address} maxLength={500} rows={3} disabled={locked} onChange={(e) => patch((d) => ({ ...d, address: e.target.value }))} />)}
          {field(
            'd.active',
            'Status',
            <select value={draft.active ? '1' : '0'} disabled={locked} onChange={(e) => patch((d) => ({ ...d, active: e.target.value === '1' }))}>
              <option value="1">Aktif</option>
              <option value="0">Nonaktif</option>
            </select>,
            { help: mode === 'create' ? undefined : `Nonaktif = ${NOUN[kind]} tidak ditawarkan lagi di pilihan (alasan wajib).` },
          )}
          {record?.odooPartnerRef ? field('d.odooPartnerRef', 'Ref. partner Odoo', <span className="pk-fgrid__value">{record.odooPartnerRef}</span>) : null}
        </div>
        {rowError('d')}
      </section>

      {/* ---- Rekening (vendor) ---- */}
      {vendor ? (
        <section id={`${p}-panel-rekening`} role="tabpanel" aria-labelledby={`${p}-tab-rekening`} hidden={tab !== 'rekening'} className="pk-uo__panel">
          <p className="pk-uo__lead">Rekening tujuan pembayaran vendor. Mengubah nomor, atas nama atau bank, dan menonaktifkan rekening, wajib dengan alasan. Verifikasi oleh Admin / Finance.</p>
          {!readOnly && !bankRights ? (
            <p className="pk-alert info" data-pk-bank-locked>
              {draft.company === null ? 'Pilih PT dulu di tab Detail Vendor.' : 'Rekening vendor hanya dapat ditambah / diubah oleh Admin atau Finance PT ini.'}
            </p>
          ) : null}
          {draft.banks.length === 0 ? <p className="pk-empty">Belum ada rekening.</p> : null}
          {draft.banks.map((b, j) => {
            const k = `bank.${b.key}`
            const bl = locked || !bankRights
            return (
              <div className="pk-uo__bank" key={b.key} data-pk-bank={b.id ?? 'baru'}>
                <p className="pk-uo__bank-title">
                  {b.id ? `Rekening ${j + 1}` : 'Rekening baru'}
                  {b.id && b.verificationStatus === 'verified' ? <span className="pk-badge ok">Terverifikasi</span> : b.id ? <span className="pk-badge none">Belum diverifikasi</span> : null}
                  {b.isDefault ? <span className="pk-badge">Default</span> : null}
                  {!b.active ? <span className="pk-badge none">Nonaktif</span> : null}
                </p>
                <div className="pk-fgrid">
                  {field(
                    `${k}.bank`,
                    'Bank',
                    <select value={b.bank ?? ''} disabled={bl} onChange={(e) => setBank(b.key, (x) => ({ ...x, bank: e.target.value ? Number(e.target.value) : null }))}>
                      <option value="">– pilih bank –</option>
                      {vendor.banks.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>,
                    { required: true },
                  )}
                  {field(`${k}.accountNo`, 'Nomor rekening', <input type="text" inputMode="numeric" value={b.accountNo} maxLength={40} disabled={bl} onChange={(e) => setBank(b.key, (x) => ({ ...x, accountNo: e.target.value }))} />, { required: true, help: 'Hanya angka (5–34 digit).' })}
                  {field(`${k}.accountHolder`, 'Atas nama', <input type="text" value={b.accountHolder} maxLength={128} disabled={bl} onChange={(e) => setBank(b.key, (x) => ({ ...x, accountHolder: e.target.value }))} />, { required: true })}
                  {field(
                    `${k}.verificationStatus`,
                    'Status verifikasi',
                    <select value={b.verificationStatus} disabled={bl} onChange={(e) => setBank(b.key, (x) => ({ ...x, verificationStatus: e.target.value === 'verified' ? 'verified' : 'unverified' }))}>
                      <option value="unverified">Belum diverifikasi</option>
                      <option value="verified">Terverifikasi</option>
                    </select>,
                  )}
                  {field(
                    `${k}.isDefault`,
                    'Rekening default',
                    <select value={b.isDefault ? '1' : '0'} disabled={bl} onChange={(e) => patch((d) => ({ ...d, banks: setDefaultBank(d.banks, b.key, e.target.value === '1') }))}>
                      <option value="0">Tidak</option>
                      <option value="1">Ya</option>
                    </select>,
                    { help: 'Diusulkan saat mengajukan pembayaran vendor. Hanya satu rekening default.' },
                  )}
                  {field(
                    `${k}.active`,
                    'Status',
                    <select value={b.active ? '1' : '0'} disabled={bl} onChange={(e) => setBank(b.key, (x) => ({ ...x, active: e.target.value === '1' }))}>
                      <option value="1">Aktif</option>
                      <option value="0">Nonaktif</option>
                    </select>,
                  )}
                </div>
                {rowError(k)}
                {!b.id && !bl ? (
                  <button type="button" className="pk-kbtn sm" onClick={() => patch((d) => ({ ...d, banks: d.banks.filter((y) => y.key !== b.key) }))}>
                    Hapus baris baru
                  </button>
                ) : null}
              </div>
            )
          })}
          {rowError('banks')}
          {!readOnly && bankRights ? (
            <p className="pk-uo__more">
              <button type="button" className="pk-kbtn" disabled={busy} data-pk-add-bank onClick={() => patch((d) => ({ ...d, banks: [...d.banks, newBank(`n${++seq.current}`, d.name.trim())] }))}>
                + Tambah rekening
              </button>
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---- Kontak PIC ---- */}
      <section id={`${p}-panel-kontak`} role="tabpanel" aria-labelledby={`${p}-tab-kontak`} hidden={tab !== 'kontak'} className="pk-uo__panel">
        <p className="pk-uo__lead">Orang yang dapat dihubungi. Satu kontak ditandai Utama — tampil sebagai Kontak di daftar dan aplikasi.</p>
        {draft.contacts.length === 0 ? <p className="pk-empty">Belum ada kontak PIC.</p> : null}
        {draft.contacts.map((c, i) => {
          const k = `contact.${c.key}`
          return (
            <div className="pk-uo__bank" key={c.key} data-pk-contact={c.id ?? 'baru'}>
              <p className="pk-uo__bank-title">
                {c.name.trim() || `Kontak ${i + 1}`}
                {c.isPrimary ? <span className="pk-badge ok">Utama</span> : null}
              </p>
              <div className="pk-fgrid">
                {field(`${k}.name`, 'Nama', <input type="text" value={c.name} maxLength={128} disabled={locked} onChange={(e) => setContact(c.key, (x) => ({ ...x, name: e.target.value }))} />, { required: true })}
                {field(`${k}.position`, 'Jabatan', <input type="text" value={c.position} maxLength={128} disabled={locked} onChange={(e) => setContact(c.key, (x) => ({ ...x, position: e.target.value }))} />)}
                {field(`${k}.phone`, 'No. HP', <input type="tel" value={c.phone} maxLength={32} disabled={locked} onChange={(e) => setContact(c.key, (x) => ({ ...x, phone: e.target.value }))} />)}
                {field(`${k}.email`, 'Email', <input type="email" value={c.email} maxLength={254} disabled={locked} onChange={(e) => setContact(c.key, (x) => ({ ...x, email: e.target.value }))} />)}
                {field(`${k}.notes`, 'Catatan', <textarea value={c.notes} maxLength={500} rows={2} disabled={locked} onChange={(e) => setContact(c.key, (x) => ({ ...x, notes: e.target.value }))} />)}
                {field(
                  `${k}.isPrimary`,
                  'Kontak utama',
                  <input type="radio" name={`${p}-primary`} checked={c.isPrimary} disabled={locked} onChange={() => patch((d) => ({ ...d, contacts: setPrimary(d.contacts, c.key) }))} />,
                )}
              </div>
              {rowError(k)}
              {!locked ? (
                <button type="button" className="pk-kbtn sm" data-pk-remove-contact onClick={() => patch((d) => ({ ...d, contacts: removeContact(d.contacts, c.key) }))}>
                  Hapus kontak
                </button>
              ) : null}
            </div>
          )
        })}
        {rowError('contacts')}
        {!readOnly ? (
          <p className="pk-uo__more">
            <button type="button" className="pk-kbtn" disabled={busy} data-pk-add-contact onClick={() => patch((d) => ({ ...d, contacts: [...d.contacts, newContact(`n${++seq.current}`, d.contacts.length === 0)] }))}>
              + Tambah kontak
            </button>
          </p>
        ) : null}
      </section>

      {/* ---- Proyek (client) ---- */}
      {client ? (
        <section id={`${p}-panel-proyek`} role="tabpanel" aria-labelledby={`${p}-tab-proyek`} hidden={tab !== 'proyek'} className="pk-uo__panel">
          {client.client === null ? (
            <p className="pk-empty">Proyek klien ini tampil di sini setelah klien disimpan; dari sini proyek baru dapat dibuat dengan klien ini sudah terisi.</p>
          ) : (
            <>
              {client.projects.length === 0 ? <p className="pk-empty">Belum ada proyek untuk klien ini (yang dapat Anda lihat).</p> : null}
              {client.projects.length ? (
                <ul className="pk-uo__list" data-pk-client-projects>
                  {client.projects.map((pr) => (
                    <li key={pr.id}>
                      <Link prefetch={false} href={`/admin/collections/projects/${pr.id}`}>
                        {pr.code ? `${pr.code} — ` : ''}
                        {pr.name}
                      </Link>{' '}
                      {pr.status ? <span className="pk-badge none">{PROJECT_STATUS_LABELS[pr.status] ?? pr.status}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {client.canCreateProject ? (
                <p className="pk-uo__more">
                  <Link className="pk-kbtn" prefetch={false} href={projectForClientHref(client.client.id)} data-pk-new-project>
                    + Proyek baru
                  </Link>{' '}
                  <span className="pk-uo__hint">Form proyek terbuka dengan klien ini dan PT-nya sudah terisi.</span>
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* ---- one save bar ---- */}
      <div className="pk-uo__bar" aria-live="polite">
        {mode === 'update' && !readOnly ? (
          <label className="pk-uo__reason pk-fld">
            <span className="lbl">
              Alasan perubahan
              {needsReason ? <span className="pk-uo__req" aria-hidden="true"> *</span> : null}
            </span>
            <input type="text" value={draft.reason} maxLength={300} disabled={busy} required={needsReason} aria-required={needsReason || undefined} aria-invalid={err('reason') ? true : undefined} onChange={(e) => patch((d) => ({ ...d, reason: e.target.value }))} data-pk-reason />
            {err('reason') ? (
              <span className="err" role="alert" data-pk-error="reason">
                {err('reason')}
              </span>
            ) : (
              <span className="help">{needsReason ? 'Wajib diisi: ada penonaktifan atau perubahan data rekening.' : 'Wajib saat menonaktifkan, atau mengubah / menonaktifkan rekening.'}</span>
            )}
          </label>
        ) : null}
        <div className="pk-kact">
          {!readOnly ? (
            <button type="button" className="pk-kbtn primary" onClick={() => void save()} disabled={busy || !changed} data-pk-save>
              {busy ? 'Menyimpan…' : 'Simpan'}
            </button>
          ) : null}
          {onCancel ? (
            <button type="button" className="pk-kbtn" onClick={onCancel} disabled={busy}>
              {mode === 'create' ? 'Batal' : 'Tutup'}
            </button>
          ) : (
            <Link className="pk-kbtn" prefetch={false} href={LIST_HREF[kind]}>
              {mode === 'create' ? 'Batal' : 'Kembali ke daftar'}
            </Link>
          )}
          {mode === 'update' && !readOnly && !changed && !msg ? <span className="pk-uo__hint">Belum ada perubahan.</span> : null}
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

