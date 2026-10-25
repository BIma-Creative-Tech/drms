import React, { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { createLocalReq, type AdminViewServerProps } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/next/templates', () => ({ DefaultTemplate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@payloadcms/ui', () => ({ Gutter: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-gutter': '' }, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => '/admin' }))

import { UPLOAD_CELL, UPLOAD_PREVIEW_FIELD } from '@/admin/display-cells'
import { AbsensiRekap, AbsensiToday } from '@/admin/views/Absensi'
import { resetAppConfigCache } from '@/api/v1/endpoints/app'
import { resetRateLimits } from '@/lib/rate-limit'

import { api, makeWorld, upload, type FlowUser, type World } from './flow-world'
import { getTestPayload, sqlAs, updateCompany } from './helpers'

/**
 * D2510 image preview (web 0.21.1, user 2026-10-25 "user belum bisa melihat preview foto absensi"): the attendance
 * views render the check-in selfie as a THUMBNAIL that opens the lightbox (was a "Selfie" text button, only in the
 * per-employee rekap), through the same audited endpoint; the endpoint keeps its access rule (PM of the team yes,
 * another staff no) and the audit of someone else's selfie; read-only upload fields of the Payload views get the
 * preview field + list cell. Real DB + API, fictional data; syncAttendanceEnabled ON here and OFF afterwards.
 */
let w: World
let attendanceId = 0
let today = ''
const SITE = { lat: -2.41, lng: 113.91 }

type Props = AdminViewServerProps

async function propsFor(user: FlowUser, segments: string[], searchParams: Record<string, string> = {}): Promise<Props> {
  const req = await createLocalReq({ user: { ...user, collection: 'users' } as never }, await getTestPayload())
  return { initPageResult: { req, locale: undefined, permissions: {}, visibleEntities: { collections: [], globals: [] } }, params: { segments }, searchParams } as unknown as Props
}

/** Resolves async server components (anywhere in the element tree) so the static renderer can render the rest. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<{ children?: ReactNode }>
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props))
  if (el.props && 'children' in el.props && el.props.children !== undefined) return cloneElement(el, undefined, ...([] as ReactNode[]).concat(await resolve(el.props.children)))
  return el
}

async function render(view: (p: Props) => Promise<ReactNode>, user: FlowUser, segments: string[], sp: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, await resolve(await view(await propsFor(user, segments, sp)))))
}

async function setAttendance(enabled: boolean) {
  await updateCompany({ syncAttendanceEnabled: enabled })
  resetAppConfigCache()
}

beforeAll(async () => {
  w = await makeWorld(`ip${Date.now() % 100000}`)
  const p = await getTestPayload()
  await p.update({ collection: 'projects', id: w.project, data: { lat: SITE.lat, lng: SITE.lng, radiusM: 100 }, overrideAccess: true /* SYSTEM-WRITE: fixture geofence */ })
  await setAttendance(true)
  resetRateLimits()
  const bytes = await sharp({ create: { width: 640, height: 800, channels: 3, background: { r: 70, g: 130, b: 90 } } }).jpeg().toBuffer()
  const up = await upload('/api/v1/media/selfies', w.users.staffA, bytes, 'image/jpeg')
  expect(up.status, JSON.stringify(up.body)).toBe(201)
  const r = await api('POST', '/api/v1/attendance/check-in', w.users.staffA, { project_id: w.project, lat: SITE.lat, lng: SITE.lng, accuracy_m: 10, selfie_media_id: up.body.id })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  attendanceId = r.body.id as number
  today = String((await sqlAs('app', 'SELECT local_date::text AS d FROM attendances WHERE id = $1', [attendanceId])).rows[0].d)
})

afterAll(async () => {
  await setAttendance(false)
})

