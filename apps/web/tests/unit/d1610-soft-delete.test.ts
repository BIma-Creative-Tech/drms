import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CollectionConfig, SanitizedConfig, Where } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { withCompanyContext, type Role } from '@/access/roles'
import { DELETED_PARAM, deletedModeOf } from '@/admin/pk-list/data'
import { buildOpenApiDocument } from '@/api/v1/openapi'
import { ProjectListQuery } from '@/api/v1/schemas-projects'
import { RecordCollection, RecordReason } from '@/api/v1/schemas-records'
import { AUDIT_ACTIONS } from '@/audit/writer'
import { PROJECT_STATUSES } from '@/collections/Projects'
import { Vendors } from '@/collections/Vendors'
import { deletedRowGuard, hideDeleted, mayShowDeleted, softDeleteFields, withSoftDelete } from '@/domain/soft-delete/collection'
import { ignoredReference, INCLUDE_DELETED, IS_DELETED, SOFT_DELETE, SOFT_DELETE_ENTRIES, SOFT_DELETE_SLUGS } from '@/domain/soft-delete/registry'
import { isNeverSubmittedDraft, PROJECT_CANCELLABLE, requestCancellable } from '@/domain/soft-delete/service'
import { andNotDeleted, isIdLookup, mentionsField, NOT_DELETED, ONLY_DELETED, readWhere, WITH_DELETED } from '@/domain/soft-delete/where'
import { closedProjectMessage, isClosedProjectStatus, PROJECT_CLOSED_STATUSES } from '@/domain/projects/status'
import { migrations } from '@/migrations'
import { SOFT_DELETE_TABLES } from '@/migrations/20261016_200100_d1610_soft_delete'
import { D1710_SOFT_DELETE_TABLES } from '@/migrations/20261017_100000_d1710_service_types'

/**
 * D1610 (ADR 0030): soft delete per row ("Hapus"), the central "hide deleted rows" read rule, restore and
 * "Batalkan proyek" — the pure parts. The DB-bound parts (usage check, endpoints, cascade) are in
 * tests/integration/d1610-soft-delete.int.test.ts.
 */

const userWith = (roles: Role[], opts: { company?: number; groupAdmin?: boolean } = {}) =>
  withCompanyContext({ id: 7, collection: 'users' }, [{ company: opts.company ?? 1, roles, employee: null }], null, opts.groupAdmin === true)

const hook = (args: Record<string, unknown>, operation: string, user: unknown, extra: { overrideAccess?: boolean; context?: Record<string, unknown> } = {}) =>
  hideDeleted({ args, operation, overrideAccess: extra.overrideAccess, req: { user, context: extra.context ?? {} }, context: {}, collection: {} } as never) as { where?: Where }

describe('where rules (pure)', () => {
  it('mentionsField finds the field at any depth of and / or', () => {
    expect(mentionsField({ isDeleted: { equals: true } }, IS_DELETED)).toBe(true)
    expect(mentionsField({ and: [{ name: { like: 'a' } }, { or: [{ isDeleted: { equals: true } }] }] }, IS_DELETED)).toBe(true)
    expect(mentionsField({ and: [{ name: { like: 'a' } }] }, IS_DELETED)).toBe(false)
    expect(mentionsField(undefined, IS_DELETED)).toBe(false)
  })

  it('isIdLookup: explicit ids (equals / in) at the top or as one conjunct of and — never not_in, never inside or', () => {
    expect(isIdLookup({ id: { in: [1, 2] } })).toBe(true)
    expect(isIdLookup({ id: { equals: 3 } })).toBe(true)
    expect(isIdLookup({ and: [{ id: { in: [3] } }, { company: { equals: 1 } }] })).toBe(true)
    expect(isIdLookup({ id: { not_in: [1] } })).toBe(false)
    expect(isIdLookup({ or: [{ id: { equals: 1 } }, { name: { like: 'x' } }] })).toBe(false)
    expect(isIdLookup({ name: { like: 'x' } })).toBe(false)
    expect(isIdLookup(undefined)).toBe(false)
  })

  it('readWhere: lists get isDeleted != true; id lookups unchanged; an explicit isDeleted kept only when allowed', () => {
    expect(readWhere(undefined, { byId: false, mayIncludeDeleted: false })).toEqual(NOT_DELETED)
    expect(readWhere({}, { byId: false, mayIncludeDeleted: false })).toEqual(NOT_DELETED)
    expect(readWhere({ name: { like: 'a' } }, { byId: false, mayIncludeDeleted: true })).toEqual({ and: [{ name: { like: 'a' } }, NOT_DELETED] })
    expect(readWhere(undefined, { byId: true, mayIncludeDeleted: false })).toBeNull()
    expect(readWhere({ id: { in: [5] } }, { byId: false, mayIncludeDeleted: false })).toBeNull()
    expect(readWhere(ONLY_DELETED, { byId: false, mayIncludeDeleted: true })).toBeNull()
    expect(readWhere(ONLY_DELETED, { byId: false, mayIncludeDeleted: false })).toEqual({ and: [ONLY_DELETED, NOT_DELETED] })
    expect(andNotDeleted(WITH_DELETED)).toEqual({ and: [WITH_DELETED, NOT_DELETED] })
  })
})

