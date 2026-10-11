'use client'
import { useFormFields } from '@payloadcms/ui'
import React from 'react'

import { previewInputFromForm, rulePreview } from '@/domain/expense/rule-preview'

/**
 * ADR 0024 (owner decision 2026-10-11): "Aturan approval" form — how a rule is chosen and a live preview of
 * the flow it gives ("Contoh: pengajuan oleh Direktur → langsung ke Finance"). Display only; the rule hook
 * and the DB trigger refuse a zero-step rule unless "Peran pemohon" is exactly Direktur.
 */
export function ApprovalRulePreview() {
  // primitive selector result (JSON) → re-render only when the preview changes
  const key = useFormFields(([fields]) => JSON.stringify(rulePreview(previewInputFromForm(fields as Record<string, { value?: unknown }>))))
  const p = JSON.parse(key) as ReturnType<typeof rulePreview>
  return (
    <div className="field-type" data-pk-rule-preview data-pk-rule-no-approval={p.noApproval ? 'true' : 'false'} style={{ padding: '10px 12px', border: '1px solid var(--theme-elevation-150)', borderRadius: 4, marginBottom: 'var(--spacing-field, 16px)', fontSize: 13, lineHeight: 1.5 }}>
      <strong style={{ display: 'block', marginBottom: 4 }}>Penjelasan aturan</strong>
      <p style={{ margin: '0 0 6px', color: 'var(--theme-elevation-700)' }}>
        Saat pengajuan dikirim, sistem memilih aturan aktif yang cocok (jenis, nominal, kategori / project, Peran pemohon) dengan Prioritas terkecil; aturan itu disimpan pada pengajuan dan perubahan aturan tidak memengaruhi pengajuan yang sudah dikirim. Tanpa level approval = &quot;Tanpa persetujuan — langsung ke antrian transfer Finance&quot;, hanya untuk Peran pemohon = Direktur (pengajuan Direktur sendiri; Finance tetap memeriksa saat transfer).
      </p>
      <p data-pk-rule-example style={{ margin: 0, padding: '6px 8px', borderRadius: 4, background: 'var(--theme-elevation-50)', fontWeight: 600 }}>
        {p.example}
      </p>
      {p.error ? (
        <p role="alert" data-pk-rule-error style={{ margin: '6px 0 0', color: 'var(--pk-tone-bad-text, var(--theme-error-500))', fontWeight: 600 }}>
          Tidak dapat disimpan: {p.error}
        </p>
      ) : null}
    </div>
  )
}

export default ApprovalRulePreview
