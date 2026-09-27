import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { KAS_STYLE } from '@/admin/components/kas/style'

import { F3Root } from './f3-ui'
import { PROGRESS_STYLE } from './progress-ui'
import { VIZ_STYLE } from './viz'

/** DefaultTemplate (nav + header) around a pk-f3 root with the dashboard + progress styles. */
export function Frame({ props, name, children }: { props: AdminViewServerProps; name: string; children: React.ReactNode }) {
  const { initPageResult, params, searchParams } = props
  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user ?? undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <F3Root name={name}>
          <style>{VIZ_STYLE}</style>
          <style>{KAS_STYLE}</style>
          <style>{PROGRESS_STYLE}</style>
          {children}
        </F3Root>
      </Gutter>
    </DefaultTemplate>
  )
}