describe('hideDeleted (beforeOperation of every registry collection)', () => {
  const staff = userWith(['pk-staff'])
  const ptAdmin = userWith(['pk-admin'])
  it('find / count / findDistinct of a non-Admin: deleted rows hidden, even when asked for', () => {
    expect(hook({ where: { name: { like: 'x' } } }, 'read', staff).where).toEqual({ and: [{ name: { like: 'x' } }, NOT_DELETED] })
    expect(hook({}, 'count', staff).where).toEqual(NOT_DELETED)
    expect(hook({ where: ONLY_DELETED }, 'readDistinct', staff).where).toEqual({ and: [ONLY_DELETED, NOT_DELETED] })
  })
  it('findByID and id lookups (labels, population) unchanged; writes untouched', () => {
    const byId = { id: 5 }
    expect(hook(byId, 'read', staff)).toBe(byId)
    const lookup = { where: { id: { in: [5, 6] } } }
    expect(hook(lookup, 'read', staff)).toBe(lookup)
    const upd = { where: { name: { equals: 'x' } } }
    expect(hook(upd, 'update', staff)).toBe(upd)
  })
  it('an explicit isDeleted condition is kept for an Admin, a system read and a server opt-in', () => {
    const ask = { where: WITH_DELETED }
    expect(hook(ask, 'read', ptAdmin)).toBe(ask)
    expect(hook(ask, 'read', staff, { overrideAccess: true })).toBe(ask)
    expect(hook(ask, 'read', staff, { context: { [INCLUDE_DELETED]: true } })).toBe(ask)
    // a system list without the condition still hides them
    expect(hook({ where: { name: { like: 'x' } } }, 'read', null, { overrideAccess: true }).where).toEqual({ and: [{ name: { like: 'x' } }, NOT_DELETED] })
  })
  it('mayShowDeleted: pk-admin of a selected PT or group admin', () => {
    expect(mayShowDeleted({ user: ptAdmin } as never)).toBe(true)
    expect(mayShowDeleted({ user: userWith(['pk-owner', 'pk-finance', 'pk-pm']) } as never)).toBe(false)
    expect(mayShowDeleted({ user: userWith(['pk-staff'], { groupAdmin: true }) } as never)).toBe(true)
    expect(mayShowDeleted({ user: null })).toBe(false)
  })
})

