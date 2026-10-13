import type { CollectionConfig } from 'payload'

import { COMPANY_LIST_FILTER } from '../company-list'

/**
 * DRMS 13/10 Umum #3–#8: the generic list view (PkListView) on every collection list, applied once in
 * payload.config.ts (a new collection gets it automatically; unit test guards the set). Skipped:
 * - upload collections (media libraries): Payload's list keeps the thumbnails, bulk upload and the
 *   "choose existing file" drawer of upload fields;
 * - collections that set their own `admin.components.views.list`.
 * The PT chips (CompanyListFilter, single choice) are dropped from `beforeListTable` there — PkListView has
 * the PT multi-select in its filter bar. Plain data (import-map path); no React import — collection configs
 * also load in the worker.
 */
export const PK_LIST_VIEW = '@/admin/pk-list/PkListView#PkListView'

export function usesPkListView(c: Pick<CollectionConfig, 'upload' | 'admin'>): boolean {
  const list = c.admin?.components?.views?.list
  return !c.upload && (!list || (list as { Component?: unknown }).Component === PK_LIST_VIEW)
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v]
}

export function withPkListView(collections: CollectionConfig[]): CollectionConfig[] {
  return collections.map((c) => {
    if (!usesPkListView(c)) return c
    const admin = c.admin ?? {}
    const components = admin.components ?? {}
    const before = asArray(components.beforeListTable).filter((x) => x !== COMPANY_LIST_FILTER)
    const { beforeListTable: _drop, ...rest } = components
    return {
      ...c,
      admin: {
        ...admin,
        components: {
          ...rest,
          ...(before.length ? { beforeListTable: before } : {}),
          views: { ...components.views, list: { Component: PK_LIST_VIEW } },
        },
      },
    }
  })
}
