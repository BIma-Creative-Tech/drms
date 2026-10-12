import { z } from 'zod'

import { companyFilterParam } from './schemas'

/**
 * DRMS 10/10 Phase C: /api/v1 contract of the project list / detail (APK "Proyek", request project picker) and the
 * cost-center picker (Finance transfer, D2). RAP money only for the price roles of the project (Direktur, Admin,
 * Finance, its PM) — null for everyone else. Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()

export const ProjectListQuery = z
  .object({
    q: z.string().trim().max(100).optional().meta({ description: 'Search in kode / nama (every word must match).' }),
    status: z
      .string()
      .regex(/^(perencanaan|berjalan|ditunda|selesai|arsip)(,(perencanaan|berjalan|ditunda|selesai|arsip))*$/)
      .optional()
      .meta({ description: 'Comma separated statuses. Default: every status except arsip.' }),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    company: companyFilterParam,
  })
  .meta({ id: 'ProjectListQuery' })

const Ref = z.object({ id, code: z.string(), name: z.string() })

export const ProjectListItem = z
  .object({
    id,
    code: z.string(),
    name: z.string(),
    kind: z.string().meta({ description: 'umum | konstruksi | kontrak_unit | aftersales | trading' }),
    companyId: id,
    pm: z.object({ id, name: z.string() }).nullable(),
    status: z.string().nullable(),
    statusLabel: z.string().nullable(),
    contractValue: z.number().nullable().meta({ description: 'RAB of the project; null without a money role in its PT (Direktur, Admin, Finance, PM) — Staff and Operator never get it (owner 2026-10-11).' }),
    progressPct: z.number().nullable(),
    costCenter: Ref.nullable().meta({ description: 'D2: default cost center proposed to Finance at the transfer.' }),
    rapPlanned: z.number().nullable().meta({ description: 'D4: Σ planned RAP amount (price roles only).' }),
    rapRealised: z.number().nullable().meta({ description: 'D4: Σ approved line totals charged to RAP items (price roles only).' }),
    rapPercent: z.number().nullable().meta({ description: 'D4: rapRealised / rapPlanned × 100 (price roles only).' }),
    rapOverBudgetItems: z.number().int().nullable().meta({ description: 'D4: RAP items over plan (price roles only).' }),
    rapItems: z.number().int().meta({ description: 'RAP items (active + deactivated with realisation).' }),
  })
  .meta({ id: 'ProjectListItem' })

export const ProjectList = z
  .object({ docs: z.array(ProjectListItem), totalDocs: z.number().int(), page: z.number().int(), totalPages: z.number().int(), limit: z.number().int() })
  .meta({ id: 'ProjectList' })

export const ProjectRapSummary = z
  .object({
    items: z.number().int(),
    planned: z.number().nullable(),
    realised: z.number().nullable(),
    transferred: z.number().nullable(),
    verified: z.number().nullable(),
    remaining: z.number().nullable(),
    percent: z.number().nullable(),
    overBudgetItems: z.number().int().nullable(),
  })
  .meta({ id: 'ProjectRapSummary', description: 'D4: money fields null without a price role.' })

export const ProjectDetail = ProjectListItem.extend({
  client: z.object({ id, name: z.string() }).nullable(),
  address: z.string().nullable(),
  startDate: z.string().nullable(),
  targetDate: z.string().nullable(),
  rap: ProjectRapSummary,
}).meta({ id: 'ProjectDetail' })

export const CostCenterListQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    active: z.enum(['1', 'all']).optional().meta({ description: 'Default active only; `all` includes deactivated ones.' }),
    company: companyFilterParam,
  })
  .meta({ id: 'CostCenterListQuery' })

export const CostCenterList = z
  .object({
    docs: z.array(z.object({ id, code: z.string(), name: z.string(), type: z.string().nullable(), companyId: id.nullable(), active: z.boolean() })),
    totalDocs: z.number().int(),
  })
  .meta({ id: 'CostCenterList' })