describe('deletedRowGuard + fields', () => {
  it('a deleted row is frozen until restored; live rows and creates pass', () => {
    expect(() => deletedRowGuard({ data: { name: 'x' }, operation: 'update', originalDoc: { id: 1, isDeleted: true } } as never)).toThrow(/sudah dihapus/)
    expect(deletedRowGuard({ data: { name: 'x' }, operation: 'update', originalDoc: { id: 1, isDeleted: false } } as never)).toEqual({ name: 'x' })
    expect(deletedRowGuard({ data: { name: 'x' }, operation: 'create' } as never)).toEqual({ name: 'x' })
  })
  it('the four fields are read-only for everyone (create / update access false) and hidden from the list columns', () => {
    const fields = softDeleteFields() as unknown as Array<{ name: string; access: { create: () => boolean; update: () => boolean }; admin: { disableListColumn?: boolean; readOnly?: boolean } }>
    expect(fields.map((f) => f.name)).toEqual(['isDeleted', 'deletedAt', 'deletedBy', 'deleteReason'])
    for (const f of fields) {
      expect(f.access.create(), f.name).toBe(false)
      expect(f.access.update(), f.name).toBe(false)
      expect(f.admin.disableListColumn, f.name).toBe(true)
      expect(f.admin.readOnly, f.name).toBe(true)
    }
  })
  it('withSoftDelete: registry collections only, idempotent; join fields to a registry collection get isDeleted != true', () => {
    // a join (tab) pointing at a registry collection — the vendor's former "Rekening" tab shape
    const other: CollectionConfig = { slug: 'things', fields: [{ name: 'name', type: 'text' }, { type: 'tabs', tabs: [{ label: 'Rekening', fields: [{ name: 'accounts', type: 'join', collection: 'vendor-bank-accounts', on: 'vendor' }] }] }] }
    const [vendors, things] = withSoftDelete([Vendors, other])
    expect(vendors!.fields.filter((f) => 'name' in f && f.name === IS_DELETED)).toHaveLength(1)
    expect(withSoftDelete([vendors!])[0]!.fields.filter((f) => 'name' in f && f.name === IS_DELETED)).toHaveLength(1)
    expect(vendors!.hooks?.beforeOperation).toContain(hideDeleted)
    expect(vendors!.hooks?.beforeChange?.[0]).toBe(deletedRowGuard)
    expect(things!.fields.some((f) => 'name' in f && f.name === IS_DELETED)).toBe(false)
    const tabs = things!.fields.find((f) => f.type === 'tabs') as unknown as { tabs: Array<{ fields: Array<{ type: string; where?: Where }> }> }
    const join = tabs.tabs.flatMap((t) => t.fields).find((f) => f.type === 'join')!
    expect(join.where).toEqual(NOT_DELETED)
  })
})

describe('registry vs the real config, the migration and the snapshot', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    process.env.PK_SKIP_ENV_CHECK = 'true'
    config = await (await import('@/payload.config')).default
  })

  it('every registry slug is a collection with the fields, the read rule, the guard — and delete still denied', async () => {
    const admin = { req: { user: { id: 1, roles: ['pk-admin', 'pk-owner', 'pk-finance', 'pk-pm', 'pk-staff'] }, context: {} } }
    for (const slug of SOFT_DELETE_SLUGS) {
      const c = config.collections.find((x) => x.slug === slug)
      expect(c, slug).toBeDefined()
      const names = c!.flattenedFields.map((f) => f.name)
      for (const n of ['isDeleted', 'deletedAt', 'deletedBy', 'deleteReason']) expect(names, `${slug}.${n}`).toContain(n)
      expect(c!.hooks.beforeOperation, slug).toContain(hideDeleted)
      expect(c!.hooks.beforeChange[0], slug).toBe(deletedRowGuard)
      expect(await c!.access.delete(admin as never), slug).toBe(false)
      expect(SOFT_DELETE[slug]!.table, slug).toBe(slug.replace(/-/g, '_'))
      // shared masters (no company column) are the only "shared" entries
      expect(SOFT_DELETE[slug]!.shared, slug).toBe(!names.includes('company'))
    }
    // nothing else got the fields
    for (const c of config.collections.filter((x) => !SOFT_DELETE_SLUGS.includes(x.slug))) expect(c.flattenedFields.some((f) => f.name === IS_DELETED), c.slug).toBe(false)
  })

  it('cascade children are registry collections themselves (they carry the columns)', () => {
    for (const e of SOFT_DELETE_ENTRIES) for (const o of e.owned.filter((x) => x.cascade)) expect(SOFT_DELETE_ENTRIES.some((x) => x.table === o.table), `${e.slug} → ${o.table}`).toBe(true)
  })

  it('migration: enums before schema, frozen table list = registry, snapshot carries the columns and enum values', () => {
    const names = migrations.map((m) => m.name)
    const e = names.indexOf('20261016_200000_d1610_soft_delete_enums')
    const s = names.indexOf('20261016_200100_d1610_soft_delete')
    expect(e).toBeGreaterThan(0)
    expect(s).toBe(e + 1)
    // later migrations create their soft-deletable tables with the columns from the start (DRMS owner 2026-10-17: service_types)
    expect([...SOFT_DELETE_TABLES, ...D1710_SOFT_DELETE_TABLES].sort()).toEqual(SOFT_DELETE_ENTRIES.map((x) => x.table).sort())
    const dir = join(__dirname, '../../src/migrations')
    const enums = readFileSync(join(dir, '20261016_200000_d1610_soft_delete_enums.ts'), 'utf8')
    expect(enums).toContain(`"enum_projects_status" ADD VALUE IF NOT EXISTS 'dibatalkan'`)
    expect(enums).toContain(`"enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'soft_delete'`)
    expect(enums).toContain(`"enum_audit_logs_action" ADD VALUE IF NOT EXISTS 'restore'`)
    const snapshot = JSON.parse(readFileSync(join(dir, '20261016_200100_d1610_soft_delete.json'), 'utf8')) as { enums: Record<string, { values: string[] }>; tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown>; foreignKeys: Record<string, unknown> }> }
    expect(snapshot.enums['public.enum_projects_status']!.values).toEqual(PROJECT_STATUSES.map((x) => x.value))
    expect(snapshot.enums['public.enum_audit_logs_action']!.values).toEqual([...AUDIT_ACTIONS])
    for (const t of SOFT_DELETE_TABLES) {
      const tb = snapshot.tables[`public.${t}`]!
      for (const c of ['is_deleted', 'deleted_at', 'deleted_by_id', 'delete_reason']) expect(tb.columns, `${t}.${c}`).toHaveProperty(c)
      expect(tb.indexes, t).toHaveProperty(`${t}_is_deleted_idx`)
      expect(tb.indexes, t).toHaveProperty(`${t}_deleted_by_idx`)
      expect(tb.foreignKeys, t).toHaveProperty(`${t}_deleted_by_id_users_id_fk`)
    }
    for (const c of ['cancel_reason', 'cancelled_at', 'cancelled_by_id']) expect(snapshot.tables['public.projects']!.columns).toHaveProperty(c)
  })
})

