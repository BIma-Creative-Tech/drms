'use client'
import { SelectField, TextField, useFormFields } from '@payloadcms/ui'
import type { SelectFieldClientComponent, TextFieldClientComponent } from 'payload'
import React from 'react'

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

/** ADR 0027 "Jenis penerima": only while the request is a Draft (it never changes afterwards). */
export const PayeeTypeField: SelectFieldClientComponent = (props) => {
  const status = useFormFields(([f]) => (typeof f.status?.value === 'string' ? f.status.value : null))
  return status === null || status === 'draft' ? <SelectField {...props} /> : null
}

export const RequestTitleField: TextFieldClientComponent = (props) => (useEditable() ? <TextField {...props} /> : null)
