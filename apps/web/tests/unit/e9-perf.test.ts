import type { CollectionConfig, GlobalConfig } from 'payload'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { keycloakFollowUpCsv, keycloakFollowUpLines } from '@/import/report'
import { assertDocumentBody, BODY_ERROR_MESSAGE, withBodyGuard, withGlobalBodyGuard } from '@/lib/body-guard'
import { envSchema } from '@/lib/env'
import {
  gateSharp,
  imageQueue,
  imageQueueOptions,
  ImageQueueFullError,
  insideImageSlot,
  Semaphore,
  setImageQueueForTests,
  setImageQueueLogger,
  withImageSlot,
} from '@/lib/image-queue'

/** A promise plus its resolver (manual control of job duration). */
function deferred<T = void>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise((r) => setImmediate(r))

afterEach(() => {
  vi.useRealTimers()
  setImageQueueForTests(null)
  setImageQueueLogger(undefined)
})

describe('Semaphore (E9 P-1 image queue)', () => {
  it('runs at most `max` jobs at once; the rest wait in FIFO order', async () => {
    const s = new Semaphore({ max: 2, maxQueue: 10, timeoutMs: 10_000 })
    const gates = Array.from({ length: 5 }, () => deferred())
    const started: number[] = []
    let peak = 0
    const jobs = gates.map((g, i) =>
      s.run(async () => {
        started.push(i)
        peak = Math.max(peak, s.active)
        await g.promise
        return i
      }),
    )
    await tick()
    expect(started).toEqual([0, 1])
    expect([s.active, s.queued]).toEqual([2, 3])
    gates[1]!.resolve()
    await tick()
    expect(started).toEqual([0, 1, 2])
    gates[0]!.resolve()
    await tick()
    expect(started).toEqual([0, 1, 2, 3])
    for (const g of gates) g.resolve()
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect([s.active, s.queued]).toEqual([0, 0])
    expect(s.stats.granted).toBe(5)
  })

  it('refuses a job when maxQueue jobs already wait (ImageQueueFullError full, Retry-After hint)', async () => {
    const s = new Semaphore({ max: 1, maxQueue: 1, timeoutMs: 10_000, retryAfterSeconds: 7 })
    const g = deferred()
    const a = s.run(() => g.promise)
    const b = s.run(async () => 'b')
    await tick()
    expect(s.saturated).toBe(true)
    const err = await s.acquire().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ImageQueueFullError)
    expect(err).toMatchObject({ reason: 'full', retryAfterSeconds: 7 })
    expect(s.stats.rejectedFull).toBe(1)
    // an already-admitted pipeline may still queue beyond the limit
    const c = s.run(async () => 'c', { ignoreQueueLimit: true })
    g.resolve()
    expect(await Promise.all([a, b, c])).toEqual([undefined, 'b', 'c'])
    expect(s.saturated).toBe(false)
  })

  it('maxQueue 0 = no waiting at all', async () => {
    const s = new Semaphore({ max: 1, maxQueue: 0, timeoutMs: 1000 })
    const g = deferred()
    const a = s.run(() => g.promise)
    await expect(s.run(async () => 1)).rejects.toMatchObject({ reason: 'full' })
    g.resolve()
    await a
    await expect(s.run(async () => 2)).resolves.toBe(2)
  })

  it('a waiter that exceeds timeoutMs is refused (timeout) and removed from the queue', async () => {
    vi.useFakeTimers()
    const s = new Semaphore({ max: 1, maxQueue: 5, timeoutMs: 1000 })
    const g = deferred()
    const a = s.run(() => g.promise)
    const b = s.acquire()
    const bErr = b.catch((e: unknown) => e)
    expect(s.queued).toBe(1)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await bErr).toMatchObject({ reason: 'timeout' })
    expect(s.queued).toBe(0)
    expect(s.stats.rejectedTimeout).toBe(1)
    g.resolve()
    await a
    expect(s.active).toBe(0)
  })

  it('releases the slot when the job throws; release() is idempotent', async () => {
    const s = new Semaphore({ max: 1, maxQueue: 1, timeoutMs: 1000 })
    await expect(s.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(s.active).toBe(0)
    const slot = await s.acquire()
    slot.release()
    slot.release()
    expect(s.active).toBe(0)
    await expect(s.run(async () => 'ok')).resolves.toBe('ok')
  })

  it('records the queue wait (stats + waitedMs)', async () => {
    const s = new Semaphore({ max: 1, maxQueue: 2, timeoutMs: 5000 })
    const g = deferred()
    const a = s.run(() => g.promise)
    const b = s.acquire()
    await new Promise((r) => setTimeout(r, 25))
    g.resolve()
    const slot = await b
    expect(slot.waitedMs).toBeGreaterThanOrEqual(20)
    expect(s.stats.maxWaitMs).toBeGreaterThanOrEqual(20)
    slot.release()
    await a
  })

  it('rejects invalid options', () => {
    expect(() => new Semaphore({ max: 0, maxQueue: 1, timeoutMs: 1 })).toThrow()
    expect(() => new Semaphore({ max: 1, maxQueue: -1, timeoutMs: 1 })).toThrow()
  })
})

