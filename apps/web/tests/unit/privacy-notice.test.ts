import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Field } from 'payload'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { privacyNoticeEndpoint } from '@/api/v1/endpoints/privacy'
import { buildOpenApiDocument } from '@/api/v1/openapi'
import { PrivacyAckBody } from '@/api/v1/schemas-privacy'
import { DownloadView } from '@/app/(public)/unduh/DownloadView'
import PrivasiPage from '@/app/(public)/privasi/page'
import { COMPANY_SETTING_FIELDS } from '@/collections/Companies'
import { Users } from '@/collections/Users'
import { SsoLoginButton } from '@/components/SsoLoginButton'
import { SELFIE_RETENTION_DEFAULT_MONTHS } from '@/domain/attendance/retention-policy'
import { escapeHtml, inlineText, noticeMeta, parseInline, parseMarkdown, renderHtml } from '@/legal/markdown'
import { PRIVACY_PATH } from '@/legal/paths'
import { privacyAckLabel } from '@/legal/privacy-ack-label'
import { PRIVACY_NOTICE, PRIVACY_NOTICE_VERSION, privacyAckCurrent, privacyNoticeBlocks, privacyStatusOf } from '@/legal/privacy-notice'
import { PRIVACY_NOTICE_SOURCE } from '@/legal/privacy-notice.generated'
import { PrivacyNoticeBody } from '@/legal/PrivacyNoticeBody'
import { PrivacyGate } from '@/admin/components/privacy/PrivacyGate'

/**
 * Employee privacy notice (Q-46, ASVS 8.3.3 / G-06, ADR 0018): the bundled text is the docs file, the markdown subset
 * renders safely (escaped text, no raw-HTML path), the version comes from the "Versi" line, the selfie retention in
 * the notice equals the setting default, and the public surfaces link /privasi.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const SOURCE = readFileSync(path.join(repoRoot, 'docs/proyekkas/legal/pemberitahuan-privasi.md'), 'utf8').replace(/\r\n?/g, '\n')

describe('bundled notice = docs/proyekkas/legal/pemberitahuan-privasi.md (single source)', () => {
  it('generated module is up to date (markdown, sha256, version, title, html)', () => {
    expect(PRIVACY_NOTICE_SOURCE.source).toBe('docs/proyekkas/legal/pemberitahuan-privasi.md')
    expect(PRIVACY_NOTICE.markdown).toBe(SOURCE)
    expect(PRIVACY_NOTICE.sha256).toBe(createHash('sha256').update(SOURCE).digest('hex'))
    const meta = noticeMeta(SOURCE)
    expect(PRIVACY_NOTICE.version).toBe(meta.version)
    expect(PRIVACY_NOTICE.title).toBe(meta.title)
    expect(PRIVACY_NOTICE.html).toBe(renderHtml(parseMarkdown(SOURCE)))
  })

  it('version 1, title from the first heading, contact filled in (no [placeholders] left)', () => {
    expect(PRIVACY_NOTICE_VERSION).toBe(1)
    expect(PRIVACY_NOTICE.title).toBe('Pemberitahuan Privasi Karyawan — Aplikasi ProyekKas')
    expect(PRIVACY_NOTICE.markdown).toMatch(/## 8\. Kontak\s+\*\*[^[\]*]+\*\*/)
    expect(PRIVACY_NOTICE.markdown).not.toMatch(/\[(Nama PIC|email|telepon|tanggal disetujui)\]/)
  })

  it('Q-33: the retention the notice states = the selfieRetentionMonths default (6 months)', () => {
    const m = /Foto selfie absensi:\s*(\d+)\s*bulan/i.exec(SOURCE)
    expect(m, 'notice §4 must state the selfie retention in months').not.toBeNull()
    expect(Number(m![1])).toBe(SELFIE_RETENTION_DEFAULT_MONTHS)
    expect(SELFIE_RETENTION_DEFAULT_MONTHS).toBe(6)
    const field = COMPANY_SETTING_FIELDS.find((f) => 'name' in f && f.name === 'selfieRetentionMonths') as Field & { defaultValue?: unknown; admin?: { description?: string } }
    expect(field.defaultValue).toBe(6)
    expect(String(field.admin?.description)).toMatch(/Q-33/)
    const del = COMPANY_SETTING_FIELDS.find((f) => 'name' in f && f.name === 'selfieRetentionDeleteEnabled') as Field & { defaultValue?: unknown }
    expect(del.defaultValue).toBe(false) // deletion stays an owner switch
  })
})

