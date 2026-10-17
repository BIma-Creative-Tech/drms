import type { PayloadRequest } from 'payload'

import { loadRap, rapRoles } from '@/domain/rap/service'

import { rapEditMode, type RapEditMode, type RapItemView } from './rap-item-form'

/**
 * Server data of the RAP item form (RapItemsEditor) of one project — shared by the RAP page /admin/rap/:id (Rap.tsx
 * RapProject) and the project's RAP tab (ProjectTabs ProjectRapTab, UI feedback 17/10 #3), so both show the same form
 * with the same pickers and edit mode. Server only (no view imports: the tab and its tests load it without the page
 * template). Call inside the page's request transaction.
 */
type Rap = Awaited<ReturnType<typeof loadRap>>
type Item = Rap['items'][number]
type Opt = { id: number; label: string }

export const rapItemView = (i: Item): RapItemView => ({
  id: i.id,
  code: i.code,
  description: i.description,
  kind: i.kind,
  stageId: i.stage?.id ?? null,
  stageName: i.stage?.name ?? null,
  uomId: i.uom.id,
  uomCode: i.uom.code,
  volume: i.volume,
  // money keys exist only for the price roles (loadRap DTO) — never copied otherwise
  ...('unitPrice' in i ? { unitPrice: i.unitPrice ?? null, value: i.value ?? null } : {}),
  ...(i.realisedAmount !== undefined ? { realisedAmount: i.realisedAmount } : {}),
  weightPct: i.weightPct,
  active: i.active,
  realised: i.realised,
  received: i.received,
  used: i.used,
})

/** Default rows of the form: active items + deactivated items that carry realisation (as the RAP page's default filter). */
export const rapEditorItems = (rap: Rap): RapItemView[] => rap.items.map(rapItemView).filter((i) => i.active || (i.realisedAmount ?? 0) > 0 || i.realised > 0)

/**
 * Edit mode (rapEditMode: roles, lock, archived project) and the pickers: active stages (+ an inactive stage still
 * named by an item), active units (+ a unit still named by an item).
 */
export async function loadRapEditor(req: PayloadRequest, p: { id: number; company: number; status?: string | null }, rap: Rap): Promise<{ mode: RapEditMode; stages: Opt[]; uoms: Opt[] }> {
  const roles = await rapRoles(req, { id: p.id, company: p.company })
  const units = (await req.payload.find({ collection: 'uoms', where: { active: { not_equals: false } }, sort: 'code', depth: 0, pagination: false, user: req.user, overrideAccess: false /* shared master, caller's read access */, req }).catch(() => ({ docs: [] }))).docs as Array<{ id: number; code?: string; name?: string }>
  const stages = rap.stages.filter((s) => s.active || rap.items.some((i) => i.stage?.id === s.id)).map((s) => ({ id: s.id, label: s.active ? s.name : `${s.name} (nonaktif)` }))
  const uoms = units.map((u) => ({ id: u.id, label: `${u.code ?? ''}${u.name && u.name !== u.code ? ` — ${u.name}` : ''}` }))
  for (const i of rap.items) if (!uoms.some((u) => u.id === i.uom.id)) uoms.push({ id: i.uom.id, label: i.uom.code })
  return { mode: rapEditMode(roles, rap.locked, p.status === 'arsip' || p.status === 'dibatalkan'), stages, uoms }
}
