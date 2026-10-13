import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import type { CollectionSlug, PayloadRequest } from 'payload'

import { loadMemberships } from '@/access/company-context'
import { relId, userId, withCompanyContext } from '@/access/roles'
import { writeAudit, writeAuditDetached } from '@/audit/writer'
import { COMPANY_SIGNATURE_SOURCE } from '@/domain/direktur-rules'
import { auditPrivacyDenied, PRIVACY_ACK_REQUIRED, PRIVACY_ACK_REQUIRED_DETAIL, PRIVACY_CHECKED_KEY, privacyAckCheck } from '@/legal/privacy-enforcement'
import { getEnv } from '@/lib/env'
import { ImageQueueFullError, withImageSlot } from '@/lib/image-queue'
import { fileSize, mediaPath } from '@/lib/media-files'
import { parseSignedParams, signedMediaPath, signingKeys, signMedia, verifyMedia } from '@/lib/signed-url'
import { withReqTransaction } from '@/lib/system-tx'

import { HttpError, json, problem, v1 } from '../http'
import { FileCollectionEnum, MediaKindEnum } from '../schemas-flow'

const COLLECTION: Record<string, CollectionSlug> = {
  receipts: 'media-receipts',
  'transfer-proofs': 'media-transfer-proofs',
  signatures: 'media-signatures',
  attachments: 'media-attachments',
  // F4b attendance selfie (720 px, JPEG in / WebP stored, EXIF stripped — ADR 0004).
  selfies: 'media-selfies',
  // E4 progress photos (1600 px JPEG, EXIF/GPS stripped; ≤ 5 per report — ADR 0004, US-10).
  'progress-photos': 'media-progress-photos',
}

/**
 * ADR 0018 (owner 2026-10-05): while "Versi APK minimum" ≥ 0.3.3, a selfie (attendance capture) of a caller who has
 * not acknowledged the current privacy notice → 403 `PRIVACY_ACK_REQUIRED` (audited `access_denied`), before the
 * image is queued or stored. Marks the request so the collection guard does not check again.
 */
async function refuseSelfieWithoutPrivacyAck(req: PayloadRequest): Promise<void> {
  const uid = userId(req)
  if (uid === undefined) throw new HttpError(401, 'Unauthorized')
  const check = await privacyAckCheck(req, uid)
  if (check.required) {
    await auditPrivacyDenied(req, check, { docType: 'media_selfies', field: 'upload', companyId: null })
    throw new HttpError(403, 'Forbidden', { code: PRIVACY_ACK_REQUIRED, detail: PRIVACY_ACK_REQUIRED_DETAIL })
  }
  req.context ??= {}
  req.context[PRIVACY_CHECKED_KEY] = true
}

/**
 * POST /api/v1/media/{kind} — multipart upload (field `file`) for the APK and custom views:
 * the collection's create access applies (e.g. transfer proofs: Finance only), the server
 * re-encodes/resizes (receipts ≤ 2000 px, original discarded, sha256 of the original kept —
 * ADR 0004, user decision 2026-09-23) and returns the id to reference in the domain actions
 * (receipts, transfer, signature, attachments). Ownership is linked when the id is used.
 */
export const uploadMediaEndpoint = v1({
  path: '/media/:kind',
  method: 'post',
  multipart: true,
  rateLimit: [60, 60_000],
  // E9 P-1: the transaction is opened INSIDE the image-queue slot (below), so a queued upload does
  // not hold a pooled DB connection while it waits.
  transactional: false,
  handler: async ({ req, params }) => {
    const kind = MediaKindEnum.safeParse(params.kind)
    if (!kind.success) throw new HttpError(404, 'Not Found')
    const file = req.file
    if (!file?.data?.length) throw new HttpError(400, 'Bad Request', { detail: 'Field "file" wajib (multipart/form-data).' })
    if (kind.data === 'selfies') await refuseSelfieWithoutPrivacyAck(req)
    const create = () =>
      withReqTransaction(req, () =>
        req.payload.create({
          collection: COLLECTION[kind.data]!,
          data: {},
          file,
          depth: 0,
          user: req.user,
          overrideAccess: false, // collection create access decides who may upload what
          req,
        }),
      )
    let doc: { id: number; mimeType?: string; filesize?: number; width?: number; height?: number; sha256Original?: string }
    try {
      // Raster images are re-encoded by sharp → one image-queue slot per upload (PDFs are stored as-is).
      doc = (await (file.mimetype?.startsWith('image/') ? withImageSlot(create, `media:${kind.data}`) : create())) as unknown as typeof doc
    } catch (err) {
      if (err instanceof ImageQueueFullError) {
        const res = problem(503, 'Service Unavailable', { code: 'UPLOAD_BUSY', detail: 'Server sedang memproses banyak foto. Unggahan akan dicoba lagi otomatis.' })
        res.headers.set('Retry-After', String(err.retryAfterSeconds))
        return res
      }
      throw err
    }
    return json(
      {
        id: doc.id,
        kind: kind.data,
        mimeType: doc.mimeType ?? null,
        filesize: doc.filesize ?? null,
        width: doc.width ?? null,
        height: doc.height ?? null,
        sha256Original: doc.sha256Original ?? null,
      },
      201,
    )
  },
})

