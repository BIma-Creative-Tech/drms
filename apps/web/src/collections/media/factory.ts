import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  APIError,
  type Access,
  type CollectionBeforeChangeHook,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
  type Field,
  type ImageSize,
  type UploadConfig,
} from 'payload'
import sharp from 'sharp'

import { denyAll } from '@/access/roles'
import { withAudit } from '@/audit/hooks'
import { imageQueue, insideImageSlot } from '@/lib/image-queue'
import { takeToken } from '@/lib/rate-limit'

const MEDIA_DIR = process.env.MEDIA_DIR ?? '/data/media'

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 // ADR 0004 §2 (upload.limits.fileSize)
/**
 * S3e (US-57): decoded-size cap of an uploaded image (decompression-bomb guard, far below sharp's
 * default 268 MP). 50 MP ≈ 8660 × 5773 — above every phone camera the client uses.
 */
export const MAX_INPUT_PIXELS = 50_000_000

/** Server-side image limits (pure, unit-tested): byte cap per MIME, then decoded pixel count. */
export function imageLimitError(spec: Pick<MediaSpec, 'maxBytesByMime'>, mime: string, bytes: number, dims?: { width?: number; height?: number }): { status: number; message: string } | null {
  const cap = spec.maxBytesByMime?.[mime] ?? MAX_UPLOAD_BYTES
  if (bytes > cap) return { status: 413, message: `File terlalu besar (maks. ${cap >= 1024 * 1024 ? `${Math.floor(cap / 1024 / 1024)} MB` : `${Math.floor(cap / 1024)} KB`}).` }
  if (dims?.width && dims.height && dims.width * dims.height > MAX_INPUT_PIXELS) {
    return { status: 413, message: `Resolusi foto terlalu besar (${dims.width} × ${dims.height} px, maks. ${MAX_INPUT_PIXELS / 1_000_000} megapiksel).` }
  }
  return null
}
const UPLOADS_PER_MINUTE = 60 // architecture §6.5

const EXT_BY_FORMAT: Record<string, string> = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' }
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export type MediaSpec = {
  slug: string
  labels: { singular: string; plural: string }
  mimeTypes: string[]
  resizeOptions?: UploadConfig['resizeOptions']
  formatOptions?: UploadConfig['formatOptions']
  imageSizes?: ImageSize[]
  /** Per-MIME size cap below the global 8 MiB (e.g. transfer-proof PDFs ≤ 2 MB). */
  maxBytesByMime?: Record<string, number>
  access: { read: Access; create: Access }
  /** Extra read-only fields of one collection (e.g. selfie retention tombstone). */
  extraFields?: Field[]
  /** Content-Disposition for served files (PDFs: attachment). */
  disposition?: 'inline' | 'attachment'
}

/**
 * Remote-URL guard (spike h): Payload 3.90.1 derives an external upload source from
 * `{ filename, url }` on create (collections/operations/create.js) BEFORE hooks and fetches it
 * even with `pasteURL: false`. Every upload collection therefore requires a real file on create
 * and rejects any `url` in the input. Exported for unit tests.
 */
export function assertNoRemoteSource(args: { operation: string; data?: unknown; hasFile: boolean }): void {
  const data = (args.data ?? {}) as Record<string, unknown>
  if ('url' in data && data.url !== undefined && data.url !== null && data.url !== '') {
    throw new APIError('Upload dari URL tidak diizinkan.', 400, null, true)
  }
  if (args.operation === 'create' && !args.hasFile) {
    throw new APIError('Hanya upload file (multipart) yang diterima.', 400, null, true)
  }
}

function ext(spec: MediaSpec, mime: string): string {
  const isRaster = mime.startsWith('image/')
  const fmt = spec.formatOptions?.format
  const key = typeof fmt === 'string' ? fmt : undefined
  if (isRaster && key && EXT_BY_FORMAT[key]) return EXT_BY_FORMAT[key] as string
  return EXT_BY_MIME[mime] ?? 'bin'
}

