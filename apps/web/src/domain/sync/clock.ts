/**
 * ADR 0010 decision 7 — time rules of an offline item. Pure module (unit-tested).
 *
 * The server time (`received_at`) is authoritative. Device times are COMPARISON values: when the
 * item was recorded on the same boot as the last successful online call, the server estimates the
 * real time from the monotonic clock (`estimated = last_server_time + (elapsed − last_elapsed)`)
 * and flags CLOCK_SKEW when the device wall clock differs by more than the threshold.
 */
export type TimeTrust = 'server' | 'estimated' | 'device_only'

export type ClockInput = {
  boot_id: string
  last_server_time?: string | null
  last_server_elapsed_ms?: number | null
}

export type ItemTimeInput = {
  offline: boolean
  device_time: string
  elapsed_ms: number
  boot_id?: string
}

export type TimeVerdict = {
  timeTrust: TimeTrust
  /** Best known real time of the user's action (UTC ISO). */
  estimatedTime: string | null
  flags: string[]
}

export const CLOCK_SKEW_MS = 5 * 60_000
/** An estimate later than the receipt time (plus this tolerance) is inconsistent → ignored. */
const FUTURE_TOLERANCE_MS = 60_000

export function judgeTime(item: ItemTimeInput, clock: ClockInput, receivedAt: Date, skewMs = CLOCK_SKEW_MS): TimeVerdict {
  const device = Date.parse(item.device_time)
  if (!item.offline) {
    return { timeTrust: 'server', estimatedTime: receivedAt.toISOString(), flags: [] }
  }
  const flags = ['OFFLINE']
  const lastServer = clock.last_server_time ? Date.parse(clock.last_server_time) : Number.NaN
  const lastElapsed = clock.last_server_elapsed_ms
  const sameBoot = (item.boot_id ?? clock.boot_id) === clock.boot_id
  if (Number.isFinite(lastServer) && typeof lastElapsed === 'number' && sameBoot && item.elapsed_ms >= lastElapsed) {
    const estimated = lastServer + (item.elapsed_ms - lastElapsed)
    if (estimated <= receivedAt.getTime() + FUTURE_TOLERANCE_MS) {
      if (Number.isFinite(device) && Math.abs(device - estimated) > skewMs) flags.push('CLOCK_SKEW')
      return { timeTrust: 'estimated', estimatedTime: new Date(estimated).toISOString(), flags }
    }
  }
  // No usable monotonic reference (reboot, never online, inconsistent): device clock only.
  if (Number.isFinite(device) && device > receivedAt.getTime() + skewMs) flags.push('CLOCK_SKEW')
  return { timeTrust: 'device_only', estimatedTime: null, flags }
}
