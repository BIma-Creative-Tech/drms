import Link from 'next/link'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { creatableCompanies } from '@/fields/company'
import { CLIENT_CREATE_ROLES, loadClientForm, loadVendorForm, PartnerFormError, VENDOR_CREATE_ROLES } from '@/domain/partners/service'

import { ClientForm, VendorForm } from '../components/partners/PartnerForm'
import { Frame } from './frame'
import { NoAccess } from './NoAccess'
import { DashHead } from './viz'

/**
 * DRMS 16/10 — "Klien" (`/admin/klien/baru`, `/admin/klien/<id>`) and "Vendor" (`/admin/vendor/baru`,
 * `/admin/vendor/<id>`): ONE tabbed form each (PartnerForm), saved by `/api/v1/{client,vendor}-form` in one
 * transaction. Entry point of the lists ("+ Buat baru", row click, "Ubah" / "Lihat") for every reader of the collection
 * — read-only without the update right. Create needs the collection's create role in a selected PT (else the no-access
 * page). Reads run with the caller's access (domain/partners/service.ts).
 */
type Parsed = { create: boolean; id: number | null; saved: boolean }

function parse(props: AdminViewServerProps): Parsed {
  const seg = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[1] ?? ''
  const sp = (props.searchParams ?? {}) as Record<string, string | string[] | undefined>
  return { create: seg === 'baru', id: /^[1-9]\d{0,9}$/.test(seg) ? Number(seg) : null, saved: sp.tersimpan === '1' }
}

const notFound = (props: AdminViewServerProps, name: string, title: string, back: React.ReactNode) => (
  <Frame props={props} name={name}>
    <DashHead title={title} note="Data ini tidak ada atau bukan data PT Anda.">
      {back}
    </DashHead>
  </Frame>
)

const statusBadge = (active: boolean) => <span className={`pk-badge ${active ? 'ok' : 'none'}`}>{active ? 'Aktif' : 'Nonaktif'}</span>

export async function KlienView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const { create, id, saved } = parse(props)
  if (create && creatableCompanies(req.user, CLIENT_CREATE_ROLES).length === 0) return <NoAccess props={props} hint="Klien baru dibuat oleh Admin atau Direktur PT. Periksa pilihan PT di kanan atas." />
  const back = (
    <Link className="pk-kbtn" href="/admin/collections/clients">
      ← Klien
    </Link>
  )
  const detail = create || id !== null ? await loadClientForm(req, create ? null : id).catch((err) => (err instanceof PartnerFormError ? null : Promise.reject(err))) : null
  if (!detail) return notFound(props, 'klien', 'Klien tidak ditemukan', back)
  const c = detail.client
  return (
    <Frame props={props} name="klien">
      <DashHead title={create ? 'Klien baru' : c?.name || 'Klien'} note={create ? 'Detail klien dan kontak PIC — disimpan sekaligus.' : 'Detail klien, kontak PIC dan proyeknya.'}>
        <div className="pk-kact">
          {c ? statusBadge(c.active) : null}
          {back}
        </div>
      </DashHead>
      <ClientForm key={c?.id ?? 'baru'} mode={create ? 'create' : 'update'} detail={detail} notice={saved ? 'Klien tersimpan.' : null} />
    </Frame>
  )
}

export async function VendorView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  const { create, id, saved } = parse(props)
  if (create && creatableCompanies(req.user, VENDOR_CREATE_ROLES).length === 0) return <NoAccess props={props} hint="Vendor baru dibuat oleh Admin atau Finance PT. Periksa pilihan PT di kanan atas." />
  const back = (
    <Link className="pk-kbtn" href="/admin/collections/vendors">
      ← Vendor
    </Link>
  )
  const detail = create || id !== null ? await loadVendorForm(req, create ? null : id).catch((err) => (err instanceof PartnerFormError ? null : Promise.reject(err))) : null
  if (!detail) return notFound(props, 'vendor', 'Vendor tidak ditemukan', back)
  const v = detail.vendor
  return (
    <Frame props={props} name="vendor">
      <DashHead title={create ? 'Vendor baru' : v?.name || 'Vendor'} note={create ? 'Detail vendor, rekening dan kontak PIC — disimpan sekaligus.' : 'Detail vendor, rekening tujuan pembayaran dan kontak PIC.'}>
        <div className="pk-kact">
          {v ? statusBadge(v.active) : null}
          {back}
        </div>
      </DashHead>
      <VendorForm key={v?.id ?? 'baru'} mode={create ? 'create' : 'update'} detail={detail} notice={saved ? 'Vendor tersimpan.' : null} />
    </Frame>
  )
}
