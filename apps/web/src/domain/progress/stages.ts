import type { PayloadRequest } from 'payload'

import { hasRole } from '@/access/roles'
import { resolveScope } from '@/access/scope'

import { ProgressError } from './reports'
import { CTX_STAGE_EDITOR, lockProject, projectStages, recalcProjectProgress, type StageRow } from './recalc'
import { isComplete, round2, stageSetErrors, weightSum, type StageInput } from './rules'

/**
 * Stage editor (US-29, G11): PUT /api/v1/projects/{id}/stages saves the WHOLE stage set of a project
 * in one transaction — total weight must be exactly 100 %. Direktur (pk-owner): any project, may add
 * and deactivate stages; PM: team projects, rename/reorder/re-weight existing stages only (requirements
 * §4 "Project & tahapan": PM R/U team, Direktur C/R/U). Stages missing from the set are deactivated
 * (no delete). Weight changes / deactivation need a reason (G7). The project progress is recalculated.
 */

export type StageSetBody = { stages?: StageInput[]; templateId?: number; reason?: string | null }

const fail = (status: number, code: string, message: string, field?: string): never => {
  throw new ProgressError(status, message, code, field)
}

export async function loadStageSet(req: PayloadRequest, projectId: number) {
  const stages = await projectStages(req, projectId)
  const project = (await req.payload.findByID({ collection: 'projects', id: projectId, depth: 0, overrideAccess: true /* SYSTEM-READ: after the visibility check */, req })) as {
    progressPct?: number | null
  }
  const sum = weightSum(stages)
  return { projectId, weightSum: sum, complete: isComplete(sum), progressPct: round2(Number(project.progressPct ?? 0)), stages }
}

/** The project must be readable by the caller (collection access) — else 404, no existence leak. */
export async function requireVisibleProject(req: PayloadRequest, projectId: number): Promise<{ id: number; status?: string | null }> {
  const p = (await req.payload
    .findByID({ collection: 'projects', id: projectId, depth: 0, user: req.user, overrideAccess: false /* caller's read scope */, req })
    .catch(() => null)) as { id: number; status?: string | null } | null
  if (!p) fail(404, 'NOT_FOUND', 'Project tidak ditemukan.')
  return p!
}

async function templateStages(req: PayloadRequest, templateId: number): Promise<StageInput[]> {
  const t = (await req.payload.findByID({ collection: 'stage-templates', id: templateId, depth: 0, overrideAccess: true /* SYSTEM-READ: master template */, req, disableErrors: true })) as {
    active?: boolean | null
    items?: Array<{ name: string; weightPct: number; sequence: number }> | null
  } | null
  if (!t || t.active === false) fail(400, 'VALIDATION', 'Template tahapan tidak ditemukan atau nonaktif.', 'templateId')
  return (t!.items ?? []).map((i) => ({ name: i.name, weightPct: Number(i.weightPct), sequence: Number(i.sequence) }))
}

export async function saveStageSet(req: PayloadRequest, projectId: number, body: StageSetBody) {
  const project = await requireVisibleProject(req, projectId)
  const owner = hasRole(req, 'pk-owner')
  if (!owner && !(hasRole(req, 'pk-pm') && (await resolveScope(req)).teamProjects.includes(projectId))) {
    fail(403, 'FORBIDDEN', 'Tahapan hanya dapat diubah oleh Direktur atau PM project ini.')
  }
  if (project.status === 'arsip') fail(409, 'STATE_CONFLICT', 'Project sudah diarsipkan.')
  await lockProject(req, projectId)
  const existing = await projectStages(req, projectId)

  let input: StageInput[]
  if (body.templateId !== undefined) {
    if (body.stages !== undefined) fail(400, 'VALIDATION', 'Isi stages ATAU templateId, tidak keduanya.', 'templateId')
    if (existing.length > 0) fail(409, 'STATE_CONFLICT', 'Template hanya dapat dipakai pada project tanpa tahapan.', 'templateId')
    input = await templateStages(req, body.templateId)
  } else {
    input = body.stages ?? []
  }
  const errors = stageSetErrors(input)
  if (errors.length > 0) throw new ProgressError(400, errors[0]!.message, 'VALIDATION', errors[0]!.path)

  const byId = new Map<number, StageRow>(existing.map((s) => [s.id, s]))
  for (const [i, s] of input.entries()) {
    if (s.id !== undefined && !byId.has(s.id)) fail(400, 'VALIDATION', `Tahapan #${s.id} bukan milik project ini.`, `stages.${i}.id`)
  }
  const keep = new Set(input.map((s) => s.id).filter((x): x is number => x !== undefined))
  const added = input.filter((s) => s.id === undefined)
  const removed = existing.filter((s) => s.active && !keep.has(s.id))
  const reactivated = input.filter((s) => s.id !== undefined && byId.get(s.id)!.active === false)
  if (!owner && (added.length > 0 || removed.length > 0 || reactivated.length > 0)) {
    fail(403, 'FORBIDDEN', 'Menambah atau menonaktifkan tahapan hanya oleh Direktur. PM dapat mengubah nama, urutan dan bobot.')
  }
  const reweighted = input.filter((s) => s.id !== undefined && round2(byId.get(s.id)!.weightPct) !== round2(s.weightPct))
  const reason = (body.reason ?? '').trim()
  if ((reweighted.length > 0 || removed.length > 0 || reactivated.length > 0) && reason.length < 3) {
    fail(400, 'VALIDATION', 'Alasan wajib diisi saat mengubah bobot atau menonaktifkan tahapan (G7).', 'reason')
  }

  req.context[CTX_STAGE_EDITOR] = true
  if (reason) req.context.auditReason = reason
  try {
    for (const s of input) {
      const data = { name: s.name.trim(), weightPct: round2(s.weightPct), sequence: s.sequence, active: true }
      if (s.id === undefined) {
        await req.payload.create({
          collection: 'project-stages',
          data: { ...data, project: projectId } as never,
          depth: 0,
          overrideAccess: true, // SYSTEM-WRITE: stage editor after the role/scope checks above
          req,
        })
        continue
      }
      const cur = byId.get(s.id)!
      if (cur.name === data.name && round2(cur.weightPct) === data.weightPct && cur.sequence === data.sequence && cur.active) continue
      await req.payload.update({
        collection: 'project-stages',
        id: s.id,
        data: data as never,
        depth: 0,
        overrideAccess: true, // SYSTEM-WRITE: stage editor after the role/scope checks above
        req,
      })
    }
    for (const s of removed) {
      await req.payload.update({
        collection: 'project-stages',
        id: s.id,
        data: { active: false } as never,
        depth: 0,
        overrideAccess: true, // SYSTEM-WRITE: stage deactivated by the editor (no delete)
        req,
      })
    }
  } finally {
    delete req.context[CTX_STAGE_EDITOR]
    delete req.context.auditReason
  }
  const after = await projectStages(req, projectId)
  if (!isComplete(weightSum(after))) fail(409, 'WEIGHTS_INCOMPLETE', `Total bobot tahapan aktif ${weightSum(after)}% (harus 100%).`)
  await recalcProjectProgress(req, projectId)
  return loadStageSet(req, projectId)
}