const FILE_COLLECTION: Record<string, CollectionSlug> = {
  receipts: 'media-receipts',
  'transfer-proofs': 'media-transfer-proofs',
  signatures: 'media-signatures',
  attachments: 'media-attachments',
  company: 'media-company',
  // E4: readable by the uploader, office roles and readers of the owning progress report.
  'progress-photos': 'media-progress-photos',
  // E9: attendance selfies (uploader, office roles, readers of the referencing attendance — Q-33).
  selfies: 'media-selfies',
}

/** Collections whose reads by someone other than the uploader are audited `view_sensitive`. */
const SENSITIVE: Partial<Record<CollectionSlug, string>> = {
  'media-transfer-proofs': 'media_transfer_proofs',
  'media-selfies': 'media_selfies',
}

type MediaDoc = {
  id: number
  filename?: string | null
  mimeType?: string | null
  uploadedBy?: unknown
  removedAt?: string | null
  sizes?: { thumb?: { filename?: string | null; mimeType?: string | null } | null } | null
}

/** view_sensitive throttle (ADR 0006 §4: 1 row per user/doc/10 min). In-process: one web instance. */
const lastSensitiveView = new Map<string, number>()
function shouldAuditView(key: string, now = Date.now()): boolean {
  const prev = lastSensitiveView.get(key)
  if (prev !== undefined && now - prev < 10 * 60_000) return false
  lastSensitiveView.set(key, now)
  if (lastSensitiveView.size > 5000) {
    for (const [k, t] of lastSensitiveView) if (now - t >= 10 * 60_000) lastSensitiveView.delete(k)
  }
  return true
}

/**
 * Signatures are readable by their uploader and office roles (collection access); in addition a
 * signature REFERENCED BY an approval row of a request the caller may read is visible (the APK
 * shows the signed positions of the caller's own/team requests, US-05/US-43).
 */
async function signatureOnVisibleRequest(req: PayloadRequest, mediaId: number): Promise<boolean> {
  const rows = await req.payload.find({
    collection: 'approvals',
    // ADR 0025: a PT's definitive Direktur signature is never opened through a request (office roles of the PT only)
    where: { and: [{ signature: { equals: mediaId } }, { or: [{ signatureSource: { exists: false } }, { signatureSource: { not_equals: COMPANY_SIGNATURE_SOURCE } }] }] },
    depth: 0,
    pagination: false,
    select: { request: true },
    overrideAccess: true, // SYSTEM-READ: which requests reference this signature
    req,
  })
  const reqIds = rows.docs.map((d) => relId((d as { request?: unknown }).request)).filter((x): x is number => x !== undefined)
  if (reqIds.length === 0) return false
  // QA-MC4-07: those requests only (was: every visible request id of the caller)
  const visible = await req.payload
    .find({ collection: 'expense-requests', where: { id: { in: reqIds } }, depth: 0, limit: 1, pagination: false, select: { status: true }, user: req.user, overrideAccess: false, req })
    .catch((err: { status?: number }) => {
      if (err.status === 403) return { docs: [] }
      throw err
    })
  return visible.docs.length > 0
}

/**
 * E9: a selfie is also readable by everyone who may read the ATTENDANCE referencing it (PM team,
 * Q-33) — same rule as GET /attendance/{id}/selfie, evaluated with the caller's access.
 */
