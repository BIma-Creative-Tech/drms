/**
 * "Status" field of the expense-request form. DRMS 10/10 Phase C polish: the status chip of the workflow panel
 * header (WorkflowPanel, `requestStatusLabel` as in the lists / APK) is the one place the status is shown, so the
 * sidebar field renders nothing on every status. Kept as the field component instead of `admin.condition`: a
 * condition on a required field makes Payload's Postgres adapter treat `status` as nullable (schema drift
 * against NOT NULL).
 */
export function RequestStatusField() {
  return null
}

export default RequestStatusField
