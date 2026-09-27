/**
 * One in-process semaphore for RAM-heavy renders in the web process (ADR 0008 §2, F3
 * export-library-decision §4.2): PDF documents, report PDFs and XLSX exports share it — max 2
 * concurrent; a third caller waits up to 10 s, then `BusyError` (endpoint → 503 + Retry-After).
 * CSV exports stream page by page and do NOT take a slot.
 */
export class BusyError extends Error {
  constructor() {
    super('renderer busy')
  }
}

export const MAX_CONCURRENT = 2
const WAIT_MS = 10_000
let active = 0
const waiters: Array<() => void> = []

async function acquire(waitMs: number): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return
  }
  await new Promise<void>((resolve, reject) => {
    const grant = () => {
      clearTimeout(timer)
      active++
      resolve()
    }
    const timer = setTimeout(() => {
      const i = waiters.indexOf(grant)
      if (i >= 0) waiters.splice(i, 1)
      reject(new BusyError())
    }, waitMs)
    waiters.push(grant)
  })
}

function release(): void {
  active--
  const next = waiters.shift()
  if (next) next()
}

export async function withHeavySlot<T>(fn: () => Promise<T>, waitMs = WAIT_MS): Promise<T> {
  await acquire(waitMs)
  try {
    return await fn()
  } finally {
    release()
  }
}

/** Test seam: slots currently held. */
export function heavySlotsInUse(): number {
  return active
}