describe('usage + request rules (pure)', () => {
  it('ignored references: own sub-tables, Payload system tables, deleted_by_id', () => {
    expect(ignoredReference('vendors', 'payload_locked_documents_rels', 'vendors_id')).toBe(true)
    expect(ignoredReference('expense_categories', 'expense_categories_rels', 'parent_id')).toBe(true)
    expect(ignoredReference('stage_templates', 'stage_templates_items', '_parent_id')).toBe(true)
    expect(ignoredReference('banks', 'vendors', 'deleted_by_id')).toBe(true)
    // a hasMany of ANOTHER collection is a real use
    expect(ignoredReference('uoms', 'expense_categories_rels', 'uoms_id')).toBe(false)
    expect(ignoredReference('projects', 'expense_requests', 'project_id')).toBe(false)
  })
  it('a request is deleted only as a never-submitted draft', () => {
    expect(isNeverSubmittedDraft({ status: 'draft', doc_no: null })).toBe(true)
    expect(isNeverSubmittedDraft({ status: 'draft', docNo: '' })).toBe(true)
    // withdrawn back to draft: it has a number → cancel, never delete
    expect(isNeverSubmittedDraft({ status: 'draft', docNo: 'PB/DRMS/2610/0001' })).toBe(false)
    expect(isNeverSubmittedDraft({ status: 'pending_approval', docNo: null })).toBe(false)
  })
  it('the cascade cancels exactly the state machine cancel rows', () => {
    const c = (type: string, status: string, payeeType = 'karyawan') => requestCancellable({ type, status, payeeType })
    for (const s of ['draft', 'pending_ack', 'pending_approval', 'approved']) expect(c('advance', s), s).toBe(true)
    for (const s of ['approved', 'receipts_verified', 'receipt_revision']) expect(c('reimburse', s), s).toBe(true)
    for (const s of ['transferred', 'receipts_complete', 'lpj_submitted', 'lpj_revision', 'lpj_verified', 'completed', 'cancelled', 'rejected']) expect(c('advance', s), s).toBe(false)
    expect(c('reimburse', 'transferred')).toBe(false)
    expect(c('advance', 'approved', 'vendor')).toBe(true)
  })
})

