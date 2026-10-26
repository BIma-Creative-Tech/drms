/**
 * D1610 (ADR 0030): project statuses of a CLOSED project — no new requests, addenda, loans, reports, attendance or
 * RAP edits (the checks that refused an archived project before). A cancelled project (`dibatalkan`, set only by
 * "Batalkan proyek") is closed like an archived one. Pure module (no Payload import).
 */
export const PROJECT_CLOSED_STATUSES = ['arsip', 'dibatalkan'] as const

export const isClosedProjectStatus = (s: unknown): boolean => s === 'arsip' || s === 'dibatalkan'

/** Message of the closed-project refusals. */
export const closedProjectMessage = (s: unknown): string => (s === 'dibatalkan' ? 'Project sudah dibatalkan.' : 'Project sudah diarsipkan.')

/**
 * Statuses a NEW request may not use (G10, domain/expense/drafts.ts): closed + `selesai`. D2610 (backlog 26/10): the
 * request project pickers (web filterOptions, APK draft editor) leave them out instead of offering a refused project.
 */
export const REQUEST_REFUSED_PROJECT_STATUSES = ['arsip', 'dibatalkan', 'selesai'] as const

export const isRequestableProjectStatus = (s: unknown): boolean => !(REQUEST_REFUSED_PROJECT_STATUSES as readonly unknown[]).includes(s)
