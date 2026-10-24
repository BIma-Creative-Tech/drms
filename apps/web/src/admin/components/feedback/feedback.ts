/**
 * DRMS 24/10 (user decision: popup before AND after every data-changing action, web + APK). One central store for the
 * two admin popups, rendered once by FeedbackHost (admin.components.providers, every admin page):
 * - `confirmAction({ title, summary, confirmLabel, danger })` → Promise<boolean>: the "Yakin ingin <aksi> …?" modal
 *   with a short summary (document number, amount, person / unit / date) and [Ya, <aksi>] / [Batal];
 * - `showResult({ ok, title, message })`: the result modal "Berhasil: <aksi> <dokumen>" / the server's error text
 *   with an OK button. The pending result is also kept in sessionStorage until OK, so an action that reloads or
 *   navigates right after the call (RequesterActions, Payload's redirect after "create") shows it on the next page.
 * Reason dialogs (ActionDialog with a field, kas/ReasonAction, RowRecordAction) ARE the confirmation — they show the
 * summary themselves and only use `showResult`. Pure module (no React, no DOM at import): unit-tested in
 * tests/unit/d2410-popup.test.ts; the APK counterpart is apps/mobile/lib/core/ui/confirm_action.dart.
 */

/** Summary rows `[label, value]`; empty values are skipped. */
export type Summary = ReadonlyArray<readonly [string, string | number | null | undefined]>

export type ConfirmRequest = {
  /** "Yakin ingin kirim pengajuan PB/2026/10/0001?" — see `confirmTitle`. */
  title: string
  summary?: Summary
  /** Extra sentence under the summary (what happens next, e.g. "Isi terkunci setelah dikirim."). */
  description?: string
  /** "Ya, kirim" — see `confirmLabel`. */
  confirmLabel: string
  danger?: boolean
  /** data-pk-dialog / data-pk-confirm of the popup (UI tests). */
  testId?: string
}

export type ResultRequest = {
  ok: boolean
  /** "Berhasil: kirim pengajuan PB/…" / "Gagal: kirim pengajuan". */
  title: string
  message?: string | null
  testId?: string
}

type PendingConfirm = ConfirmRequest & { id: number; resolve: (yes: boolean) => void }
export type FeedbackState = { confirm: PendingConfirm | null; result: (ResultRequest & { id: number }) | null }

export const RESULT_STORAGE_KEY = 'pk-result'

let state: FeedbackState = { confirm: null, result: null }
let seq = 0
let hosts = 0
const listeners = new Set<() => void>()

