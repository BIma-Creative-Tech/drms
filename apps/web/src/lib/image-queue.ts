import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * E9 P-1 (user decision 2026-09-27: queue image resizing, upload p95 < 5 s, everything else
 * p95 < 2 s): one process-wide FIFO queue in front of every sharp resize/re-encode in the web
 * process, so a burst of photo uploads cannot occupy all CPU and starve the other requests.
 *
 * - At most `IMAGE_RESIZE_CONCURRENCY` (default 2) image JOBS run at once; the rest wait in FIFO
 *   order. A job = one upload (main re-encode + thumbnail + metadata), see `withImageSlot`.
 * - The queue is bounded: with `IMAGE_RESIZE_MAX_QUEUE` (default 20) jobs already waiting — or
 *   after waiting `QUEUE_TIMEOUT_MS` — a new job is refused with `ImageQueueFullError`; the upload
 *   endpoint answers 503 + `Retry-After` (the APK uploads in the background and retries).
 * - `gateSharp` wraps the sharp factory handed to Payload: every `toBuffer`/`toFile` outside a job
 *   (admin REST uploads, seed) takes a slot for that one pipeline; inside a job it runs directly
 *   (AsyncLocalStorage marks the job), so a job never waits for itself.
 * Outputs are untouched: the pipeline (resize, format, auto-orient, metadata stripping) is
 * whatever Payload builds; only WHEN it runs changes.
 */
export class ImageQueueFullError extends Error {
  constructor(
    readonly reason: 'full' | 'timeout',
    readonly retryAfterSeconds: number,
  ) {
    super(reason === 'full' ? 'image queue full' : 'image queue wait timeout')
  }
}

export type SemaphoreOptions = {
  /** Jobs running at once (≥ 1). */
  max: number
  /** Jobs allowed to WAIT; one more is refused (0 = no waiting). */
  maxQueue: number
  /** Longest wait for a slot before the job is refused. */
  timeoutMs: number
  /** Retry-After hint of a refusal. */
  retryAfterSeconds?: number
}

export type Slot = { release: () => void; waitedMs: number }

type Waiter = { grant: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }

/** Bounded FIFO counting semaphore (pure, unit-tested). */
export class Semaphore {
  private running = 0
  private readonly waiters: Waiter[] = []
  readonly stats = { granted: 0, rejectedFull: 0, rejectedTimeout: 0, totalWaitMs: 0, maxWaitMs: 0 }

  constructor(readonly opts: SemaphoreOptions) {
    if (!Number.isInteger(opts.max) || opts.max < 1) throw new Error('Semaphore max must be an integer ≥ 1')
    if (!Number.isInteger(opts.maxQueue) || opts.maxQueue < 0) throw new Error('Semaphore maxQueue must be an integer ≥ 0')
  }

  get active(): number {
    return this.running
  }

  get queued(): number {
    return this.waiters.length
  }

  /** True when a new job would be refused right now (all slots busy and the queue is full). */
  get saturated(): boolean {
    return this.running >= this.opts.max && this.waiters.length >= this.opts.maxQueue
  }

  /**
   * Takes a slot (FIFO). `ignoreQueueLimit`: the caller was already admitted elsewhere (a pipeline
   * inside an admitted upload) — it may wait beyond `maxQueue`, still in FIFO order and with the
   * timeout.
   */
  acquire(opts: { ignoreQueueLimit?: boolean } = {}): Promise<Slot> {
    const start = Date.now()
    const retry = this.opts.retryAfterSeconds ?? 5
    const slot = (): Slot => {
      const waitedMs = Date.now() - start
      this.stats.granted++
      this.stats.totalWaitMs += waitedMs
      if (waitedMs > this.stats.maxWaitMs) this.stats.maxWaitMs = waitedMs
      let released = false
      return {
        waitedMs,
        release: () => {
          if (released) return
          released = true
          this.release()
        },
      }
    }
    if (this.running < this.opts.max && this.waiters.length === 0) {
      this.running++
      return Promise.resolve(slot())
    }
    if (!opts.ignoreQueueLimit && this.waiters.length >= this.opts.maxQueue) {
      this.stats.rejectedFull++
      return Promise.reject(new ImageQueueFullError('full', retry))
    }
    return new Promise<Slot>((resolve, reject) => {
      const w: Waiter = {
        grant: () => {
          if (w.timer) clearTimeout(w.timer)
          this.running++
          resolve(slot())
        },
        reject,
        timer: undefined,
      }
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w)
        if (i >= 0) this.waiters.splice(i, 1)
        this.stats.rejectedTimeout++
        reject(new ImageQueueFullError('timeout', retry))
      }, this.opts.timeoutMs)
      w.timer.unref?.()
      this.waiters.push(w)
    })
  }

  private release(): void {
    this.running--
    const next = this.waiters.shift()
    if (next) next.grant()
  }

  async run<T>(fn: () => Promise<T>, opts: { ignoreQueueLimit?: boolean } = {}): Promise<T> {
    const s = await this.acquire(opts)
    try {
      return await fn()
    } finally {
      s.release()
    }
  }
}

