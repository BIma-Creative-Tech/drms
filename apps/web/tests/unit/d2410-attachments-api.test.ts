import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from '@/api/v1/openapi'
import { openapiDocument } from '@/api/v1/openapi.generated'
import { ExpenseRequestDetail } from '@/api/v1/schemas-flow'
import { SyncDraftUpsertPayload } from '@/api/v1/schemas-sync'

/**
 * D2410 (point 6, user 2026-10-24) — the APK's general attachments ("Lampiran"):
 *  1. `expense_request.draft_upsert` carries `attachment_ids` (media-attachments ids, ≤ 20; replaces the list, omitted =
 *     unchanged for older APKs);
 *  2. `GET /expense-requests/{id}` lists `attachments[] {id, fileName, mimeType}` so the APK shows and opens them.
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('SyncDraftUpsertPayload.attachment_ids', () => {
  it('optional array of ids, at most 20', () => {
    expect(SyncDraftUpsertPayload.safeParse({ title: 'Reimburse bensin' }).success).toBe(true)
    expect(SyncDraftUpsertPayload.parse({ attachment_ids: [7, 8] }).attachment_ids).toEqual([7, 8])
    expect(SyncDraftUpsertPayload.parse({ attachment_ids: [] }).attachment_ids).toEqual([])
    expect(SyncDraftUpsertPayload.safeParse({ attachment_ids: Array.from({ length: 21 }, (_, i) => i + 1) }).success).toBe(false)
    expect(SyncDraftUpsertPayload.safeParse({ attachment_ids: [0] }).success).toBe(false)
    expect(SyncDraftUpsertPayload.safeParse({ attachment_ids: null }).success).toBe(false)
  })
})

describe('ExpenseRequestDetail.attachments', () => {
  it('the zod schema requires the list; file name / type may be null', () => {
    const shape = ExpenseRequestDetail.shape.attachments
    expect(shape.safeParse([{ id: 5, fileName: 'a.pdf', mimeType: 'application/pdf' }]).success).toBe(true)
    expect(shape.safeParse([{ id: 5, fileName: null, mimeType: null }]).success).toBe(true)
    expect(shape.safeParse(undefined).success).toBe(false)
  })

  it('the committed OpenAPI document carries both fields', () => {
    const built = buildOpenApiDocument('0.0.0') as unknown as Json
    const committed = openapiDocument as unknown as Json
    const sc = built.components.schemas as Json
    expect(sc.ExpenseRequestDetail.required).toContain('attachments')
    expect(sc.ExpenseRequestDetail.properties.attachments.items.required).toEqual(['id', 'fileName', 'mimeType'])
    expect(committed.components.schemas.ExpenseRequestDetail.properties.attachments).toEqual(sc.ExpenseRequestDetail.properties.attachments)
    expect(sc.SyncDraftUpsertPayload.properties.attachment_ids.maxItems).toBe(20)
    expect(committed.components.schemas.SyncDraftUpsertPayload.properties.attachment_ids).toEqual(sc.SyncDraftUpsertPayload.properties.attachment_ids)
  })
})
