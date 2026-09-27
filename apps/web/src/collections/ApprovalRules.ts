import { APIError, type CollectionConfig, type Option } from 'payload'

import { ROLES, ROLE_LABELS, denyAll, relId, rolesOf, type Role } from '@/access/roles'
import { byRole, rolesAllowed } from '@/access/policies'
import { reasonOnAnyUpdate, withAudit } from '@/audit/hooks'
import { isDecisionRole, ruleDecisionError } from '@/domain/expense/decision'
import { stepsError, type AckBy, type AckMode } from '@/domain/expense/rules'
import { activeField, rupiahField } from '@/fields/common'

const roleOptions = ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))
/** ADR 0013: only Direktur/Finance are offered for decision positions (the DB enum keeps every role). */
const decisionRoleOptions = ({ options }: { options: Option[] }): Option[] => options.filter((o) => isDecisionRole(typeof o === 'string' ? o : o.value))

/**
 * Aturan approval (US-34): amount range, request type, signature positions ("Diajukan Oleh" /
 * "Dibuat Oleh" signatures, "Diketahui Oleh" required/optional/none + who; approval levels 1..n),
 * optional category/project/cost center. Engine: src/domain/expense/rules.ts (rule resolved and
 * SNAPSHOTTED on the request at submit — later rule changes never affect submitted requests).
 * Every change requires a reason (requirements §8). Admin C/R/U, Owner R/U, Finance R.
 * ADR 0013 (E1): decision positions only for Direktur (`pk-owner`) / Finance — see `ruleDecisionError`.
 */