async function selfieOnVisibleAttendance(req: PayloadRequest, mediaId: number): Promise<boolean> {
  const res = await req.payload.find({
    collection: 'attendances',
    where: { selfie: { equals: mediaId } },
    depth: 0,
    limit: 1,
    pagination: false,
    select: { selfie: true },
    user: req.user,
    overrideAccess: false, // the caller's attendance scope decides
    req,
  })
  return res.docs.length > 0
}

/**
 * The media row when the CURRENT req.user may read it (collection read access with
 * overrideAccess:false, plus the owner-document fallbacks for signatures and selfies), else null.
 * Shared by the file download, the signed-URL minting and the signed-URL re-check.
 */
async function readableMedia(req: PayloadRequest, slug: CollectionSlug, id: number): Promise<MediaDoc | null> {
  let doc = (await req.payload.findByID({ collection: slug, id, depth: 0, user: req.user, overrideAccess: false, req }).catch(() => null)) as MediaDoc | null
  const fallback =
    (slug === 'media-signatures' && (() => signatureOnVisibleRequest(req, id))) || (slug === 'media-selfies' && (() => selfieOnVisibleAttendance(req, id))) || null
  if (!doc && fallback && (await fallback())) {
    doc = (await req.payload.findByID({ collection: slug, id, depth: 0, overrideAccess: true /* SYSTEM-READ: visibility checked above */, req }).catch(() => null)) as MediaDoc | null
  }
  return doc
}

function parseTarget(params: Record<string, string>, req: PayloadRequest): { kind: string; slug: CollectionSlug; id: number; variant: 'thumb' | null } {
  const kind = FileCollectionEnum.safeParse(params.collection)
  if (!kind.success) throw new HttpError(404, 'Not Found')
  if (!/^\d{1,10}$/.test(params.id ?? '')) throw new HttpError(404, 'Not Found')
  const variant = req.searchParams.get('variant')
  if (variant !== null && variant !== 'thumb') throw new HttpError(400, 'Bad Request', { detail: 'variant hanya "thumb".' })
  return { kind: kind.data, slug: FILE_COLLECTION[kind.data]!, id: Number(params.id), variant }
}

const nowS = () => Math.floor(Date.now() / 1000)
const keys = () => signingKeys(getEnv())

/**
 * Signed request (…?exp&uid&sig): verifies the HMAC, the expiry and the user, then makes that user
 * the request user so every later check (read access, audit) runs as them. Any failure → 403 (ADR
 * 0004 §4 / E9 AC: expired → 403; valid signature but the user may not read the file → 403).
 */
async function authenticateSigned(req: PayloadRequest, t: { kind: string; id: number; variant: string | null }): Promise<void> {
  const p = parseSignedParams(req.searchParams)
  if (!p) throw new HttpError(403, 'Forbidden', { code: 'URL_INVALID', detail: 'Tautan file tidak valid.' })
  const result = verifyMedia({ collection: t.kind, id: t.id, variant: t.variant, userId: p.uid }, p, keys(), nowS())
  if (result === 'expired') throw new HttpError(403, 'Forbidden', { code: 'URL_EXPIRED', detail: 'Tautan file sudah kedaluwarsa. Buka ulang dari aplikasi.' })
  if (result !== 'ok') throw new HttpError(403, 'Forbidden', { code: 'URL_INVALID', detail: 'Tautan file tidak valid.' })
  const found = await req.payload.find({
    collection: 'users',
    where: { and: [{ id: { equals: p.uid } }, { active: { equals: true } }] },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true, // SYSTEM-READ: the user the URL was minted for (signature verified above)
    req,
  })
  const user = found.docs[0]
  if (!user) throw new HttpError(403, 'Forbidden', { code: 'URL_INVALID', detail: 'Tautan file tidak valid.' })
  // ADR 0016 §5: same company context as an interactive login (all memberships, no selection)
  const withCtx = withCompanyContext(user, await loadMemberships(req.payload, user.id, req), null, (user as { groupAdmin?: boolean | null }).groupAdmin === true)
  req.user = { ...withCtx, collection: 'users', _strategy: 'signedUrl' } as unknown as PayloadRequest['user']
}

