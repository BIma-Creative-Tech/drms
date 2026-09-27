import { handleEndpoints } from 'payload'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { BODY_ERROR_MESSAGE } from '@/lib/body-guard'
import { imageQueue, setImageQueueForTests } from '@/lib/image-queue'
import { resetRateLimits } from '@/lib/rate-limit'
import config from '@/payload.config'

import { getTestPayload, sqlAs } from './helpers'
import { makeWorld, ORIGIN, type FlowUser, type Res, type World } from './flow-world'

/**
 * E9 follow-ups (QA report §7, user decision 2026-09-27):
 * - P-1: image resizing runs through a bounded, process-wide queue — concurrent uploads of every
 *   kind still succeed with unchanged outputs, at most IMAGE_RESIZE_CONCURRENCY run at once, a full
 *   queue answers 503 + Retry-After (v1) / 503 (generic REST), PDFs are not queued;
 * - B-1 (G-21): generic REST create/update with a non-JSON body → 400 with a clear message, not 500.
 */
let w: World

beforeAll(async () => {
  w = await makeWorld('pf')
})

afterEach(() => {
  setImageQueueForTests(null)
  resetRateLimits()
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

async function photo(w0: number, h0: number, seed: number, format: 'jpeg' | 'png' = 'jpeg'): Promise<Buffer> {
  const img = sharp({ create: { width: w0, height: h0, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: 90 } } }).withExif({ IFD0: { Make: 'TestPhone', Copyright: 'gps -3.3,114.6' } })
  return format === 'jpeg' ? img.jpeg({ quality: 90 }).toBuffer() : img.png().toBuffer()
}

async function send(path: string, user: FlowUser, bytes: Buffer, mimetype: string): Promise<Res> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimetype }), mimetype === 'application/pdf' ? 'x.pdf' : mimetype === 'image/png' ? 'x.png' : 'x.jpg')
  const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: user.cookie }, body: form }) })
  const text = await res.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: body as Res['body'], headers: res.headers }
}

describe('P-1 image queue: concurrent uploads', () => {
  it('12 concurrent uploads of every v1 kind succeed with unchanged outputs; ≤ 2 resize jobs at once', async () => {
    setImageQueueForTests({ max: 2, maxQueue: 20, timeoutMs: 30_000 })
    let peak = 0
    const probe = setInterval(() => (peak = Math.max(peak, imageQueue().active)), 1)
    const jobs: Array<{ kind: string; user: FlowUser; bytes: Buffer; mime: string; expect: [number, number]; format: string }> = []
    for (let i = 0; i < 4; i++) jobs.push({ kind: 'receipts', user: w.users.staffA, bytes: await photo(3200, 2400, i), mime: 'image/jpeg', expect: [1600, 1200], format: 'jpeg' })
    for (let i = 0; i < 4; i++) jobs.push({ kind: 'selfies', user: w.users.staffB, bytes: await photo(1080, 1440, 10 + i), mime: 'image/jpeg', expect: [540, 720], format: 'jpeg' })
    for (let i = 0; i < 2; i++) jobs.push({ kind: 'progress-photos', user: w.users.pm, bytes: await photo(2000, 1500, 20 + i), mime: 'image/jpeg', expect: [1600, 1200], format: 'jpeg' })
    jobs.push({ kind: 'signatures', user: w.users.finance, bytes: await photo(1200, 450, 30, 'png'), mime: 'image/png', expect: [800, 300], format: 'png' })
    jobs.push({ kind: 'attachments', user: w.users.finance, bytes: await photo(2400, 1800, 31), mime: 'image/jpeg', expect: [2000, 1500], format: 'jpeg' })
    const results = await Promise.all(jobs.map((j) => send(`/api/v1/media/${j.kind}`, j.user, j.bytes, j.mime)))
    clearInterval(probe)
    results.forEach((r, i) => expect(r.status, `${jobs[i]!.kind}: ${JSON.stringify(r.body)}`).toBe(201))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(2)
    expect([imageQueue().active, imageQueue().queued]).toEqual([0, 0])
    expect(imageQueue().stats.granted).toBe(jobs.length)

    const p = await getTestPayload()
    const slugOf: Record<string, string> = { receipts: 'media-receipts', selfies: 'media-selfies', 'progress-photos': 'media-progress-photos', signatures: 'media-signatures', attachments: 'media-attachments' }
    for (const [i, r] of results.entries()) {
      const j = jobs[i]!
      const body = r.body as { id: number; width: number; height: number }
      expect([body.width, body.height], j.kind).toEqual(j.expect)
      const doc = (await p.findByID({ collection: slugOf[j.kind] as 'media-receipts', id: body.id, depth: 0, overrideAccess: true /* SYSTEM-READ: test */ })) as unknown as { filename: string; sizes?: { thumb?: { width?: number | null } } }
      const file = `${process.env.MEDIA_DIR}/${slugOf[j.kind]}/${doc.filename}`
      const meta = await sharp(file).metadata()
      expect([meta.format, meta.exif, meta.width], j.kind).toEqual([j.format, undefined, j.expect[0]])
      if (j.kind === 'receipts' || j.kind === 'progress-photos' || j.kind === 'attachments') expect(doc.sizes?.thumb?.width, j.kind).toBe(320)
    }
    // the transaction of each upload committed (rows visible to another connection)
    const ids = results.filter((_, i) => jobs[i]!.kind === 'receipts').map((r) => (r.body as { id: number }).id)
    expect(Number((await sqlAs('app', 'SELECT count(*) AS n FROM media_receipts WHERE id = ANY($1)', [ids])).rows[0].n)).toBe(4)
  })

  it('queue full → 503 + Retry-After (code UPLOAD_BUSY), nothing stored; PDFs are not queued; afterwards uploads work again', async () => {
    setImageQueueForTests({ max: 1, maxQueue: 0, timeoutMs: 30_000, retryAfterSeconds: 5 })
    const before = Number((await sqlAs('app', 'SELECT count(*) AS n FROM media_receipts')).rows[0].n)
    const held = await imageQueue().acquire() // a long resize job occupies the only slot
    try {
      const r = await send('/api/v1/media/receipts', w.users.staffA, await photo(800, 600, 40), 'image/jpeg')
      expect(r.status).toBe(503)
      expect(r.headers.get('retry-after')).toBe('5')
      expect(r.body).toMatchObject({ status: 503, code: 'UPLOAD_BUSY' })
      expect(Number((await sqlAs('app', 'SELECT count(*) AS n FROM media_receipts')).rows[0].n)).toBe(before)
      // generic REST upload (admin panel, e.g. company logo) → 503 as well
      const logo = await send('/api/media-company', w.users.owner, await photo(600, 200, 41, 'png'), 'image/png')
      expect(logo.status).toBe(503)
      // a PDF is stored as-is, no sharp → not queued
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nxref\n0 2\ntrailer<</Root 1 0 R>>\nstartxref\n9\n%%EOF\n')
      expect((await send('/api/v1/media/attachments', w.users.finance, pdf, 'application/pdf')).status).toBe(201)
    } finally {
      held.release()
    }
    expect((await send('/api/v1/media/receipts', w.users.staffA, await photo(800, 600, 42), 'image/jpeg')).status).toBe(201)
    expect((await send('/api/media-company', w.users.owner, await photo(600, 200, 43, 'png'), 'image/png')).status).toBe(201)
  })

  it('queued uploads wait (FIFO) instead of failing while the queue has room', async () => {
    setImageQueueForTests({ max: 1, maxQueue: 5, timeoutMs: 30_000 })
    const held = await imageQueue().acquire()
    const pending = Promise.all([1, 2, 3].map(async (i) => send('/api/v1/media/receipts', w.users.staffA, await photo(1000, 800, 50 + i), 'image/jpeg')))
    await new Promise((r) => setTimeout(r, 200))
    expect(imageQueue().queued).toBe(3)
    held.release()
    expect((await pending).map((r) => r.status)).toEqual([201, 201, 201])
    expect(imageQueue().stats.maxWaitMs).toBeGreaterThanOrEqual(150)
  })
})

