import { getTranslation } from '@payloadcms/translations'
import { DefaultListView, Gutter, RelationshipProvider, SetStepNav } from '@payloadcms/ui'
import { renderTable } from '@payloadcms/ui/rsc'
import { getClientConfig } from '@payloadcms/ui/utilities/getClientConfig'
import Link from 'next/link'
import type { ListViewClientProps, ListViewServerProps, PaginatedDocs } from 'payload'
import React from 'react'

import { ClickableRow } from '@/admin/components/list/ClickableRow'
import { ListToolbar, Pager, type ToolbarFilter } from '@/admin/components/list/ListToolbar'
import { TableScroll } from '@/admin/components/TableScroll'
import { listHref } from '@/admin/list-query'
import { ROW_ACTIONS_FIELD } from '@/admin/row-actions'

import { ColumnPicker } from './ColumnPicker'
import { loadPkList } from './data'
import { customEditOf } from './edit-view'
import { COMPANY_PARAM, dateParams, filterParam, nextSort, pkFiltered, SORT_PARAM, toolbarQuery } from './query'

type I18nLike = Parameters<typeof getTranslation>[1]
const label = (l: unknown, i18n: I18nLike, fallback: string): string => {
  if (typeof l === 'string' && l !== '') return l
  if (l && (typeof l === 'object' || typeof l === 'function')) return getTranslation(l as never, i18n) || fallback
  return fallback
}

/** Client props of the list view (what Payload's DefaultListView takes) — for the drawer fallback. */
function clientPropsOf(p: ListViewServerProps): ListViewClientProps {
  const { AfterList, AfterListTable, BeforeList, BeforeListTable, Description, listMenuItems, Table, beforeActions, collectionSlug, columnState, disableBulkDelete, disableBulkEdit, disableQueryPresets, enableRowSelections } = p
  const { hasCreatePermission, hasDeletePermission, hasTrashPermission, newDocumentURL, queryPreset, queryPresetPermissions, renderedFilters, resolvedFilterOptions, viewType } = p
  return { AfterList, AfterListTable, BeforeList, BeforeListTable, Description, listMenuItems, Table, beforeActions, collectionSlug, columnState, disableBulkDelete, disableBulkEdit, disableQueryPresets, enableRowSelections, hasCreatePermission, hasDeletePermission, hasTrashPermission, newDocumentURL, queryPreset, queryPresetPermissions, renderedFilters, resolvedFilterOptions, viewType }
}

/**
 * DRMS 13/10 Umum #3–#8 (+ Persetujuan #2 for the custom views): the generic list view of every collection
 * (`admin.components.views.list`, wired in src/admin/pk-list/wire.ts) instead of Payload's default list:
 * - title + "Buat baru" (only with create permission, Payload's create URL);
 * - one filter bar like the custom views (ListToolbar): search, checklist filters per collection
 *   (pk-list/config.ts: select / relationship / boolean, PT when 2+ PTs are selected), date ranges, page size,
 *   "Kolom ▾" (columns saved per user and collection in Payload's preference `collection-<slug>`);
 * - sortable headers, every row opens the record (ClickableRow), the "Aksi" column stays (RowActionsCell:
 *   "Ubah" when the row is editable, else "Buka"/"Lihat") — NO selection checkboxes, NO bulk edit/delete;
 * - shared Pager (20/50/100), horizontal scroll on narrow screens (TableScroll).
 * Rows come from pk-list/data.ts (`overrideAccess: false`, the PT selection applies); cells are rendered by
 * Payload's own cell pipeline (renderTable → custom Cell components, relationship titles, formats).
 * The collection's beforeList / beforeListTable / afterList / afterListTable / Description slots are kept.
 * Inside a relationship/upload drawer (Payload passes disableBulkEdit + disableBulkDelete only there) the
 * default list stays: its row click selects a document.
 */
