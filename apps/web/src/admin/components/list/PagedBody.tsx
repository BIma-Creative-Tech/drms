'use client'

import React, { useState } from 'react'

import { DEFAULT_PAGE_SIZE } from '@/admin/list-query'

/** The slice of rows on `page` (1-based, clamped) and the page count. Pure, unit-tested. */
export function pageSlice<T>(rows: readonly T[], page: number, per: number): { items: T[]; page: number; pages: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / per))
  const p = Math.min(Math.max(1, page), pages)
  const items = rows.slice((p - 1) * per, p * per)
  return { items, page: p, pages, from: rows.length ? (p - 1) * per + 1 : 0, to: (p - 1) * per + items.length }
}

/**
 * DRMS 13/10 Umum #3: pagination of the report / dashboard tables (viz.tsx DataTable) whose rows are computed
 * whole on the server (bounded report rows, no URL state of their own): the `<tbody>` shows `per` rows and a
 * `<tfoot>` pager ("1–20 dari 57 baris · ‹ Sebelumnya · Halaman 1 dari 3 · Berikutnya ›") switches pages in the
 * browser. Tables paged in the database (Pager + URL) pass `paged={false}` to DataTable instead.
 */
export function PagedBody({ children, colSpan, per = DEFAULT_PAGE_SIZE, unit = 'baris', id }: { children: React.ReactNode; colSpan: number; per?: number; unit?: string; id: string }) {
  const rows = React.Children.toArray(children)
  const [page, setPage] = useState(1)
  const s = pageSlice(rows, page, per)
  return (
    <>
      <tbody>{s.items}</tbody>
      {s.pages > 1 ? (
        <tfoot>
          <tr>
            <td colSpan={colSpan}>
              <nav className="pk-pager" aria-label={`Halaman ${unit}`} data-pk-pager={id}>
                <span className="pk-pager__count" aria-live="polite">
                  {s.from}–{s.to} dari {rows.length} {unit}
                </span>
                <span className="pk-pager__nav">
                  <button type="button" className="pk-ltb__btn" onClick={() => setPage(s.page - 1)} disabled={s.page <= 1} aria-disabled={s.page <= 1}>
                    ‹ Sebelumnya
                  </button>
                  <span className="pk-pager__page">
                    Halaman {s.page} dari {s.pages}
                  </span>
                  <button type="button" className="pk-ltb__btn" onClick={() => setPage(s.page + 1)} disabled={s.page >= s.pages} aria-disabled={s.page >= s.pages}>
                    Berikutnya ›
                  </button>
                </span>
              </nav>
            </td>
          </tr>
        </tfoot>
      ) : null}
    </>
  )
}

export default PagedBody
