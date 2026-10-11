import Link from 'next/link'
import React from 'react'

import { isFiltered, listHref, PAGE_SIZES, type ListQuery, type PageOf } from '@/admin/list-query'

import { AutoSubmit } from './AutoSubmit'
import { DateInput } from '../DateInput'

/**
 * DRMS 10/10 D8: the shared table toolbar of the custom views — search box, filters (select), optional
 * date range and page size, as a GET form (URL = state; AutoSubmit applies it without a reload). Server
 * component; values come from the parsed ListQuery. `keep` = params of the view that the toolbar does
 * not own (e.g. a tab) and must survive a search.
 */
export type ToolbarFilter = { key: string; label: string; options: ReadonlyArray<{ value: string; label: string }>; all?: string }

type Props = {
  id: string
  action: string
  query: ListQuery
  label: string
  search?: { placeholder: string }
  filters?: ReadonlyArray<ToolbarFilter | null | false>
  dates?: { from: string; to: string; fromLabel?: string; toLabel?: string }
  keep?: Record<string, string | undefined>
  pageSize?: boolean
}

export function ListToolbar({ id, action, query, label, search, filters, dates, keep, pageSize = true }: Props) {
  const fs = (filters ?? []).filter((f): f is ToolbarFilter => !!f && f.options.length > 0)
  const filtered = isFiltered(query) || (dates ? !!(query.filters[dates.from] || query.filters[dates.to]) : false)
  return (
    <form className="pk-ltb" method="get" action={action} role="search" aria-label={label} data-pk-toolbar={id}>
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search ? (
        <label className="pk-ltb__field pk-ltb__search">
          <span>Cari</span>
          <input type="search" name="q" defaultValue={query.q} placeholder={search.placeholder} maxLength={100} autoComplete="off" data-pk-search={id} />
        </label>
      ) : null}
      {fs.map((f) => (
        <label key={f.key} className="pk-ltb__field">
          <span>{f.label}</span>
          <select name={f.key} defaultValue={query.filters[f.key] ?? ''} data-pk-filter-key={f.key}>
            <option value="">{f.all ?? 'Semua'}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {dates ? (
        <>
          <label className="pk-ltb__field">
            <span>{dates.fromLabel ?? 'Dari'}</span>
            <DateInput type="date" name={dates.from} defaultValue={query.filters[dates.from] ?? ''} />
          </label>
          <label className="pk-ltb__field">
            <span>{dates.toLabel ?? 'Sampai'}</span>
            <DateInput type="date" name={dates.to} defaultValue={query.filters[dates.to] ?? ''} />
          </label>
        </>
      ) : null}
      {pageSize ? (
        <label className="pk-ltb__field pk-ltb__per">
          <span>Per halaman</span>
          <select name="per" defaultValue={String(query.per)} data-pk-page-size={id}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="pk-ltb__actions">
        <button type="submit" className="pk-ltb__btn">
          Terapkan
        </button>
        {filtered ? (
          <Link className="pk-ltb__btn pk-ltb__btn--ghost" href={listHref(action, keep ?? {}, {})} prefetch={false} data-pk-reset={id}>
            Reset
          </Link>
        ) : null}
      </div>
      <AutoSubmit />
    </form>
  )
}

/**
 * Page indicator + previous/next links ("1–20 dari 57 · Halaman 1 dari 3"). Plain links (URL state),
 * rendered also for a single page so the count is always visible.
 */
export function Pager({ id, path, sp, page, pageKey = 'hal', unit = 'data' }: { id: string; path: string; sp: Record<string, string | string[] | undefined> | undefined; page: PageOf<unknown>; pageKey?: string; unit?: string }) {
  const href = (p: number) => listHref(path, sp, { [pageKey]: p > 1 ? p : null }, { pageKey })
  return (
    <nav className="pk-pager" aria-label={`Halaman ${unit}`} data-pk-pager={id}>
      <span className="pk-pager__count" aria-live="polite">
        {page.total === 0 ? `0 ${unit}` : `${page.from}–${page.to} dari ${page.total} ${unit}`}
      </span>
      {page.totalPages > 1 ? (
        <span className="pk-pager__nav">
          {page.page > 1 ? (
            <Link className="pk-ltb__btn" href={href(page.page - 1)} prefetch={false} rel="prev">
              ‹ Sebelumnya
            </Link>
          ) : (
            <span className="pk-ltb__btn" aria-disabled="true">
              ‹ Sebelumnya
            </span>
          )}
          <span className="pk-pager__page">
            Halaman {page.page} dari {page.totalPages}
          </span>
          {page.page < page.totalPages ? (
            <Link className="pk-ltb__btn" href={href(page.page + 1)} prefetch={false} rel="next">
              Berikutnya ›
            </Link>
          ) : (
            <span className="pk-ltb__btn" aria-disabled="true">
              Berikutnya ›
            </span>
          )}
        </span>
      ) : null}
    </nav>
  )
}