function set(next: Partial<FeedbackState>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const feedbackStore = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  get: (): FeedbackState => state,
  /** FeedbackHost mount/unmount: without a host (not an admin page) confirmations pass and results are dropped. */
  attach(): () => void {
    hosts += 1
    return () => {
      hosts -= 1
    }
  },
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/**
 * Opens the confirmation popup; resolves true on "Ya, …", false on "Batal" / Esc. A second request while one is open
 * cancels the first (false). Without a mounted host (unit test, non-admin page) it resolves true: the button keeps
 * working, the server re-checks everything anyway.
 */
export function confirmAction(req: ConfirmRequest): Promise<boolean> {
  if (hosts <= 0) return Promise.resolve(true)
  state.confirm?.resolve(false)
  return new Promise<boolean>((resolve) => {
    seq += 1
    set({ confirm: { ...req, id: seq, resolve } })
  })
}

/** Closes the confirmation popup with the user's answer (FeedbackHost). */
export function answerConfirm(yes: boolean) {
  const c = state.confirm
  if (!c) return
  set({ confirm: null })
  c.resolve(yes)
}

/** Shows the result popup (kept in sessionStorage until OK: survives a reload / navigation right after the call). */
export function showResult(req: ResultRequest) {
  seq += 1
  const result = { ...req, id: seq }
  try {
    storage()?.setItem(RESULT_STORAGE_KEY, JSON.stringify(req))
  } catch {
    /* storage full / disabled: the popup still shows on this page */
  }
  set({ result })
}

/** OK on the result popup. */
export function dismissResult() {
  try {
    storage()?.removeItem(RESULT_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  set({ result: null })
}

/** A result stored by the previous page (reload / navigation right after the action) — FeedbackHost on mount. */
export function restoreResult() {
  let raw: string | null = null
  try {
    raw = storage()?.getItem(RESULT_STORAGE_KEY) ?? null
  } catch {
    raw = null
  }
  if (!raw || state.result) return
  try {
    const r = JSON.parse(raw) as Partial<ResultRequest>
    if (typeof r.ok === 'boolean' && typeof r.title === 'string') {
      seq += 1
      set({ result: { ok: r.ok, title: r.title, message: typeof r.message === 'string' ? r.message : null, testId: typeof r.testId === 'string' ? r.testId : undefined, id: seq } })
      return
    }
  } catch {
    /* malformed: dropped below */
  }
  dismissResult()
}

// ---------------------------------------------------------------------------------------------------------------
// Wording (Bahasa Indonesia, same on every button): "Yakin ingin tolak PB/1?" · [Ya, tolak] · "Berhasil: tolak PB/1"

/** "Kirim pengajuan" → "kirim pengajuan"; acronyms ("LPJ", "KM") stay. */
export function lowerFirst(s: string): string {
  const t = s.trim()
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t
}

/** "Yakin ingin <aksi> <objek>?" (a trailing "?" / "…" of the action label is dropped). */
export function confirmTitle(action: string, object?: string | null): string {
  const a = lowerFirst(action).replace(/[?…]+$/, '')
  return `Yakin ingin ${a}${object ? ` ${object}` : ''}?`
}

/** "[Ya, <aksi>]". */
export function confirmLabel(action: string): string {
  return `Ya, ${lowerFirst(action).replace(/[?…]+$/, '')}`
}

/** A dialog title written as a question ("Void transfer TRF/1?") → "Yakin ingin void transfer TRF/1?" (idempotent). */
export function asConfirmTitle(title: string): string {
  const t = title.trim()
  if (/^yakin\b/i.test(t)) return t
  return `Yakin ingin ${lowerFirst(t).replace(/[?…]+$/, '')}?`
}

/** A confirm button label ("Void transfer") → "Ya, void transfer" (idempotent). */
export function asConfirmLabel(label: string): string {
  return /^ya\b/i.test(label.trim()) ? label.trim() : confirmLabel(label)
}

/** "Berhasil: <aksi> <dokumen>". */
export function successTitle(action: string, doc?: string | null): string {
  return `Berhasil: ${lowerFirst(action).replace(/[?…]+$/, '')}${doc ? ` ${doc}` : ''}`
}

/** "Gagal: <aksi>". */
export function failureTitle(action: string): string {
  return `Gagal: ${lowerFirst(action).replace(/[?…]+$/, '')}`
}

/** Destructive actions are styled danger: Tolak, Batalkan, Hapus, Nonaktifkan, Void. */
export function isDangerAction(action: string): boolean {
  return /\b(tolak|batal|hapus|nonaktif|void|cabut)/i.test(action)
}

/** Summary rows with a value (empty / null / undefined skipped). */
export function summaryRows(summary: Summary | undefined): Array<[string, string]> {
  return (summary ?? []).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k, v]) => [k, String(v)])
}

/**
 * Convenience for a plain (no reason) action: confirm → run → result popup. `run` returns null on success or the
 * error text (server problem); a thrown error is shown as "Gagal menghubungi server". Returns true when it ran OK.
 */
export async function confirmedRun(opts: {
  action: string
  object?: string | null
  summary?: Summary
  description?: string
  danger?: boolean
  testId?: string
  /** Result message on success (what happens next). */
  success?: string
  run: () => Promise<string | null>
}): Promise<boolean> {
  const yes = await confirmAction({
    title: confirmTitle(opts.action, opts.object),
    summary: opts.summary,
    description: opts.description,
    confirmLabel: confirmLabel(opts.action),
    danger: opts.danger ?? isDangerAction(opts.action),
    testId: opts.testId,
  })
  if (!yes) return false
  let err: string | null
  try {
    err = await opts.run()
  } catch (e) {
    err = (e as Error)?.message || 'Gagal menghubungi server. Coba lagi.'
  }
  showResult(err ? { ok: false, title: failureTitle(opts.action), message: err, testId: opts.testId } : { ok: true, title: successTitle(opts.action, opts.object), message: opts.success ?? null, testId: opts.testId })
  return !err
}
