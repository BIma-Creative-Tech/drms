/**
 * ADR 0024 (owner decision 2026-10-11): explanation + preview of one `approval-rules` row for the Admin
 * form ("Contoh: pengajuan oleh Owner → langsung ke Finance" — ADR 0025: the zero-step rule is the Owner's). Pure module (unit-tested) — the rule
 * hook (`ruleDecisionError` / `zeroStepRuleError`) and the DB trigger stay authoritative.
 */
import { ROLE_LABELS, isRole, type Role } from '@/access/roles'

import { DIREKTUR_ROLE, NO_APPROVAL_RULE_LABEL, OWNER_ROLE, SCOPE_MANAGER_LABEL, zeroStepRuleError } from './decision'
import type { AckBy, AckMode } from './rules'

export type RulePreviewInput = {
  docType: string
  requesterRoles: readonly string[]
  acknowledge: AckMode
  acknowledgeBy: AckBy | null
  acknowledgeRole: string | null
  hasAcknowledgeUser: boolean
  steps: ReadonlyArray<{ level: number | null; approverRole: string | null; hasUser: boolean }>
}

export type RulePreview = {
  /** "Contoh: pengajuan oleh Direktur → langsung ke Finance". */
  example: string
  /** Ordered steps after "Diajukan" (decision positions, then Finance). */
  flow: string[]
  noApproval: boolean
  /** Why the rule would be refused on save (null = fine) — same text as the server. */
  error: string | null
}

const roleLabel = (r: string | null | undefined) => (r && isRole(r) ? ROLE_LABELS[r] : 'peran belum dipilih')

/** Who files: "Direktur", "Staff lapangan atau Project Manager", or "siapa saja" (no condition). */
export function requesterText(roles: readonly string[]): string {
  const valid = [...new Set(roles)].filter(isRole)
  if (valid.length === 0) return 'siapa saja'
  return valid.map((r) => ROLE_LABELS[r]).join(' atau ')
}

export function rulePreview(input: RulePreviewInput): RulePreview {
  const roles = [...new Set(input.requesterRoles)].filter(isRole) as Role[]
  const who = requesterText(roles)
  const steps = [...input.steps].sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
  const addendum = input.docType === 'budget_addendum'
  const error = zeroStepRuleError({ steps: steps.map((s) => ({ level: s.level ?? 0 })), requesterRoles: roles, acknowledge: input.acknowledge }, input.docType)
  const finance = addendum ? null : 'Finance: transfer (antrian transfer; Reimburse: verifikasi nota dulu)'
  if (steps.length === 0) {
    const example = addendum ? 'Addendum RAB butuh minimal 1 level approval.' : `Contoh: pengajuan oleh ${who} → langsung ke Finance (${NO_APPROVAL_RULE_LABEL}).`
    return { example, flow: finance ? ['Tanpa persetujuan', finance] : [], noApproval: !addendum, error }
  }
  const flow: string[] = []
  if (input.acknowledge !== 'none') {
    const by =
      input.acknowledgeBy === 'scope_manager'
        ? SCOPE_MANAGER_LABEL
        : input.acknowledgeBy === 'user'
          ? input.hasAcknowledgeUser
            ? 'user tertentu'
            : 'user belum dipilih'
          : roleLabel(input.acknowledgeRole)
    flow.push(`${input.acknowledge === 'optional' ? 'Diketahui (opsional)' : 'Persetujuan'}: ${by}`)
  }
  for (const s of steps) flow.push(`Level ${s.level ?? '?'}: ${s.hasUser ? 'user tertentu' : roleLabel(s.approverRole)}`)
  if (finance) flow.push(finance)
  const selfRole = roles.length === 1 && (roles[0] === DIREKTUR_ROLE || roles[0] === OWNER_ROLE) ? roles[0] : null
  const example = `Contoh: pengajuan oleh ${who} → ${flow.join(' → ')}.${selfRole ? ` (${ROLE_LABELS[selfRole]} tidak pernah memutuskan pengajuannya sendiri — G1.)` : ''}`
  return { example, flow, noApproval: false, error }
}

/** Reads the Payload form state of the rule form (`steps.<i>.level|approverRole|approverUser`). */
export function previewInputFromForm(fields: Record<string, { value?: unknown } | undefined>): RulePreviewInput {
  const v = (k: string) => fields[k]?.value
  const rows = new Map<number, { level: number | null; approverRole: string | null; hasUser: boolean }>()
  for (const [k, f] of Object.entries(fields)) {
    const m = /^steps\.(\d+)\.(level|approverRole|approverUser)$/.exec(k)
    if (!m) continue
    const i = Number(m[1])
    const row = rows.get(i) ?? { level: null, approverRole: null, hasUser: false }
    if (m[2] === 'level') row.level = typeof f?.value === 'number' ? f.value : null
    else if (m[2] === 'approverRole') row.approverRole = typeof f?.value === 'string' ? f.value : null
    else row.hasUser = f?.value !== null && f?.value !== undefined && f?.value !== ''
    rows.set(i, row)
  }
  const rr = v('requesterRoles')
  return {
    docType: typeof v('docType') === 'string' ? (v('docType') as string) : 'expense_request',
    requesterRoles: Array.isArray(rr) ? rr.filter((x): x is string => typeof x === 'string') : [],
    acknowledge: (['required', 'optional', 'none'].includes(v('acknowledge') as string) ? v('acknowledge') : 'required') as AckMode,
    acknowledgeBy: (['scope_manager', 'role', 'user'].includes(v('acknowledgeBy') as string) ? v('acknowledgeBy') : null) as AckBy | null,
    acknowledgeRole: typeof v('acknowledgeRole') === 'string' ? (v('acknowledgeRole') as string) : null,
    hasAcknowledgeUser: v('acknowledgeUser') !== null && v('acknowledgeUser') !== undefined && v('acknowledgeUser') !== '',
    steps: [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r),
  }
}
