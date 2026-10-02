#!/usr/bin/env node
// MC4 UAT suite — FIXTURE (ADR 0016, US-MC-01…19; plan in ../mc4-uat-report.md §3). Runbook: README.md.
//
//   node fixture.mjs plan              dry run (default): logins + reads only, prints what apply would create
//   node fixture.mjs apply             commit: creates / re-activates the fixture, prints + saves the ids
//   node fixture.mjs cleanup           dry run of the cleanup
//   node fixture.mjs cleanup --commit  deactivates everything the fixture created (--keep-users: app accounts stay)
//
// Everything goes through the app (Payload REST with a real web session, /api/v1 with a password-grant
// token + registered device) as the fictional GROUP ADMIN admin.uji (owner step B-1). Exception, by the
// app's own rules: projects are Direktur-only (`Projects.ts` create = pk-owner) → the CS1 project is
// created (and archived on cleanup) with dir-cs1's session.
//
// It never modifies a record it did not create: every lookup is by the fixture's own natural keys inside
// PT CS1, memberships only of the 6 fictional accounts, and an existing PT with the same short code but
// another name aborts the run. App accounts are linked to the EXISTING Keycloak users by e-mail (the
// app's users-sync finds them; no e-mail is sent) — the preflight proves each account exists in Keycloak
// first (password grant), so the app never creates a Keycloak user.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ACCOUNTS, CFG, FICTIONAL_EMAIL, NAMES, accounts, brief, guard, saveState } from './lib.mjs'

const mode = process.argv[2] ?? 'plan'
const flags = new Set(process.argv.slice(3))
if (!['plan', 'apply', 'cleanup'].includes(mode)) {
  console.error('usage: fixture.mjs plan|apply|cleanup [--commit] [--keep-users]')
  process.exit(2)
}
guard()
const write = mode === 'apply' || (mode === 'cleanup' && flags.has('--commit'))
const A = accounts()
const REASON = 'UAT MC4 (fiktif, docs/proyekkas/uat/mc4)'
const summary = { mode, write, target: CFG.target, appUrl: CFG.appUrl, at: new Date().toISOString(), actions: [], ids: {} }
const act = (what, detail = '') => {
  summary.actions.push(`${what}${detail ? ` ${detail}` : ''}`)
  console.log(`${write ? '' : '[dry-run] '}${what}${detail ? ` ${detail}` : ''}`)
}
const die = (m) => {
  console.error(`FIXTURE STOPPED: ${m}`)
  process.exit(1)
}

const EMP = { staff: 'CS1-UJI-STAFF', pm: 'CS1-UJI-PM', andi: 'CS1-UJI-ANDI' }
const BANK_ACC = { staff: '9990002220001', andi: '9990002220002' }
const M = {
  project: { code: 'PRJ-CS1-UJI-01', name: 'Proyek Uji CS1' },
  costCenter: { code: 'CC-CS1-UJI', name: 'Operasional Uji CS1' },
  cash: { name: 'Kas Uji CS1' },
  category: { code: 'MAT', name: 'Material' },
}

const q = (o) => new URLSearchParams({ depth: '0', limit: '20', ...o }).toString()
async function find(acc, collection, w) {
  const r = await acc.rest('GET', `/api/${collection}?${q(w)}`)
  if (r.status !== 200) die(`read ${collection} as ${acc.key}: ${brief(r)}`)
  return r.body.docs
}
async function create(acc, collection, data, label) {
  if (!write) {
    act(`would create ${collection}`, label)
    return null
  }
  const r = await acc.rest('POST', `/api/${collection}?depth=0`, { json: data })
  if (r.status !== 201) die(`create ${collection} ${label} as ${acc.key}: ${brief(r)}`)
  act(`created ${collection}`, `${label} id=${r.body.doc.id}`)
  return r.body.doc
}
async function patch(acc, collection, id, data, label) {
  if (!write) {
    act(`would update ${collection}`, `${label} ${JSON.stringify(data)}`)
    return
  }
  const r = await acc.rest('PATCH', `/api/${collection}/${id}?depth=0`, { json: { ...data, changeReason: REASON } })
  if (r.status !== 200) die(`update ${collection} ${label} as ${acc.key}: ${brief(r)}`)
  act(`updated ${collection}`, `${label} id=${id} ${JSON.stringify(data)}`)
}
/** find-or-create by natural key; an inactive fixture row is re-activated (apply) */
async function ensure(acc, collection, w, data, label, { reactivate = { active: true } } = {}) {
  const hit = (await find(acc, collection, w))[0]
  if (hit) {
    const off = Object.entries(reactivate).some(([k, v]) => hit[k] !== v)
    if (off && mode === 'apply') await patch(acc, collection, hit.id, reactivate, label)
    else console.log(`exists ${collection} ${label} id=${hit.id}`)
    return hit
  }
  return create(acc, collection, data, label)
}