/**
 * GET /api/v1/media/{collection}/{id}/file[?variant=thumb] — authenticated, scoped file download
 * for the APK and the web panel (ADR 0004 §4; Traefik strips bearer tokens on the Payload-proxied
 * /api/<slug>/file path). Read access = the media collection's own access (owner-document
 * derived), else 404 (no existence leak). The stored name comes from the DB and must be a
 * server-generated one inside the collection's staticDir (no path traversal). Streams the file
 * with `private, no-store`, nosniff and a fixed Content-Disposition. Transfer proofs (bank data)
 * and other people's selfies are audited `view_sensitive`.
 *
 * E9: the same URL also accepts a SIGNED query (`exp`, `uid`, `sig` from GET …/signed-url) instead
 * of a session/bearer — expired or invalid → 403, valid but the user may no longer read the file →
 * 403 (audited `access_denied`). Without `sig` nothing changes (APK bearer / web cookie → 401/404).
 */
export const mediaFileEndpoint = v1({
  path: '/media/:collection/:id/file',
  method: 'get',
  rateLimit: [240, 60_000],
  signedAccess: true,
  handler: async ({ req, params }) => {
    const t = parseTarget(params, req)
    const signed = req.searchParams.has('sig')
    if (signed) await authenticateSigned(req, t)

    const doc = await readableMedia(req, t.slug, t.id)
    if (!doc) {
      if (!signed) throw new HttpError(404, 'Not Found')
      await writeAuditDetached(req, [
        { action: 'access_denied', docType: t.slug.replace(/-/g, '_'), docId: String(t.id), field: 'signed_url', reason: 'URL bertanda tangan valid, tetapi pengguna tidak (lagi) berhak membaca file (E9, ADR 0004 §4)' },
      ])
      throw new HttpError(403, 'Forbidden', { code: 'FORBIDDEN', detail: 'Anda tidak berhak membuka file ini.' })
    }

    const name = t.variant === 'thumb' ? doc.sizes?.thumb?.filename : doc.filename
    const mime = (t.variant === 'thumb' ? doc.sizes?.thumb?.mimeType : doc.mimeType) ?? 'application/octet-stream'
    const file = doc.removedAt ? null : mediaPath(req.payload, t.slug, name)
    const size = file ? await fileSize(file) : null
    if (!file || size === null) throw new HttpError(404, 'Not Found')

    const uid = userId(req)
    const sensitive = SENSITIVE[t.slug]
    const own = relId(doc.uploadedBy) === uid
    if (sensitive && !(t.slug === 'media-selfies' && own) && shouldAuditView(`${uid}:${t.slug}:${t.id}`)) {
      await withReqTransaction(req, () => writeAudit(req, [{ action: 'view_sensitive', docType: sensitive, docId: String(t.id), field: t.variant ?? 'file' }]))
    }
    const ext = path.extname(file)
    const disposition = mime === 'application/pdf' ? 'attachment' : 'inline'
    const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `${disposition}; filename="${t.kind}-${t.id}${t.variant ? '-thumb' : ''}${ext}"`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    })
  },
})

/**
 * GET /api/v1/media/{collection}/{id}/signed-url[?variant=thumb] — E9 (ADR 0004 §4): mints a signed
 * URL of the file endpoint for the CALLER, valid 5 minutes, for contexts that cannot send the
 * bearer/cookie (notification deep links, WebView `<img>`, external viewer). Same visibility as
 * the download (not readable → 404). The URL is relative to the API origin.
 */
export const mediaSignedUrlEndpoint = v1({
  path: '/media/:collection/:id/signed-url',
  method: 'get',
  rateLimit: [240, 60_000],
  handler: async ({ req, params }) => {
    const t = parseTarget(params, req)
    const doc = await readableMedia(req, t.slug, t.id)
    if (!doc) throw new HttpError(404, 'Not Found')
    const target = { collection: t.kind, id: t.id, variant: t.variant, userId: userId(req)! }
    const signedParams = signMedia(target, keys(), nowS())
    return json({
      url: signedMediaPath(req.payload.config.routes.api, target, signedParams),
      expiresAt: new Date(signedParams.exp * 1000).toISOString(),
      ttlSeconds: signedParams.exp - nowS(),
    })
  },
})