describe('B-1 (G-21): generic REST with a non-JSON body → 400, never 500', () => {
  const COLLECTIONS = ['expense-requests', 'budget-lines', 'clients', 'cost-centers', 'projects', 'project-stages', 'stage-templates']

  async function raw(method: string, path: string, user: FlowUser, body: BodyInit | null, contentType?: string) {
    const headers = new Headers({ Origin: ORIGIN, Cookie: user.cookie })
    if (contentType) headers.set('Content-Type', contentType)
    const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}${path}`, { method, headers, body }) })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : null) as { errors?: Array<{ message?: string }> } | null }
  }

  it('form-urlencoded POST (ZAP 90022) to every affected collection and the company-settings global → 400 + message', async () => {
    const counts = async () => Object.fromEntries(await Promise.all(COLLECTIONS.map(async (c) => [c, Number((await sqlAs('app', `SELECT count(*) AS n FROM ${c.replace(/-/g, '_')}`)).rows[0].n)])))
    const before = await counts()
    for (const user of [w.users.owner, w.users.admin]) {
      for (const c of COLLECTIONS) {
        const r = await raw('POST', `/api/${c}`, user, 'name=zap&code=ZAP&project=1', 'application/x-www-form-urlencoded')
        expect(r.status, `${c}: ${JSON.stringify(r.body)}`).toBe(400)
        expect(r.body?.errors?.[0]?.message).toBe(BODY_ERROR_MESSAGE)
      }
      const g = await raw('POST', '/api/globals/company-settings', user, 'name=zap', 'application/x-www-form-urlencoded')
      expect(g.status, JSON.stringify(g.body)).toBe(400)
      expect(g.body?.errors?.[0]?.message).toBe(BODY_ERROR_MESSAGE)
    }
    expect(await counts()).toEqual(before)
  })

  it('text/plain, JSON array/null and multipart without _payload → 400 on create and update', async () => {
    const owner = w.users.owner
    expect((await raw('POST', '/api/clients', owner, 'hello', 'text/plain')).status).toBe(400)
    expect((await raw('POST', '/api/clients', owner, '[{"name":"x"}]', 'application/json')).status).toBe(400)
    expect((await raw('POST', '/api/clients', owner, 'null', 'application/json')).status).toBe(400)
    const form = new FormData()
    form.append('name', 'zap')
    expect((await raw('POST', '/api/projects', owner, form)).status).toBe(400)
    const client = (await getTestPayload()).create({ collection: 'clients', data: { name: 'PF Klien (FIKTIF)' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
    const id = (await client).id
    expect((await raw('PATCH', `/api/clients/${id}`, owner, 'name=x', 'application/x-www-form-urlencoded')).status).toBe(400)
    expect((await raw('PATCH', `/api/clients?where[id][equals]=${id}`, owner, 'name=x', 'application/x-www-form-urlencoded')).status).toBe(400)
    // a proper JSON body still works (the guard only rejects non-documents)
    const ok = await raw('PATCH', `/api/clients/${id}`, owner, JSON.stringify({ name: 'PF Klien 2 (FIKTIF)' }), 'application/json')
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  })

  it('unauthenticated form POST is still refused (4xx), never 500', async () => {
    const res = await handleEndpoints({ config, request: new Request(`${ORIGIN}/api/clients`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=x' }) })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})
