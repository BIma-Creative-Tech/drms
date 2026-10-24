'use client'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import { problemText } from '../ActionButton'
import { askField, fieldResult } from './client'
import { WrapSelect } from '../WrapSelect'
import { WrapText } from '../WrapText'

/**
 * DRMS 10/10 D4 (owner 2026-10-11, RAP for every project with a RAB): RAP templates on the project's RAP tab —
 * "Pakai template" fills an EMPTY RAP (POST …/rap/apply-template; templates of the PT that fit the project kind)
 * and "Simpan sebagai template" stores the active items as a template of the PT (POST …/rap/save-template, kind =
 * the project's). The server re-checks the editor role, the kind and the empty RAP.
 */
type Template = { id: number; name: string; items: number; projectKind: string | null }

const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function RapTemplateActions({ projectId, templates, empty }: { projectId: number; templates: Template[]; empty: boolean }) {
  const router = useRouter()
  const uid = useId()
  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`/api/v1/projects/${projectId}/rap/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': key() },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(problemText(data, res.status))
    return data
  }

  /** DRMS 24/10: `action` is asked first ("Yakin ingin …?" + summary) and named in the result popup. */
  const run = async (label: string, action: string, object: string | null, summary: Array<[string, string | number | null]>, fn: () => Promise<string>) => {
    setError(null)
    setDone(null)
    if (!(await askField(action, object, summary))) return
    setBusy(label)
    try {
      setDone(await fn())
      fieldResult(action, object, null)
      router.refresh()
    } catch (x) {
      setError((x as Error).message)
      fieldResult(action, object, (x as Error).message || 'Gagal menghubungi server.')
    } finally {
      setBusy(null)
    }
  }

  const apply = () =>
    templateId
      ? run('Memakai template…', 'Pakai template RAP', templates.find((t) => String(t.id) === templateId)?.name ?? null, [['Template', templates.find((t) => String(t.id) === templateId)?.name ?? null], ['Jumlah item', templates.find((t) => String(t.id) === templateId)?.items ?? null]], async () => {
          await post('apply-template', { templateId: Number(templateId) })
          return 'RAP terisi dari template.'
        })
      : setError('Pilih template dulu.')

  const save = () =>
    name.trim().length >= 3
      ? run('Menyimpan template…', 'Simpan sebagai template RAP', name.trim(), [['Nama template', name.trim()]], async () => {
          const t = (await post('save-template', { name: name.trim() })) as { name: string; items: number }
          setName('')
          return `Template "${t.name}" tersimpan (${t.items} item).`
        })
      : setError('Nama template minimal 3 karakter.')

  return (
    <div className="pk-kform" data-pk-form="rap-templates">
      {error ? (
        <div className="pk-alert bad" role="alert">
          <b aria-hidden>!</b>
          <p>{error}</p>
        </div>
      ) : null}
      {done ? (
        <div className="pk-alert ok" role="status">
          <b aria-hidden>✓</b>
          <p>{done}</p>
        </div>
      ) : null}
      {empty ? (
        <div className="pk-fld">
          <label htmlFor={`${uid}-tpl`}>Pakai template RAP</label>
          {templates.length === 0 ? (
            <p className="help" data-pk-rap-templates="none">
              Belum ada template RAP untuk jenis project ini. Isi RAP lewat impor Excel di bawah, lalu simpan sebagai template untuk project berikutnya.
            </p>
          ) : (
            <>
              <WrapSelect id={`${uid}-tpl`} value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-pk-field="rap-template">
                <option value="">Pilih template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.items} item{t.projectKind ? '' : ', semua jenis'})
                  </option>
                ))}
              </WrapSelect>
              <div className="pk-actions">
                <button type="button" className="pk-kbtn primary" onClick={apply} disabled={busy !== null} data-pk-submit="rap-apply-template">
                  {busy === 'Memakai template…' ? busy : 'Pakai template'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="pk-fld">
          <label htmlFor={`${uid}-name`}>Simpan RAP ini sebagai template</label>
          <WrapText id={`${uid}-name`} value={name} maxLength={128} placeholder="mis. RAP trading standar" onChange={(e) => setName(e.target.value)} />
          <p className="help">Item aktif disimpan sebagai template PT ini untuk project berjenis sama.</p>
          <div className="pk-actions">
            <button type="button" className="pk-kbtn" onClick={save} disabled={busy !== null} data-pk-submit="rap-save-template">
              {busy === 'Menyimpan template…' ? busy : 'Simpan template'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default RapTemplateActions
