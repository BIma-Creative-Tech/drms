import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { PageHeader, Panel } from '@/admin/components/ui/nexus'
import { isModuleId, landingSections } from '@/admin/modules/registry'
import { loadModules } from '@/admin/shell/modules-server'

import { PageTemplate } from './frame'
import { LauncherGrid } from './LauncherGrid'
import { NoAccess } from './NoAccess'

/**
 * DRMS 10/10 D9: module landing page `/admin/modul/<id>` — a tile per visible sub-menu of the module
 * (quick-action cards), grouped by the menu sections (one card each), instead of jumping into the first sub-menu.
 * Visibility = the SAME resolveModules() as the top bar and the launcher (Payload read permission ∧
 * visibleEntities ∧ registry role rules ∧ PT features); a module the caller cannot see (or an unknown
 * id) → the uniform no-access page. The tiles only link — every target re-checks access itself.
 */
export async function ModuleLanding(props: AdminViewServerProps) {
  const { initPageResult } = props
  const req = initPageResult.req
  const id = ((props.params as { segments?: string[] } | undefined)?.segments ?? [])[1]
  if (!req.user || !isModuleId(id)) return <NoAccess props={props} />
  const modules = await loadModules({ payload: req.payload, user: req.user, permissions: initPageResult.permissions, visibleEntities: initPageResult.visibleEntities, i18n: req.i18n })
  const mod = modules.find((m) => m.id === id)
  if (!mod) return <NoAccess props={props} />
  const sections = landingSections(mod)
  return (
    <PageTemplate props={props}>
      <Gutter>
        {/* D2510 (ADR 0033): shared page header (module chip) + one Nexus card per menu section, tiles = quick actions */}
        <section className="pk-launcher pk-modland" data-pk-module-landing={mod.id} aria-labelledby="pk-modland-title">
          <PageHeader id="pk-modland-title" title={mod.label} sub={`${mod.hint} — pilih menu.`} mod={mod.id} icon={mod.icon} />
          <div className="pk-nx-page">
            {sections.map((s) => (
              <Panel key={s.key} className="pk-modland__section" icon={s.label ? undefined : mod.icon} title={s.label ?? `Menu ${mod.label}`} note={`(${s.tiles.length})`}>
                <LauncherGrid tiles={s.tiles.map((t) => ({ ...t, mod: mod.id }))} label={s.label ? `${mod.label}: ${s.label}` : `Menu ${mod.label}`} />
              </Panel>
            ))}
          </div>
        </section>
      </Gutter>
    </PageTemplate>
  )
}

export default ModuleLanding