describe('markdown subset (safe renderer)', () => {
  it('headings, paragraphs with soft breaks, lists with continuation lines, tables, rules', () => {
    const md = '# Judul\n\nBaris satu\nbaris dua.\n\n- a **b**\n  lanjut\n- c\n\n1. satu\n2. dua\n\n| X | Y |\n|---|---|\n| 1 | **2** |\n| 3 \\| 4 | |\n\n---\n#### H4'
    const b = parseMarkdown(md)
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'ul', 'ol', 'table', 'hr', 'h'])
    expect(renderHtml(b)).toBe(
      [
        '<h1>Judul</h1>',
        '<p>Baris satu baris dua.</p>',
        '<ul><li>a <strong>b</strong> lanjut</li><li>c</li></ul>',
        '<ol><li>satu</li><li>dua</li></ol>',
        '<table><thead><tr><th>X</th><th>Y</th></tr></thead><tbody><tr><td>1</td><td><strong>2</strong></td></tr><tr><td>3 | 4</td><td></td></tr></tbody></table>',
        '<hr>',
        '<h4>H4</h4>',
      ].join('\n'),
    )
  })

  it('raw HTML, links and images are TEXT (escaped) — no tag or attribute from the source reaches the output', () => {
    const md = '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)"> [klik](javascript:alert(1)) ![x](http://e/x.png)\n\n| <b>a</b> |\n|---|\n| "q" & \'s\' |'
    const html = renderHtml(parseMarkdown(md))
    expect(html).not.toMatch(/<(script|img|a|b)\b/i)
    expect(html).not.toMatch(/<[a-z0-9]+\s/i) // no tag carries an attribute
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; [klik](javascript:alert(1))')
    expect(html).toContain('&quot;q&quot; &amp; &#39;s&#39;')
    // only the fixed tag set
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((m) => m[1]))
    expect([...tags].every((t) => ['p', 'table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(t!))).toBe(true)
  })

  it('inline: strong, em, code, escapes; unmatched markers and snake_case stay literal', () => {
    expect(renderHtml([{ t: 'p', c: parseInline('**a** *b* _c_ `d<e>` \\*f\\* g**h snake_case_name 2*3') }])).toBe(
      '<p><strong>a</strong> <em>b</em> <em>c</em> <code>d&lt;e&gt;</code> *f* g**h snake_case_name 2*3</p>',
    )
    expect(inlineText(parseInline('**[Nama]** · `x`'))).toBe('[Nama] · x')
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;')
  })

  it('noticeMeta: integer version from the "Versi" line, title from the first heading; refuses a notice without them', () => {
    expect(noticeMeta('# T\n\n- **Versi:** 12 (DRAF) · x')).toEqual({ version: 12, title: 'T' })
    expect(noticeMeta('# A **B**\n\n**Versi:** 3')).toEqual({ version: 3, title: 'A B' })
    expect(() => noticeMeta('# T\n\nVersi 1')).toThrow(/Versi/)
    expect(() => noticeMeta('- **Versi:** 0\n# T')).toThrow(/≥ 1/)
    expect(() => noticeMeta('- **Versi:** 2')).toThrow(/title/)
  })

  it('React body is built from the AST (no dangerouslySetInnerHTML): same escaping, title optional', () => {
    const blocks = parseMarkdown('# T\n\n## Bagian\n\n<b onclick="x">tebal</b> **ok**\n\n| a |\n|---|\n| b |')
    const html = renderToStaticMarkup(React.createElement(PrivacyNoticeBody, { blocks, skipTitle: true }))
    expect(html).not.toContain('<h1>')
    expect(html).toContain('<h3>Bagian</h3>') // shifted below the caller's title
    expect(html).toContain('&lt;b onclick=&quot;x&quot;&gt;tebal&lt;/b&gt; <strong>ok</strong>')
    expect(html).toContain('<th scope="col">a</th>')
    const full = renderToStaticMarkup(React.createElement(PrivacyNoticeBody, {}))
    expect(full).toContain(`<h1>${escapeHtml(PRIVACY_NOTICE.title)}</h1>`)
    expect(privacyNoticeBlocks()).toBe(privacyNoticeBlocks()) // parsed once
  })
})