describe('image queue configuration (IMAGE_RESIZE_CONCURRENCY / IMAGE_RESIZE_MAX_QUEUE)', () => {
  it('defaults 2 / 20; valid values used; invalid → default; boot schema validates', () => {
    expect(imageQueueOptions({})).toMatchObject({ max: 2, maxQueue: 20, timeoutMs: 30_000, retryAfterSeconds: 5 })
    expect(imageQueueOptions({ IMAGE_RESIZE_CONCURRENCY: '1', IMAGE_RESIZE_MAX_QUEUE: '0' })).toMatchObject({ max: 1, maxQueue: 0 })
    expect(imageQueueOptions({ IMAGE_RESIZE_CONCURRENCY: '0', IMAGE_RESIZE_MAX_QUEUE: 'x' })).toMatchObject({ max: 2, maxQueue: 20 })
    const obj = envSchema.shape
    expect(obj.IMAGE_RESIZE_CONCURRENCY!.safeParse(undefined).data).toBe(2)
    expect(obj.IMAGE_RESIZE_CONCURRENCY!.safeParse('9').success).toBe(false)
    expect(obj.IMAGE_RESIZE_MAX_QUEUE!.safeParse('50').data).toBe(50)
    expect(obj.IMAGE_RESIZE_MAX_QUEUE!.safeParse('-1').success).toBe(false)
  })
})

describe('withImageSlot', () => {
  it('holds one slot per job, nested calls reuse it, logs the wait at debug', async () => {
    setImageQueueForTests({ max: 1, maxQueue: 5, timeoutMs: 5000 })
    const debug = vi.fn()
    setImageQueueLogger({ debug })
    expect(insideImageSlot()).toBe(false)
    const r = await withImageSlot(async () => {
      expect(insideImageSlot()).toBe(true)
      expect(imageQueue().active).toBe(1)
      return withImageSlot(async () => 'nested') // would dead-lock with max 1 if it took a 2nd slot
    }, 'media:receipts')
    expect(r).toBe('nested')
    expect(imageQueue().active).toBe(0)
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ msg: 'image queue slot', label: 'media:receipts', waitMs: expect.any(Number) }))
  })

  it('throws ImageQueueFullError when the queue is full', async () => {
    setImageQueueForTests({ max: 1, maxQueue: 0, timeoutMs: 5000 })
    const g = deferred()
    const a = withImageSlot(() => g.promise)
    await tick()
    await expect(withImageSlot(async () => 1)).rejects.toBeInstanceOf(ImageQueueFullError)
    g.resolve()
    await a
  })
})

