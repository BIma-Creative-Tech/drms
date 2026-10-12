import Link from 'next/link'
import type { PayloadRequest } from 'payload'
import React from 'react'

import { hasRoleAny } from '@/access/roles'
import { Icon } from '@/admin/modules/Icon'
import { siteFromCostCenterHref } from '@/domain/sites'

/**
 * ADR 0023 Q-S2: sidebar link of the cost-center form (`ui` field `siteLink`, CostCenters.ts) — "Buat site dari
 * pusat biaya" opens the site create form pre-filled with this cost center's PT, kode, nama and titik. Server
 * component (Payload field serverProps: id, req); only on saved documents and for the roles that may create a
 * site (Admin, Direktur) — the create re-checks the role in the PT.
 */
export function SiteFromCostCenterLink({ id, req }: { id?: number | string; req?: PayloadRequest }) {
  if (id === undefined || id === null || id === '' || !req || !hasRoleAny(req, 'pk-admin', 'pk-owner')) return null
  return (
    <div className="pk-doclink" data-pk-link="site-from-cost-center">
      <Link href={siteFromCostCenterHref(id)} className="pk-doclink__a" prefetch={false}>
        <Icon name="tBuilding" size={18} />
        <span>Buat site dari pusat biaya</span>
        <Icon name="arrowRight" size={16} />
      </Link>
      <p className="pk-doclink__hint">Kantor cabang dengan nama, kode dan titik absensi pusat biaya ini.</p>
    </div>
  )
}

export default SiteFromCostCenterLink
