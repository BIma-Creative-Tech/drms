import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, http, makeUser, webSessionCookie, type TestUser } from './helpers'

/** ADR 0004 targets + spike h (remote-URL guard) through the real upload pipeline. */
let finance: TestUser & { _strategy: string }
let phone: Buffer

beforeAll(async () => {
  finance = { ...(await makeUser(['pk-finance'], { label: 'media' })), _strategy: 'oidcSession' }
  // 4032×3024 "phone photo" with EXIF → must be resized to ≤ 1600 px (S3e, US-57) and all metadata stripped
  phone = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 200, g: 180, b: 150 } } })
    .jpeg({ quality: 95 })
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'X', Copyright: 'loc -2.2,113.9' } })
    .toBuffer()
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('media-receipts (ADR 0004 §2/§3)', () => {
  it('re-encodes to ≤ 1600 px JPEG without EXIF/GPS, UUID name, sha256 of the discarded original, thumb 320 webp', async () => {
    const p = await getTestPayload()
    const doc = await p.create({
      collection: 'media-receipts',
      data: {},
      file: { data: phone, mimetype: 'image/jpeg', name: '../../etc/passwd.jpg', size: phone.length },
      user: finance,
      overrideAccess: false,
      depth: 0,
    })
    expect(doc.filename).toMatch(/^[0-9a-f-]{36}\.jpg$/)
    expect(doc.sha256Original).toBe(createHash('sha256').update(phone).digest('hex'))
    expect([doc.originalWidth, doc.originalHeight]).toEqual([4032, 3024])
    expect([doc.width, doc.height]).toEqual([1600, 1200])
    expect(doc.uploadedBy).toBe(finance.id)
    const dir = path.join(process.env.MEDIA_DIR!, 'media-receipts')
    const files = readdirSync(dir).filter((f) => f.startsWith(doc.filename!.slice(0, 36)))
    expect(files.sort()).toEqual([doc.filename, `${doc.filename!.slice(0, 36)}-320x240.webp`].sort())
    const stored = readFileSync(path.join(dir, doc.filename!))
    const meta = await sharp(stored).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(stored.length).toBeLessThan(phone.length)
  })

  it('rejects remote-URL sources over REST (no fetch) and JSON creates without a file', async () => {
    const cookie = await webSessionCookie(finance)
    const h = { Cookie: cookie, Origin: 'http://localhost:3000' }
    const ssrf = await http('POST', '/api/media-receipts', { headers: h, json: { url: 'http://169.254.169.254/latest/meta-data', filename: 'x.jpg' } })
    expect(ssrf.status).toBe(400)
    const nofile = await http('POST', '/api/media-receipts', { headers: h, json: { filename: 'x.jpg' } })
    expect(nofile.status).toBe(400)
  })

  it('media is immutable (update 403) and uploads are role-limited (staff → transfer proofs 403)', async () => {
    const p = await getTestPayload()
    const staff = { ...(await makeUser(['pk-staff'], { label: 'media-staff' })), _strategy: 'oidcSession' }
    const any = (await p.find({ collection: 'media-receipts', limit: 1, overrideAccess: true /* SYSTEM-READ */ })).docs[0]!
    await expect(p.update({ collection: 'media-receipts', id: any.id, data: { ownerDocType: 'x' }, user: finance, overrideAccess: false })).rejects.toMatchObject({ status: 403 })
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer()
    await expect(
      p.create({ collection: 'media-transfer-proofs', data: {}, file: { data: png, mimetype: 'image/png', name: 'a.png', size: png.length }, user: staff, overrideAccess: false }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('signatures are palette PNG ≤ 800×300; PDFs are checked by magic bytes', async () => {
    const p = await getTestPayload()
    const sig = await sharp({ create: { width: 1600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const s = await p.create({ collection: 'media-signatures', data: {}, file: { data: sig, mimetype: 'image/png', name: 's.png', size: sig.length }, user: finance, overrideAccess: false })
    expect([s.width, s.height]).toEqual([800, 300])
    expect(s.filename).toMatch(/\.png$/)
    const fake = Buffer.from('not a pdf at all')
    await expect(
      p.create({ collection: 'media-transfer-proofs', data: {}, file: { data: fake, mimetype: 'application/pdf', name: 'x.pdf', size: fake.length }, user: finance, overrideAccess: false }),
    ).rejects.toBeTruthy()
  })
})