export const ApprovalRules: CollectionConfig = withAudit(
  {
    slug: 'approval-rules',
    labels: { singular: 'Aturan approval', plural: 'Aturan approval' },
    admin: { useAsTitle: 'name', group: 'Keuangan', defaultColumns: ['name', 'docType', 'requestType', 'minAmount', 'maxAmount', 'active'] },
    access: {
      read: byRole({ 'pk-admin': true, 'pk-owner': true, 'pk-finance': true }),
      create: rolesAllowed('pk-admin'),
      update: byRole({ 'pk-admin': true, 'pk-owner': true }),
      delete: denyAll,
    },
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, req }) => {
          const min = (data.minAmount ?? originalDoc?.minAmount ?? 0) as number
          const max = (data.maxAmount ?? originalDoc?.maxAmount ?? null) as number | null
          if (max !== null && max < min) throw new APIError('Nominal maksimum harus ≥ minimum.', 400, null, true)
          const steps = ((data.steps ?? originalDoc?.steps ?? []) as Array<{ level: number; approverRole?: Role | null; approverUser?: unknown }>).map((s) => ({
            level: s.level,
            approverRole: s.approverRole ?? null,
            approverUser: relId(s.approverUser) ?? null,
          }))
          const docType = (data.docType ?? originalDoc?.docType ?? 'expense_request') as string
          if (docType === 'budget_addendum') {
            // E5: addenda have no request type / expense category — such a rule would never match.
            if ((data.requestType ?? originalDoc?.requestType ?? 'any') !== 'any') throw new APIError('Aturan Addendum RAB: jenis pengajuan harus "Semua".', 400, null, true)
            if (relId(data.category !== undefined ? data.category : originalDoc?.category)) throw new APIError('Aturan Addendum RAB tidak memakai kategori biaya.', 400, null, true)
          }
          const err = stepsError(steps)
          if (err) throw new APIError(err, 400, null, true)
          // ADR 0013 (E1): "Diketahui" = Direktur approval, then Finance; PM/Staff never decide,
          // "PM project / penanggung jawab" (scope_manager) is retired, Direktur is never optional.
          const rule = {
            acknowledge: (data.acknowledge ?? originalDoc?.acknowledge ?? 'required') as AckMode,
            acknowledgeBy: (data.acknowledgeBy ?? originalDoc?.acknowledgeBy ?? 'role') as AckBy,
            acknowledgeRole: (data.acknowledgeRole !== undefined ? data.acknowledgeRole : originalDoc?.acknowledgeRole) as Role | null | undefined,
            acknowledgeUser: relId(data.acknowledgeUser !== undefined ? data.acknowledgeUser : originalDoc?.acknowledgeUser) ?? null,
            steps,
          }
          const named = [rule.acknowledgeUser, ...steps.map((s) => s.approverUser)].filter((x): x is number => typeof x === 'number')
          const roles = new Map<number, Role[]>()
          if (named.length > 0) {
            const users = await req.payload.find({
              collection: 'users',
              where: { id: { in: named } },
              depth: 0,
              pagination: false,
              select: { roles: true },
              overrideAccess: true, // SYSTEM-READ: roles of users named in a rule (ADR 0013 validation)
              req,
            })
            for (const u of users.docs) roles.set(u.id as number, rolesOf(u))
          }
          const decisionErr = ruleDecisionError(rule, (id) => roles.get(id))
          if (decisionErr) throw new APIError(decisionErr, 400, null, true)
          return data
        },
      ],
    },
    fields: [
      { name: 'name', type: 'text', label: 'Nama aturan', required: true, maxLength: 128 },
      {
        name: 'docType',
        type: 'select',
        label: 'Dokumen',
        required: true,
        defaultValue: 'expense_request',
        options: [
          { label: 'Pengajuan biaya', value: 'expense_request' },
          { label: 'Addendum RAB', value: 'budget_addendum' },
        ],
      },
      {
        name: 'requestType',
        type: 'select',
        label: 'Jenis pengajuan',
        required: true,
        defaultValue: 'any',
        options: [
          { label: 'Semua', value: 'any' },
          { label: 'Uang Muka', value: 'advance' },
          { label: 'Reimburse', value: 'reimburse' },
        ],
      },
      rupiahField('minAmount', 'Nominal minimum (Rp)', { required: true }),
      rupiahField('maxAmount', 'Nominal maksimum (Rp, kosong = tanpa batas)'),
      { name: 'category', type: 'relationship', relationTo: 'expense-categories', label: 'Kategori (opsional)' },
      { name: 'project', type: 'relationship', relationTo: 'projects', label: 'Project (opsional)' },
      { name: 'costCenter', type: 'relationship', relationTo: 'cost-centers', label: 'Pusat biaya (opsional)' },
      { name: 'priority', type: 'number', label: 'Prioritas', defaultValue: 100, min: 0, admin: { description: 'Angka kecil dievaluasi lebih dulu.' } },
      {
        name: 'acknowledge',
        type: 'select',
        label: 'Diketahui Oleh (persetujuan Direktur)',
        required: true,
        defaultValue: 'required',
        options: [
          { label: 'Wajib', value: 'required' },
          { label: 'Opsional', value: 'optional' },
          { label: 'Tidak dipakai', value: 'none' },
        ],
      },
      {
        name: 'acknowledgeBy',
        type: 'select',
        label: 'Pengisi "Diketahui Oleh"',
        required: true,
        defaultValue: 'role',
        // `scope_manager` stays in the enum so snapshots/rules saved before ADR 0013 remain readable;
        // it can no longer be chosen (hook: 400).
        options: [
          { label: 'PM project / penanggung jawab pusat biaya (tidak dipakai lagi — ADR 0013)', value: 'scope_manager' },
          { label: 'Peran tertentu', value: 'role' },
          { label: 'User tertentu', value: 'user' },
        ],
        filterOptions: ({ options }) => options.filter((o) => (typeof o === 'string' ? o : o.value) !== 'scope_manager'),
      },
      { name: 'acknowledgeRole', type: 'select', label: 'Peran "Diketahui Oleh"', defaultValue: 'pk-owner', options: roleOptions, filterOptions: decisionRoleOptions },
      { name: 'acknowledgeUser', type: 'relationship', relationTo: 'users', label: 'User "Diketahui Oleh"' },
      {
        name: 'signDiajukan',
        type: 'select',
        label: 'Tanda tangan "Diajukan Oleh"',
        required: true,
        defaultValue: 'required',
        options: [
          { label: 'Wajib', value: 'required' },
          { label: 'Opsional', value: 'optional' },
          { label: 'Tidak dipakai', value: 'none' },
        ],
      },
      {
        name: 'signDibuat',
        type: 'select',
        label: 'Tanda tangan "Dibuat Oleh"',
        required: true,
        defaultValue: 'required',
        options: [
          { label: 'Wajib', value: 'required' },
          { label: 'Opsional', value: 'optional' },
          { label: 'Tidak dipakai', value: 'none' },
        ],
      },
      {
        name: 'steps',
        type: 'array',
        label: 'Level approval',
        minRows: 1,
        fields: [
          { name: 'level', type: 'number', label: 'Level', required: true, min: 1 },
          { name: 'approverRole', type: 'select', label: 'Peran approver', options: roleOptions, filterOptions: decisionRoleOptions },
          { name: 'approverUser', type: 'relationship', relationTo: 'users', label: 'Approver (user tertentu)' },
        ],
      },
      activeField(),
    ],
  },
  { docType: 'approval_rule', reasonRules: [reasonOnAnyUpdate] },
)
