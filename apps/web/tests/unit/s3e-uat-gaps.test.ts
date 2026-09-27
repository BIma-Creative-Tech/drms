import type { Payload, TypedUser } from 'payload'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { F2NavLinks } from '@/admin/components/F2NavLinks'
import { openFlagCounts } from '@/admin/components/ReviewDetails'
import type { Role } from '@/access/roles'
import { bodyErrorDetail } from '@/api/v1/http'
import { AddendumReason } from '@/api/v1/schemas-addendum'
import { RejectBody, RevisionBody } from '@/api/v1/schemas-flow'
import { bankAccountOptions } from '@/collections/ExpenseRequests'
import { imageLimitError, MAX_INPUT_PIXELS } from '@/collections/media/factory'
import { effectiveRadiusM, geofenceError, withEffectiveRadius } from '@/domain/attendance/calendar'
import { TRANSFER_QUEUE_WHERE } from '@/domain/expense/types'
import { APPROVAL_EMAIL_EVENTS, approvalEmail, eventsFor, notificationHref, REQUESTER_STATUS_EVENTS } from '@/domain/notifications'
import { insideGeofence } from '@/domain/sync/attendance'

/** Sprint S3 track E — UAT gap fixes (docs/proyekkas/uat/fase1/README.md S-ids). */

const doc = (status: string, extra: Record<string, unknown> = {}) =>
  ({ id: 7, docNo: '001/PB-DRMS/IX/2026', type: 'reimburse', status, title: 'BBM Hilux', grandTotal: 1_447_500, requesters: [3], createdBy: 9, ...extra }) as never

describe('S-04 notifications: submit / withdraw / on behalf + approval email', () => {
  it('submit (Draft → waiting) informs the people besides the decider', () => {
    expect(eventsFor({ status: 'draft' }, doc('pending_ack'))).toEqual([
      { event: 'expense.pending_ack', to: 'ack' },
      { event: 'expense.submitted', to: 'people' },
    ])
    expect(eventsFor({ status: 'draft' }, doc('pending_approval')).map((e) => e.event)).toEqual(['expense.pending_approval', 'expense.submitted'])
  })

  it('re-approval after a receipt revision is not a "submitted" event', () => {
    expect(eventsFor({ status: 'receipt_revision' }, doc('pending_ack')).map((e) => e.event)).toEqual(['expense.pending_ack'])
  })

  it('withdraw (waiting → Draft) informs the people; other returns to Draft do not', () => {
    expect(eventsFor({ status: 'pending_ack' }, doc('draft'))).toEqual([{ event: 'expense.withdrawn', to: 'people' }])
    expect(eventsFor({ status: 'pending_approval' }, doc('draft'))).toEqual([{ event: 'expense.withdrawn', to: 'people' }])
    expect(eventsFor({ status: 'draft' }, doc('draft'))).toEqual([])
  })

  it('toggle sets: requester events vs approval email events', () => {
    expect([...REQUESTER_STATUS_EVENTS].sort()).toEqual(['expense.created_on_behalf', 'expense.submitted', 'expense.withdrawn'])
    expect([...APPROVAL_EMAIL_EVENTS].sort()).toEqual(['expense.pending_ack', 'expense.pending_approval'])
  })

  it('approval email: doc number + step + inbox link, no amount / requester names', () => {
    const m = approvalEmail(doc('pending_ack') as never, 'expense.pending_ack', 'https://kas.example.test/')
    expect(m.subject).toBe('ProyekKas — Menunggu keputusan Anda: 001/PB-DRMS/IX/2026')
    expect(m.text).toContain('menunggu persetujuan Anda sebagai Direktur (Diketahui)')
    expect(m.text).toContain('https://kas.example.test/admin/persetujuan')
    expect(m.text).not.toMatch(/Rp|1\.447\.500|BBM/)
    expect(approvalEmail(doc('pending_approval') as never, 'expense.pending_approval', undefined).text).toContain('menunggu approval Anda')
  })

  it('notification page links by document type', () => {
    expect(notificationHref('expense_request', '12')).toBe('/admin/collections/expense-requests/12')
    expect(notificationHref('project', '3')).toBe('/admin/progress/project/3')
    expect(notificationHref('budget_addendum', '4')).toBe('/admin/addendum/detail/4')
    expect(notificationHref('progress_report', '5')).toBe('/admin/progress/laporan/5')
    expect(notificationHref('expense_request', 'x')).toBeNull()
    expect(notificationHref('other', '1')).toBeNull()
  })
})

describe('S-03 bank account picker (US-44)', () => {
  it('lists active accounts of the requesters, else of the creator, else nothing', () => {
    expect(bankAccountOptions({ data: { requesters: [3, { id: 4 }] }, user: { employee: 9 } as never })).toEqual({ and: [{ employee: { in: [3, 4] } }, { active: { not_equals: false } }] })
    expect(bankAccountOptions({ data: {}, user: { employee: { id: 9 } } as never })).toEqual({ and: [{ employee: { in: [9] } }, { active: { not_equals: false } }] })
    expect(bankAccountOptions({ data: { requesters: [] }, user: {} as never })).toBe(false)
  })
})