// ---------------------------------------------------------------- 0. preflight (MC4-01 + accounts exist)
const disabled = [] // accounts deactivated by an earlier `cleanup --commit` (the app disabled them in Keycloak)
for (const [k, email] of Object.entries(ACCOUNTS)) {
  if (!FICTIONAL_EMAIL.test(email)) die(`not a fictional account: ${k}`)
  let c
  try {
    c = await A[k].tokenGrant()
  } catch (e) {
    if (e.disabled && k !== 'admin' && mode !== 'plan') {
      disabled.push(k)
      continue
    }
    die(`${e.message} — Keycloak account missing, disabled or wrong password file`)
  }
  const roles = c.realmRoles ?? []
  const ok = roles.includes('pk-user') || (process.env.UAT_ALLOW_LEGACY_MARKER === '1' && roles.some((r) => /^pk-(staff|pm|finance|owner|admin)$/.test(r)))
  if (!ok) die(`MC4-01 not fixed: the token of ${k} carries realm roles ${JSON.stringify(roles)} (needs pk-user; UAT report §2 B-2)`)
}
console.log(`preflight: ${6 - disabled.length} Keycloak accounts log in (password grant), tokens carry pk-user (MC4-01 fixed)${disabled.length ? `; disabled by an earlier cleanup (re-activated below): ${disabled.join(', ')}` : ''}`)

// ---------------------------------------------------------------- 1. admin.uji = group admin (B-1)
const meR = await A.admin.v1('GET', '/me')
if (meR.status === 401) die('admin.uji has no (active) app account — owner step B-1: create it with "Admin grup (semua PT)"')
if (meR.status !== 200) die(`admin.uji /me: ${brief(meR)}`)
const me = meR.body
if (me.companies.some((c) => c.code === 'DRMS')) die('admin.uji is a member of DRMS — expected a fictional group admin without DRMS membership')
summary.ids.users = { admin: me.id }
// group admin ⇔ reads PT DRMS without being a member of it (Companies.ts read access)
const drms = (await find(A.admin, 'companies', { 'where[shortCode][equals]': 'DRMS' }))[0]
if (!drms) die('admin.uji is not a group admin (it cannot read PT DRMS) — owner step B-1: tick "Admin grup (semua PT)"')
summary.ids.companies = { DRMS: drms.id }