describe('attendance selfie previews (web 0.21.1)', () => {
  const href = () => `href="/api/v1/attendance/${attendanceId}/selfie"`

  it('Tim hari ini (PM of the team): the member card shows the check-in selfie as a lightbox thumbnail', async () => {
    const html = await render(AbsensiToday, w.users.pm, ['absensi'])
    const start = html.indexOf(`data-pk-member="${w.emp.a}"`)
    expect(start, 'member card').toBeGreaterThan(-1)
    const card = html.slice(start, html.indexOf('</li></ul>', start) + 5)
    expect(card).toContain(`data-pk-member-selfies="${w.emp.a}"`)
    expect(card).toContain(href())
    expect(card).toContain(`data-pk-lightbox="att-today-${w.emp.a}"`)
    expect(card).toContain('data-pk-action="selfie"')
    expect(card).toContain(`data-pk-attendance="${attendanceId}"`)
    expect(card).toContain(`src="/api/v1/attendance/${attendanceId}/selfie"`)
    expect(card).toContain('loading="lazy"')
    expect(card).toMatch(/data-pk-lightbox-caption="Masuk \d{2}:\d{2} · /)
  })

  it('Rekap per karyawan (Admin) and Rekap saya (the employee): thumbnail per check-in, no "Selfie" text button', async () => {
    const month = today.slice(0, 7)
    const admin = await render(AbsensiRekap, w.users.admin, ['absensi', 'rekap'], { karyawan: String(w.emp.a), bulan: month })
    expect(admin).toContain(href())
    expect(admin).toContain(`data-pk-lightbox="att-${w.emp.a}-${today}"`)
    expect(admin).toContain('data-pk-selfie-img=""')
    expect(admin).not.toMatch(/<button[^>]*data-pk-action="selfie"/)
    const own = await render(AbsensiRekap, w.users.staffA, ['absensi', 'rekap'])
    expect(own).toContain(href())
  })

  it('the thumbnail URL keeps its access rule and audit: PM of the team 200 (audited), another staff 404', async () => {
    resetRateLimits()
    const before = Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'view_sensitive' AND doc_type = 'attendance' AND doc_id = $1", [String(attendanceId)])).rows[0].n)
    const pm = await api('GET', `/api/v1/attendance/${attendanceId}/selfie`, w.users.pm)
    expect(pm.status).toBe(200)
    expect(pm.headers.get('content-type')).toBe('image/jpeg')
    expect(pm.headers.get('cache-control')).toBe('private, no-store')
    const after = Number((await sqlAs('app', "SELECT count(*)::int AS n FROM audit_logs WHERE action = 'view_sensitive' AND doc_type = 'attendance' AND doc_id = $1", [String(attendanceId)])).rows[0].n)
    expect(after).toBe(before + 1)
    expect((await api('GET', `/api/v1/attendance/${attendanceId}/selfie`, w.users.staffB)).status).toBe(404)
    expect((await api('GET', `/api/v1/attendance/${attendanceId}/selfie`, null)).status).toBe(401)
  })

  it('Payload views: read-only upload fields get the preview field, every media upload field the thumbnail cell', async () => {
    const p = await getTestPayload()
    const fieldOf = (slug: string, name: string) => p.collections[slug as 'attendances']!.config.fields.find((f) => 'name' in f && f.name === name) as { admin?: { components?: { Cell?: unknown; Field?: unknown } } }
    expect(fieldOf('attendances', 'selfie').admin?.components).toMatchObject({ Cell: UPLOAD_CELL, Field: UPLOAD_PREVIEW_FIELD })
    expect(fieldOf('transfers', 'proof').admin?.components).toMatchObject({ Cell: UPLOAD_CELL, Field: UPLOAD_PREVIEW_FIELD })
    // editable: Payload's own upload field stays (upload / choose existing), the list still previews
    expect(fieldOf('receipts', 'image').admin?.components?.Cell).toBe(UPLOAD_CELL)
    expect(fieldOf('receipts', 'image').admin?.components?.Field).toBeUndefined()
    // LPJ photos keep their own lightbox field
    expect(fieldOf('settlements', 'photos').admin?.components?.Field).toBe('@/admin/components/LpjPhotosField#LpjPhotosField')
  })
})