export function mediaCollection(spec: MediaSpec): CollectionConfig {
  const beforeOperation: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
    if (operation !== 'create' && operation !== 'update') return args
    const a = args as { data?: Record<string, unknown> }
    assertNoRemoteSource({ operation, data: a.data, hasFile: Boolean(req.file?.data?.length || req.file?.tempFilePath) })
    if (operation !== 'create' || !req.file) return args
    // E9 P-1: generic REST uploads (admin panel) are not queued as a whole job; refuse them early
    // while the image queue is saturated (the /api/v1 upload endpoint queues whole jobs itself).
    if (req.file.mimetype?.startsWith('image/') && !insideImageSlot() && imageQueue().saturated) {
      throw new APIError('Server sedang memproses banyak foto. Coba lagi sebentar lagi.', 503, null, true)
    }
    const uid = (req.user as { id?: number } | null)?.id
    if (uid !== undefined && !takeToken(`upload:${uid}`, UPLOADS_PER_MINUTE, 60_000)) {
      throw new APIError('Terlalu banyak upload. Coba lagi sebentar lagi.', 429, null, true)
    }
    const buf = req.file.data
    const mime = req.file.mimetype
    const tooBig = imageLimitError(spec, mime, buf.length)
    if (tooBig) throw new APIError(tooBig.message, tooBig.status, null, true)
    if (mime === 'application/pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new APIError('File PDF tidak valid.', 400, null, true)
    }
    let width: number | undefined
    let height: number | undefined
    if (mime.startsWith('image/')) {
      const meta = await sharp(buf).metadata()
      width = meta.width
      height = meta.height
      const tooLarge = imageLimitError(spec, mime, buf.length, { width, height })
      if (tooLarge) throw new APIError(tooLarge.message, tooLarge.status, null, true)
    }
    // Server-generated name (no user-controlled paths, no enumeration). ADR 0004 §1.
    req.file.name = `${randomUUID()}.${ext(spec, mime)}`
    a.data = {
      ...(a.data ?? {}),
      sha256Original: createHash('sha256').update(buf).digest('hex'),
      originalWidth: width,
      originalHeight: height,
      originalSize: buf.length,
    }
    return args
  }

  const stamp: CollectionBeforeChangeHook = ({ data, operation, req }) => {
    if (operation === 'create') {
      data.uploadedBy = (req.user as { id?: number } | null)?.id ?? null
      data.receivedAt = new Date().toISOString()
    }
    return data
  }

  const readOnly = { readOnly: true }
  const never = { update: () => false }

  return withAudit(
    {
      slug: spec.slug,
      labels: spec.labels,
      admin: { group: 'Media', defaultColumns: ['filename', 'mimeType', 'filesize', 'uploadedBy', 'createdAt'] },
      access: { read: spec.access.read, create: spec.access.create, update: denyAll, delete: denyAll },
      upload: {
        staticDir: path.join(MEDIA_DIR, spec.slug),
        mimeTypes: spec.mimeTypes,
        resizeOptions: spec.resizeOptions,
        formatOptions: spec.formatOptions,
        imageSizes: spec.imageSizes,
        adminThumbnail: spec.imageSizes?.some((s) => s.name === 'thumb') ? 'thumb' : undefined,
        pasteURL: false,
        crop: false,
        focalPoint: false,
        bulkUpload: false,
        modifyResponseHeaders: ({ headers }) => {
          headers.set('Cache-Control', 'private, no-store')
          headers.set('X-Content-Type-Options', 'nosniff')
          headers.set('Content-Disposition', spec.disposition ?? 'inline')
          return headers
        },
      },
      hooks: { beforeOperation: [beforeOperation], beforeChange: [stamp] },
      fields: [
        { name: 'uploadedBy', type: 'relationship', relationTo: 'users', label: 'Diunggah oleh', index: true, access: never, admin: readOnly },
        { name: 'receivedAt', type: 'date', label: 'Diterima server', access: never, admin: readOnly },
        { name: 'ownerDocType', type: 'text', label: 'Jenis dokumen pemilik', index: true, access: never, admin: readOnly },
        { name: 'ownerDocId', type: 'text', label: 'ID dokumen pemilik', index: true, access: never, admin: readOnly },
        { name: 'sha256Original', type: 'text', label: 'SHA-256 file asli', index: true, access: never, admin: readOnly },
        { name: 'originalWidth', type: 'number', access: never, admin: readOnly },
        { name: 'originalHeight', type: 'number', access: never, admin: readOnly },
        { name: 'originalSize', type: 'number', access: never, admin: readOnly },
        { name: 'capturedAt', type: 'date', label: 'Waktu foto (perangkat)', access: never },
        ...(spec.extraFields ?? []),
      ],
    },
    { docType: spec.slug.replace(/-/g, '_'), extraFields: ['filename', 'mimeType', 'filesize', 'width', 'height'] },
  )
}
