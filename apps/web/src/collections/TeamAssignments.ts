import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'

import { denyAll, hasRole, relId } from '@/access/roles'
import { anyOf, byRole, rolesAllowed, teamCostCenters, teamProjects } from '@/access/policies'
import { resolveScope } from '@/access/scope'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { companyField, companyHook } from '@/fields/company'

/**
 * Penugasan tim: employee ↔ project XOR cost center (form item 9), role in project, period.
 * Admin C/R/U; Owner R/U; PM C/R/U only for team projects/cost centers and never with role
 * `pm` (would let a PM grant themselves new team scope — privilege escalation guard).
 */
const guard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const merged = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>
  const project = relId(merged.project)
  const costCenter = relId(merged.costCenter)
  if ((project === undefined) === (costCenter === undefined)) {
    throw new APIError('Isi salah satu: project ATAU pusat biaya.', 400, null, true)
  }
  const start = merged.startDate ? new Date(String(merged.startDate)).getTime() : undefined
  const end = merged.endDate ? new Date(String(merged.endDate)).getTime() : undefined
  if (start !== undefined && end !== undefined && end < start) {
    throw new APIError('Tanggal selesai tidak boleh sebelum tanggal mulai.', 400, null, true)
  }
  // ADR 0016 §5: roles + team scope IN THE ASSIGNMENT's PT (company set by companyHook, runs first)
  const company = relId(merged.company)
  if (req.user && !hasRole(req, ['pk-admin', 'pk-owner'], company) && hasRole(req, 'pk-pm', company)) {
    const scope = await resolveScope(req, company ?? null)
    const inTeam =
      (project !== undefined && scope.teamProjects.includes(project)) ||
      (costCenter !== undefined && scope.teamCostCenters.includes(costCenter))
    if (!inTeam) throw new APIError('Hanya untuk project/pusat biaya tim Anda.', 403, null, true)
    if (merged.roleInProject === 'pm') throw new APIError('PM tidak dapat menetapkan peran PM.', 403, null, true)
    if (operation === 'update' && originalDoc && relId(originalDoc.project) !== project) {
      throw new APIError('Project penugasan tidak dapat dipindah.', 403, null, true)
    }
  }
  return data
}

export const TeamAssignments: CollectionConfig = withAudit(
  {
    slug: 'team-assignments',
    labels: { singular: 'Penugasan tim', plural: 'Penugasan tim' },
    admin: { group: 'Proyek', defaultColumns: ['employee', 'project', 'costCenter', 'roleInProject', 'startDate', 'endDate'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-pm': anyOf(teamProjects(), teamCostCenters()) }),
      create: rolesAllowed('pk-admin', 'pk-pm'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-pm': anyOf(teamProjects(), teamCostCenters()) }),
      delete: denyAll,
    },
    hooks: { beforeChange: [companyHook('team-assignments', { derive: [{ field: 'employee', collection: 'employees' }], check: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }] }), guard] },
    fields: [
      companyField({ derived: true }),
      { name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true },
      {
        name: 'roleInProject',
        type: 'select',
        label: 'Peran',
        required: true,
        defaultValue: 'staff',
        options: [
          { label: 'PM', value: 'pm' },
          { label: 'Staff', value: 'staff' },
          { label: 'Mandor', value: 'mandor' },
        ],
      },
      { name: 'startDate', type: 'date', label: 'Mulai', admin: { date: { pickerAppearance: 'dayOnly' } } },
      { name: 'endDate', type: 'date', label: 'Selesai', admin: { date: { pickerAppearance: 'dayOnly' } } },
    ],
  },
  { docType: 'team_assignment', reasonRules: [reasonOnChange(['endDate', 'roleInProject'], 'Alasan wajib diisi saat mengubah peran atau mengakhiri penugasan.')] },
)