describe('gateSharp', () => {
  function fakeSharp() {
    const calls: string[] = []
    class Inst {
      resize() {
        calls.push('resize')
        return this
      }
      clone() {
        return new Inst()
      }
      async toBuffer() {
        calls.push('toBuffer')
        return Buffer.from('x')
      }
      async metadata() {
        return { width: 1 }
      }
    }
    const factory = Object.assign((..._args: unknown[]) => new Inst(), { concurrency: (n?: number) => n ?? 1 })
    return { factory, calls }
  }

  it('routes toBuffer of instances, chained calls and clones through the gate; statics pass through', async () => {
    const { factory, calls } = fakeSharp()
    const run = vi.fn((fn: () => Promise<unknown>) => fn())
    const gated = gateSharp(factory, run as <T>(fn: () => Promise<T>) => Promise<T>)
    expect(gated.concurrency(3)).toBe(3)
    const inst = gated('in') as unknown as { resize: () => typeof inst; clone: () => typeof inst; toBuffer: () => Promise<Buffer>; metadata: () => Promise<unknown> }
    const chained = inst.resize()
    expect(chained).toBe(inst)
    await chained.toBuffer()
    await inst.clone().resize().toBuffer()
    await inst.metadata()
    expect(run).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['resize', 'toBuffer', 'resize', 'toBuffer'])
  })

  it('outside a job each pipeline takes a queue slot (bounded concurrency); inside a job it runs directly', async () => {
    setImageQueueForTests({ max: 1, maxQueue: 0, timeoutMs: 5000 })
    let active = 0
    let peak = 0
    class Slow {
      async toBuffer() {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 5))
        active--
        return Buffer.alloc(0)
      }
    }
    const gated = gateSharp(() => new Slow())
    // maxQueue 0 does not refuse pipelines (already admitted), it only serialises them
    await Promise.all(Array.from({ length: 4 }, () => (gated() as Slow).toBuffer()))
    expect(peak).toBe(1)
    await withImageSlot(async () => {
      await Promise.all([(gated() as Slow).toBuffer(), (gated() as Slow).toBuffer()]) // no self-deadlock
    })
    expect(imageQueue().active).toBe(0)
  })

  it('real sharp: identical output (resize, format, EXIF stripped) through the gate', async () => {
    const input = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .jpeg({ quality: 95 })
      .withExif({ IFD0: { Make: 'TestPhone', Copyright: 'gps -2.2,113.9' } })
      .toBuffer()
    const pipeline = (s: typeof sharp) => s(input).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).toFormat('jpeg', { quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    const plain = await pipeline(sharp)
    const gated = await pipeline(gateSharp(sharp))
    expect(gated.info).toEqual(plain.info)
    expect(Buffer.compare(gated.data, plain.data)).toBe(0)
    const meta = await sharp(gated.data).metadata()
    expect([meta.width, meta.height, meta.format, meta.exif]).toEqual([1600, 1200, 'jpeg', undefined])
    // clone (Payload imageSizes) keeps working
    const base = gateSharp(sharp)(input).rotate()
    const thumb = await base.clone().resize({ width: 320, height: 320, fit: 'inside' }).webp({ quality: 70 }).toBuffer({ resolveWithObject: true })
    expect([thumb.info.width, thumb.info.format]).toEqual([320, 'webp'])
  })
})

