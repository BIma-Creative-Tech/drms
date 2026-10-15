'use client'
import { Drawer, RelationshipField, useAuth, useDocumentDrawer, useDrawerSlug, useField, useFormFields, useModal } from '@payloadcms/ui'
import type { RelationshipFieldClientProps } from 'payload'
import React, { useId } from 'react'

import { Icon } from '@/admin/modules/Icon'
import { CREATE_PROP, createButtonState, createTargetOf, drawerInitialData, NEEDS_COMPANY_TEXT, relationId, valueWithCreated, type CreatableOptions } from '@/admin/relationship-create'
import { mayCreate } from '@/admin/shell/quick-create'

import { CompanyScopedField } from '../companies/CompanyScopedField'
import { PartnerFormLoader } from '../partners/PartnerForm'

type Props = RelationshipFieldClientProps & { [CREATE_PROP]?: CreatableOptions }

/**
 * DRMS 16/10 (owner, "konsep no. 1" b): relationship picker + "+ <Klien|Vendor|Karyawan> baru" that creates the missing
 * record in a side drawer and puts it into the picker (admin/relationship-create.ts). Klien / Vendor: the tabbed
 * partner form (PartnerFormLoader) with the form's PT preselected; Karyawan: Payload's document drawer of the plain
 * employee form (no user account) with `initialData: { company }`. The "+" shows only with the create permission
 * Payload sends to the admin and waits for the form's PT ("Pilih PT terlebih dahulu") where the PT is chosen in the
 * form. Payload's own "+" is off on these fields (allowCreate: false). The drawer forms + server re-check everything.
 */
export function CreatableRelationshipField(props: Props) {
  const { [CREATE_PROP]: optsProp, ...fieldProps } = props
  const opts: CreatableOptions = optsProp ?? { company: 'form' }
  const { field, path: pathProp, readOnly } = fieldProps
  const path = pathProp ?? field.name
  const target = createTargetOf(field.relationTo)
  const hasMany = field.hasMany === true
  const { permissions } = useAuth()
  const { value, setValue } = useField<unknown>({ path })
  const company = useFormFields(([f]) => relationId(f.company?.value))
  const hintId = useId()
  const { openModal, closeModal, isModalOpen } = useModal()
  const partnerSlug = useDrawerSlug(`pk-create-${path.replace(/\W+/g, '-')}`)
  const [DocDrawer, , docDrawer] = useDocumentDrawer({ collectionSlug: target?.slug ?? 'employees' })

  const picker = opts.lock ? <CompanyScopedField {...fieldProps} /> : <RelationshipField {...fieldProps} />
  if (!target) return picker
  const state = createButtonState({ canCreate: mayCreate(permissions?.collections?.[target.slug]?.create), readOnly: readOnly === true, mode: opts.company, company })
  if (state === 'hidden') return picker

  const created = (id: unknown) => {
    const n = relationId(id)
    if (n !== null) setValue(valueWithCreated(value, n, hasMany))
  }
  const open = () => (target.drawer === 'partner' ? openModal(partnerSlug) : docDrawer.openDrawer())
  const label = `${target.noun} baru`

  return (
    <div className="pk-relcreate" data-pk-relcreate={target.slug}>
      {picker}
      <div className="pk-relcreate__bar">
        <button type="button" className="pk-relcreate__btn" onClick={open} disabled={state !== 'ready'} aria-describedby={state === 'needs-company' ? hintId : undefined} data-pk-relcreate-btn={state}>
          <Icon name="add" size={16} />
          <span>{label}</span>
        </button>
        {state === 'needs-company' ? (
          <span className="pk-relcreate__hint" id={hintId}>
            {NEEDS_COMPANY_TEXT}
          </span>
        ) : null}
      </div>
      {target.drawer === 'partner' ? (
        <Drawer slug={partnerSlug} title={label} className="pk-relcreate__drawer">
          {isModalOpen(partnerSlug) ? (
            <PartnerFormLoader
              kind={target.partnerKind}
              id={null}
              initialCompany={opts.company === 'form' ? company : null}
              onSaved={(id) => {
                created(id)
                closeModal(partnerSlug)
              }}
              onCancel={() => closeModal(partnerSlug)}
            />
          ) : null}
        </Drawer>
      ) : (
        <DocDrawer
          initialData={drawerInitialData(opts.company, company)}
          redirectAfterCreate={false}
          onSave={({ doc, operation }) => {
            if (operation !== 'create') return
            created(doc.id)
            docDrawer.closeDrawer()
          }}
        />
      )}
    </div>
  )
}

export default CreatableRelationshipField