export async function PkListView(props: ListViewServerProps) {
  const { collectionConfig, payload, user, i18n, permissions, searchParams, listPreferences, viewType } = props
  if ((props.disableBulkEdit === true && props.disableBulkDelete === true) || viewType === 'trash') return <DefaultListView {...clientPropsOf(props)} />

  const slug = collectionConfig.slug
  const adminRoute = payload.config.routes?.admin ?? '/admin'
  const base = `${adminRoute}/collections/${slug}`
  const fieldPermissions = permissions?.collections?.[slug]?.fields
  const data = await loadPkList({ payload, user, collection: collectionConfig, searchParams, columnsPref: listPreferences?.columns, fieldPermissions })
  const { cfg, query, page, docs } = data
  const plural = label(collectionConfig.labels?.plural, i18n, slug)
  // DRMS 13/10 W3: users → the tabbed "Pengguna" view for Admins (create + row); DRMS 16/10: clients / vendors → the
  // tabbed "Klien" / "Vendor" pages (create + row + the "Aksi" link), see edit-view.ts
  const custom = customEditOf(slug, user, adminRoute)
  const createHref = custom ? (props.hasCreatePermission ? custom.createHref : undefined) : props.hasCreatePermission ? props.newDocumentURL : undefined
  const rowHref = (id: unknown) => (custom ? custom.rowHref(String(id)) : `${base}/${encodeURIComponent(String(id))}`)

  // Payload's cell pipeline for exactly the visible columns (no selection column)
  const clientConfig = getClientConfig({ config: payload.config, i18n, importMap: payload.importMap, user: user ?? true })
  const clientCollectionConfig = clientConfig.collections.find((c) => c.slug === slug)
  const pageDocs = { docs, totalDocs: page.total, limit: page.per, page: page.page, totalPages: page.totalPages } as unknown as PaginatedDocs
  const { columnState } = renderTable({
    clientCollectionConfig,
    collectionConfig,
    columns: data.columns.map((accessor) => ({ accessor, active: true })),
    data: pageDocs,
    enableRowSelections: false,
    fieldPermissions,
    i18n,
    orderableFieldName: undefined as never,
    payload,
    useAsTitle: collectionConfig.admin?.useAsTitle,
    viewType: 'list',
  })
  const byAccessor = new Map(columnState.map((c) => [c.accessor, c]))
  const shown = data.columns.map((a) => byAccessor.get(a)).filter((c): c is NonNullable<typeof c> => !!c && c.active && !(custom?.hideRowActions && c.accessor === ROW_ACTIONS_FIELD))
  const sortable = new Set(cfg.columns.filter((c) => c.sortable).map((c) => c.name))
  // DRMS 15/10 #6: columns hug their content; the empty filler cell before "Aksi" (or last) takes the rest of the row
  const actionsAt = shown.findIndex((c) => c.accessor === ROW_ACTIONS_FIELD)
  const fillAt = actionsAt < 0 ? shown.length : actionsAt
  const fill = () => <td key="pk-fill" className="pk-plist__fill" aria-hidden="true" />
  // long texts: one line with an ellipsis; textareas wrap (both within 360 px, custom.scss .pk-plist__cell)
  const wraps = (field: unknown) => ['textarea', 'richText'].includes((field as { type?: string } | undefined)?.type ?? '')
  const colLabel = (name: string, field?: unknown) =>
    name === 'id' ? 'ID' : name === ROW_ACTIONS_FIELD ? 'Aksi' : label((field as { label?: unknown } | undefined)?.label ?? cfg.columns.find((c) => c.name === name)?.label, i18n, name)

  // filter bar: PT (2+ PTs), the collection's checklists, date ranges
  const filters: ToolbarFilter[] = []
  if (data.companies) filters.push({ key: COMPANY_PARAM, label: 'PT', all: 'Semua PT', multi: true, options: data.companies })
  for (const f of cfg.filters) {
    const name = label(f.label, i18n, f.name)
    if (f.kind === 'select') filters.push({ key: filterParam(f.name), label: name, multi: true, options: f.options.map((o) => ({ value: o.value, label: label(o.label, i18n, o.value) })) })
    else if (f.kind === 'boolean') filters.push({ key: filterParam(f.name), label: name, multi: true, options: f.name === 'active' ? [{ value: 'true', label: 'Aktif' }, { value: 'false', label: 'Nonaktif' }] : [{ value: 'true', label: 'Ya' }, { value: 'false', label: 'Tidak' }] })
    else if (data.relOptions[f.name]) filters.push({ key: filterParam(f.name), label: name, multi: true, options: data.relOptions[f.name]! })
  }
  const dates = cfg.dates.map((d) => {
    const k = dateParams(d.name)
    const name = label(d.label, i18n, d.name)
    return { from: k.from, to: k.to, fromLabel: `${name} dari`, toLabel: 'sampai' }
  })
  // params the bar does not own survive a search / filter change: the sort and an old where[…] deep link
  const keep: Record<string, string | undefined> = { [SORT_PARAM]: query.sort }
  for (const [k, v] of Object.entries(searchParams ?? {})) if (k.startsWith('where[') && typeof v === 'string') keep[k] = v
  const filtered = pkFiltered(query)

  const pickerColumns = data.available.filter((n) => n !== ROW_ACTIONS_FIELD).map((name) => ({ name, label: colLabel(name, byAccessor.get(name)?.field) }))

  return (
    <div className={`pk-plist pk-plist--${slug}`} data-pk-list={slug}>
      <SetStepNav nav={[{ label: plural }]} />
      {props.BeforeList}
      <Gutter className="pk-plist__wrap">
        <header className="pk-plist__head">
          <h1 className="pk-plist__title">{plural}</h1>
          {createHref ? (
            <Link href={createHref} prefetch={false} className="pk-ltb__btn pk-ltb__btn--primary" data-pk-create={slug}>
              + Buat baru
            </Link>
          ) : null}
          {props.listMenuItems?.length ? <div className="pk-plist__menu">{props.listMenuItems}</div> : null}
        </header>
        {props.Description ? <div className="pk-plist__desc">{props.Description}</div> : null}
        <ListToolbar
          id={`list-${slug}`}
          action={base}
          query={toolbarQuery(query, cfg)}
          label={`Cari dan saring ${plural.toLocaleLowerCase('id')}`}
          search={cfg.searchFields.length ? { placeholder: `${cfg.searchFields.map((n) => colLabel(n)).join(', ')}…` } : undefined}
          filters={filters}
          dates={dates}
          keep={keep}
          resetHref={query.sort ? listHref(base, {}, { [SORT_PARAM]: query.sort }) : base}
          filteredHint={filtered}
          extra={<ColumnPicker slug={slug} columns={pickerColumns} visible={data.columns.filter((n) => n !== ROW_ACTIONS_FIELD)} defaults={cfg.defaultColumns.filter((n) => n !== ROW_ACTIONS_FIELD && data.available.includes(n))} all={cfg.columns.map((c) => c.name)} />}
        />
        {data.error ? (
          <p className="pk-plist__error" role="alert">
            {data.error}
          </p>
        ) : query.linkWhere ? (
          <p className="pk-plist__note" data-pk-link-filter>
            Daftar disaring dari tautan (mis. kartu dashboard).{' '}
            <Link href={base} prefetch={false}>
              Tampilkan semua
            </Link>
          </p>
        ) : null}
        {props.BeforeListTable}
        {docs.length === 0 ? (
          <div className="pk-plist__empty" data-pk-empty={slug}>
            <p>{filtered ? 'Tidak ada data yang cocok dengan pencarian / filter.' : `Belum ada data ${plural.toLocaleLowerCase('id')}.`}</p>
            {!filtered && createHref ? (
              <Link href={createHref} prefetch={false} className="pk-ltb__btn pk-ltb__btn--primary">
                + Buat baru
              </Link>
            ) : null}
          </div>
        ) : (
          <TableScroll label={`Daftar ${plural.toLocaleLowerCase('id')}`}>
            <div className="table pk-plist__table">
              <RelationshipProvider>
                <table>
                  <thead>
                    <tr>
                      {shown.flatMap((c, ci) => {
                        const name = c.accessor
                        const text = colLabel(name, c.field)
                        const dir = query.sort === name ? 'ascending' : query.sort === `-${name}` ? 'descending' : undefined
                        return [
                          ...(ci === fillAt ? [fill()] : []),
                          <th key={name} scope="col" aria-sort={dir} className={`pk-plist__th cell-${name}`}>
                            {sortable.has(name) ? (
                              <Link href={listHref(base, searchParams, { [SORT_PARAM]: nextSort(query.sort, name) })} prefetch={false} className="pk-plist__sort" data-pk-sort={name}>
                                <span>{text}</span>
                                <span className="pk-plist__sort-ind" aria-hidden="true">
                                  {dir === 'ascending' ? '▲' : dir === 'descending' ? '▼' : '↕'}
                                </span>
                              </Link>
                            ) : (
                              text
                            )}
                          </th>,
                        ]
                      })}
                      {fillAt === shown.length ? fill() : null}
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc, i) => (
                      <ClickableRow key={String(doc.id)} href={rowHref(doc.id)} data-id={String(doc.id)} className={`row-${i + 1}`}>
                        {shown.flatMap((c, ci) => [
                          ...(ci === fillAt ? [fill()] : []),
                          <td key={c.accessor} className={`cell-${c.accessor}`}>
                            {c.accessor === ROW_ACTIONS_FIELD ? c.renderedCells[i] : <div className={wraps(c.field) ? 'pk-plist__cell pk-plist__cell--wrap' : 'pk-plist__cell'}>{c.renderedCells[i]}</div>}
                          </td>,
                        ])}
                        {fillAt === shown.length ? fill() : null}
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </RelationshipProvider>
            </div>
          </TableScroll>
        )}
        {props.AfterListTable}
        {page.total > 0 ? <Pager id={`list-${slug}`} path={base} sp={searchParams} page={page} unit="data" /> : null}
      </Gutter>
      {props.AfterList}
    </div>
  )
}

export default PkListView
