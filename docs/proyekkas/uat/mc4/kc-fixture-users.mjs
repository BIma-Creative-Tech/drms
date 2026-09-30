// MC4 staging UAT — fixture helper for Keycloak realm drms-staging (fictional *.uji@proyekkas.test accounts only).
// Uses the service account proyekkas-admin-api (roles: manage-users/view-users only). Never prints secrets.
// Run from a throwaway container on the internal network drms-kc-admin-stg (Traefik alias auth.bimacreative.tech,
// router drms-kc-admin-stg, /opt/infra/docs/03-operations/keycloak.md §Paparan path):
//   docker run --rm --name pk-mc4uat-kc --memory 256m --network drms-kc-admin-stg \
//     -v "$SCRATCH:/work:ro" \
//     -v /opt/infra/identity/keycloak/secrets/drms-staging-proyekkas-admin-api.secret:/run/kc.secret:ro \
//     -v "$PWD/docs/proyekkas/uat/mc4:/scripts:ro" node:24.21.0-bookworm-slim node /scripts/kc-fixture-users.mjs list uji
// "ensure" reads the password from $SCRATCH/pw/<email> (file 600, outside git), sets it with temporary=false,
// clears required actions and maps the realm role pk-user. It never calls execute-actions-email.
// Usage: node kc-fixture-users.mjs list <search>
//        node kc-fixture-users.mjs ensure <email> <firstName> <lastName>   (password read from /work/pw/<email>)
import { readFileSync, existsSync } from 'node:fs'

const BASE = 'https://auth.bimacreative.tech'
const REALM = 'drms-staging'
const secret = readFileSync('/run/kc.secret', 'utf8').trim()

async function saToken() {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: 'proyekkas-admin-api', client_secret: secret })
  const r = await fetch(`${BASE}/realms/${REALM}/protocol/openid-connect/token`, { method: 'POST', body })
  if (!r.ok) throw new Error(`sa token ${r.status}`)
  return (await r.json()).access_token
}
const T = await saToken()
const H = { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' }
const A = `${BASE}/admin/realms/${REALM}`

async function j(method, path, body) {
  const r = await fetch(`${A}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text()
  return { status: r.status, body: t ? (() => { try { return JSON.parse(t) } catch { return t } })() : null, location: r.headers.get('location') }
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'list') {
  const r = await j('GET', `/users?search=${encodeURIComponent(args[0])}&max=100&briefRepresentation=true`)
  if (r.status !== 200) { console.log('list', r.status); process.exit(1) }
  for (const u of r.body) {
    const roles = await j('GET', `/users/${u.id}/role-mappings/realm`)
    const creds = await j('GET', `/users/${u.id}/credentials`)
    console.log(JSON.stringify({ id: u.id, username: u.username, email: u.email, enabled: u.enabled, requiredActions: u.requiredActions, realmRoles: (roles.body || []).map((x) => x.name), credTypes: (creds.body || []).map((c) => c.type) }))
  }
} else if (cmd === 'ensure') {
  const [email, firstName, lastName] = args
  const pwFile = `/work/pw/${email}`
  if (!existsSync(pwFile)) throw new Error('no pw file')
  const pw = readFileSync(pwFile, 'utf8').trim()
  let r = await j('GET', `/users?email=${encodeURIComponent(email)}&exact=true`)
  let id = r.body?.[0]?.id
  if (!id) {
    const c = await j('POST', '/users', { username: email, email, firstName, lastName, enabled: true, emailVerified: true, requiredActions: [] })
    if (c.status !== 201) { console.log('create', c.status, JSON.stringify(c.body)); process.exit(1) }
    id = c.location.split('/').pop()
    console.log('created', email, id)
  } else console.log('exists', email, id)
  const p = await j('PUT', `/users/${id}/reset-password`, { type: 'password', value: pw, temporary: false })
  // 400 on a re-run = same password rejected by the realm password history (already set)
  console.log('password', p.status)
  const u = await j('GET', `/users/${id}`)
  if ((u.body.requiredActions || []).length) { const q = await j('PUT', `/users/${id}`, { ...u.body, requiredActions: [] }); console.log('clear requiredActions', q.status) }
  let role = await j('GET', `/roles/pk-user`)
  if (role.status !== 200) { const av = await j('GET', `/users/${id}/role-mappings/realm/available`); console.log('roles/pk-user', role.status, 'available', av.status); role = { body: (av.body || []).find((x) => x.name === 'pk-user') } }
  if (!role.body) { console.log('pk-user role not visible'); process.exit(1) }
  const have = await j('GET', `/users/${id}/role-mappings/realm`)
  if (!(have.body || []).some((x) => x.name === 'pk-user')) {
    const m = await j('POST', `/users/${id}/role-mappings/realm`, [{ id: role.body.id, name: 'pk-user' }])
    console.log('pk-user', m.status)
  } else console.log('pk-user already')
} else {
  console.log('unknown cmd')
  process.exit(2)
}