export const DEFAULT_IMAGE_RESIZE_CONCURRENCY = 2
export const DEFAULT_IMAGE_RESIZE_MAX_QUEUE = 20
/** A queued upload is refused after 30 s (below Traefik/APK timeouts; worst case 20 jobs ≈ 10–20 s). */
export const QUEUE_TIMEOUT_MS = 30_000
export const RETRY_AFTER_SECONDS = 5

function intEnv(v: string | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || v.trim() === '') return dflt
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt
}

/** Queue settings from the environment (validated again at boot by lib/env.ts). */
export function imageQueueOptions(env: Record<string, string | undefined> = process.env): SemaphoreOptions {
  return {
    max: intEnv(env.IMAGE_RESIZE_CONCURRENCY, DEFAULT_IMAGE_RESIZE_CONCURRENCY, 1, 8),
    maxQueue: intEnv(env.IMAGE_RESIZE_MAX_QUEUE, DEFAULT_IMAGE_RESIZE_MAX_QUEUE, 0, 500),
    timeoutMs: QUEUE_TIMEOUT_MS,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
  }
}

type DebugLogger = { debug: (obj: Record<string, unknown>) => void }

let queue = new Semaphore(imageQueueOptions())
let logger: DebugLogger | undefined
const inJob = new AsyncLocalStorage<true>()

/** The process-wide image queue (stats / tests). */
export function imageQueue(): Semaphore {
  return queue
}

/** Test seam: replace the queue (e.g. max 1, maxQueue 0). */
export function setImageQueueForTests(opts: SemaphoreOptions | null): void {
  queue = new Semaphore(opts ?? imageQueueOptions())
}

/** Payload logger (onInit) for the debug queue-wait lines. */
export function setImageQueueLogger(l: DebugLogger | undefined): void {
  logger = l
}

/** True inside `withImageSlot` (the current async context already holds a slot). */
export function insideImageSlot(): boolean {
  return inJob.getStore() === true
}

/**
 * Runs one image job (e.g. an upload's whole Payload create) holding one queue slot. Throws
 * `ImageQueueFullError` when the queue is full or the wait times out. Nested calls reuse the slot.
 */
export async function withImageSlot<T>(fn: () => Promise<T>, label = 'image'): Promise<T> {
  if (insideImageSlot()) return fn()
  const q = queue
  const slot = await q.acquire()
  logger?.debug({ msg: 'image queue slot', label, waitMs: slot.waitedMs, active: q.active, queued: q.queued })
  try {
    return await inJob.run(true, fn)
  } finally {
    slot.release()
  }
}

const GATED = new Set<PropertyKey>(['toBuffer', 'toFile'])

/**
 * Wraps a sharp-like factory: `toBuffer()`/`toFile()` (promise form) of every instance — and of
 * its clones — run through the image queue unless the caller already holds a slot. Chained calls
 * keep returning the wrapper. Everything else passes through unchanged.
 */
export function gateSharp<F extends (...args: never[]) => unknown>(factory: F, run: <T>(fn: () => Promise<T>) => Promise<T> = gatedRun): F {
  const wrap = (inst: object): object => {
    const proxy: object = new Proxy(inst, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target) as unknown
        if (typeof v !== 'function') return v
        const fn = v as (...a: unknown[]) => unknown
        if (GATED.has(prop)) {
          return (...args: unknown[]) => {
            if (typeof args[args.length - 1] === 'function') return fn.apply(target, args) // callback form: not used by Payload
            return run(() => fn.apply(target, args) as Promise<unknown>)
          }
        }
        return (...args: unknown[]) => {
          const r = fn.apply(target, args)
          if (r === target) return proxy
          if (prop === 'clone' && r && typeof r === 'object') return wrap(r)
          return r
        }
      },
    })
    return proxy
  }
  return new Proxy(factory, {
    apply(target, thisArg, args) {
      return wrap(Reflect.apply(target, thisArg, args) as object)
    },
    construct(target, args) {
      return wrap(Reflect.construct(target, args) as object)
    },
  })
}

/** Pipeline-level gate: already admitted (or system tooling) → may exceed the queue length. */
function gatedRun<T>(fn: () => Promise<T>): Promise<T> {
  if (insideImageSlot()) return fn()
  return queue.run(fn, { ignoreQueueLimit: true })
}
