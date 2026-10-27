import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CollectionConfig, GlobalConfig } from 'payload'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { CONFIRM_SAVE_BUTTON, withConfirmSave, withGlobalConfirmSave } from '@/admin/confirm-save'
import { answerConfirm, asConfirmLabel, asConfirmTitle, confirmAction, confirmedRun, confirmLabel, confirmTitle, dismissResult, failureTitle, feedbackStore, isDangerAction, lowerFirst, showResult, successTitle, summaryRows } from '@/admin/components/feedback/feedback'
import { SummaryList } from '@/admin/components/feedback/FeedbackHost'
import { expenseRequestSummary, moneyDocSummary } from '@/admin/components/feedback/summaries'

/**
 * DRMS 24/10 (user decision): confirmation popup BEFORE and result popup AFTER every data-changing action — the pure
 * store + wording (feedback.ts), the summary list, the summaries of the common documents and the "Simpan" wiring of
 * every collection / global. The dialogs themselves are native <dialog> (FeedbackHost) — browser behaviour.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const src = (p: string) => readFileSync(path.resolve(here, '../../src', p), 'utf8')

let detach: (() => void) | null = null
afterEach(() => {
  answerConfirm(false)
  dismissResult()
  detach?.()
  detach = null
})

describe('wording', () => {
  it('"Yakin ingin <aksi> <dokumen>?", [Ya, <aksi>], "Berhasil: <aksi> <dokumen>", "Gagal: <aksi>"', () => {
    expect(confirmTitle('Kirim pengajuan', 'PB/2026/10/0001')).toBe('Yakin ingin kirim pengajuan PB/2026/10/0001?')
    expect(confirmTitle('Tolak')).toBe('Yakin ingin tolak?')
    expect(confirmLabel('Tolak')).toBe('Ya, tolak')
    expect(confirmLabel('LPJ selesai')).toBe('Ya, LPJ selesai')
    expect(successTitle('Setujui', 'PB/1')).toBe('Berhasil: setujui PB/1')
    expect(failureTitle('Void transfer')).toBe('Gagal: void transfer')
    expect(lowerFirst('KM baru')).toBe('KM baru')
  })
  it('existing dialog titles / buttons are rephrased once (idempotent)', () => {
    expect(asConfirmTitle('Void transfer TRF/1?')).toBe('Yakin ingin void transfer TRF/1?')
    expect(asConfirmTitle(asConfirmTitle('Tolak ADD/1?'))).toBe('Yakin ingin tolak ADD/1?')
    expect(asConfirmLabel('Void transfer')).toBe('Ya, void transfer')
    expect(asConfirmLabel('Ya, nonaktifkan')).toBe('Ya, nonaktifkan')
  })
  it('destructive actions are danger: Tolak, Batalkan, Hapus, Nonaktifkan, Void', () => {
    expect(['Tolak', 'Batalkan pengajuan', 'Hapus', 'Nonaktifkan 2FA', 'Void transfer TRF/1'].every(isDangerAction)).toBe(true)
    expect(['Setujui', 'Kirim pengajuan', 'Simpan', 'Diketahui', 'Catat transfer'].some(isDangerAction)).toBe(false)
  })
})

describe('summary', () => {
  it('rows without a value are skipped; values rendered as text', () => {
    expect(summaryRows([['No.', 'PB/1'], ['Judul', null], ['Total', 0], ['Catatan', '  ']])).toEqual([
      ['No.', 'PB/1'],
      ['Total', '0'],
    ])
    const html = renderToStaticMarkup(React.createElement(SummaryList, { summary: [['Pengajuan', 'PB/1'], ['Pemohon', '<b>x</b>']] }))
    expect(html).toContain('<dt>Pengajuan</dt><dd>PB/1</dd>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;') // escaped, never HTML
    expect(renderToStaticMarkup(React.createElement(SummaryList, { summary: [] }))).toBe('')
  })
  it('expense request + money document summaries', () => {
    const s = expenseRequestSummary({ id: 7, docNo: null, typeLabel: 'Pengajuan Baru', title: 'Semen', grandTotal: 1250000, requesters: [{ name: 'Budi' }, { name: 'Ani' }] })
    expect(s.object).toBe('Draft #7')
    expect(summaryRows(s.summary)).toEqual([
      ['Pengajuan Baru', 'Draft #7'],
      ['Judul', 'Semen'],
      ['Pemohon', 'Budi, Ani'],
      ['Total', 'Rp 1.250.000'],
    ])
    expect(summaryRows(moneyDocSummary('Transfer', { docNo: 'TRF/1', amount: 5000, party: 'Budi', partyLabel: 'Penerima' }).summary)).toEqual([
      ['Transfer', 'TRF/1'],
      ['Nominal', 'Rp 5.000'],
      ['Penerima', 'Budi'],
    ])
  })
})

describe('store', () => {
  it('without a mounted host a confirmation passes (button keeps working; the server re-checks)', async () => {
    await expect(confirmAction({ title: 't', confirmLabel: 'Ya' })).resolves.toBe(true)
  })
  it('with a host: resolves with the answer; a second request cancels the first', async () => {
    detach = feedbackStore.attach()
    const first = confirmAction({ title: 'Yakin ingin tolak PB/1?', confirmLabel: 'Ya, tolak', danger: true })
    expect(feedbackStore.get().confirm?.title).toBe('Yakin ingin tolak PB/1?')
    const second = confirmAction({ title: 'Yakin ingin setujui PB/1?', confirmLabel: 'Ya, setujui' })
    await expect(first).resolves.toBe(false)
    answerConfirm(true)
    await expect(second).resolves.toBe(true)
    expect(feedbackStore.get().confirm).toBeNull()
  })
  it('confirmedRun: Batal runs nothing; success / server error → result popup', async () => {
    detach = feedbackStore.attach()
    let ran = 0
    const run = async () => {
      ran += 1
      return null
    }
    const cancelled = confirmedRun({ action: 'Hapus', object: 'nota 12', run })
    expect(feedbackStore.get().confirm).toMatchObject({ title: 'Yakin ingin hapus nota 12?', confirmLabel: 'Ya, hapus', danger: true })
    answerConfirm(false)
    expect(await cancelled).toBe(false)
    expect(ran).toBe(0)

    const ok = confirmedRun({ action: 'Kirim pengajuan', object: 'PB/1', success: 'Approver dinotifikasi.', run })
    answerConfirm(true)
    expect(await ok).toBe(true)
    expect(feedbackStore.get().result).toMatchObject({ ok: true, title: 'Berhasil: kirim pengajuan PB/1', message: 'Approver dinotifikasi.' })

    const bad = confirmedRun({ action: 'Setujui', run: async () => 'Status data sudah berubah.' })
    answerConfirm(true)
    expect(await bad).toBe(false)
    expect(feedbackStore.get().result).toMatchObject({ ok: false, title: 'Gagal: setujui', message: 'Status data sudah berubah.' })
    dismissResult()
    expect(feedbackStore.get().result).toBeNull()
  })
  it('showResult replaces the open result', () => {
    showResult({ ok: true, title: 'Berhasil: simpan' })
    showResult({ ok: false, title: 'Gagal: simpan', message: 'x' })
    expect(feedbackStore.get().result).toMatchObject({ ok: false, title: 'Gagal: simpan' })
  })
})

describe('wiring', () => {
  it('every collection / global "Simpan" confirms; an own SaveButton (expense requests) is kept', () => {
    const cols = withConfirmSave([{ slug: 'a', fields: [] }, { slug: 'b', fields: [], admin: { components: { edit: { SaveButton: '@/x#X' } } } }] as CollectionConfig[])
    expect(cols[0]?.admin?.components?.edit?.SaveButton).toBe(CONFIRM_SAVE_BUTTON)
    expect(cols[1]?.admin?.components?.edit?.SaveButton).toBe('@/x#X')
    const globals = withGlobalConfirmSave([{ slug: 'g', fields: [] }] as GlobalConfig[])
    expect(globals[0]?.admin?.components?.elements?.SaveButton).toBe(CONFIRM_SAVE_BUTTON)
    expect(src('admin/components/RequestSaveButton.tsx')).toContain('<ConfirmSaveButton {...props} />')
  })
  it('host + save button in the providers / import map; no window.confirm in the shared action components', () => {
    expect(src('payload.config.ts')).toContain("'@/admin/components/feedback/FeedbackHost#FeedbackHost'")
    const map = src('app/(payload)/admin/importMap.js')
    expect(map).toContain('"@/admin/components/feedback/FeedbackHost#FeedbackHost"')
    expect(map).toContain('"@/admin/components/feedback/ConfirmSaveButton#ConfirmSaveButton"')
    expect(src('admin/components/ActionButton.tsx')).not.toMatch(/window\.(prompt|confirm|alert)\(/)
    for (const f of ['admin/components/ActionDialog.tsx', 'admin/components/kas/ReasonAction.tsx', 'admin/components/RowRecordAction.tsx', 'admin/components/MoneyForm.tsx', 'admin/components/addendum/ConfirmAction.tsx']) {
      expect(src(f), f).not.toMatch(/window\.(prompt|confirm|alert)\(/)
      expect(src(f), f).toMatch(/showResult\(/)
    }
  })
})
