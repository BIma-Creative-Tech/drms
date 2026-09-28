import type { CollectionConfig, Payload } from 'payload'
import React from 'react'

import { companyContextOf } from '@/access/roles'

import { companyLabels } from './labels'
import { activeCompanyFilter, companyFilterHref, hasOtherFilter, type SearchParams } from './list-filter'

/**
 * `beforeListTable` of every list with a PT column (MC2-4, wireframe §4): "Menampilkan DRMS, CS1 ·
 * 42 data" + PT chips that narrow the list inside the switcher selection. Only rendered when more
 * than one PT is selected — with one PT the column already says it all.
 */
type Props = {
  collectionConfig?: Pick<CollectionConfig, 'slug'>
  payload: Payload
  user?: unknown
  searchParams?: SearchParams
  data?: { totalDocs?: number }
}

export async function CompanyListFilter({ collectionConfig, payload, user, searchParams, data }: Props) {
  const ctx = companyContextOf(user)
  const selected = ctx?.selected ?? []
  if (!collectionConfig || selected.length < 2) return null
  const labels = await companyLabels(payload)
  const sp = searchParams ?? {}
  const base = `${payload.config.routes?.admin ?? '/admin'}/collections/${collectionConfig.slug}`
  const active = activeCompanyFilter(sp)
  const other = hasOtherFilter(sp)
  const opts = selected.map((id) => ({ id, code: labels.get(id)?.shortCode ?? `#${id}`, name: labels.get(id)?.name ?? '' })).sort((a, b) => a.code.localeCompare(b.code))
  const shown = active !== null ? opts.filter((o) => o.id === active) : opts
  const total = typeof data?.totalDocs === 'number' ? data.totalDocs : null
  return (
    <nav className="pk-pt-filter" aria-label="Saring menurut PT" data-pk-pt-filter={collectionConfig.slug}>
      <span className="pk-pt-filter__label">PT</span>
      <ul className="pk-pt-filter__chips">
        <li>
          <a href={companyFilterHref(base, sp, null)} className="pk-pt-filter__chip" aria-current={active === null && !other ? 'true' : undefined}>
            Semua pilihan
          </a>
        </li>
        {opts.map((o) => (
          <li key={o.id}>
            <a href={companyFilterHref(base, sp, o.id)} className="pk-pt-filter__chip" title={o.name} aria-current={active === o.id ? 'true' : undefined} data-pk-pt-chip={o.code}>
              {o.code}
            </a>
          </li>
        ))}
      </ul>
      <span className="pk-pt-filter__meta" role="status">
        Menampilkan {shown.map((o) => o.code).join(', ')}
        {total !== null ? ` · ${total.toLocaleString('id-ID')} data` : ''}
        {other ? ' · filter lain aktif' : ''}
      </span>
    </nav>
  )
}

export default CompanyListFilter
