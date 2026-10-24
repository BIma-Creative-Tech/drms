'use client'
import React, { createContext, useContext } from 'react'

import type { Summary } from './feedback'

/**
 * DRMS 24/10: the document a group of action buttons acts on — its number (`object`, named in "Yakin ingin tolak
 * PB/…?" and "Berhasil: tolak PB/…") and the summary rows of the popups (amount, person, date). A page / panel / list
 * row wraps its buttons ONCE (server components may render it: plain serialisable props); ActionButton, Act,
 * ReasonAction, ConfirmAction and the money forms read it when their own `object` / `summary` props are not given —
 * so buttons added later inside the wrapper get the summary without touching each call site.
 */
export type DocSummary = { object?: string | null; summary?: Summary }

const Ctx = createContext<DocSummary>({})

export function DocSummaryProvider({ object, summary, children }: DocSummary & { children?: React.ReactNode }) {
  return <Ctx.Provider value={{ object, summary }}>{children}</Ctx.Provider>
}

export function useDocSummary(): DocSummary {
  return useContext(Ctx)
}

export default DocSummaryProvider
