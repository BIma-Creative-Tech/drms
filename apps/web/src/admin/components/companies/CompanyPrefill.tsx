'use client'
import { useField } from '@payloadcms/ui'
import React, { useEffect } from 'react'

import { CompanyBadge } from './CompanyBadge'

/**
 * DRMS 13/10 Pengajuan #1/#2: the create form's PT when exactly one PT is possible (one membership with the
 * create role, or the PT switcher on one PT) — set once into the form state (without marking the form as
 * modified: no "unsaved changes" prompt for a value the user did not type) and shown read-only as the PT badge.
 * The value normally arrives already in the initial form state (companyField `defaultValue`); this effect is a fallback.
 */
export function CompanyPrefill({ path, id, shortCode, name }: { path: string; id: number; shortCode: string; name: string | null }) {
  const { value, setValue } = useField<number | { id: number } | null>({ path })
  const current = typeof value === 'number' ? value : value && typeof value === 'object' ? value.id : null
  useEffect(() => {
    if (current !== id) setValue(id, true)
  }, [current, id, setValue])
  return <CompanyBadge shortCode={shortCode} name={name} note="Sesuai pemilih PT di kanan atas." />
}

export default CompanyPrefill
