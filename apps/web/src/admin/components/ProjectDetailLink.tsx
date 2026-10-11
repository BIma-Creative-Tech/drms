import Link from 'next/link'
import type { PayloadRequest } from 'payload'
import React from 'react'

import { hasRoleAny } from '@/access/roles'
import { Icon } from '@/admin/modules/Icon'

/**
 * DRMS 10/10 #5: sidebar link of the project form (`ui` field `detailLink`, Projects.ts) to the custom
 * project page /admin/progress/project/:id (tahapan, progress, laporan, addendum) — the way back is the
 * "Data project" button there. Server component (Payload field serverProps: id, req); only on saved
 * documents and only for the roles that may open that page (Progress.tsx READERS) — the page re-checks.
 */
export function ProjectDetailLink({ id, req }: { id?: number | string; req?: PayloadRequest }) {
  if (id === undefined || id === null || id === '' || !req || !hasRoleAny(req, 'pk-owner', 'pk-finance', 'pk-pm')) return null
  return (
    <div className="pk-doclink" data-pk-link="project-detail">
      <Link href={`/admin/progress/project/${id}`} className="pk-doclink__a" prefetch={false}>
        <Icon name="project" size={18} />
        <span>Buka halaman project</span>
        <Icon name="arrowRight" size={16} />
      </Link>
      <p className="pk-doclink__hint">Tahapan, progress fisik, laporan &amp; addendum project ini.</p>
    </div>
  )
}

export default ProjectDetailLink
