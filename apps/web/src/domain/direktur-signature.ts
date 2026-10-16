import type { PayloadRequest } from 'payload'

import { displayName, fail, resolveSignature, type Signature } from '@/domain/expense/common'

import { AUDIT_ACTOR_DISPLAY, decisionPositionOf, direkturOf, isDirekturStep, representationApplies, type CompanyDirektur } from './direktur-rules'

export * from './direktur-rules'

/**
 * ADR 0025 service part: reads the PT's definitive Direktur, decides whether THIS decision is signed as that
 * Direktur, and returns the signature / display name / snapshot columns of the approval row. The rules
 * (what a Direktur step is, when representation applies) are the pure module `direktur-rules.ts`.
 */

/** Definitive Direktur of PT `companyId` (fresh SYSTEM-READ in the request's transaction), or null when not configured. */
export async function companyDirektur(req: PayloadRequest, companyId: number | null | undefined): Promise<CompanyDirektur | null> {
  if (typeof companyId !== 'number') return null
  const c = (await req.payload.findByID({
    collection: 'companies',
    id: companyId,
    depth: 0,
    select: { direktur: true } as never,
    overrideAccess: true, // SYSTEM-READ: the PT's definitive Direktur (decision signing, ADR 0025)
    req,
    disableErrors: true,
  })) as { direktur?: unknown } | null
  return direkturOf(companyId, c?.direktur)
}

/**
 * Owner decision 2026-10-16 (`holdsPositionAs`): the decision the caller would take now at `pos` is signed as the PT's
 * definitive Direktur — the rule of `representationFor` without the media read (the DB index decides last).
 */
export async function decidesAsDirektur(
  req: PayloadRequest,
  input: { companyId: number | null | undefined; callerId: number; snapshot: Parameters<typeof isDirekturStep>[0]; pos: { position: 'diketahui' | 'approval'; level: number } | null },
): Promise<boolean> {
  if (!input.pos || !isDirekturStep(input.snapshot, input.pos.position, input.pos.level)) return false
  return representationApplies(await companyDirektur(req, input.companyId), input.callerId, true)
}

export type Representation = {
  companyId: number
  name: string
  title: string | null
  mediaId: number
  sha256: string | null
}

/**
 * The representation of THIS decision, or null (personal signature as before): the caller is a designated
 * representative of the document's PT and decides a Direktur step, and the PT's signature media row exists.
 */
export async function representationFor(req: PayloadRequest, input: { companyId: number | null | undefined; callerId: number; direkturStep: boolean }): Promise<Representation | null> {
  if (!input.direkturStep) return null
  const cfg = await companyDirektur(req, input.companyId)
  if (!representationApplies(cfg, input.callerId, input.direkturStep)) return null
  const m = (await req.payload.findByID({
    collection: 'media-signatures',
    id: cfg.signatureId,
    depth: 0,
    overrideAccess: true, // SYSTEM-READ: the PT's Direktur signature (immutable media row)
    req,
    disableErrors: true,
  })) as { id: number; sha256Original?: string | null } | null
  if (!m) return null
  return { companyId: cfg.companyId, name: cfg.name, title: cfg.title, mediaId: m.id, sha256: m.sha256Original ?? null }
}

/**
 * Starts showing the represented Direktur as the actor of every audit row written for the rest of this request
 * (the decision row, the status change, finalize side effects). The rows keep the real `user_id`.
 */
export function showAuditActorAs(req: PayloadRequest, rep: Representation | null): void {
  if (!rep) return
  req.context ??= {}
  req.context[AUDIT_ACTOR_DISPLAY] = rep.name
}

/** Approval-row columns of a represented decision (spread into the `approvals` create data). */
export function representedColumns(rep: Representation | null): { representedDirektur: { name: string | null; title: string | null } } {
  return { representedDirektur: { name: rep?.name ?? null, title: rep?.title ?? null } }
}

export type DecisionSigner = {
  /** Signature stored on the approval row (the PT's Direktur signature when represented). */
  signature: Signature | null
  /** Representation snapshot, or null (personal decision). */
  represented: Representation | null
  /** `approvals.actorName` = the name shown everywhere (the definitive Direktur when represented). */
  actorName: string
}

/**
 * Signature + display name of ONE decision (acknowledge / approve / reject) by the caller. Represented: the PT's
 * Direktur signature (a drawn/captured signature of the representative is ignored — the server decides), the
 * Direktur's name, and every audit row of this request shows that name. Otherwise the caller's captured or
 * profile signature (US-43); `required` → 409 `missingMessage` when there is none.
 */
export async function signDecision(
  req: PayloadRequest,
  input: { companyId: number | null | undefined; callerId: number; direkturStep: boolean; capturedId?: number | null; required: boolean; missingMessage?: string },
): Promise<DecisionSigner> {
  const rep = await representationFor(req, input)
  if (rep) {
    showAuditActorAs(req, rep)
    return { signature: { mediaId: rep.mediaId, sha256: rep.sha256, source: 'company' }, represented: rep, actorName: rep.name }
  }
  const signature = await resolveSignature(req, input.callerId, input.capturedId)
  if (!signature && input.required) {
    fail(409, input.missingMessage ?? 'Tanda tangan wajib: unggah tanda tangan Anda di Profil & tanda tangan (web) atau buat tanda tangan di aplikasi, lalu ulangi.')
  }
  return { signature, represented: null, actorName: await displayName(req, input.callerId) }
}

/** Approval-row columns of one decision (signature + display name + representation snapshot). */
export function signerColumns(s: DecisionSigner) {
  return {
    actorName: s.actorName,
    signature: s.signature?.mediaId ?? null,
    signatureSha256: s.signature?.sha256 ?? null,
    signatureSource: s.signature ? s.signature.source : 'none',
    ...representedColumns(s.represented),
  }
}

/** Detail DTO hint (web decision bar, APK decision sheet): the caller's next decision is signed as this Direktur. */
export type DirekturSignatureHint = { name: string; title: string | null; signatureId: number }

/**
 * `direkturSignature` of GET /expense-requests/{id}: non-null when the decision the caller may take now is a
 * Direktur step of a PT with a definitive Direktur and the caller is one of its designated representatives —
 * the APK then shows the PT signature read-only instead of asking for one. The server decides again at the
 * decision itself (`signDecision`).
 */
export async function direkturSignatureHint(
  req: PayloadRequest,
  input: { companyId: number | null | undefined; callerId: number; snapshot: Parameters<typeof isDirekturStep>[0]; status: string; currentLevel: number | null | undefined; allowed: readonly string[] },
): Promise<DirekturSignatureHint | null> {
  const pos = decisionPositionOf(input.allowed, input.status, input.currentLevel)
  if (!pos || !isDirekturStep(input.snapshot, pos.position, pos.level)) return null
  const cfg = await companyDirektur(req, input.companyId)
  if (!representationApplies(cfg, input.callerId, true)) return null
  return { name: cfg.name, title: cfg.title, signatureId: cfg.signatureId }
}