describe('REST body guard (E9 B-1, G-21)', () => {
  it('only plain objects are documents; upload collections may omit data', () => {
    expect(() => assertDocumentBody({})).not.toThrow()
    expect(() => assertDocumentBody({ name: 'x' })).not.toThrow()
    for (const bad of [undefined, null, 'name=x', 3, [], [{ a: 1 }]]) {
      expect(() => assertDocumentBody(bad)).toThrow(BODY_ERROR_MESSAGE)
    }
    expect(() => assertDocumentBody(undefined, { allowUndefined: true })).not.toThrow()
    expect(() => assertDocumentBody('x', { allowUndefined: true })).toThrow()
    try {
      assertDocumentBody(undefined)
    } catch (e) {
      expect(e).toMatchObject({ status: 400, isPublic: true })
    }
  })

  it('is prepended to every collection / global beforeOperation and only checks writes', async () => {
    const own = vi.fn(({ args }: { args: unknown }) => args)
    const [plain, upload] = withBodyGuard([
      { slug: 'clients', fields: [], hooks: { beforeOperation: [own as never] } } as CollectionConfig,
      { slug: 'media-x', fields: [], upload: true } as CollectionConfig,
    ])
    const hook = (c: CollectionConfig | undefined, operation: string, data: unknown) =>
      (c!.hooks!.beforeOperation![0] as unknown as (a: unknown) => unknown)({ args: { data }, operation })
    expect(plain!.hooks!.beforeOperation).toHaveLength(2)
    expect(plain!.hooks!.beforeOperation![1]).toBe(own)
    expect(() => hook(plain, 'create', undefined)).toThrow(BODY_ERROR_MESSAGE)
    expect(() => hook(plain, 'update', ['x'])).toThrow(BODY_ERROR_MESSAGE)
    expect(() => hook(plain, 'updateByID', 'x')).toThrow(BODY_ERROR_MESSAGE)
    expect(hook(plain, 'read', undefined)).toEqual({ data: undefined })
    expect(hook(plain, 'create', { a: 1 })).toEqual({ data: { a: 1 } })
    expect(hook(upload, 'create', undefined)).toEqual({ data: undefined })
    expect(() => hook(upload, 'create', 'x')).toThrow(BODY_ERROR_MESSAGE)

    const [g] = withGlobalBodyGuard([{ slug: 'company-settings', fields: [] } as GlobalConfig])
    const gh = g!.hooks!.beforeOperation![0] as unknown as (a: unknown) => unknown
    expect(() => gh({ args: { data: undefined }, operation: 'update' })).toThrow(BODY_ERROR_MESSAGE)
    expect(gh({ args: { data: { a: 1 } }, operation: 'update' })).toEqual({ data: { a: 1 } })
    expect(gh({ args: {}, operation: 'read' })).toEqual({})
  })
})

describe('import: Keycloak follow-up summary (E9 B-2, G-22)', () => {
  const rows = [
    { username: 'lt-field-01', email: 'a@x.test', keycloakSub: 'id-1', action: 'disable_logout' as const },
    { username: 'lt-field-02', email: 'b@x.test', keycloakSub: null, action: 'disable_logout' as const },
    { username: '=cmd', email: 'c@x.test', keycloakSub: 'id-3', action: 'enable' as const },
  ]

  it('one summary warning listing the users (not one line per device)', () => {
    const lines = keycloakFollowUpLines({ mode: 'commit', committed: true, keycloakFollowUp: rows })
    expect(lines).toHaveLength(4)
    expect(lines.join('\n')).toMatch(/PERINGATAN KEYCLOAK \(realm drms\)/)
    expect(lines[2]).toBe('  2 pengguna dinonaktifkan → WAJIB disable + logout di Keycloak (runbook import-data-golive §Langkah Keycloak): lt-field-01, lt-field-02')
    expect(lines[3]).toMatch(/^ {2}1 pengguna diaktifkan kembali → enable di Keycloak/)
    expect(keycloakFollowUpLines({ mode: 'dry-run', committed: false, keycloakFollowUp: rows })[2]).toMatch(/akan dinonaktifkan/)
    expect(keycloakFollowUpLines({ mode: 'commit', committed: true, keycloakFollowUp: [] })).toEqual([])
  })

  it('CSV for the runbook kc_* loop (formula-injection safe, no secrets)', () => {
    expect(keycloakFollowUpCsv(rows)).toBe("username,email,keycloakId,action\nlt-field-01,a@x.test,id-1,disable_logout\nlt-field-02,b@x.test,,disable_logout\n'=cmd,c@x.test,id-3,enable\n")
  })
})
