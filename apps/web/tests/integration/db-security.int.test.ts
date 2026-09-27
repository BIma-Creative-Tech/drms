import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, makeUser, sqlAs, sqlError } from './helpers'

/** ADR 0006 + spike c refinements, verified in the catalog and by attempting the forbidden DML. */
let auditId: number

beforeAll(async () => {
  const p = await getTestPayload()
  await p.create({ collection: 'uoms', data: { code: 'DBSEC', name: 'dbsec' }, overrideAccess: true /* SYSTEM-WRITE: fixture */ })
  const r = await sqlAs('app', 'SELECT max(id)::int AS id FROM audit_logs')
  auditId = r.rows[0].id
  expect(auditId).toBeGreaterThan(0)
})

afterAll(async () => {
  await (await getTestPayload()).destroy()
})

describe('audit_logs is append-only (Class A)', () => {
  it('app role: UPDATE / DELETE / TRUNCATE → 42501 permission denied', async () => {
    for (const q of [`UPDATE audit_logs SET reason = 'x' WHERE id = ${auditId}`, `DELETE FROM audit_logs WHERE id = ${auditId}`, 'TRUNCATE audit_logs']) {
      const err = await sqlError('app', q)
      expect(err, q).not.toBeNull()
      expect(err?.code, q).toBe('42501')
      expect(err?.message, q).toMatch(/permission denied/)
    }
  })

  it('owner role: UPDATE / DELETE / TRUNCATE rejected by trigger (42501)', async () => {
    for (const [q, op] of [
      [`UPDATE audit_logs SET reason = 'x' WHERE id = ${auditId}`, 'UPDATE'],
      [`DELETE FROM audit_logs WHERE id = ${auditId}`, 'DELETE'],
      ['TRUNCATE audit_logs', 'TRUNCATE'],
    ] as const) {
      const err = await sqlError('owner', q)
      expect(err?.code, q).toBe('42501')
      expect(err?.message, q).toContain(`append-only table audit_logs: ${op} rejected`)
    }
  })

  it('server_time is set by the DB, a forged value is ignored', async () => {
    const r = await sqlAs(
      'app',
      "INSERT INTO audit_logs (server_time, event_id, doc_type, action) VALUES ('2000-01-01T00:00:00Z', 'forge', 'test', 'create') RETURNING server_time",
    )
    const t = new Date(r.rows[0].server_time).getTime()
    expect(Math.abs(t - Date.now())).toBeLessThan(60_000)
  })
})

describe('grants (least privilege)', () => {
  it('DELETE only on rewritten child tables + Payload internals (explicit allow-list)', async () => {
    const r = await sqlAs(
      'app',
      "SELECT table_name FROM information_schema.role_table_grants WHERE grantee = current_user AND privilege_type = 'DELETE' ORDER BY 1",
    )
    expect(r.rows.map((x) => x.table_name)).toEqual([
      'approval_rules_steps',
      'expense_categories_rels',
      // F2a: Payload rewrites these children on every parent update; locked content is protected
      // by the deferred freeze check (content_hash), not by withholding DELETE.
      'expense_requests_lines',
      'expense_requests_rels',
      'idempotency_keys', // purge of expired keys
      'payload_jobs',
      'payload_jobs_log',
      'payload_kv',
      'payload_locked_documents',
      'payload_locked_documents_rels',
      'payload_preferences',
      'payload_preferences_rels',
      'stage_templates_items',
      'sync_receipts', // F4: purge of expired sync results (30 days, ADR 0010)
      'users_roles',
    ])
  })

  it('app role has no TRUNCATE/REFERENCES/TRIGGER anywhere and cannot run DDL', async () => {
    const r = await sqlAs(
      'app',
      "SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = current_user AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')",
    )
    expect(r.rows[0].n).toBe(0)
    expect((await sqlError('app', 'CREATE TABLE pk_evil (id int)'))?.code).toBe('42501')
    expect((await sqlError('app', 'ALTER TABLE uoms DISABLE TRIGGER ALL'))?.code).toBe('42501')
    expect((await sqlError('app', "DELETE FROM uoms WHERE code = 'DBSEC'"))?.code).toBe('42501')
    expect((await sqlError('app', "INSERT INTO payload_migrations (name, batch) VALUES ('evil', 99)"))?.code).toBe('42501')
  })

  it('ro role can read but not write', async () => {
    const r = await sqlAs('ro', 'SELECT count(*)::int AS n FROM uoms')
    expect(r.rows[0].n).toBeGreaterThan(0)
    expect((await sqlError('ro', "INSERT INTO uoms (code, name) VALUES ('X', 'x')"))?.code).toBe('42501')
  })
})

describe('protected columns (OLD IS DISTINCT FROM NEW per column)', () => {
  it('users.keycloak_sub and any uuid are immutable once set; unchanged full-row UPDATE passes', async () => {
    const u = await makeUser(['pk-staff'])
    const err = await sqlError('app', `UPDATE users SET keycloak_sub = gen_random_uuid()::text WHERE id = ${u.id}`)
    expect(err?.message).toContain('column users.keycloak_sub is immutable')
    // Payload-style UPDATE writing every column with the same values must pass (spike c.2)
    expect(await sqlError('app', `UPDATE users SET keycloak_sub = keycloak_sub, email = email WHERE id = ${u.id}`)).toBeNull()
    const uuidErr = await sqlError('app', "UPDATE uoms SET uuid = gen_random_uuid()::text WHERE code = 'DBSEC'")
    expect(uuidErr?.message).toContain('column uoms.uuid is immutable')
  })

  it('document_sequence_counters: next_value only increases, no delete', async () => {
    await sqlAs('app', "INSERT INTO document_sequence_counters VALUES ('dbsec', 'ALL', 10)")
    expect((await sqlError('app', "UPDATE document_sequence_counters SET next_value = 9 WHERE doc_type = 'dbsec'"))?.message).toContain('may only increase')
    expect(await sqlError('app', "UPDATE document_sequence_counters SET next_value = 11 WHERE doc_type = 'dbsec'")).toBeNull()
    expect((await sqlError('app', "DELETE FROM document_sequence_counters WHERE doc_type = 'dbsec'"))?.code).toBe('42501')
  })
})
