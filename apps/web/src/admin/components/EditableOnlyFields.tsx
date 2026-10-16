'use client'
import { SelectField, TextField, useDocumentInfo, useField, useFormFields } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import type { SelectFieldClientComponent, TextFieldClientComponent } from 'payload'
import React, { useEffect, useRef } from 'react'

import { payeePreset } from '@/admin/shell/quick-create'
import { linesEditable } from '@/collections/expense-request-form'

/**
 * DRMS 10/10 B-2 (item 3): the REQUIRED header inputs of the expense request (Jenis, Judul) only while the
 * content is editable (new / Draft / Revisi Nota). On a locked request the workflow panel shows them in the
 * read-only "Rincian pengajuan" summary, so the main column carries no disabled inputs. A component instead of
 * `admin.condition`: a condition on a required field makes the Postgres adapter treat the column as nullable
 * (schema drift, see RequestStatusField).
 */
const useEditable = () => {
  const status = useFormFields(([f]) => (typeof f.status?.value === 'string' ? f.status.value : null))
  return linesEditable({ status })
}

/** ADR 0027 / 0028: a vendor / PT grup payment is always "Pengajuan Baru" (set by the server) — no "Jenis" input then. */
const useVendor = () => useFormFields(([f]) => f.payeeType?.value === 'vendor' || f.payeeType?.value === 'pt_grup')

export const RequestTypeField: SelectFieldClientComponent = (props) => {
  const editable = useEditable()
  const vendor = useVendor()
  return editable && !vendor ? <SelectField {...props} /> : null
}

/**
 * DRMS 16/10 "+ Buat" › "Pembayaran vendor": `?penerima=vendor` (or `pt_grup`) on the CREATE form presets "Jenis
 * penerima" once, exactly like the user picking it (form state refresh included) — only when that option is offered to
 * the caller (filterOptions: Staff / Finance / PM for vendor, ADR 0027); the server re-checks on save (drafts.ts). The user can
 * switch back; an existing request is never touched.
 */
function usePayeePreset(path: string) {
  const preset = payeePreset(useSearchParams()?.get('penerima'))
  const { id } = useDocumentInfo()
  const { value, setValue, selectFilterOptions } = useField<string>({ path })
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !preset || id !== undefined || value === undefined) return
    done.current = true
    const offered = !selectFilterOptions || selectFilterOptions.some((o) => (typeof o === 'string' ? o : o.value) === preset)
    if (offered && value !== preset) setValue(preset)
  }, [preset, id, value, setValue, selectFilterOptions])
}

/** ADR 0027 "Jenis penerima": only while the request is a Draft (it never changes afterwards). */
export const PayeeTypeField: SelectFieldClientComponent = (props) => {
  const status = useFormFields(([f]) => (typeof f.status?.value === 'string' ? f.status.value : null))
  usePayeePreset(props.path)
  return status === null || status === 'draft' ? <SelectField {...props} /> : null
}

export const RequestTitleField: TextFieldClientComponent = (props) => (useEditable() ? <TextField {...props} /> : null)
