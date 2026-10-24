import { sql } from '@payloadcms/db-postgres'

import { OWNER_ROLE } from './decision'

type SQL = ReturnType<typeof sql>

/**
 * D2410 (status-filter.ts): the request (table alias `alias`) waits for the Owner — status `pending_approval` and the
 * snapshot step of its current level (0 / NULL read as level 1, like requestStatusLabel) is the Owner role without a
 * named user. Same rule as timeline.ts `ownerStep`.
 */
export function ownerStepSql(alias = 'er'): SQL {
  const a = sql.identifier(alias)
  return sql`(${a}.status = 'pending_approval' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${a}.approval_snapshot -> 'steps') = 'array' THEN ${a}.approval_snapshot -> 'steps' ELSE '[]'::jsonb END) st
     WHERE (st ->> 'level') ~ '^[0-9]+$' AND (st ->> 'level')::numeric = coalesce(nullif(${a}.current_level, 0), 1)
       AND st ->> 'approverRole' = ${OWNER_ROLE} AND coalesce(st ->> 'approverUserId', '') = ''))`
}
