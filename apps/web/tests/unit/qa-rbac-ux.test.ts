import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Field, FlattenedField, SanitizedConfig } from 'payload'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { changedFields } from '@/access/field-guard'
import { inIds, NO_ROWS } from '@/access/scope'
import { problemText, promptLabel, statusText } from '@/admin/components/ActionButton'
import { batchErrors } from '@/admin/components/access/role-matrix'
import { payloadError } from '@/admin/components/absensi/AttendanceActions'
import { boolText } from '@/admin/components/BoolCell'
import { createRouteSlug } from '@/admin/denied-create'
import { ACTIVE_CELL, isServerTimestamp, SERVER_TIME_CELL, SERVER_TIME_FIELD, withDisplayCells, YES_NO_CELL } from '@/admin/display-cells'
import { NO_ACCESS_TEXT, NoAccessBody } from '@/admin/views/no-access-body'
import { DISPLAY_NAME, displayNameQuery, rewriteDisplayNameWhere, userLabel } from '@/fields/users'
import { errorLine, fieldLabel } from '@/lib/field-labels'
import { formatServerTimestamp } from '@/lib/server-time'

/**
 * QA report 2026-10-08 — hak akses & UX (branch fix/qa-rbac-ux): pure parts of QA-16, QA-20, QA-21,
 * QA-22/23, QA-24, QA-25, QA-28, QA-29 and QA-31. DB-bound behaviour: tests/integration/qa-rbac-ux.int.test.ts.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const src = (p: string) => readFileSync(path.resolve(here, '../../src', p), 'utf8')

let config: SanitizedConfig
beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

describe('QA-28 empty scope = empty list, not 403', () => {
  it('inIds: ids → IN, nothing → a Where no row matches (never `false`, never an empty IN)', () => {
    expect(inIds('project', [3, 1])).toEqual({ project: { in: [3, 1] } })
    expect(inIds('id', [])).toBe(NO_ROWS)
    expect(NO_ROWS).toEqual({ id: { equals: 0 } })
  })
})

describe('QA-16 user labels and picker queries', () => {
  it('name with the email as secondary; email alone without a name', () => {
    expect(userLabel({ name: ' Budi Santoso ', email: 'budi@pt.test' })).toBe('Budi Santoso · budi@pt.test')
    expect(userLabel({ name: '', email: 'x@pt.test' })).toBe('x@pt.test')
    expect(userLabel({ name: 'Sari' })).toBe('Sari')
    expect(userLabel(null)).toBe('')
  })

  it('users.useAsTitle is the virtual displayName; list search uses the stored columns', () => {
    const users = config.collections.find((c) => c.slug === 'users')!
    expect(users.admin.useAsTitle).toBe(DISPLAY_NAME)
    expect(users.admin.listSearchableFields).toEqual(['name', 'email'])
    const f = users.flattenedFields.find((x) => x.name === DISPLAY_NAME) as FlattenedField & { virtual?: boolean }
    expect(f.virtual).toBe(true)
  })

  it('picker search on the title → OR over name/email; select of the title adds its sources; sort by name', () => {
    expect(rewriteDisplayNameWhere({ and: [{ id: { not_in: [1] } }, { displayName: { like: 'bud' } }] })).toEqual({
      and: [{ id: { not_in: [1] } }, { or: [{ name: { like: 'bud' } }, { email: { like: 'bud' } }] }],
    })
    expect(rewriteDisplayNameWhere({ displayName: { equals: 'x' }, active: { equals: true } })).toEqual({
      and: [{ active: { equals: true } }, { or: [{ name: { equals: 'x' } }, { email: { equals: 'x' } }] }],
    })
    const args = { select: { displayName: true }, where: { displayName: { like: 'a' } }, sort: '-displayName' }
    displayNameQuery({ args, operation: 'read' } as never)
    expect(args).toEqual({ select: { displayName: true, name: true, email: true }, where: { or: [{ name: { like: 'a' } }, { email: { like: 'a' } }] }, sort: '-name' })
    const untouched = { where: { displayName: { like: 'a' } } }
    displayNameQuery({ args: untouched, operation: 'update' } as never)
    expect(untouched.where).toEqual({ displayName: { like: 'a' } })
  })

  it('every editable user picker is filtered (projects.pm, cost-centers.manager, approval-rules users)', () => {
    const rel = (slug: string, name: string) => {
      const c = config.collections.find((x) => x.slug === slug)!
      const walk = (fs: readonly FlattenedField[]): FlattenedField | undefined => {
        for (const f of fs) {
          if (f.name === name) return f
          if ('flattenedFields' in f && Array.isArray(f.flattenedFields)) {
            const hit = walk(f.flattenedFields as FlattenedField[])
            if (hit) return hit
          }
        }
        return undefined
      }
      return walk(c.flattenedFields) as (FlattenedField & { filterOptions?: unknown }) | undefined
    }
    for (const [slug, name] of [
      ['projects', 'pm'],
      ['cost-centers', 'manager'],
      ['approval-rules', 'acknowledgeUser'],
      ['approval-rules', 'approverUser'],
    ] as const) {
      expect(typeof rel(slug, name)?.filterOptions, `${slug}.${name}`).toBe('function')
    }
  })
})

describe('QA-20(b) changed-field detection (403 naming the fields)', () => {
  const fields = [
    { name: 'name', type: 'text', label: 'Nama project' },
    { name: 'budget', type: 'number', label: 'RAB (Rp)' },
    { name: 'pm', type: 'relationship', relationTo: 'users' },
    { name: 'startDate', type: 'date' },
    { name: 'company', type: 'relationship', relationTo: 'companies' },
  ] as unknown as FlattenedField[]
  const current = { name: 'Gedung A', budget: 1000, pm: 7, startDate: '2026-10-01T04:00:00.000Z', company: 1 }

  it('only fields present AND different count (relationship ids, dates, numeric strings normalised)', () => {
    expect(changedFields(fields, { name: 'Gedung A', budget: '1000', pm: { id: 7 }, startDate: '2026-10-01T04:00:00Z', company: 2 }, current)).toEqual([])
    expect(changedFields(fields, { name: 'Gedung B', budget: 2000 }, current).map((f) => f.name)).toEqual(['name', 'budget'])
    expect(changedFields(fields, { pm: 8 }, current).map((f) => f.name)).toEqual(['pm'])
  })

  it('projects: Direktur/Admin update all, PM their team only (owner decision 2026-10-09 reverses QA-20(b)); the guard runs before access', () => {
    const p = config.collections.find((c) => c.slug === 'projects')!
    expect((p.hooks.beforeOperation ?? []).length).toBeGreaterThanOrEqual(2)
    expect(src('collections/Projects.ts')).toMatch(/update: byRole\(\{\s*'pk-owner': true,\s*'pk-admin': true,\s*'pk-pm':/)
  })
})

describe('QA-20(c) / QA-24 uniform no-access page', () => {
  it('one text + a back link, no role codes', () => {
    const html = renderToStaticMarkup(React.createElement(NoAccessBody))
    expect(html).toContain(NO_ACCESS_TEXT)
    expect(html).toContain('href="/admin"')
    expect(html).not.toMatch(/pk-(finance|owner|admin|pm|staff)/)
  })

  it('no custom view still says "Halaman ini hanya untuk"', () => {
    for (const f of ['Kas', 'Reports', 'Addendum', 'Progress', 'AksesPt', 'Absensi', 'shared']) {
      expect(src(`admin/views/${f}.tsx`), f).not.toMatch(/Halaman ini (hanya )?untuk/)
    }
  })

  it('Payload unauthorized view is ours; /collections/<slug>/create is the only redirected route', () => {
    const views = config.admin.components.views as Record<string, { Component?: unknown }>
    expect(views.unauthorized?.Component).toBe('@/admin/views/NoAccess#UnauthorizedView')
    expect(createRouteSlug(['collections', 'team-assignments', 'create'])).toBe('team-assignments')
    expect(createRouteSlug(['collections', 'team-assignments', '5'])).toBeNull()
    expect(createRouteSlug(['collections', 'team-assignments'])).toBeNull()
    expect(createRouteSlug(undefined)).toBeNull()
    expect(src('app/(payload)/admin/[[...segments]]/page.tsx')).toMatch(/redirectDeniedCreate/)
  })
})

describe('QA-21 messages in the user language, no raw paths / internal codes', () => {
  it('field labels for API paths, line paths numbered from 1, unknown paths dropped', () => {
    expect(fieldLabel('usageNotes')).toBe('Uraian penggunaan dana')
    expect(fieldLabel('lines.2.uomId')).toBe('Baris 3 · Satuan')
    expect(fieldLabel('items.0.company_id')).toBe('Baris 1 · PT')
    expect(fieldLabel('payload.lines.0.receipts.1')).toBeNull()
    expect(errorLine({ path: 'lines', message: 'Minimal 1 baris item.' })).toBe('Rincian item: Minimal 1 baris item.')
    expect(errorLine({ path: 'somethingInternal', message: 'Wajib.' })).toBe('Wajib.')
  })

  it('problemText: labels instead of paths, never "HTTP 403" or an English reason phrase', () => {
    expect(problemText({ title: 'Bad Request', detail: 'Periksa isian.', errors: [{ path: 'usageNotes', message: 'Wajib diisi.' }] }, 400)).toBe('Periksa isian. — Uraian penggunaan dana: Wajib diisi.')
    expect(problemText({ title: 'Forbidden' }, 403)).toBe(statusText(403))
    expect(problemText(null, 500)).not.toMatch(/HTTP/)
    expect(payloadError({ errors: [{ message: 'x', data: { errors: [{ path: 'code', message: 'Kode sudah dipakai.' }] } }] }, 400)).toBe('Kode: Kode sudah dipakai.')
    expect(payloadError(null, 500)).not.toMatch(/HTTP/)
    expect(batchErrors({ errors: [{ path: 'reason', message: 'Wajib.' }] }, []).general).toEqual(['Alasan: Wajib.'])
  })

  it('domain messages carry no US-xx / ADR / G-x / Q-x codes and no API field names', () => {
    expect(src('domain/expense/workflow.ts')).not.toMatch(/signatureMediaId \(US-43\)/)
    const failLines = ['domain/expense/drafts.ts', 'domain/expense/common.ts', 'domain/expense/snapshot.ts', 'domain/expense/transfers.ts', 'domain/addendum/service.ts', 'domain/progress/stages.ts', 'domain/expense/workflow.ts']
      .flatMap((f) => src(f).split('\n').filter((l) => /fail\(|message: '/.test(l)))
      .filter((l) => /\((US-\d+|ADR \d+|G\d+|Q-\d+)\)/.test(l))
    expect(failLines).toEqual([])
  })

  it('every ValidationError goes through validationError (req.t + field labels)', () => {
    for (const f of ['audit/hooks.ts', 'fields/company.ts', 'collections/Employees.ts', 'collections/ExpenseRequests.ts']) expect(src(f), f).not.toMatch(/new ValidationError\(/)
  })
})

describe('QA-22 / QA-23 app dialogs instead of prompt/confirm/alert', () => {
  it('no window.prompt / confirm / alert in the admin components and views', () => {
    for (const f of ['admin/components/ActionButton.tsx', 'admin/components/RequesterActions.tsx', 'admin/components/ReimburseReceiptReview.tsx', 'admin/views/ApprovalInbox.tsx', 'admin/views/LpjVerification.tsx']) {
      expect(src(f), f).not.toMatch(/window\.(prompt|confirm|alert)\(/)
    }
  })

  it('reason label from the old prompt text', () => {
    expect(promptLabel('Alasan penolakan (wajib, minimal 3 karakter):')).toBe('Alasan penolakan')
    expect(promptLabel('Catatan pemeriksaan (opsional):')).toBe('Catatan pemeriksaan')
    expect(promptLabel('')).toBe('Alasan')
  })
})

describe('QA-25 server timestamps: same text on server and in any browser timezone', () => {
  it('fixed WITA text, independent of process.env.TZ', () => {
    const iso = '2026-10-07T22:30:00.000Z' // 06:30 WITA on 8 Oct
    const before = process.env.TZ
    const a = formatServerTimestamp(iso)
    process.env.TZ = 'America/New_York'
    const b = formatServerTimestamp(iso)
    process.env.TZ = before
    expect(a).toBe('8 Okt 2026 06:30 WITA')
    expect(b).toBe(a)
    expect(formatServerTimestamp(null)).toBe('—')
    expect(formatServerTimestamp('nope')).toBe('—')
  })

  it('read-only date+time fields get the fixed-text Field/Cell (expense-requests.submittedAt)', () => {
    const er = config.collections.find((c) => c.slug === 'expense-requests')!
    const f = er.fields.find((x) => 'name' in x && x.name === 'submittedAt') as Field & { admin?: { components?: { Field?: unknown; Cell?: unknown } } }
    expect(f.admin?.components?.Field).toBe(SERVER_TIME_FIELD)
    expect(f.admin?.components?.Cell).toBe(SERVER_TIME_CELL)
    expect(isServerTimestamp({ name: 'x', type: 'date', admin: { date: { pickerAppearance: 'dayOnly' }, readOnly: true } } as Field)).toBe(false)
  })

  it('RequesterActions formats Rupiah without Intl/locale (formatRupiah)', () => {
    expect(src('admin/components/RequesterActions.tsx')).not.toMatch(/toLocaleString\(/)
  })
})

describe('QA-29 display', () => {
  it('booleans "Aktif/Nonaktif" (active) and "Ya/Tidak", never "benar/salah"', () => {
    expect(boolText(true, 'active')).toBe('Aktif')
    expect(boolText(false, 'active')).toBe('Nonaktif')
    expect(boolText(true, 'yesno')).toBe('Ya')
    expect(boolText(false, 'yesno')).toBe('Tidak')
    expect(boolText(null, 'yesno')).toBe('—')
    const [c] = withDisplayCells([{ slug: 'x', fields: [{ name: 'active', type: 'checkbox' }, { type: 'row', fields: [{ name: 'flag', type: 'checkbox' }] }] }])
    const active = c!.fields[0] as Field & { admin?: { components?: { Cell?: unknown } } }
    const flag = (c!.fields[1] as { fields: Array<Field & { admin?: { components?: { Cell?: unknown } } }> }).fields[0]!
    expect(active.admin?.components?.Cell).toBe(ACTIVE_CELL)
    expect(flag.admin?.components?.Cell).toBe(YES_NO_CELL)
  })

  it('admin date format "d MMM yyyy HH:mm"', () => {
    expect(config.admin.dateFormat).toBe('d MMM yyyy HH:mm')
  })

  it('media: technical fields hidden while creating (no id), shown read-only on a saved file', () => {
    const m = config.collections.find((c) => c.slug === 'media-signatures')!
    for (const name of ['sha256Original', 'originalWidth', 'originalHeight', 'originalSize', 'uploadedBy', 'receivedAt']) {
      const f = m.fields.find((x) => 'name' in x && x.name === name) as Field & { admin?: { condition?: (d: unknown) => boolean; readOnly?: boolean } }
      expect(f.admin?.condition?.({}), name).toBe(false)
      expect(f.admin?.condition?.({ id: 3 }), name).toBe(true)
      expect(f.admin?.readOnly, name).toBe(true)
    }
  })
})

describe('QA-31 kas edit: proof editable, date/account/amount shown locked', () => {
  it('CashEntryUpdate accepts proofId (nullable); amount/date/account stay refused', async () => {
    const { CashEntryUpdate } = await import('@/api/v1/schemas-flow')
    expect(CashEntryUpdate.safeParse({ reason: 'bukti susulan', proofId: 12 }).success).toBe(true)
    expect(CashEntryUpdate.safeParse({ reason: 'hapus bukti', proofId: null }).success).toBe(true)
    for (const k of ['amount', 'entryDate', 'cashAccountId']) expect(CashEntryUpdate.safeParse({ reason: 'ubah', [k]: 1 }).success, k).toBe(false)
  })

  it('edit form shows the locked fields and a proof input', () => {
    const f = src('admin/components/kas/CashEntryForm.tsx')
    for (const k of ['entryDate', 'cashAccountId', 'amount']) expect(f).toContain(`data-pk-locked="${k}"`)
    expect(f).toContain('data-pk-field="proof"')
  })
})
