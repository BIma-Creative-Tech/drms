import type { Field, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Static guards over the sanitized Payload config (no DB): decisions of the F1 spike / user
 * (2026-09-23) that must not regress silently.
 */
let config: SanitizedConfig

beforeAll(async () => {
  process.env.PK_SKIP_ENV_CHECK = 'true'
  config = await (await import('@/payload.config')).default
})

function walk(fields: Field[], visit: (f: Field, path: string) => void, prefix = ''): void {
  for (const f of fields) {
    const name = 'name' in f && f.name ? `${prefix}${f.name}` : prefix
    visit(f, name)
    if ('fields' in f && Array.isArray(f.fields)) walk(f.fields as Field[], visit, name ? `${name}.` : prefix)
    if (f.type === 'tabs') for (const t of f.tabs) walk(t.fields, visit, prefix)
    if (f.type === 'blocks') for (const b of f.blocks) walk(b.fields, visit, `${name}.`)
  }
}

describe('Payload config guards', () => {
  it('GraphQL off, maxDepth 3, avatar default (no gravatar), Indonesian UI only', () => {
    expect(config.graphQL.disable).toBe(true)
    expect(config.maxDepth).toBe(3)
    expect(config.admin.avatar).toBe('default')
    expect(Object.keys(config.i18n.supportedLanguages)).toEqual(['id'])
    expect(config.i18n.fallbackLanguage).toBe('id')
  })

  it('no json/code field renders the Monaco editor (CSP: no strict-dynamic → Monaco from jsdelivr is blocked)', () => {
    const offenders: string[] = []
    // Payload-internal hidden entities (payload-jobs, payload-jobs-stats, …) never render in the admin.
    const visible = (h: unknown) => !h || typeof h === 'function'
    const all = [...config.collections.filter((c) => visible(c.admin?.hidden)), ...config.globals.filter((g) => visible(g.admin?.hidden))]
    for (const c of all) {
      walk(c.fields, (f, p) => {
        if ((f.type === 'json' || f.type === 'code') && !(f.admin?.components as { Field?: unknown } | undefined)?.Field) {
          offenders.push(`${c.slug}.${p}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('every upload collection has pasteURL off and the remote-URL guard (beforeOperation)', () => {
    const uploads = config.collections.filter((c) => c.upload)
    expect(uploads.map((c) => c.slug).sort()).toEqual([
      'media-attachments',
      'media-company',
      'media-progress-photos',
      'media-receipts',
      'media-selfies',
      'media-signatures',
      'media-transfer-proofs',
    ])
    for (const c of uploads) {
      const up = c.upload as { pasteURL?: unknown; crop?: unknown; focalPoint?: unknown; staticDir?: string }
      expect(up.pasteURL, c.slug).toBe(false)
      expect(up.crop, c.slug).toBe(false)
      expect(up.focalPoint, c.slug).toBe(false)
      expect(c.hooks.beforeOperation.length, c.slug).toBeGreaterThan(0)
      expect(c.access.update({ req: { user: { roles: ['pk-admin'] } } } as never), c.slug).toBe(false)
    }
  })

  it('no collection allows delete for any role; every master is audited', async () => {
    const admin = { req: { user: { id: 1, roles: ['pk-admin', 'pk-owner', 'pk-finance', 'pk-pm', 'pk-staff'] }, context: {} } }
    for (const c of config.collections) {
      if (c.slug.startsWith('payload-')) continue
      expect(await c.access.delete(admin as never), c.slug).toBe(false)
    }
    const masters = [
      'employees', 'employee-bank-accounts', 'banks', 'clients', 'vendors', 'vendor-bank-accounts', 'projects', 'project-stages', 'stage-templates',
      'budget-lines', 'expense-categories', 'cash-in-sources', 'cash-accounts', 'team-assignments', 'work-schedules',
      'holidays', 'approval-rules', 'notification-templates', 'uoms', 'vehicles', 'cost-centers', 'document-sequences', 'users', 'devices',
    ]
    for (const slug of masters) {
      const c = config.collections.find((x) => x.slug === slug)
      expect(c, slug).toBeDefined()
      expect((c?.custom as { pkAudit?: unknown }).pkAudit, slug).toBeDefined()
    }
    expect((config.globals.find((g) => g.slug === 'company-settings')?.custom as { pkAudit?: unknown }).pkAudit).toBeDefined()
  })

  it('Class A audit-logs stays flat (no array/hasMany/blocks/localized), no versions', () => {
    const audit = config.collections.find((c) => c.slug === 'audit-logs')!
    expect(audit.versions).toBeFalsy()
    walk(audit.fields, (f, p) => {
      expect(['array', 'blocks', 'group'].includes(f.type), p).toBe(false)
      if ('hasMany' in f) expect(f.hasMany, p).toBeFalsy()
      if ('localized' in f) expect(f.localized, p).toBeFalsy()
    })
  })

  it('upload limits ≤ 8 MiB per file, ≤ 10 MiB per request (ADR 0004 §2)', () => {
    expect(config.upload.limits?.fileSize).toBe(8 * 1024 * 1024)
    expect(config.upload.requestSizeLimit).toBe(10 * 1024 * 1024)
  })

  it('/api/v1 endpoints are registered as root endpoints', () => {
    const paths = config.endpoints.map((e) => `${e.method} ${e.path}`)
    for (const p of ['get /v1/health', 'head /v1/health', 'get /v1/health/ready', 'head /v1/health/ready', 'get /v1/me', 'get /v1/masters', 'post /v1/devices/register', 'post /v1/devices/:id/revoke', 'post /v1/admin/test-email', 'get /v1/openapi.json']) {
      expect(paths).toContain(p)
    }
  })

  it('jobs: REST run/queue/cancel closed (worker uses the Local API); no email adapter without SMTP_*', async () => {
    const access = config.jobs.access ?? {}
    for (const fn of [access.run, access.queue, access.cancel]) {
      expect(typeof fn).toBe('function')
      expect(await (fn as (a: unknown) => unknown)({ req: { user: { id: 1, roles: ['pk-admin'] } } })).toBe(false)
    }
    expect(config.jobs.tasks?.map((t) => t.slug)).toContain('sendEmail')
    expect(config.email).toBeUndefined()
  })
})
