import Link from 'next/link'
import type { AdminViewServerProps } from 'payload'
import React from 'react'

import { KAS_STYLE } from '@/admin/components/kas/style'

import { F3Root } from './f3-ui'
import { Frame, PageHead } from './frame'
import { NO_ACCESS_TITLE, NoAccessBody } from './no-access-body'

export { NO_ACCESS_BACK, NO_ACCESS_TEXT, NO_ACCESS_TITLE, NoAccessBody } from './no-access-body'

/** A custom view the caller may not use: module bar + the uniform message. */
export function NoAccess({ props, hint }: { props: AdminViewServerProps; hint?: React.ReactNode }) {
  return (
    <Frame props={props} name="no-access">
      <PageHead props={props} title={NO_ACCESS_TITLE} />
      <NoAccessBody hint={hint} />
    </Frame>
  )
}

/**
 * QA-24: replaces Payload's UnauthorizedView at /admin/unauthorized ("Tidak sah, Anda harus masuk…"
 * for a logged-in user). Payload renders it in the minimal template (no module bar). A user WITHOUT
 * any panel role lands here too (handleAuthRedirect) — the same text applies.
 */
export function UnauthorizedView() {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px' }}>
      <F3Root name="unauthorized">
        <style>{KAS_STYLE}</style>
        <PageHead title={NO_ACCESS_TITLE} />
        <NoAccessBody
          hint={
            <>
              Bila Anda seharusnya punya akses, hubungi Admin PT Anda. <Link href="/admin/logout">Keluar</Link>
            </>
          }
        />
      </F3Root>
    </div>
  )
}

export default NoAccess
