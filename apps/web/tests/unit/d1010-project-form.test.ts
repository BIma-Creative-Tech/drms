import type { SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { PROJECT_PM_REQUIRED, projectPmValidate, Projects } from '@/collections/Projects'

/** DRMS 10/10 #5: project form — PM mandatory, one primary action (no "Edit"/"API" tabs), link to the project page. */
describe('projectPmValidate', () => {
  it('refuses an empty PM on create and whenever the write sends `pm`', () => {
    expect(projectPmValidate(undefined, { operation: 'create' })).toBe(PROJECT_PM_REQUIRED)
    expect(projectPmValidate(null, { operation: 'create' })).toBe('Project Manager wajib diisi')
    expect(projectPmValidate('', { operation: 'update' })).toBe(PROJECT_PM_REQUIRED)
    expect(projectPmValidate(null, { operation: 'update' })).toBe(PROJECT_PM_REQUIRED)
    expect(projectPmValidate(7, { operation: 'create' })).toBe(true)
  })
  it('an update that does not send `pm` stays valid (e.g. progress recalculation on a legacy row)', () => {
    expect(projectPmValidate(undefined, { operation: 'update' })).toBe(true)
  })
  it('pm field: required + the validator; sidebar link field to the project page', () => {
    const pm = Projects.fields.find((f) => 'name' in f && f.name === 'pm') as { required?: boolean; validate?: unknown }
    expect(pm.required).toBe(true)
    expect(pm.validate).toBe(projectPmValidate)
    const link = Projects.fields.find((f) => 'name' in f && f.name === 'detailLink') as { type: string; admin?: { position?: string; components?: { Field?: string } } }
    expect(link).toMatchObject({ type: 'ui', admin: { position: 'sidebar', components: { Field: '@/admin/components/ProjectDetailLink#ProjectDetailLink' } } })
  })
})

describe('edit view: no separate "Edit"/"API" step', () => {
  let config: SanitizedConfig
  beforeAll(async () => {
    config = await (await import('@/payload.config')).default
  })
  it('every collection and global hides the API tab (hideAPIURL)', () => {
    expect(config.collections.filter((c) => c.admin?.hideAPIURL !== true).map((c) => c.slug).filter((s) => !s.startsWith('payload-'))).toEqual([])
    expect(config.globals.filter((g) => g.admin?.hideAPIURL !== true).map((g) => g.slug).filter((s) => !s.startsWith('payload-'))).toEqual([])
  })
})
