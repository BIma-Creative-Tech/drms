import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { Icon } from '@/admin/modules/Icon'
import { isModuleId, landingSections } from '@/admin/modules/registry'
import { loadModules } from '@/admin/shell/modules-server'

import { PageTemplate } from './frame'
import { LauncherGrid } from './LauncherGrid'
import { NoAccess } from './NoAccess'

/**
 * DRMS 10/10 D9: module landing page `/admin/modul/<id>` — a tile per visible sub-menu of the module
 * (launcher tile look), grouped by the menu sections, instead of jumping into the first sub-menu.
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
        <section className="pk-launcher pk-modland" data-pk-module-landing={mod.id} aria-labelledby="pk-modland-title">
          <header className="pk-modland__head" data-mod={mod.id}>
            <span className="pk-modland__chip" aria-hidden="true">
              <Icon name={mod.icon} size="56%" />
            </span>
            <div>
              <h1 id="pk-modland-title" className="pk-modland__title">
                {mod.label}
              </h1>
              <p className="pk-modland__hint">{mod.hint} — pilih menu.</p>
            </div>
          </header>
          {sections.map((s) => (
            <div key={s.key} className="pk-modland__section">
              {s.label ? <h2 className="pk-modland__label">{s.label}</h2> : null}
              <LauncherGrid tiles={s.tiles.map((t) => ({ ...t, mod: mod.id }))} label={s.label ? `${mod.label}: ${s.label}` : `Menu ${mod.label}`} />
            </div>
          ))}
        </section>
      </Gutter>
    </PageTemplate>
  )
}

export default ModuleLanding
