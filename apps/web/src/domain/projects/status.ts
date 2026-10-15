/**
 * D1610 (ADR 0030): project statuses of a CLOSED project — no new requests, addenda, loans, reports, attendance or
 * RAP edits (the checks that refused an archived project before). A cancelled project (`dibatalkan`, set only by
 * "Batalkan proyek") is closed like an archived one. Pure module (no Payload import).
 */
export const PROJECT_CLOSED_STATUSES = ['arsip', 'dibatalkan'] as const

export const isClosedProjectStatus = (s: unknown): boolean => s === 'arsip' || s === 'dibatalkan'

/** Message of the closed-project refusals. */
export const closedProjectMessage = (s: unknown): string => (s === 'dibatalkan' ? 'Project sudah dibatalkan.' : 'Project sudah diarsipkan.')