describe('S-06 reject reason: specific messages', () => {
  it('reason < 3 chars → Indonesian message, used as problem detail', () => {
    const r = RejectBody.safeParse({ reason: ' a ' })
    expect(r.success).toBe(false)
    const errors = r.error!.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    expect(errors).toEqual([{ path: 'reason', message: 'Alasan wajib diisi, minimal 3 karakter.' }])
    expect(bodyErrorDetail(errors)).toBe('Alasan wajib diisi, minimal 3 karakter.')
    expect(RejectBody.safeParse({}).error!.issues[0]!.message).toBe('Alasan wajib diisi.')
    expect(RevisionBody.safeParse({ note: 'x' }).error!.issues[0]!.message).toBe('Catatan wajib diisi, minimal 3 karakter.')
    expect(AddendumReason.safeParse({ reason: 'x' }).error!.issues[0]!.message).toBe('Alasan wajib diisi, minimal 3 karakter.')
    expect(RejectBody.safeParse({ reason: 'Nota tidak jelas' }).success).toBe(true)
  })

  it('detail joins distinct messages (max 3) and falls back to the generic text', () => {
    expect(bodyErrorDetail([])).toBe('Data tidak valid.')
    const many = ['a', 'b', 'b', 'c', 'd'].map((m, i) => ({ path: String(i), message: m }))
    expect(bodyErrorDetail(many)).toBe('a b c (+1 lainnya)')
  })
})

describe('S-19 geofence: company default radius + GPS accuracy allowance', () => {
  it('radius optional with a point; not without a point', () => {
    expect(geofenceError({ lat: -3.3, lng: 114.6, radiusM: null })).toBeNull()
    expect(geofenceError({ lat: null, lng: null, radiusM: 100 })).toMatch(/titik lokasi/)
    expect(geofenceError({ lat: -3.3, lng: null, radiusM: null })).toMatch(/sekaligus/)
  })

  it('effective radius: own, else company default, else 100 m', () => {
    expect(effectiveRadiusM(150, 80)).toBe(150)
    expect(effectiveRadiusM(null, 80)).toBe(80)
    expect(effectiveRadiusM(undefined, null)).toBe(100)
  })

  it('masters: point without radius gets the default; no point stays without radius', () => {
    expect(withEffectiveRadius({ id: 1, lat: -3.3, lng: 114.6, radiusM: null }, 120)).toMatchObject({ radiusM: 120 })
    expect(withEffectiveRadius({ id: 1, lat: -3.3, lng: 114.6, radiusM: 60 }, 120)).toMatchObject({ radiusM: 60 })
    expect(withEffectiveRadius({ id: 1, lat: null, lng: null, radiusM: null }, 120)).toMatchObject({ radiusM: null })
  })

  it('GPS accuracy widens the fence by at most 50 m', () => {
    expect(insideGeofence(140, 100, 40)).toBe(true)
    expect(insideGeofence(151, 100, 500)).toBe(false) // capped at 50 m
    expect(insideGeofence(101, 100, null)).toBe(false)
  })
})

describe('S-24 image limits (US-57)', () => {
  it('byte cap per MIME, then decoded pixels', () => {
    expect(imageLimitError({}, 'image/jpeg', 9 * 1024 * 1024)).toMatchObject({ status: 413, message: 'File terlalu besar (maks. 8 MB).' })
    expect(imageLimitError({ maxBytesByMime: { 'image/png': 2 * 1024 * 1024 } }, 'image/png', 3 * 1024 * 1024)).toMatchObject({ status: 413 })
    expect(imageLimitError({ maxBytesByMime: { 'image/png': 512 * 1024 } }, 'image/png', 600 * 1024)!.message).toBe('File terlalu besar (maks. 512 KB).')
    expect(imageLimitError({}, 'image/jpeg', 1024, { width: 10_000, height: 6_000 })).toMatchObject({ status: 413, message: expect.stringMatching(/Resolusi foto terlalu besar/) })
    expect(imageLimitError({}, 'image/jpeg', 1024, { width: 4032, height: 3024 })).toBeNull()
    expect(MAX_INPUT_PIXELS).toBe(50_000_000)
  })
})

describe('S-05 flag count definition', () => {
  it('open flags of both levels; reviewed/resolved not counted', () => {
    expect(
      openFlagCounts([
        { status: 'open', level: 'warning' },
        { status: 'open', level: 'info' },
        { status: 'reviewed', level: 'warning' },
        { status: 'resolved', level: 'info' },
      ]),
    ).toEqual({ warning: 1, info: 1, total: 2 })
  })
})

describe('S-07 transfer badge = transfer queue; S-23 Admin reaches Laporan', () => {
  async function nav(roles: Role[]) {
    const wheres: unknown[] = []
    const payload = {
      count: async (args: { collection: string; where: unknown }) => {
        wheres.push(args.where)
        return { totalDocs: 3 }
      },
    } as unknown as Payload
    const el = await F2NavLinks({ payload, user: { id: 1, roles, collection: 'users' } as unknown as TypedUser })
    return { html: el ? renderToString(el) : '', wheres }
  }

  it('badge counts exactly TRANSFER_QUEUE_WHERE (no Reimburse waiting for verification)', async () => {
    const { wheres } = await nav(['pk-finance'])
    expect(wheres[0]).toBe(TRANSFER_QUEUE_WHERE)
    expect(JSON.stringify(TRANSFER_QUEUE_WHERE)).not.toContain('"in"')
  })

  it('Admin gets the Laporan link (attendance report export)', async () => {
    expect((await nav(['pk-admin'])).html).toContain('data-pk-nav-link="laporan"')
    expect((await nav(['pk-staff'])).html).not.toContain('data-pk-nav-link="laporan"')
  })
})
