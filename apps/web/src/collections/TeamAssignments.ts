import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'
import { creatableRelationship } from '@/admin/relationship-create'

import { denyAll, hasRole, relId } from '@/access/roles'
import { anyOf, byRole, rolesAllowed, teamCostCenters, teamProjects } from '@/access/policies'
import { resolveScope } from '@/access/scope'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { companyField, companyHook, legacySiteField, lockedUntilCompany, pickerSameCompany } from '@/fields/company'

/**
 * Penugasan tim: employee ↔ project XOR cost center (form item 9), role, period. ADR 0032: the site option
 * (ADR 0023) is gone — no new site assignment and no change to a site; the migration 20261024_200000 turned the site
 * rows into project rows (projects of that site) or ended them, the rest stays as history.
 * Admin C/R/U; Owner R/U; PM C/R/U only for team projects/cost centers and never with role
 * `pm` (would let a PM grant themselves new team scope — privilege escalation guard).
 */
const guard: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const merged = { ...(originalDoc ?? {}), ...data } as Record<string, unknown>
  const project = relId(merged.project)
  const costCenter = relId(merged.costCenter)
  const site = relId(merged.site)
  // ADR 0032: no new / changed site assignment by a user (a legacy site row may still get its end date). The go-live
  // import CLI (system request, no user) still writes its workbook's legacy Site columns — follow-up in ADR 0032.
  if (req.user && site !== undefined && (operation === 'create' || relId(originalDoc?.site) !== site)) {
    throw new APIError('Penugasan ke site tidak tersedia lagi. Pilih project atau pusat biaya.', 400, null, true)
  }
  // exactly one location (DB CHECK team_assignments_location_one also counts the legacy site column)
  if ([project, costCenter, site].filter((x) => x !== undefined).length !== 1) {
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
    hooks: { beforeChange: [companyHook('team-assignments', { derive: [{ field: 'employee', collection: 'employees' }], check: [{ field: 'project', collection: 'projects' }, { field: 'costCenter', collection: 'cost-centers' }, { field: 'site', collection: 'sites' }], companyIsFilter: true }), guard] },
    fields: [
      // DRMS UI 17/10 #4 (owner 2026-10-17): PT picker that only filters the pickers below (the PT follows the employee)
      companyField({ derived: true, filter: true }),
      // DRMS 16/10 (b): "+ Karyawan baru" (plain employee form in a drawer, no user account); DRMS UI 17/10 #4: employees,
      // projects and pusat biaya of the chosen PT only — locked ("Pilih PT terlebih dahulu") until it has a value
      creatableRelationship({ name: 'employee', type: 'relationship', relationTo: 'employees', label: 'Karyawan', required: true, index: true, ...pickerSameCompany({ required: true }), admin: { placeholder: 'Pilih karyawan…' } }, { company: 'form', lock: true }),
      lockedUntilCompany({ name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', index: true, ...pickerSameCompany(), admin: { placeholder: 'Pilih project…' } }),
      lockedUntilCompany({ name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya', index: true, ...pickerSameCompany(), admin: { placeholder: 'Pilih pusat biaya…' } }),
      // ADR 0032: the site option (ADR 0023) removed — hidden legacy column (history rows only)
      legacySiteField('site', 'Site (lama)'),
      {
        name: 'roleInProject',
        type: 'select',
        label: 'Peran',
        required: true,
        defaultValue: 'staff',
        admin: { placeholder: 'Pilih peran…' },
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
