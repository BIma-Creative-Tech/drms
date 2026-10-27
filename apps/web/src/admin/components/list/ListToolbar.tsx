import Link from 'next/link'
import React from 'react'

import { filterValues, isFiltered, listHref, PAGE_SIZES, type ListQuery, type PageOf } from '@/admin/list-query'

import { AutoSubmit } from './AutoSubmit'
import { MultiSelect } from './MultiSelect'
import { DateInput } from '../DateInput'

/**
 * DRMS 10/10 D8: the shared table toolbar of the custom views — search box, filters (select), optional
 * date range and page size, as a GET form (URL = state; AutoSubmit applies it without a reload). Server
 * component; values come from the parsed ListQuery. `keep` = params of the view that the toolbar does
 * not own (e.g. a tab) and must survive a search.
 * DRMS 13/10 Umum #4 / Persetujuan #2: a filter with `multi` is a checklist dropdown (MultiSelect, `?key=a,b`);
 * the view reads it with filterValues(). `extra` = more controls at the end of the bar.
 * D2510 (ADR 0033): `flush` = the bar is a row of a Nexus card (PkListView) — no box of its own; `formId` names the
 * form so a control outside it can belong to it (`form=` attribute: the page size in the card foot, Pager `perPage`).
 */
export type ToolbarFilter = { key: string; label: string; options: ReadonlyArray<{ value: string; label: string; title?: string }>; all?: string; multi?: boolean }
export type ToolbarDates = { from: string; to: string; fromLabel?: string; toLabel?: string }

type Props = {
  id: string
  action: string
  query: ListQuery
  label: string
  search?: { placeholder: string }
  filters?: ReadonlyArray<ToolbarFilter | null | false>
  dates?: ToolbarDates | ReadonlyArray<ToolbarDates>
  keep?: Record<string, string | undefined>
  pageSize?: boolean
  extra?: React.ReactNode
  /** Reset target (default: the action with only `keep`). */
  resetHref?: string
  /** Force the Reset link (e.g. a filter the toolbar does not render is active). */
  filteredHint?: boolean
  /** D2510: a row inside a card (no border / background of its own). */
  flush?: boolean
  /** D2510: id of the <form> (controls outside it join via `form=`). */
  formId?: string
}

export function ListToolbar({ id, action, query, label, search, filters, dates, keep, pageSize = true, extra, resetHref, filteredHint, flush, formId }: Props) {
  // a multi filter with a value from the URL stays visible even if its option list came back empty
  const fs = (filters ?? []).filter((f): f is ToolbarFilter => !!f && (f.options.length > 0 || (!!f.multi && filterValues(query, f.key).length > 0)))
  const ranges: ReadonlyArray<ToolbarDates> = dates ? ('from' in dates ? [dates as ToolbarDates] : (dates as ReadonlyArray<ToolbarDates>)) : []
  const filtered = !!filteredHint || isFiltered(query) || ranges.some((d) => !!(query.filters[d.from] || query.filters[d.to]))
  return (
    <form id={formId} className={flush ? 'pk-ltb pk-ltb--flush' : 'pk-ltb'} method="get" action={action} role="search" aria-label={label} data-pk-toolbar={id}>
      {Object.entries(keep ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {search ? (
        <label className="pk-ltb__field pk-ltb__search">
          <span>Cari</span>
          <input type="search" name="q" defaultValue={query.q} placeholder={search.placeholder} maxLength={100} autoComplete="off" data-pk-search={id} />
        </label>
      ) : null}
      {fs.map((f) =>
        f.multi ? (
          <div key={f.key} className="pk-ltb__field pk-ltb__field--multi">
            <span aria-hidden="true">{f.label}</span>
            <MultiSelect name={f.key} label={f.label} options={f.options} value={filterValues(query, f.key)} allLabel={f.all ?? 'Semua'} />
          </div>
        ) : (
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
        ),
      )}
      {ranges.map((d) => (
        <React.Fragment key={d.from}>
          <label className="pk-ltb__field">
            <span>{d.fromLabel ?? 'Dari'}</span>
            <DateInput type="date" name={d.from} defaultValue={query.filters[d.from] ?? ''} />
          </label>
          <label className="pk-ltb__field">
            <span>{d.toLabel ?? 'Sampai'}</span>
            <DateInput type="date" name={d.to} defaultValue={query.filters[d.to] ?? ''} />
          </label>
        </React.Fragment>
      ))}
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
          <Link className="pk-ltb__btn pk-ltb__btn--ghost" href={resetHref ?? listHref(action, keep ?? {}, {})} prefetch={false} data-pk-reset={id}>
            Reset
          </Link>
        ) : null}
        {extra}
      </div>
      <AutoSubmit />
    </form>
  )
}

/**
 * Page indicator + previous/next links ("1–20 dari 57 · Halaman 1 dari 3"). Plain links (URL state),
 * rendered also for a single page so the count is always visible.
 * D2510: `perPage` = the toolbar's page size, shown here (card foot) and bound to the toolbar form by `form=`
 * (AutoSubmit applies it on change like any toolbar control; without JS the toolbar's "Terapkan" sends it).
 */
export function Pager({ id, path, sp, page, pageKey = 'hal', unit = 'data', perPage }: { id: string; path: string; sp: Record<string, string | string[] | undefined> | undefined; page: PageOf<unknown>; pageKey?: string; unit?: string; perPage?: { form: string; value: number } }) {
  const href = (p: number) => listHref(path, sp, { [pageKey]: p > 1 ? p : null }, { pageKey })
  return (
    <nav className="pk-pager" aria-label={`Halaman ${unit}`} data-pk-pager={id}>
      <span className="pk-pager__count" aria-live="polite">
        {page.total === 0 ? `0 ${unit}` : `${page.from}–${page.to} dari ${page.total} ${unit}`}
      </span>
      {perPage ? (
        <label className="pk-pager__per">
          <span>Per halaman</span>
          <select name="per" form={perPage.form} defaultValue={String(perPage.value)} data-pk-page-size={id}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
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