describe('project status Dibatalkan', () => {
  it('is a status option, closed like Arsip, cancellable only from the running statuses', () => {
    expect(PROJECT_STATUSES.map((s) => s.value)).toContain('dibatalkan')
    expect(PROJECT_CLOSED_STATUSES).toEqual(['arsip', 'dibatalkan'])
    expect(isClosedProjectStatus('dibatalkan')).toBe(true)
    expect(isClosedProjectStatus('berjalan')).toBe(false)
    expect(closedProjectMessage('dibatalkan')).toBe('Project sudah dibatalkan.')
    expect(closedProjectMessage('arsip')).toBe('Project sudah diarsipkan.')
    expect([...PROJECT_CANCELLABLE]).toEqual(['perencanaan', 'berjalan', 'ditunda'])
  })
  it('the form neither sets nor leaves Dibatalkan (only the cancel action)', async () => {
    const { Projects } = await import('@/collections/Projects')
    const guards = Projects.hooks?.beforeChange ?? []
    const run = async (data: Record<string, unknown>, originalDoc?: Record<string, unknown>) => {
      for (const g of guards) if ((g as unknown as { name?: string }).name === 'cancelStatusGuard') return g({ data, originalDoc, operation: originalDoc ? 'update' : 'create', req: {} } as never)
      throw new Error('cancelStatusGuard missing')
    }
    await expect(run({ status: 'dibatalkan' }, { status: 'berjalan' })).rejects.toThrow(/Batalkan proyek/)
    await expect(run({ status: 'dibatalkan' })).rejects.toThrow(/Batalkan proyek/)
    await expect(run({ status: 'berjalan' }, { status: 'dibatalkan' })).rejects.toThrow(/tidak dapat diaktifkan kembali/)
    await expect(run({ name: 'x' }, { status: 'dibatalkan' })).resolves.toEqual({ name: 'x' })
    await expect(run({ status: 'selesai' }, { status: 'berjalan' })).resolves.toEqual({ status: 'selesai' })
  })
  it('the select hides Dibatalkan unless the project is cancelled', async () => {
    const { Projects } = await import('@/collections/Projects')
    const status = Projects.fields.find((f) => 'name' in f && f.name === 'status') as unknown as { filterOptions: (a: { options: Array<{ value: string }>; data: Record<string, unknown> }) => Array<{ value: string }> }
    const options = [...PROJECT_STATUSES] as Array<{ value: string }>
    expect(status.filterOptions({ options, data: { status: 'berjalan' } }).map((o) => o.value)).not.toContain('dibatalkan')
    expect(status.filterOptions({ options, data: { status: 'dibatalkan' } }).map((o) => o.value)).toContain('dibatalkan')
  })
})

describe('API contract', () => {
  it('reason 3–1000 characters; collection = the registry', () => {
    expect(RecordReason.safeParse({ reason: 'ok' }).success).toBe(false)
    expect(RecordReason.safeParse({ reason: '  salah input  ' }).success).toBe(true)
    expect(RecordReason.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false)
    expect(RecordReason.safeParse({ reason: 'salah input', extra: 1 }).success).toBe(false)
    expect(RecordCollection.safeParse('vendors').success).toBe(true)
    expect(RecordCollection.safeParse('cash-entries').success).toBe(false)
  })
  it('project list accepts dibatalkan; the OpenAPI document has the five paths', () => {
    expect(ProjectListQuery.safeParse({ status: 'arsip,dibatalkan' }).success).toBe(true)
    const doc = buildOpenApiDocument('0.0.0') as unknown as { paths: Record<string, unknown> }
    for (const p of ['/records/{collection}/{id}/delete-check', '/records/{collection}/{id}/delete', '/records/{collection}/{id}/restore', '/projects/{id}/cancel-plan', '/projects/{id}/cancel']) expect(doc.paths, p).toHaveProperty([p])
  })
  it('audit actions soft_delete and restore exist', () => {
    expect(AUDIT_ACTIONS).toContain('soft_delete')
    expect(AUDIT_ACTIONS).toContain('restore')
  })
})

describe('admin list filter "Tampilkan yang dihapus"', () => {
  it('offered to Admins on registry collections only; the URL value is ignored for everyone else', () => {
    expect(DELETED_PARAM).toBe('dihapus')
    expect(deletedModeOf('vendors', userWith(['pk-admin']) as never, { dihapus: 'tampil' })).toEqual({ allowed: true, mode: 'tampil' })
    expect(deletedModeOf('vendors', userWith(['pk-admin']) as never, { dihapus: 'hanya' })).toEqual({ allowed: true, mode: 'hanya' })
    expect(deletedModeOf('vendors', userWith(['pk-admin']) as never, { dihapus: 'semua' })).toEqual({ allowed: true, mode: '' })
    expect(deletedModeOf('vendors', userWith(['pk-finance']) as never, { dihapus: 'tampil' })).toEqual({ allowed: false, mode: '' })
    expect(deletedModeOf('cash-entries', userWith(['pk-admin']) as never, { dihapus: 'tampil' })).toEqual({ allowed: false, mode: '' })
  })
})
