'use client'

import { useRouter } from 'next/navigation'
import React, { useEffect, useRef } from 'react'

/**
 * DRMS 10/10 D8: progressive enhancement of a list toolbar (a plain GET form, works without JS): the
 * search box applies itself 400 ms after the last keystroke, selects / dates / page size on change —
 * as a client navigation (router.replace, no full reload, focus stays in the search box). Empty values
 * are dropped from the URL and every change resets the page (`hal`).
 */
export function AutoSubmit({ pageKey = 'hal' }: { pageKey?: string }) {
  const marker = useRef<HTMLSpanElement>(null)
  const router = useRouter()
  useEffect(() => {
    const form = marker.current?.closest('form')
    if (!form) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = () => {
      const params = new URLSearchParams()
      for (const [k, v] of new FormData(form).entries()) if (typeof v === 'string' && v.trim() !== '' && k !== pageKey) params.set(k, v.trim())
      const url = new URL(form.action, window.location.href)
      const next = `${url.pathname}${params.size ? `?${params}` : ''}`
      if (next !== `${window.location.pathname}${window.location.search}`) router.replace(next, { scroll: false })
    }
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement | null
      if (t?.type !== 'search') return
      clearTimeout(timer)
      timer = setTimeout(go, 400)
    }
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement | null
      if (!t || (t as HTMLInputElement).type === 'search') return
      clearTimeout(timer)
      go()
    }
    const onSubmit = (e: SubmitEvent) => {
      e.preventDefault()
      clearTimeout(timer)
      go()
    }
    form.addEventListener('input', onInput)
    form.addEventListener('change', onChange)
    form.addEventListener('submit', onSubmit)
    return () => {
      clearTimeout(timer)
      form.removeEventListener('input', onInput)
      form.removeEventListener('change', onChange)
      form.removeEventListener('submit', onSubmit)
    }
  }, [router, pageKey])
  return <span ref={marker} hidden />
}

export default AutoSubmit