// ---------------------------------------------------------------- cleanup
if (mode === 'cleanup') {
  const cs1 = (await find(A.admin, 'companies', { 'where[shortCode][equals]': CFG.ptCode }))[0]
  if (!cs1) die(`PT ${CFG.ptCode} not found — nothing to clean up`)
  if (cs1.name !== CFG.ptName) die(`PT ${CFG.ptCode} is not the UAT fixture (name differs) — refusing`)
  const inCs1 = (w) => ({ 'where[company][equals]': cs1.id, ...w })
  // project first: archive needs Direktur CS1 (dir-cs1) while that membership is still active
  const proj = (await find(A.admin, 'projects', inCs1({ 'where[code][equals]': M.project.code })))[0]
  if (proj && proj.status !== 'arsip') await patch(A.dir, 'projects', proj.id, { status: 'arsip' }, M.project.code)
  for (const [col, w, label] of [
    ['cost-centers', { 'where[code][equals]': M.costCenter.code }, M.costCenter.code],
    ['cash-accounts', { 'where[name][equals]': M.cash.name }, M.cash.name],
    ['expense-categories', { 'where[code][equals]': M.category.code }, `${CFG.ptCode}/${M.category.code}`],
  ]) {
    const hit = (await find(A.admin, col, inCs1(w)))[0]
    if (hit && hit.active !== false) await patch(A.admin, col, hit.id, { active: false }, label)
  }
  for (const code of Object.values(EMP)) {
    const e = (await find(A.admin, 'employees', inCs1({ 'where[code][equals]': code })))[0]
    if (!e) continue
    for (const b of await find(A.admin, 'employee-bank-accounts', { 'where[employee][equals]': e.id })) if (b.active !== false) await patch(A.admin, 'employee-bank-accounts', b.id, { active: false }, `rekening ${code}`)
    if (e.active !== false) await patch(A.admin, 'employees', e.id, { active: false }, code)
  }
  // memberships of the 5 other accounts (CS1 + the DRMS rows of rina / andi), then their app accounts
  const users = {}
  for (const k of ['staff', 'pm', 'dir', 'rina', 'andi']) users[k] = (await find(A.admin, 'users', { 'where[email][equals]': ACCOUNTS[k] }))[0]
  const items = []
  for (const [k, u] of Object.entries(users)) {
    if (!u) continue
    for (const m of await find(A.admin, 'company-memberships', { 'where[user][equals]': u.id })) {
      if ((m.company === cs1.id || (m.company === drms.id && (k === 'rina' || k === 'andi'))) && m.active !== false) items.push({ user: u.id, company: m.company, roles: m.roles, active: false })
    }
  }
  if (items.length) {
    if (write) {
      const r = await A.admin.v1('POST', '/company-memberships/batch', { json: { reason: `${REASON}: selesai`, items } })
      if (r.status !== 200) die(`deactivate memberships: ${brief(r)}`)
    }
    act(`${write ? '' : 'would '}deactivate ${items.length} memberships`, items.map((i) => `${i.user}@${i.company}`).join(' '))
  }
  if (!flags.has('--keep-users')) {
    for (const [k, u] of Object.entries(users)) if (u && u.active !== false) await patch(A.admin, 'users', u.id, { active: false }, `${k} (Keycloak account is disabled by the app's users-sync)`)
  }
  if (cs1.active !== false) await patch(A.admin, 'companies', cs1.id, { active: false }, CFG.ptCode)
  console.log(`cleanup ${write ? 'done' : 'planned (add --commit)'}; admin.uji itself is left to the owner (untick "Admin grup", deactivate) — README §Cleanup`)
  writeFileSync(join(CFG.out, `fixture-cleanup${write ? '' : '-plan'}.json`), `${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}

// ---------------------------------------------------------------- 2. PT CS1 with "Salin default saat dibuat"
let cs1 = (await find(A.admin, 'companies', { 'where[shortCode][equals]': CFG.ptCode }))[0]
if (cs1 && cs1.name !== CFG.ptName) die(`a PT with short code ${CFG.ptCode} exists and is not the UAT fixture (name differs) — refusing to touch it`)
if (!cs1) {
  cs1 = await create(
    A.admin,
    'companies',
    { shortCode: CFG.ptCode, name: CFG.ptName, legalName: CFG.ptName, timezone: CFG.timezone, active: true, copyDefaults: true, copyDefaultsFrom: drms.id, pdfHeader: `${CFG.ptName}\nData uji fiktif — bukan dokumen resmi`, syncAttendanceEnabled: false },
    `${CFG.ptCode} "${CFG.ptName}" (copyDefaults from DRMS)`,
  )
} else if (cs1.active === false && mode === 'apply') await patch(A.admin, 'companies', cs1.id, { active: true }, CFG.ptCode)
else console.log(`exists companies ${CFG.ptCode} id=${cs1.id}`)
if (!cs1) {
  console.log('[dry-run] the remaining steps depend on PT CS1 and are listed only: admin.uji Admin CS1; app accounts for 5 fictional e-mails; employees CS1-UJI-{STAFF,PM,ANDI}; memberships staff/pm/dir CS1, rina Direktur DRMS + Finance CS1, andi Finance DRMS + Finance CS1; cost center, cash account, category, bank accounts, project (as dir-cs1), team assignments')
  writeFileSync(join(CFG.out, 'fixture-plan.json'), `${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}
summary.ids.companies.CS1 = cs1.id
const inCs1 = (w) => ({ 'where[company][equals]': cs1.id, ...w })

// ---------------------------------------------------------------- 3. admin.uji = Admin CS1 (needed to create accounts)
const adminM = (await find(A.admin, 'company-memberships', { 'where[user][equals]': me.id, 'where[company][equals]': cs1.id }))[0]
if (!adminM) await create(A.admin, 'company-memberships', { user: me.id, company: cs1.id, roles: ['pk-admin'], active: true }, 'admin.uji Admin CS1')
else if (adminM.active === false || !adminM.roles?.includes('pk-admin')) {
  if (write) {
    const r = await A.admin.v1('POST', '/company-memberships/batch', { json: { reason: REASON, items: [{ user: me.id, company: cs1.id, roles: ['pk-admin'], active: true }] } })
    if (r.status !== 200) die(`admin membership: ${brief(r)}`)
  }
  act('re-activate admin.uji Admin CS1')
}

// ---------------------------------------------------------------- 4. app accounts (linked by e-mail)
const U = { admin: me.id }
for (const k of ['staff', 'pm', 'dir', 'rina', 'andi']) {
  const u = await ensure(A.admin, 'users', { 'where[email][equals]': ACCOUNTS[k] }, { email: ACCOUNTS[k], name: NAMES[k], active: true }, ACCOUNTS[k])
  if (u?.groupAdmin === true) die(`${k} is a group admin — not the expected fictional account`)
  U[k] = u?.id ?? null
}
summary.ids.users = U
for (const k of disabled) {
  const c = await A[k].tokenGrant().catch((e) => die(`${e.message} — still disabled after re-activation`))
  if (!(c.realmRoles ?? []).includes('pk-user')) die(`MC4-01: ${k} token without pk-user`)
}

// ---------------------------------------------------------------- 5. employees CS1
const E = {}
for (const [k, code] of Object.entries(EMP)) E[k] = (await ensure(A.admin, 'employees', inCs1({ 'where[code][equals]': code }), { company: cs1.id, code, name: NAMES[k], active: true }, code))?.id ?? null
summary.ids.employees = E

// ---------------------------------------------------------------- 6. memberships (atomic batch, role matrix path)
const want = [
  { k: 'staff', company: cs1.id, roles: ['pk-staff'], employee: E.staff },
  { k: 'pm', company: cs1.id, roles: ['pk-pm'], employee: E.pm },
  { k: 'dir', company: cs1.id, roles: ['pk-owner'], employee: null },
  { k: 'rina', company: drms.id, roles: ['pk-owner'], employee: null },
  { k: 'rina', company: cs1.id, roles: ['pk-finance'], employee: null },
  { k: 'andi', company: drms.id, roles: ['pk-finance'], employee: null },
  { k: 'andi', company: cs1.id, roles: ['pk-finance'], employee: E.andi },
]
const items = []
for (const w of want) {
  if (!U[w.k]) {
    act('would create membership', `${w.k}@${w.company} ${w.roles}`)
    continue
  }
  const m = (await find(A.admin, 'company-memberships', { 'where[user][equals]': U[w.k], 'where[company][equals]': w.company }))[0]
  const same = m && m.active !== false && [...(m.roles ?? [])].sort().join() === w.roles.join() && (m.employee ?? null) === w.employee
  if (same) console.log(`exists membership ${w.k}@${w.company} ${w.roles}`)
  else items.push({ user: U[w.k], company: w.company, roles: w.roles, employee: w.employee, active: true })
}
if (items.length) {
  if (write) {
    const r = await A.admin.v1('POST', '/company-memberships/batch', { json: { reason: REASON, items } })
    if (r.status !== 200) die(`membership batch: ${brief(r)}`)
    summary.ids.memberships = r.body.items.map((i) => i.id)
  }
  act(`${write ? '' : 'would '}save ${items.length} memberships (batch)`, items.map((i) => `${i.user}@${i.company}:${i.roles}`).join(' '))
}

// ---------------------------------------------------------------- 7. CS1 masters
const bank = (await find(A.admin, 'banks', { 'where[code][equals]': 'MANDIRI' }))[0] ?? (await find(A.admin, 'banks', {}))[0]
const ids = {}
ids.costCenter = (await ensure(A.admin, 'cost-centers', inCs1({ 'where[code][equals]': M.costCenter.code }), { company: cs1.id, code: M.costCenter.code, name: M.costCenter.name, type: 'operational', manager: U.pm, active: true }, M.costCenter.code))?.id ?? null
ids.cashAccount = (await ensure(A.admin, 'cash-accounts', inCs1({ 'where[name][equals]': M.cash.name }), { company: cs1.id, name: M.cash.name, kind: 'bank', openingBalance: 25_000_000, active: true }, M.cash.name))?.id ?? null
ids.category = (await ensure(A.admin, 'expense-categories', inCs1({ 'where[code][equals]': M.category.code }), { company: cs1.id, code: M.category.code, name: M.category.name, active: true }, `${CFG.ptCode}/${M.category.code}`))?.id ?? null
ids.bankAccounts = {}
for (const k of ['staff', 'andi']) {
  if (!E[k]) continue
  ids.bankAccounts[k] = (await ensure(A.admin, 'employee-bank-accounts', { 'where[employee][equals]': E[k], 'where[accountNo][equals]': BANK_ACC[k] }, { employee: E[k], bank: bank.id, accountNo: BANK_ACC[k], accountHolder: NAMES[k], isDefault: true, verificationStatus: 'verified', active: true }, `rekening ${EMP[k]}`))?.id ?? null
}
// project: Direktur CS1 only (Projects.ts create = pk-owner)
ids.project = (await ensure(A.dir, 'projects', inCs1({ 'where[code][equals]': M.project.code }), { company: cs1.id, code: M.project.code, name: M.project.name, pm: U.pm, budget: 100_000_000, status: 'berjalan' }, `${M.project.code} (as dir-cs1)`, { reactivate: { status: 'berjalan' } }))?.id ?? null
if (ids.project) {
  for (const [k, role] of [['staff', 'staff'], ['andi', 'staff'], ['pm', 'pm']]) {
    if (E[k]) await ensure(A.admin, 'team-assignments', { 'where[employee][equals]': E[k], 'where[project][equals]': ids.project }, { company: cs1.id, employee: E[k], project: ids.project, roleInProject: role }, `${EMP[k]} → ${M.project.code} (${role})`, { reactivate: {} })
  }
  if (E.staff && ids.costCenter) await ensure(A.admin, 'team-assignments', { 'where[employee][equals]': E.staff, 'where[costCenter][equals]': ids.costCenter }, { company: cs1.id, employee: E.staff, costCenter: ids.costCenter, roleInProject: 'staff' }, `${EMP.staff} → ${M.costCenter.code}`, { reactivate: {} })
}
summary.ids.masters = ids

// ---------------------------------------------------------------- 8. copy-defaults evidence (US-MC-01)
const seqs = await find(A.admin, 'document-sequences', inCs1({ limit: '50' }))
const rules = await find(A.admin, 'approval-rules', inCs1({ limit: '50' }))
const schedules = await find(A.admin, 'work-schedules', inCs1({ limit: '50' }))
summary.copyDefaults = {
  sequences: seqs.length,
  sequencesStartAt: [...new Set(seqs.map((s) => s.startAt))],
  approvalRules: rules.length,
  ackRoles: [...new Set(rules.map((r) => r.acknowledgeRole))],
  workSchedules: schedules.length,
}
console.log(`copy defaults in ${CFG.ptCode}: ${JSON.stringify(summary.copyDefaults)}`)

saveState({ fixture: { at: summary.at, companies: summary.ids.companies, users: U, employees: E, masters: ids } })
writeFileSync(join(CFG.out, write ? 'fixture.json' : 'fixture-plan.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\nSUMMARY ${JSON.stringify(summary.ids)}`)
