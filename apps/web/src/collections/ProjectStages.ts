import type { CollectionConfig } from 'payload'

import { denyAll } from '@/access/roles'
import { assignedProjects, byRole, rolesAllowed, teamProjects } from '@/access/policies'
import { reasonOnChange, withAudit } from '@/audit/hooks'
import { progressWriteGuard, stageRecalcHook, stageWeightGuard } from '@/domain/progress/guards'
import { activeField, percentField, uuidField } from '@/fields/common'
import { companyField, companyHook, pickerSameCompany } from '@/fields/company'

/**
 * Tahapan project. `progressPct` only changes via progress reports (E4, requirements §1 #7): field
 * access false for everyone, an explicit different value → 403 (progressWriteGuard), DB trigger
 * pk_progress_guard. Weight changes need a reason (G7). G11 (sum = 100 %): the stage editor
 * (PUT /api/v1/projects/{id}/stages) saves the whole set; single writes here may build a set up to
 * 100 % but never break a complete one (stageWeightGuard). A weight/active change recalculates the
 * project progress in the same transaction. No delete: a stage is deactivated (`active`).
 */
export const ProjectStages: CollectionConfig = withAudit(
  {
    slug: 'project-stages',
    labels: { singular: 'Tahapan project', plural: 'Tahapan project' },
    admin: { useAsTitle: 'name', group: 'Proyek', defaultColumns: ['project', 'sequence', 'name', 'weightPct', 'progressPct'] },
    access: {
      read: byRole({
        'pk-admin': true,
        'pk-owner': true,
        'pk-finance': true,
        'pk-pm': teamProjects(),
        'pk-staff': assignedProjects(),
      }),
      // Owner decision 2026-10-09: Admin gains the same stage-creation right as Direktur/PM (reverses QA-20).
      create: rolesAllowed('pk-owner', 'pk-admin', 'pk-pm'),
      update: byRole({ 'pk-owner': true, 'pk-admin': true, 'pk-pm': teamProjects() }),
      delete: denyAll,
    },
    hooks: { beforeOperation: [progressWriteGuard('project-stages')], beforeChange: [companyHook('project-stages', { derive: [{ field: 'project', collection: 'projects' }] }), stageWeightGuard], afterChange: [stageRecalcHook] },
    fields: [
      companyField({ derived: true }),
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project', required: true, index: true, access: { update: () => false }, ...pickerSameCompany({ required: true, decidesCompany: true }) },
      { name: 'name', type: 'text', label: 'Nama tahapan', required: true, maxLength: 128 },
      percentField('weightPct', 'Bobot (%)'),
      { name: 'sequence', type: 'number', label: 'Urutan', min: 1, required: true },
      { ...percentField('progressPct', 'Progress (%)'), defaultValue: 0, access: { create: () => false, update: () => false }, admin: { readOnly: true } },
      { ...activeField(), admin: { position: 'sidebar', description: 'Nonaktif = tidak dihitung dalam bobot & progress project.' } },
      // P3: `rap` = the stage % comes from the RAP work items (daily reports); manual progress reports are refused
      {
        name: 'progressMode',
        type: 'select',
        label: 'Sumber progress',
        defaultValue: 'manual',
        options: [
          { label: 'Laporan progress (manual)', value: 'manual' },
          { label: 'RAP + laporan harian', value: 'rap' },
        ],
        access: { create: () => false, update: () => false },
        admin: { readOnly: true, position: 'sidebar' },
      },
      uuidField(),
    ],
  },
  {
    docType: 'project_stage',
    reasonRules: [reasonOnChange(['weightPct'], 'Alasan wajib diisi saat mengubah bobot tahapan.'), reasonOnChange(['active'], 'Alasan wajib diisi saat menonaktifkan tahapan.')],
  },
)
