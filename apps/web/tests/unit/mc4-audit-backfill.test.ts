import type { Field, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { PER_PT_DOC_TYPES, POST_MC4_DOC_TYPES } from '@/audit/writer'
import { PER_PT_TABLES } from '@/migrations/20260927_234849_mc1_company_columns'
import { FR1_PER_PT_TABLES } from '@/migrations/20261010_120000_fr1_security'

/** Per-PT tables created after MC1 with company_id NOT NULL from the start (their own migrations). */
const PER_PT_TABLES_AFTER_MC1 = ['urgency_levels', 'rap_items', 'rap_templates', 'resource_types', 'daily_reports'] // 20261010_090000_p2s_urgency_level, 20261011_100000_p3_rap
import { BY_DOC_NO, BY_ID } from '@/migrations/20261003_090000_mc4_audit_company_backfill'

/**
 * UAT MC4-04 (AUD-02): the audit writer derives the PT of EVERY per-PT doc type, and the backfill migration uses
 * the same docType → table mapping (frozen copy) for the historic rows.
 */
let config: SanitizedConfig

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

const topFields = (fields: Field[]): Field[] =>
  fields.flatMap((f) => (f.type === 'row' || f.type === 'collapsible' ? topFields(f.fields) : f.type === 'tabs' ? f.tabs.flatMap((t) => ('name' in t && t.name ? [] : topFields(t.fields))) : [f]))

/** Per-PT doc types written only by domain call sites (no `withAudit` collection): `closePeriod` / `reopenPeriod`. */
const DOMAIN_ONLY: Array<[string, string, string]> = [['period_closing', 'period_closings', 'company_id']]

/** [docType, table, PT column] of every audited collection whose rows belong to ONE PT (+ DOMAIN_ONLY). */
function perPtAudited(): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [...DOMAIN_ONLY]
  for (const c of config.collections) {
    const docType = (c.custom?.pkAudit as { docType?: string } | undefined)?.docType
    if (!docType) continue
    const table = c.slug.replace(/-/g, '_')
    const names = new Set(topFields(c.fields).map((f) => ('name' in f ? f.name : '')))
    if (c.slug === 'companies') out.push([docType, table, 'id'])
    else if (names.has('company')) out.push([docType, table, 'company_id'])
    else if (names.has('ownerCompany')) out.push([docType, table, 'owner_company_id'])
  }
  return out.sort(([a], [b]) => a.localeCompare(b))
}

describe('UAT MC4-04: PT tag of audit rows for every per-PT doc type', () => {
  it('the writer map covers exactly the audited per-PT collections (incl. masters, the PT itself and owner-linked media)', () => {
    const expected = perPtAudited()
    expect(expected.length).toBeGreaterThanOrEqual(30)
    const actual = Object.entries(PER_PT_DOC_TYPES).map(([d, [t, c]]): [string, string, string] => [d, t, c]).sort(([a], [b]) => a.localeCompare(b))
    expect(actual).toEqual(expected)
  })

  it('every company_id table of the map is a per-PT table of MC1 / FR1 (or the membership table)', () => {
    for (const [d, [table, column]] of Object.entries(PER_PT_DOC_TYPES)) {
      if (column === 'company_id') expect([...PER_PT_TABLES, ...FR1_PER_PT_TABLES, 'company_memberships', ...PER_PT_TABLES_AFTER_MC1], d).toContain(table)
    }
  })

  it('app-wide doc types stay untagged', () => {
    for (const d of ['user', 'users', 'device', 'web_session', 'company_settings', 'report', 'import', 'audit_log', 'bank', 'uom', 'notification_template', 'media_signatures', 'media_company']) {
      expect(Object.hasOwn(PER_PT_DOC_TYPES, d), d).toBe(false)
    }
  })

  it('the migration uses the same docType → table mapping as the writer (frozen copy; later doc types came after it)', () => {
    // doc types of collections created after the backfill have no historic untagged rows
    const AFTER_BACKFILL = [...POST_MC4_DOC_TYPES, 'urgency_level'] // FR1 + 20261010_090000_p2s_urgency_level
    expect(BY_ID).toEqual(Object.fromEntries(Object.entries(PER_PT_DOC_TYPES).filter(([d]) => !AFTER_BACKFILL.includes(d))))
    for (const d of AFTER_BACKFILL) expect(Object.hasOwn(BY_ID, d), d).toBe(false)
  })

  it('the doc-number fallback only names per-PT number columns', () => {
    for (const [d, [table, column]] of Object.entries(BY_DOC_NO)) {
      expect(['doc_no', 'entry_no'], d).toContain(column)
      expect(Object.values(PER_PT_DOC_TYPES).some(([t]) => t === table), d).toBe(true)
    }
  })
})
