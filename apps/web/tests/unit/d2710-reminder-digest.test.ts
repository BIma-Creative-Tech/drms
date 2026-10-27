import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { dateLabel, DIGEST_MAX_TEXT, DIGEST_SECTIONS, digestEmail, REMINDER_RULES, type DigestItem } from '@/domain/reminders/rules'

/**
 * D2710 (user 2026-10-27): one daily reminder digest per recipient. Prod queued ~150 reminder emails at once (up to 19
 * per person) against the mailbox budget of 24/h — about half failed for good every day.
 */
const root = fileURLToPath(new URL('../../', import.meta.url))
const src = (p: string) => readFileSync(join(root, p), 'utf8')
const item = (rule: DigestItem['rule'], n: number, companyId = 1): DigestItem => ({ rule, title: `T${n}`, body: `Isi pengingat ${n}.`, companyId })

describe('digestEmail', () => {
  it('one reminder keeps its own subject and text', () => {
    const m = digestEmail([item('lpj_overdue', 1)], { date: '2026-10-27', appUrl: 'https://drms.example/' })
    expect(m.subject).toBe('RR Teams — T1')
    expect(m.text).toMatch(/^Isi pengingat 1\.\n\nBuka RR Teams: https:\/\/drms\.example\/admin\n\n/)
    expect(m.text).toContain('satu email per hari')
  })

  it('several reminders: one email, grouped per rule in a fixed order, count in the subject', () => {
    const m = digestEmail([item('late_progress', 1), item('lpj_overdue', 2), item('late_progress', 3), item('budget_threshold', 4)], { date: '2026-10-27' })
    expect(m.subject).toBe('RR Teams — Ringkasan pengingat 27 Okt 2026 (4 pengingat)')
    expect(m.text.startsWith('Ringkasan pengingat harian RR Teams, 27 Okt 2026: 4 pengingat.\n')).toBe(true)
    const lpj = m.text.indexOf('LPJ terlambat (1)')
    const late = m.text.indexOf('Laporan progress terlambat (2)')
    const budget = m.text.indexOf('Ambang anggaran project (1)')
    expect(lpj).toBeGreaterThan(0)
    expect(late).toBeGreaterThan(lpj)
    expect(budget).toBeGreaterThan(late)
    expect(m.text.match(/^- /gm)).toHaveLength(4)
    expect(m.text).not.toContain('Buka RR Teams') // no APP_URL
  })

  it('PT label only when the items span several PTs', () => {
    const one = digestEmail([item('lpj_overdue', 1, 2), item('lpj_overdue', 2, 2)], { date: '2026-10-27', ptLabel: () => 'LAS' })
    expect(one.text).not.toContain('[LAS]')
    const two = digestEmail([item('lpj_overdue', 1, 2), item('lpj_overdue', 2, 3)], { date: '2026-10-27', ptLabel: (id) => (id === 2 ? 'LAS' : 'PMK') })
    expect(two.text).toContain('- [LAS] Isi pengingat 1.')
    expect(two.text).toContain('- [PMK] Isi pengingat 2.')
  })

  it('stays inside the sendEmail text limit and says how many were left out', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ ...item('late_progress', i), body: `Project P${i} ${'x'.repeat(80)}` }))
    const m = digestEmail(many, { date: '2026-10-27', appUrl: 'https://drms.example' })
    expect(m.text.length).toBeLessThan(20_000)
    expect(m.text.length).toBeGreaterThan(DIGEST_MAX_TEXT - 200)
    const shown = m.text.match(/^- /gm)!.length
    expect(shown).toBeLessThan(400)
    expect(m.text).toContain(`… dan ${400 - shown} pengingat lainnya.`)
    expect(m.subject.length).toBeLessThanOrEqual(200)
  })

  it('every rule has a section; date label', () => {
    expect(Object.keys(DIGEST_SECTIONS).sort()).toEqual([...REMINDER_RULES].sort())
    expect(dateLabel('2026-01-05')).toBe('5 Jan 2026')
    expect(dateLabel('bukan tanggal')).toBe('bukan tanggal')
  })
})

describe('service wiring', () => {
  it('reminders never queue sendEmail per subject; the digest flush is the only sender', () => {
    const svc = src('src/domain/reminders/service.ts')
    expect(svc.match(/task: 'sendEmail'/g)).toHaveLength(1)
    expect(svc).toMatch(/async function flushDigests\(/)
    expect(svc).toMatch(/emails = await flushDigests\(payload\)/)
  })
})
