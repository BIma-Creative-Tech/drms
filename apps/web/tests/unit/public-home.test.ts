import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import HomePage, { metadata } from '@/app/(public)/page'
import { SsoLoginButton } from '@/components/SsoLoginButton'
import { DOWNLOAD_PATH, LOGIN_PATH, PRIVACY_PATH } from '@/legal/paths'
import { BRAND_NAME } from '@/theme/graphics'

/** Owner 2026-10-10: "/" answered 404 and nothing linked to /unduh — public home page + download link on the login. */
describe('public home page and download links', () => {
  it('GET / renders plain links to the login, the APK download and the privacy notice (no form), not indexed', () => {
    const page = renderToStaticMarkup(React.createElement(HomePage))
    expect(page).toContain(`<h1 class="pk-pub__title">${BRAND_NAME}</h1>`)
    expect(page).toMatch(/<a class="pk-pub__button" href="\/admin\/login" id="pk-home-login">Masuk<\/a>/)
    expect(page).toMatch(/<a class="pk-pub__button pk-pub__button--secondary" href="\/unduh" id="pk-home-download">/)
    expect(page).toContain('href="/privasi"')
    expect(page).not.toContain('<form')
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
    expect([LOGIN_PATH, DOWNLOAD_PATH, PRIVACY_PATH]).toEqual(['/admin/login', '/unduh', '/privasi'])
  })

  it('the web login links to /unduh next to the privacy notice', () => {
    const html = renderToStaticMarkup(React.createElement(SsoLoginButton, {}))
    expect(html).toContain(`<a href="/unduh" id="pk-download-link">Unduh aplikasi ${BRAND_NAME}</a>`)
    expect(html).toContain('href="/privasi"')
  })
})