describe('acknowledgement helpers', () => {
  it('privacyAckCurrent / privacyStatusOf', () => {
    expect(privacyAckCurrent(null)).toBe(false)
    expect(privacyAckCurrent(undefined)).toBe(false)
    expect(privacyAckCurrent(1, 2)).toBe(false)
    expect(privacyAckCurrent(2, 2)).toBe(true)
    expect(privacyAckCurrent(3, 2)).toBe(true)
    expect(privacyAckCurrent('1', 1)).toBe(false)
    expect(privacyStatusOf(null)).toEqual({ currentVersion: PRIVACY_NOTICE_VERSION, ackVersion: null, ackAt: null })
    expect(privacyStatusOf({ privacyAckVersion: 1, privacyAckAt: '2026-10-05T02:00:00.000Z' })).toEqual({ currentVersion: 1, ackVersion: 1, ackAt: '2026-10-05T02:00:00.000Z' })
    expect(privacyStatusOf({ privacyAckVersion: '2', privacyAckAt: new Date('2026-10-05T02:00:00Z') }).ackVersion).toBe(2)
  })

  it('Users list column label: none / current / outdated (Asia/Makassar)', () => {
    expect(privacyAckLabel(null, null, 1, 'Asia/Makassar')).toEqual({ text: 'Belum', state: 'none' })
    const cur = privacyAckLabel(1, '2026-10-05T02:12:00.000Z', 1, 'Asia/Makassar')
    expect(cur.state).toBe('current')
    expect(cur.text).toMatch(/^v1 · 05\/10\/26,? 10[.:]12$/)
    const old = privacyAckLabel(1, '2026-10-05T02:12:00.000Z', 2, 'Asia/Makassar')
    expect(old.state).toBe('outdated')
    expect(old.text).toMatch(/\(terbaru v2\)$/)
    expect(privacyAckLabel('1', 'not a date', 1).text).toBe('v1 · —')
  })

  it('Users: ack fields are read-only for create/update (only the endpoint writes them) + list column', () => {
    type Loose = { type: string; label?: unknown; access?: Record<string, (a: unknown) => unknown>; admin?: Record<string, unknown> }
    const f = (name: string) => Users.fields.find((x) => 'name' in x && x.name === name) as unknown as Loose
    for (const name of ['privacyAckVersion', 'privacyAckAt']) {
      expect(f(name).access?.create?.({})).toBe(false)
      expect(f(name).access?.update?.({})).toBe(false)
      expect(f(name).admin?.readOnly).toBe(true)
    }
    expect(f('privacyAck').type).toBe('ui')
    expect(f('privacyAck').label).toBe('Privasi dibaca (versi/tanggal)')
    expect(Users.admin?.defaultColumns).toContain('privacyAck')
  })

  it('admin gate renders nothing once the current version is acknowledged', () => {
    expect(PrivacyGate({ user: { privacyAckVersion: PRIVACY_NOTICE_VERSION } })).toBeNull()
    expect(PrivacyGate({ user: null })).toBeNull()
    expect(PrivacyGate({ user: { privacyAckVersion: null } })).not.toBeNull()
    expect(PrivacyGate({ user: { privacyAckVersion: PRIVACY_NOTICE_VERSION - 1 } })).not.toBeNull()
  })
})

describe('API contract + public surfaces', () => {
  it('GET /privacy-notice (public): version, title, html, markdown — no auth, cacheable', async () => {
    expect(privacyNoticeEndpoint.path).toBe('/v1/privacy-notice')
    const res = await privacyNoticeEndpoint.handler({ searchParams: new URLSearchParams() } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['html', 'markdown', 'title', 'version'])
    expect(body).toEqual({ version: PRIVACY_NOTICE.version, title: PRIVACY_NOTICE.title, html: PRIVACY_NOTICE.html, markdown: PRIVACY_NOTICE.markdown })
  })

  it('ack body: integer version only (strict)', () => {
    expect(PrivacyAckBody.safeParse({ version: 1 }).success).toBe(true)
    expect(PrivacyAckBody.safeParse({ version: 1.5 }).success).toBe(false)
    expect(PrivacyAckBody.safeParse({ version: 0 }).success).toBe(false)
    expect(PrivacyAckBody.safeParse({ version: '1' }).success).toBe(false)
    expect(PrivacyAckBody.safeParse({ version: 1, ackAt: 'x' }).success).toBe(false)
  })

  it('OpenAPI documents both paths and Me.privacy', () => {
    const doc = buildOpenApiDocument('0.0.0') as unknown as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }> } }
    expect(doc.paths['/privacy-notice']?.get).toBeDefined()
    expect(doc.paths['/me/privacy-ack']?.post).toBeDefined()
    expect(doc.components.schemas.Me?.required).toContain('privacy')
    expect(Object.keys(doc.components.schemas.PrivacyStatus?.properties ?? {}).sort()).toEqual(['ackAt', 'ackVersion', 'currentVersion'])
  })

  it('/privasi renders the bundled notice; /unduh and the web login link to it', () => {
    const page = renderToStaticMarkup(React.createElement(PrivasiPage))
    expect(page).toContain(`<h1 class="pk-pub__title">${escapeHtml(PRIVACY_NOTICE.title)}</h1>`)
    expect(page).toContain(`data-pk-privacy-version="${PRIVACY_NOTICE.version}"`)
    expect(page).toContain('Foto selfie absensi: 6 bulan')
    expect(PRIVACY_PATH).toBe('/privasi')
    expect(renderToStaticMarkup(React.createElement(DownloadView, { release: null }))).toContain('href="/privasi"')
    expect(renderToStaticMarkup(React.createElement(SsoLoginButton, {}))).toContain('href="/privasi"')
  })
})
