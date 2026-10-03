#!/usr/bin/env node
// MC4 UAT suite — API cases (US-MC-01…19 + the owner's PT scope rule of 2026-10-02). Runbook: README.md.
//   node --test-reporter=spec api-suite.mjs        (env: see lib.mjs; needs `fixture.mjs apply` first)
// Output: $UAT_OUT/api-results.{md,json} — one row per case: PASS / FAIL / SKIP (+ reason, ids/status only).
//
// Accounts (fixture): staff = Staff CS1 · pm = PM CS1 · dir = Direktur CS1 · rina = Direktur DRMS + Finance CS1 ·
// andi = Finance DRMS + Finance CS1 · admin = group admin (+ Admin CS1). DRMS ids are DISCOVERED read-only
// through rina / andi (their DRMS roles); the CS1-only accounts then probe them.
// Writes: only in PT CS1 (fictional) — requests, receipts, a transfer, a CS1 period close + reopen. Probes that
// must be REJECTED and would touch DRMS on a defect use harmless values and undo themselves on failure.
// Optional (flags): UAT_DEACTIVATE_PT=1 → deactivated-PT media case (deactivates CS1, then re-activates it);
// UAT_DUP_FROM_DRMS=0 → skip the cross-PT duplicate-receipt case (it copies receiptNo/vendor/amount of ONE
// DRMS receipt into a fictional CS1 draft that is withdrawn + cancelled at the end; nothing is printed).
// UAT_DRMS_WRITER=<e-mail> (LOCAL target only) → also proves "DRMS continues" by submitting one DRMS request.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { Account, CFG, accounts, addDays, brief, guard, today, uuid } from './lib.mjs'

guard()
const A = accounts()
const RESULTS = []
const CTX = {} // ids discovered / created during the run (ids only)
class Skip extends Error {}
const skip = (m) => {
  throw new Skip(m)
}
const need = (v, what) => (v === undefined || v === null ? skip(`prerequisite missing: ${what}`) : v)
const st = (r, want, ctx = '') => {
  const list = Array.isArray(want) ? want : [want]
  assert.ok(list.includes(r.status), `${ctx} expected HTTP ${list.join('/')} got ${brief(r)}`)
  return r.body
}
const docs = (r) => st(r, 200).docs
const companyOf = (x) => x?.companyId ?? (typeof x?.company === 'object' && x.company ? x.company.id : x?.company)
const sig = (acc) => acc.upload('signatures')
const prevMonth = () => {
  const d = new Date(`${today()}T00:00:00Z`)
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - 1)
  return d.toISOString().slice(0, 7)
}

async function kase(t, id, us, title, fn) {
  const t0 = Date.now()
  let status = 'PASS'
  let note = ''
  try {
    const r = await fn()
    if (typeof r === 'string') note = r
  } catch (e) {
    if (e instanceof Skip) {
      status = 'SKIP'
      note = e.message
    } else {
      status = 'FAIL'
      note = String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 500)
    }
  }
  RESULTS.push({ id, us, title, status, note, ms: Date.now() - t0 })
  await t.test(`${id} [${us}] ${title}`, (tt) => {
    if (status === 'SKIP') tt.skip(note)
    else if (status === 'FAIL') assert.fail(note)
  })
}

after(() => {
  const n = (s) => RESULTS.filter((r) => r.status === s).length
  const head = `# MC4 UAT — API results\n\n- Target: \`${CFG.target}\` ${CFG.appUrl} (realm \`${CFG.realm}\`)\n- Run: ${new Date().toISOString()}\n- **PASS ${n('PASS')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')}** (of ${RESULTS.length})\n\n| ID | US | Case | Result | Note |\n|---|---|---|---|---|\n`
  const rows = RESULTS.map((r) => `| ${r.id} | ${r.us} | ${r.title.replace(/\|/g, '/')} | ${r.status} | ${r.note.replace(/\|/g, '/')} |`).join('\n')
  writeFileSync(join(CFG.out, 'api-results.md'), `${head}${rows}\n`)
  writeFileSync(join(CFG.out, 'api-results.json'), `${JSON.stringify({ target: CFG.target, appUrl: CFG.appUrl, at: new Date().toISOString(), counts: { pass: n('PASS'), fail: n('FAIL'), skip: n('SKIP') }, results: RESULTS, ids: CTX }, null, 2)}\n`)
  console.log(`\nMC4 UAT API: PASS ${n('PASS')} · FAIL ${n('FAIL')} · SKIP ${n('SKIP')} → ${join(CFG.out, 'api-results.md')}`)
})

// ================================================================================================
test('MC4 UAT API suite', { concurrency: false, timeout: 45 * 60_000 }, async (t) => {
  // ------------------------------------------------------------------ setup: who is who (ids only)
  const me = {}
  for (const k of Object.keys(A)) {
    const r = await A[k].v1('GET', '/me')
    assert.equal(r.status, 200, `setup /me ${k}: ${brief(r)} — run fixture.mjs apply first`)
    me[k] = r.body
  }
  const ptId = (code) => me.andi.companies.find((c) => c.code === code)?.id
  const CS1 = ptId(CFG.ptCode)
  const DRMS = ptId('DRMS')
  assert.ok(CS1 && DRMS, 'setup: andi must be mapped to DRMS and CS1 (fixture)')
  Object.assign(CTX, { CS1, DRMS })
  const cs1Of = (k) => me[k].companies.find((c) => c.id === CS1)
  const mastersCs1 = (await A.staff.v1('GET', `/masters?types=projects,expense-categories,bank-accounts,cost-centers`)).body.types
  CTX.cs1Project = mastersCs1.projects.items.find((p) => p.code === 'PRJ-CS1-UJI-01')?.id
  CTX.cs1Category = mastersCs1['expense-categories'].items.find((c) => c.code === 'MAT')?.id
  CTX.staffEmp = cs1Of('staff')?.employeeId
  CTX.staffBank = mastersCs1['bank-accounts'].items.find((b) => b.employee === CTX.staffEmp)?.id
  const andiMasters = (await A.andi.v1('GET', `/masters?types=bank-accounts,projects&company=${CS1}`)).body.types
  CTX.andiEmp = cs1Of('andi')?.employeeId
  CTX.andiBank = andiMasters['bank-accounts'].items.find((b) => b.employee === CTX.andiEmp)?.id
  const cs1Bal = (await A.andi.v1('GET', `/cash-accounts/balances?company=${CS1}`)).body.items
  CTX.cs1Cash = cs1Bal.find((a) => a.name === 'Kas Uji CS1')?.cashAccountId

  // ------------------------------------------------------------------ discovery of DRMS ids (read-only, via rina / andi)
  const D = {}
  {
    const reqs = []
    let cursor = null
    for (let page = 0; page < 6; page++) {
      const r = await A.rina.v1('GET', `/expense-requests?company=${DRMS}&limit=100${cursor ? `&cursor=${cursor}` : ''}`)
      if (r.status !== 200) break
      reqs.push(...r.body.items)
      cursor = r.body.nextCursor
      if (!cursor) break
    }
    D.requests = reqs.length
    const numbered = reqs.filter((x) => x.docNo)
    D.req = numbered[0]?.id ?? reqs[0]?.id
    D.maxDocNo = numbered.map((x) => Number(String(x.docNo).split('/')[0])).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0) || null
    D.docToken = numbered[0] ? String(numbered[0].docNo).split('/')[1] : null
    // a request with a receipt image + one with a transfer proof + a signature
    for (const x of numbered.slice(0, 40)) {
      if (D.receiptMedia && D.proofMedia && D.signature && D.dupSource) break
      const d = (await A.rina.v1('GET', `/expense-requests/${x.id}`)).body
      const rc = (d.receipts ?? []).find((y) => y.imageId)
      if (rc && !D.receiptMedia) Object.assign(D, { receiptMedia: rc.imageId, receiptReq: x.id })
      const live = !['draft', 'rejected', 'cancelled', 'withdrawn', 'void', 'closed'].includes(d.status)
      const dup = (d.receipts ?? []).find((y) => y.receiptNo && ['pending', 'valid'].includes(y.status))
      if (dup && live && !D.dupSource) D.dupSource = { request: x.id, receiptNo: dup.receiptNo, vendorName: dup.vendorName, amount: dup.amount }
      const tr = (d.transfers ?? []).find((y) => y.proofId)
      if (tr && !D.proofMedia) D.proofMedia = tr.proofId
      const sg = (d.approvals ?? []).find((y) => y.signatureId)
      if (sg && !D.signature) D.signature = sg.signatureId
    }
    D.pendingAck = reqs.filter((x) => x.status === 'pending_ack').length
    const pr = await A.rina.v1('GET', `/progress-reports?company=${DRMS}&limit=20`)
    const prItem = pr.status === 200 ? pr.body.items[0] : undefined
    Object.assign(D, { progress: prItem?.id, progressPhoto: prItem?.photos?.[0]?.id })
    const ad = await A.rina.v1('GET', `/budget-addenda?company=${DRMS}&limit=20`)
    D.addendum = ad.status === 200 ? ad.body.items[0]?.id : undefined
    const ce = await A.andi.v1('GET', `/cash-entries?company=${DRMS}&limit=20`)
    D.cashEntry = ce.status === 200 ? ce.body.items[0]?.id : undefined
    const ms = (await A.rina.v1('GET', `/masters?types=projects,cost-centers,employees,expense-categories&company=${DRMS}`)).body.types
    D.project = ms.projects.items[0]?.id
    D.costCenter = ms['cost-centers'].items[0]?.id
    D.employee = ms.employees.items[0]?.id
    D.category = ms['expense-categories'].items[0]?.id
    const bal = await A.andi.v1('GET', `/cash-accounts/balances?company=${DRMS}`)
    D.cashAccount = bal.body.items?.[0]?.cashAccountId
    const att = await A.rina.rest('GET', `/api/attendances?depth=0&limit=10&where[company][equals]=${DRMS}&where[selfie][exists]=true`)
    const a0 = att.status === 200 ? att.body.docs[0] : undefined
    Object.assign(D, { attendance: a0?.id, selfie: a0?.selfie })
    const co = await A.rina.rest('GET', `/api/companies/${DRMS}?depth=0`)
    D.logo = co.body?.logo ?? undefined
    CTX.drms = { ...D, dupSource: D.dupSource ? { request: D.dupSource.request } : undefined }
  }
  const cs1Only = ['staff', 'pm', 'dir']

  // ================================================================== US-MC-01 company + copy defaults
  await kase(t, 'CO-01', 'US-MC-01', 'PT CS1 exists with the copied defaults (7 sequences from 1, approval rule Direktur → Finance)', async () => {
    const seq = docs(await A.admin.rest('GET', `/api/document-sequences?depth=0&limit=50&where[company][equals]=${CS1}`))
    assert.ok(seq.length >= 7, `sequences ${seq.length}`)
    assert.ok(seq.every((s) => s.startAt === 1), 'startAt 1')
    const rules = docs(await A.admin.rest('GET', `/api/approval-rules?depth=0&limit=50&where[company][equals]=${CS1}`))
    assert.ok(rules.some((r) => r.acknowledgeRole === 'pk-owner' && (r.steps ?? []).some((s) => s.approverRole === 'pk-finance')), 'rule Direktur → Finance')
    return `${seq.length} sequences, ${rules.length} rules`
  })
  await kase(t, 'CO-02', 'US-MC-01', 'a PT Direktur (not group admin) cannot create a PT → 403', async () => {
    const r = await A.dir.rest('POST', '/api/companies?depth=0', { json: { shortCode: 'UJIX', name: 'PT Uji Tolak', timezone: CFG.timezone } })
    if (r.status === 201) await A.admin.rest('PATCH', `/api/companies/${r.body.doc.id}`, { json: { active: false, changeReason: 'UAT MC4: hasil uji negatif' } })
    st(r, 403)
  })
  await kase(t, 'CO-03', 'US-MC-01', 'CS1-only user reads only PT CS1 in /api/companies', async () => {
    const list = docs(await A.dir.rest('GET', '/api/companies?depth=0&limit=50'))
    assert.deepEqual(list.map((c) => c.id), [CS1])
  })

  // ================================================================== US-MC-05 /me companies[]
  await kase(t, 'ME-01', 'US-MC-05', '/me companies[] = exactly the mapped PTs with the per-PT roles', async () => {
    const want = {
      staff: { [CS1]: ['pk-staff'] },
      pm: { [CS1]: ['pk-pm'] },
      dir: { [CS1]: ['pk-owner'] },
      rina: { [DRMS]: ['pk-owner'], [CS1]: ['pk-finance'] },
      andi: { [DRMS]: ['pk-finance'], [CS1]: ['pk-finance'] },
      admin: { [CS1]: ['pk-admin'] },
    }
    for (const [k, w] of Object.entries(want)) {
      const got = Object.fromEntries(me[k].companies.map((c) => [c.id, [...c.roles].sort()]))
      assert.deepEqual(got, w, `${k}`)
    }
  })
  await kase(t, 'ME-02', 'US-MC-05', '/me capabilities per PT (approval inbox for Direktur/Finance only) + employee per PT', async () => {
    assert.equal(cs1Of('staff').capabilities.approvalInbox, false)
    assert.equal(cs1Of('dir').capabilities.approvalInbox, true)
    assert.ok(me.rina.companies.every((c) => c.capabilities.approvalInbox === true))
    assert.ok(CTX.staffEmp && CTX.andiEmp, 'employees of staff / andi in CS1')
    assert.equal(me.andi.companies.find((c) => c.id === DRMS).employeeId ?? null, null)
  })
  await kase(t, 'ME-03', 'US-MC-05', 'X-Company-Ids narrows the selection (andi: CS1 only → activeCompanyIds [CS1])', async () => {
    const r = st(await A.andi.v1('GET', '/me', { headers: { 'X-Company-Ids': String(CS1) } }), 200)
    assert.deepEqual(r.activeCompanyIds, [CS1])
  })

  // ================================================================== US-MC-04/05/14 spoofing
  for (const [id, hv] of [['SPF-01', () => String(DRMS)], ['SPF-02', () => `${CS1},${DRMS}`], ['SPF-03', () => 'abc']]) {
    await kase(t, id, 'US-MC-05', `X-Company-Ids "${id === 'SPF-03' ? 'abc' : id === 'SPF-02' ? 'CS1,DRMS' : 'DRMS'}" from a CS1-only user → 403 COMPANY_NOT_ALLOWED`, async () => {
      for (const k of cs1Only) {
        const r = await A[k].v1('GET', '/expense-requests?limit=5', { headers: { 'X-Company-Ids': hv() } })
        st(r, 403, k)
        assert.equal(r.body.code, 'COMPANY_NOT_ALLOWED', k)
      }
    })
  }
  await kase(t, 'SPF-04', 'US-MC-06', '?company=<DRMS> on list/queue routes from a CS1-only user → 403 COMPANY_NOT_ALLOWED', async () => {
    for (const p of [`/expense-requests?company=${DRMS}`, `/approvals/inbox?company=${DRMS}`, `/progress-reports?company=${DRMS}`, `/budget-addenda?company=${DRMS}`]) {
      const r = await A.dir.v1('GET', p)
      st(r, 403, p)
      assert.equal(r.body.code, 'COMPANY_NOT_ALLOWED', p)
    }
  })
  await kase(t, 'SPF-05', 'US-MC-04', `cookie ${CFG.companyCookie}=<DRMS> on a CS1-only web session → ignored (falls back to own PT, no DRMS row)`, async () => {
    const cookie = { [CFG.companyCookie]: String(DRMS) }
    const meC = st(await A.dir.rest('GET', '/api/v1/me', { extraCookies: cookie }), 200)
    assert.deepEqual(meC.activeCompanyIds, [CS1])
    const list = docs(await A.dir.rest('GET', '/api/expense-requests?depth=0&limit=100', { extraCookies: cookie }))
    assert.ok(list.every((d) => companyOf(d) === CS1), 'only CS1 rows')
    const proj = docs(await A.dir.rest('GET', '/api/projects?depth=0&limit=100', { extraCookies: cookie }))
    assert.ok(proj.every((d) => companyOf(d) === CS1))
  })
  await kase(t, 'SPF-06', 'US-MC-04', 'PT switcher POST /api/v1/me/companies with a foreign PT → 403; own PT → 200', async () => {
    st(await A.dir.rest('POST', '/api/v1/me/companies', { json: { companyIds: [DRMS] } }), 403)
    st(await A.dir.rest('POST', '/api/v1/me/companies', { json: { companyIds: [CS1] } }), 200)
    st(await A.dir.rest('POST', '/api/v1/me/companies', { json: { companyIds: null } }), 200)
  })
  await kase(t, 'SPF-07', 'US-MC-14', 'the rejected header is audited (access_denied, read by the group admin)', async () => {
    const r = await A.admin.rest('GET', `/api/audit-logs?depth=0&limit=5&sort=-id&where[action][equals]=access_denied&where[userId][equals]=${me.staff.id}`)
    const list = docs(r)
    assert.ok(list.length >= 1, 'access_denied row for staff-cs1')
  })

  // ================================================================== US-MC-14 isolation sweep
  const iso = (id, title, kind, paths) =>
    kase(t, id, 'US-MC-14', title, async () => {
      const ps = paths().filter(([, v]) => v !== undefined && v !== null)
      if (!ps.length) skip(`no DRMS ${kind} visible to rina/andi on this target`)
      for (const k of cs1Only) {
        for (const [p, , ok] of ps) {
          const r = p.startsWith('/api/v1/') ? await A[k].v1('GET', p.slice(7), { raw: true }) : await A[k].rest('GET', p, { raw: true })
          assert.ok((ok ?? [404]).includes(r.status), `${k} GET ${p.replace(/\d+/g, '#')} → ${r.status}`)
        }
      }
      return `${ps.length} paths × ${cs1Only.length} users`
    })
  await iso('ISO-01', 'DRMS expense request: /api/v1 detail, history, PDF (both variants) → 404', 'request', () => [
    [`/api/v1/expense-requests/${D.req}`, D.req],
    [`/api/v1/expense-requests/${D.req}/history`, D.req],
    [`/api/v1/expense-requests/${D.req}/pdf`, D.req],
    [`/api/v1/expense-requests/${D.req}/pdf?variant=internal`, D.req, [403, 404]],
  ])
  await iso('ISO-02', 'DRMS media files + signed URLs (receipt, transfer proof, signature, progress photo, selfie, logo) → 404', 'media', () => [
    [`/api/v1/media/receipts/${D.receiptMedia}/file`, D.receiptMedia],
    [`/api/v1/media/receipts/${D.receiptMedia}/file?variant=thumb`, D.receiptMedia],
    [`/api/v1/media/receipts/${D.receiptMedia}/signed-url`, D.receiptMedia],
    [`/api/v1/media/transfer-proofs/${D.proofMedia}/file`, D.proofMedia],
    [`/api/v1/media/signatures/${D.signature}/file`, D.signature],
    [`/api/v1/media/progress-photos/${D.progressPhoto}/file`, D.progressPhoto],
    [`/api/v1/media/selfies/${D.selfie}/file`, D.selfie],
    [`/api/v1/attendance/${D.attendance}/selfie`, D.attendance, [403, 404]],
    [`/api/v1/media/company/${D.logo}/file`, D.logo],
  ])
  await iso('ISO-03', 'DRMS progress report, budget addendum, project stages over /api/v1 → 404', 'progress/addendum', () => [
    [`/api/v1/progress-reports/${D.progress}`, D.progress],
    [`/api/v1/budget-addenda/${D.addendum}`, D.addendum],
    [`/api/v1/projects/${D.project}/stages`, D.project, [403, 404]],
  ])
  await iso('ISO-04', 'DRMS documents over Payload REST /api/<slug>/:id → 404/403', 'REST ids', () => [
    [`/api/expense-requests/${D.req}?depth=0`, D.req, [403, 404]],
    [`/api/projects/${D.project}?depth=0`, D.project, [403, 404]],
    [`/api/cost-centers/${D.costCenter}?depth=0`, D.costCenter, [403, 404]],
    [`/api/employees/${D.employee}?depth=0`, D.employee, [403, 404]],
    [`/api/expense-categories/${D.category}?depth=0`, D.category, [403, 404]],
    [`/api/cash-accounts/${D.cashAccount}?depth=0`, D.cashAccount, [403, 404]],
    [`/api/cash-entries/${D.cashEntry}?depth=0`, D.cashEntry, [403, 404]],
    [`/api/progress-reports/${D.progress}?depth=0`, D.progress, [403, 404]],
    [`/api/budget-addenda/${D.addendum}?depth=0`, D.addendum, [403, 404]],
    [`/api/attendances/${D.attendance}?depth=0`, D.attendance, [403, 404]],
    [`/api/media-receipts/${D.receiptMedia}?depth=0`, D.receiptMedia, [403, 404]],
    [`/api/companies/${DRMS}?depth=0`, DRMS, [403, 404]],
  ])
  await kase(t, 'ISO-05', 'US-MC-14', 'CS1-only REST lists hold CS1 rows only (requests, projects, employees, cash accounts, attendances, audit, media)', async () => {
    for (const k of cs1Only) {
      for (const slug of ['expense-requests', 'projects', 'employees', 'cash-accounts', 'cost-centers', 'expense-categories', 'attendances', 'budget-addenda', 'progress-reports']) {
        const r = await A[k].rest('GET', `/api/${slug}?depth=0&limit=200`)
        if (r.status === 403) continue // collection not readable for this role at all
        assert.ok(docs(r).every((d) => companyOf(d) === CS1), `${k} ${slug}`)
      }
      if (D.receiptMedia) {
        const r = await A[k].rest('GET', '/api/media-receipts?depth=0&limit=500')
        if (r.status === 200) assert.ok(!r.body.docs.some((d) => d.id === D.receiptMedia), `${k} media-receipts list`)
      }
    }
  })
  await kase(t, 'ISO-06', 'US-MC-14', 'CS1-only /api/v1 lists + masters hold CS1 (or shared) rows only', async () => {
    for (const k of cs1Only) {
      const reqs = st(await A[k].v1('GET', '/expense-requests?limit=100'), 200).items
      assert.ok(reqs.every((x) => x.companyId === CS1), `${k} requests`)
      const ms = st(await A[k].v1('GET', '/masters'), 200)
      for (const [type, v] of Object.entries(ms.types)) assert.ok(v.items.every((i) => i.shared === true || i.company === CS1), `${k} masters ${type}`)
      const notif = st(await A[k].v1('GET', '/notifications?limit=100'), 200).items
      assert.ok(notif.every((n) => n.companyId === null || n.companyId === CS1), `${k} notifications`)
      for (const p of ['/progress-reports?limit=50', '/budget-addenda?limit=50']) {
        const r = await A[k].v1('GET', p)
        if (r.status === 200) assert.ok(r.body.items.every((x) => x.companyId === CS1), `${k} ${p}`)
      }
    }
  })
  await kase(t, 'ISO-07', 'US-MC-14', 'reports + exports of a CS1-only Direktur carry no DRMS document number', async () => {
    const tok = need(D.docToken, 'a numbered DRMS document')
    for (const code of ['rekap-pengajuan', 'rekap-kas', 'audit-log']) {
      const j = await A.dir.v1('GET', `/reports/${code}`)
      st(j, 200, code)
      assert.ok(!JSON.stringify(j.body).includes(`/${tok}/`), `${code} json`)
      const csv = await A.dir.v1('GET', `/reports/${code}/csv`, { raw: true })
      assert.equal(csv.status, 200, `${code} csv`)
      assert.ok(!csv.bytes.toString('utf8').includes(`/${tok}/`), `${code} csv`)
    }
    const pdf = await A.dir.v1('GET', '/reports/rekap-kas/pdf', { raw: true })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF')
  })

  // ================================================================== US-MC-07 body company + cross-PT references
  await kase(t, 'BDY-01', 'US-MC-07', 'create with body company=<DRMS> by a CS1-only user → 403 COMPANY_NOT_ALLOWED (nothing created)', async () => {
    const r = await A.staff.v1('POST', '/expense-requests', { json: { type: 'reimburse', company: DRMS, title: 'UJI tolak', requesterIds: [need(CTX.staffEmp, 'staff employee')], neededDate: addDays(today(), 7), lines: [{ description: 'x', total: 1000, categoryId: CTX.cs1Category }] } })
    st(r, 403)
    assert.equal(r.body.code, 'COMPANY_NOT_ALLOWED')
  })
  await kase(t, 'BDY-02', 'US-MC-07', 'body company=CS1 with a DRMS project (2-PT user) → 400 COMPANY_MISMATCH', async () => {
    const r = await A.andi.v1('POST', '/expense-requests', { json: { type: 'reimburse', company: CS1, title: 'UJI tolak', projectId: need(D.project, 'DRMS project'), requesterIds: [CTX.andiEmp], neededDate: addDays(today(), 7), lines: [{ description: 'x', total: 1000, categoryId: CTX.cs1Category }] } })
    st(r, 400)
    assert.equal(r.body.code, 'COMPANY_MISMATCH')
  })
  await kase(t, 'BDY-03', 'US-MC-07', 'cash entry body company=CS1 with a DRMS cash account → 400 COMPANY_MISMATCH', async () => {
    const r = await A.andi.v1('POST', '/cash-entries', { json: { direction: 'out', company: CS1, cashAccountId: need(D.cashAccount, 'DRMS cash account'), amount: 1000, description: 'UJI tolak' } })
    st(r, 400)
    assert.equal(r.body.code, 'COMPANY_MISMATCH')
  })
  await kase(t, 'BDY-04', 'US-MC-07', 'body company=CS1 is honoured even with X-Company-Ids=<DRMS> (2-PT user) → 201 in CS1', async () => {
    const r = await A.andi.v1('POST', '/expense-requests', {
      headers: { 'X-Company-Ids': String(DRMS) },
      json: { type: 'reimburse', company: CS1, title: 'UJI MC4 nama PT di body', projectId: need(CTX.cs1Project, 'CS1 project'), requesterIds: [need(CTX.andiEmp, 'andi employee')], bankAccountId: CTX.andiBank, neededDate: addDays(today(), 7), lines: [{ description: 'Material uji', total: 50_000, categoryId: CTX.cs1Category }] },
    })
    const b = st(r, 201)
    assert.equal(b.companyId, CS1)
    CTX.bodyDraft = b.id
  })
  await kase(t, 'BDY-05', 'US-MC-03', 'membership with an employee of another PT → rejected (same-PT employee rule), nothing changed', async () => {
    const r = await A.admin.v1('POST', '/company-memberships/batch', { json: { reason: 'UAT MC4 uji negatif', items: [{ user: me.andi.id, company: DRMS, roles: ['pk-finance'], employee: need(CTX.andiEmp, 'andi CS1 employee') }] } })
    if (r.status === 200) await A.admin.v1('POST', '/company-memberships/batch', { json: { reason: 'UAT MC4 pulihkan', items: [{ user: me.andi.id, company: DRMS, roles: ['pk-finance'], employee: null }] } })
    st(r, [400, 403, 409])
  })

  // ================================================================== US-MC-08/06/07/12 the CS1 flow
  const cs1Draft = async (acc, emp, bank, title, amount, receipt) => {
    const d = st(await acc.v1('POST', '/expense-requests', { json: { type: 'reimburse', title, projectId: need(CTX.cs1Project, 'CS1 project'), requesterIds: [emp], bankAccountId: bank, neededDate: addDays(today(), 7), lines: [{ description: 'Material uji', total: amount, categoryId: CTX.cs1Category }] } }), 201)
    if (receipt) {
      const img = await acc.upload('receipts')
      const r = st(await acc.v1('POST', `/expense-requests/${d.id}/receipts`, { json: { lineId: d.lines[0].id, receiptNo: receipt.receiptNo, vendorName: receipt.vendorName, receiptDate: addDays(today(), -1), amount, imageId: img } }), 201)
      return r
    }
    return d
  }
  await kase(t, 'FLW-01', 'US-MC-08', 'Staff CS1 submits a request → pending_ack, number n/PB-CS1/…', async () => {
    const d = await cs1Draft(A.staff, need(CTX.staffEmp, 'staff employee'), CTX.staffBank, 'UJI MC4 alur CS1', 250_000, { receiptNo: `UJI-${uuid().slice(0, 8)}`, vendorName: 'Toko Uji CS1' })
    CTX.req = d.id
    CTX.reqReceipt = d.receipts[0].id
    CTX.reqReceiptMedia = d.receipts[0].imageId
    const s = st(await A.staff.v1('POST', `/expense-requests/${d.id}/submit`, { json: { signatureMediaId: await sig(A.staff) } }), 200)
    assert.equal(s.status, 'pending_ack')
    assert.match(s.docNo, new RegExp(`^\\d+/PB-${CFG.ptCode}/`))
    CTX.reqDocNo = s.docNo
    return s.docNo
  })
  await kase(t, 'NUM-01', 'US-MC-08', 'per-PT numbering: the first PB of CS1 is 1, independent of the DRMS counter', async () => {
    const all = []
    let cursor = null
    do {
      const r = st(await A.dir.v1('GET', `/expense-requests?limit=100${cursor ? `&cursor=${cursor}` : ''}`), 200)
      all.push(...r.items)
      cursor = r.nextCursor
    } while (cursor)
    const pb = all.filter((x) => x.docNo && x.docNo.includes(`/PB-${CFG.ptCode}/`)).sort((a, b) => a.id - b.id)
    assert.ok(pb.length >= 1)
    assert.ok(pb[0].docNo.startsWith('1/'), `first CS1 number ${pb[0].docNo.split('/')[0]}`)
    assert.ok(all.every((x) => !x.docNo || x.docNo.includes(`-${CFG.ptCode}/`)), 'every CS1 number carries the CS1 token')
    const max = need(D.maxDocNo, 'a numbered DRMS request')
    return `CS1 first = 1; DRMS latest number ${max} (token ${D.docToken})`
  })
  await kase(t, 'FLW-02', 'US-MC-06', 'inbox: Direktur CS1 sees it at "Diketahui" (PT chip CS1); rina / andi do not', async () => {
    const id = need(CTX.req, 'CS1 request')
    const dirItem = st(await A.dir.v1('GET', '/approvals/inbox'), 200).items.find((i) => i.id === id)
    assert.ok(dirItem, 'in dir inbox')
    assert.equal(dirItem.step, 'acknowledge')
    assert.equal(dirItem.company.shortCode, CFG.ptCode)
    for (const k of ['rina', 'andi']) assert.ok(!st(await A[k].v1('GET', '/approvals/inbox'), 200).items.some((i) => i.id === id), k)
  })
  await kase(t, 'MUT-01', 'US-MC-07', 'rina (Direktur only in DRMS) acknowledges a CS1 request → 403, status unchanged', async () => {
    const id = need(CTX.req, 'CS1 request')
    const r = await A.rina.v1('POST', `/expense-requests/${id}/acknowledge`, { json: { signatureMediaId: await sig(A.rina) } })
    st(r, [403, 404, 409])
    assert.equal(st(await A.staff.v1('GET', `/expense-requests/${id}`), 200).status, 'pending_ack')
  })
  await kase(t, 'FLW-03', 'US-MC-12', 'Direktur CS1 acknowledges → pending_approval', async () => {
    const id = need(CTX.req, 'CS1 request')
    const d = st(await A.dir.v1('POST', `/expense-requests/${id}/acknowledge`, { json: { signatureMediaId: await sig(A.dir) } }), 200)
    assert.equal(d.status, 'pending_approval')
  })
  await kase(t, 'FLW-04', 'US-MC-06', 'inbox: rina + andi see it at "Approval" (Finance CS1); Direktur CS1 no longer', async () => {
    const id = need(CTX.req, 'CS1 request')
    for (const k of ['rina', 'andi']) {
      const it = st(await A[k].v1('GET', '/approvals/inbox'), 200).items.find((i) => i.id === id)
      assert.ok(it, `${k} inbox`)
      assert.equal(it.step, 'approve', k)
    }
    assert.ok(!st(await A.dir.v1('GET', '/approvals/inbox'), 200).items.some((i) => i.id === id))
  })
  await kase(t, 'FLW-05', 'US-MC-06', 'Rina rule: every CS1 item at "Approval", every DRMS item at "Diketahui" — never the other way', async () => {
    const items = st(await A.rina.v1('GET', '/approvals/inbox'), 200).items
    for (const i of items) {
      if (i.company.id === CS1) assert.equal(i.step, 'approve', `CS1 item step`)
      else if (i.company.id === DRMS) assert.equal(i.step, 'acknowledge', `DRMS item step`)
      else assert.fail(`foreign PT ${i.company.id} in rina's inbox`)
    }
    const nD = items.filter((i) => i.company.id === DRMS).length
    if (nD === 0) return D.pendingAck ? `NOTE: ${D.pendingAck} DRMS request(s) in pending_ack but none in rina's inbox — check their rule's acknowledger (user / scope manager) by hand` : 'no DRMS request waits for "Diketahui" on this target (DRMS side not observable)'
    return `${items.length} items: ${nD} DRMS at Diketahui, ${items.length - nD} CS1 at Approval`
  })
  await kase(t, 'MUT-02', 'US-MC-07', 'Direktur CS1 cannot approve (Finance step) → 403', async () => {
    const id = need(CTX.req, 'CS1 request')
    st(await A.dir.v1('POST', `/expense-requests/${id}/approve`, { json: { signatureMediaId: await sig(A.dir) } }), [403, 409])
  })
  await kase(t, 'FLW-06', 'US-MC-06', 'rina (Finance CS1) approves → approved', async () => {
    const id = need(CTX.req, 'CS1 request')
    const d = st(await A.rina.v1('POST', `/expense-requests/${id}/approve`, { json: { signatureMediaId: await sig(A.rina) } }), 200)
    assert.equal(d.status, 'approved')
  })
  await kase(t, 'FLW-07', 'US-MC-12', 'notifications of the flow are tagged CS1 (Direktur CS1 got the "Diketahui" one)', async () => {
    const id = need(CTX.req, 'CS1 request')
    const n = st(await A.dir.v1('GET', '/notifications?limit=100'), 200).items.filter((x) => String(x.docId) === String(id))
    assert.ok(n.length >= 1, 'dir-cs1 notification for the request')
    assert.ok(n.every((x) => x.companyId === CS1))
  })
  await kase(t, 'MUT-03', 'US-MC-07', 'transfer from a DRMS cash account on a CS1 request → 400 (account of another PT), nothing posted', async () => {
    const id = need(CTX.req, 'CS1 request')
    for (const rc of [CTX.reqReceipt]) await A.andi.v1('POST', `/expense-requests/${id}/receipts/${rc}/verify`, { json: {} })
    const v = st(await A.andi.v1('POST', `/expense-requests/${id}/verify-receipts`, { json: {} }), 200)
    assert.equal(v.status, 'receipts_verified')
    const proof = await A.andi.upload('transfer-proofs')
    const r = await A.andi.v1('POST', `/expense-requests/${id}/transfer`, { json: { cashAccountId: need(D.cashAccount, 'DRMS cash account'), bankRef: `UJI-X-${id}`, proofMediaId: proof } })
    st(r, [400, 403, 404, 409])
    assert.ok(!JSON.stringify(r.body).includes('tutup buku'), 'no DRMS lock-date oracle')
    CTX.proof = proof
  })
  await kase(t, 'FLW-08', 'US-MC-07', 'andi (Finance CS1) transfers from the CS1 cash account → transferred, CS1 cash entry', async () => {
    const id = need(CTX.req, 'CS1 request')
    const r = st(await A.andi.v1('POST', `/expense-requests/${id}/transfer`, { json: { cashAccountId: need(CTX.cs1Cash, 'CS1 cash account'), bankRef: `UJI-TRF-${id}`, proofMediaId: need(CTX.proof, 'proof') } }), 201)
    assert.equal(r.request.status, 'transferred')
    CTX.cashEntry = r.cashEntryId
    return `${r.transferDocNo} / ${r.cashEntryNo}`
  })
  await kase(t, 'FLW-09', 'US-MC-11', 'request PDF: Direktur CS1 200 (CS1 letterhead), internal variant for Finance CS1', async () => {
    const id = need(CTX.req, 'CS1 request')
    const a = await A.dir.v1('GET', `/expense-requests/${id}/pdf`, { raw: true })
    assert.equal(a.status, 200)
    assert.equal(a.bytes.subarray(0, 4).toString(), '%PDF')
    const b = await A.rina.v1('GET', `/expense-requests/${id}/pdf?variant=internal`, { raw: true })
    assert.equal(b.status, 200)
  })

  // ================================================================== US-MC-06 queues
  await kase(t, 'INB-01', 'US-MC-06', 'queues carry a PT chip; andi sees DRMS + CS1 only; ?company= narrows', async () => {
    for (const p of ['/approvals/inbox', '/transfer-queue', '/lpj-queue']) {
      const items = st(await A.andi.v1('GET', p), 200).items
      assert.ok(items.every((i) => [DRMS, CS1].includes(companyOf(i))), p)
      const narrowed = st(await A.andi.v1('GET', `${p}?company=${CS1}`), 200).items
      assert.ok(narrowed.every((i) => companyOf(i) === CS1), `${p}?company=CS1`)
    }
  })
  await kase(t, 'INB-02', 'US-MC-06', 'Finance queues are role-gated (Staff CS1 → 403)', async () => {
    st(await A.staff.v1('GET', '/transfer-queue'), 403)
    st(await A.pm.v1('GET', '/lpj-queue'), 403)
  })

  // ================================================================== US-MC-10 dashboards (Σ per PT = total)
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0)
  await kase(t, 'DSH-01', 'US-MC-10', 'andi finance dashboard: DRMS + CS1, Σ byCompany = totals (cash, transfer queue)', async () => {
    const d = st(await A.andi.v1('GET', '/dashboard/finance'), 200)
    assert.deepEqual(d.companies.map((c) => c.id).sort((a, b) => a - b), [DRMS, CS1].sort((a, b) => a - b))
    assert.equal(sum(d.cashByCompany, 'total'), d.cashTotal, 'cash')
    assert.equal(sum(d.transferQueue.byCompany, 'count'), d.transferQueue.count, 'queue count')
    assert.equal(sum(d.transferQueue.byCompany, 'sum'), d.transferQueue.sum, 'queue sum')
    assert.ok(d.accounts.every((a) => [DRMS, CS1].includes(a.companyId)))
  })
  await kase(t, 'DSH-02', 'US-MC-10', 'rina owner dashboard = DRMS only (Direktur PT); Σ byCompany = totals', async () => {
    const d = st(await A.rina.v1('GET', '/dashboard/owner'), 200)
    assert.deepEqual(d.companies.map((c) => c.id), [DRMS])
    assert.equal(sum(d.cash.byCompany, 'total'), d.cash.total, 'cash')
    assert.equal(sum(d.approvals.byCompany, 'count'), d.approvals.count, 'approvals')
    assert.equal(sum(d.budget.byCompany, 'running'), d.budget.running, 'budget')
    assert.ok(d.projects.every((p) => p.companyId === DRMS))
    CTX.rinaOwnerCash = d.cash.total
  })
  await kase(t, 'DSH-03', 'US-MC-10', 'rina finance dashboard = CS1 only (Finance PT)', async () => {
    const d = st(await A.rina.v1('GET', '/dashboard/finance'), 200)
    assert.deepEqual(d.companies.map((c) => c.id), [CS1])
    assert.ok(d.accounts.every((a) => a.companyId === CS1))
  })
  await kase(t, 'DSH-04', 'US-MC-10', 'Direktur CS1 owner dashboard: CS1 only, no DRMS company id anywhere; CS1 cash = Σ CS1 balances', async () => {
    const d = st(await A.dir.v1('GET', '/dashboard/owner'), 200)
    assert.deepEqual(d.companies.map((c) => c.id), [CS1])
    const ids = [...JSON.stringify(d).matchAll(/"companyId":(\d+)/g)].map((m) => Number(m[1]))
    assert.ok(ids.every((x) => x === CS1), 'companyId values')
    const bal = st(await A.andi.v1('GET', `/cash-accounts/balances?company=${CS1}`), 200).items
    assert.equal(d.cash.total, sum(bal, 'balance'), 'CS1 cash reconciles with balances')
  })
  await kase(t, 'DSH-05', 'US-MC-10', 'role layouts are per PT role: Staff CS1 → owner/finance dashboards 403; PM CS1 → CS1 team only', async () => {
    st(await A.staff.v1('GET', '/dashboard/owner'), 403)
    st(await A.staff.v1('GET', '/dashboard/finance'), 403)
    const pm = st(await A.pm.v1('GET', '/dashboard/pm'), 200)
    const ids = [...JSON.stringify(pm).matchAll(/"companyId":(\d+)/g)].map((m) => Number(m[1]))
    assert.ok(ids.every((x) => x === CS1))
  })
  await kase(t, 'DSH-06', 'US-MC-10', 'X-Company-Ids narrows the consolidated dashboard (andi: CS1 only)', async () => {
    const d = st(await A.andi.v1('GET', '/dashboard/finance', { headers: { 'X-Company-Ids': String(CS1) } }), 200)
    assert.deepEqual(d.companies.map((c) => c.id), [CS1])
  })

  // ================================================================== US-MC-11 reports
  await kase(t, 'REP-01', 'US-MC-11', 'andi consolidated report: PT column + "Subtotal per PT" table, Σ PT rows = TOTAL', async () => {
    const r = st(await A.andi.v1('GET', '/reports/rekap-pengajuan'), 200)
    const sub = r.extra.find((x) => x.key === 'subtotal-pt')
    assert.ok(sub, 'subtotal-pt table')
    assert.ok(r.main.columns[0].key === 'pt' || r.main.rows.length === 0, 'PT column first')
    const money = sub.columns.filter((c) => c.type === 'money' || c.type === 'int')
    for (const c of money) assert.equal(sub.rows.reduce((a, x) => a + (typeof x[c.key] === 'number' ? x[c.key] : 0), 0), sub.totals[c.key], `Σ ${c.key}`)
    assert.deepEqual(sub.rows.map((x) => x.pt).sort(), ['DRMS', CFG.ptCode].sort())
    return `${money.length} subtotal columns`
  })
  await kase(t, 'REP-02', 'US-MC-11', 'pt=<CS1> narrows to one PT (no PT column, CS1 rows only)', async () => {
    const r = st(await A.andi.v1('GET', `/reports/rekap-pengajuan?pt=${CS1}`), 200)
    assert.ok(!r.extra.some((x) => x.key === 'subtotal-pt'))
    assert.deepEqual((r.companies ?? []).map((c) => c.id), [CS1])
    if (D.docToken) assert.ok(!JSON.stringify(r.main.rows).includes(`/${D.docToken}/`))
  })
  await kase(t, 'REP-03', 'US-MC-11', 'a foreign PT: X-Company-Ids → 403; ?pt=<DRMS> → no DRMS data (narrows to nothing, QA-MC4-14 INFO)', async () => {
    const h = await A.dir.v1('GET', '/reports/rekap-pengajuan', { headers: { 'X-Company-Ids': String(DRMS) } })
    st(h, 403)
    assert.equal(h.body.code, 'COMPANY_NOT_ALLOWED')
    // develop bff95ac: 200 with 0 rows (silent narrowing); from fix/mc4-qa-open-items (QA-MC4-14): 403 COMPANY_NOT_ALLOWED
    const r = await A.dir.v1('GET', `/reports/rekap-pengajuan?pt=${DRMS}`)
    const p = st(r, [200, 403])
    if (r.status === 403) {
      assert.equal(r.body.code, 'COMPANY_NOT_ALLOWED')
      return '?pt=<foreign> answers 403 COMPANY_NOT_ALLOWED (QA-MC4-14 fix)'
    }
    assert.equal(p.main.rows.length, 0, 'no rows')
    assert.ok(!(p.companies ?? []).some((c) => c.id === DRMS))
    return '?pt=<foreign> answers 200 with 0 rows (server before the QA-MC4-14 fix)'
  })
  await kase(t, 'REP-04', 'US-MC-11', 'exports: consolidated CSV has a PT column; single-PT PDF/XLSX download', async () => {
    const csv = await A.andi.v1('GET', '/reports/rekap-pengajuan/csv', { raw: true })
    assert.equal(csv.status, 200)
    const lines = csv.bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    assert.ok(lines.some((l) => /Laporan gabungan/.test(l)), 'consolidated preamble')
    assert.ok(lines.some((l) => /^"?PT"?[;,]/.test(l)), 'table header starts with a PT column')
    const pdf = await A.andi.v1('GET', `/reports/rekap-kas/pdf?pt=${CS1}`, { raw: true })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF')
  })
  await kase(t, 'REP-05', 'US-MC-11', 'report roles per PT: Staff CS1 → 403', async () => {
    st(await A.staff.v1('GET', '/reports/rekap-kas'), 403)
  })

  // ================================================================== US-MC-09 per-PT closing
  await kase(t, 'CLS-01', 'US-MC-09', 'closing CS1 (previous month) does not change the DRMS lock date; a CS1 posting in it is refused', async () => {
    const period = prevMonth()
    const before = st(await A.andi.v1('GET', `/period-closings?company=${DRMS}`), 200).lockDate
    const c = await A.andi.v1('POST', '/period-closings', { json: { period, company: CS1, note: 'UAT MC4 uji tutup buku per PT' } })
    st(c, [201, 409], 'close CS1') // 409 = already closed by an aborted earlier run
    CTX.closed = period
    const cs1Lock = st(await A.andi.v1('GET', `/period-closings?company=${CS1}`), 200).lockDate
    assert.ok(cs1Lock && cs1Lock.startsWith(period), `CS1 lock date ${cs1Lock}`)
    const after2 = st(await A.andi.v1('GET', `/period-closings?company=${DRMS}`), 200).lockDate
    assert.equal(after2, before, 'DRMS lock date unchanged')
    const p = await A.andi.v1('POST', '/cash-entries', { json: { direction: 'out', company: CS1, entryDate: `${period}-15`, cashAccountId: need(CTX.cs1Cash, 'CS1 cash'), amount: 1000, description: 'UJI periode tertutup' } })
    st(p, [400, 409, 422], 'posting in the closed CS1 month')
    return `CS1 closed ${period}; DRMS lock date ${before ?? 'none'} unchanged`
  })
  await kase(t, 'CLS-02', 'US-MC-09', 'closing a DRMS period by a CS1-only Direktur → 403 (undone at once on a defect)', async () => {
    const r = await A.dir.v1('POST', '/period-closings', { json: { period: '2020-01', company: DRMS, note: 'UAT MC4 uji negatif' } })
    if (r.status === 201) await A.rina.v1('POST', `/period-closings/2020-01/reopen?company=${DRMS}`, { json: { reason: 'UAT MC4: hasil uji negatif dibatalkan' } })
    st(r, [403])
  })
  await kase(t, 'CLS-03', 'US-MC-09', 'PM CS1 / Staff CS1 cannot close CS1 → 403', async () => {
    st(await A.pm.v1('POST', '/period-closings', { json: { period: '2020-02', company: CS1 } }), 403)
    st(await A.staff.v1('POST', '/period-closings', { json: { period: '2020-02', company: CS1 } }), 403)
  })
  await kase(t, 'CLS-04', 'US-MC-09', 'Direktur CS1 re-opens the CS1 period (restores the fixture)', async () => {
    const period = need(CTX.closed, 'closed CS1 period')
    st(await A.dir.v1('POST', `/period-closings/${period}/reopen?company=${CS1}`, { json: { reason: 'UAT MC4: buka kembali setelah uji' } }), 200)
    const lock = st(await A.andi.v1('GET', `/period-closings?company=${CS1}`), 200).lockDate
    assert.ok(!lock || lock < `${period}-01`, `CS1 lock date after reopen ${lock}`)
  })

  // ================================================================== US-MC-18 audit per PT
  await kase(t, 'AUD-01', 'US-MC-18', 'Direktur CS1 reads audit rows of CS1 only (no untagged / DRMS rows)', async () => {
    const list = docs(await A.dir.rest('GET', '/api/audit-logs?depth=0&limit=200&sort=-id'))
    assert.ok(list.length > 0)
    assert.ok(list.every((x) => companyOf(x) === CS1), 'company of every row')
  })
  await kase(t, 'AUD-02', 'US-MC-18', 'audit rows of the CS1 request carry PT CS1; the Direktur CS1 reads no audit row of a DRMS request', async () => {
    const id = need(CTX.req, 'CS1 request')
    const rows = docs(await A.dir.rest('GET', `/api/audit-logs?depth=0&limit=200&where[docId][equals]=${id}&where[docType][equals]=expense_request`))
    assert.ok(rows.length >= 3, `rows ${rows.length}`)
    assert.ok(rows.every((x) => companyOf(x) === CS1))
    const drmsReq = need(D.req, 'DRMS request')
    const own = docs(await A.rina.rest('GET', `/api/audit-logs?depth=0&limit=5&where[docId][equals]=${drmsReq}&where[docType][equals]=expense_request`))
    assert.ok(own.length > 0, 'control: rina (Direktur DRMS) reads them')
    const r = docs(await A.dir.rest('GET', `/api/audit-logs?depth=0&limit=50&where[docId][equals]=${drmsReq}&where[docType][equals]=expense_request`))
    assert.equal(r.length, 0, 'dir-cs1 reads none')
    const rinaAll = docs(await A.rina.rest('GET', '/api/audit-logs?depth=0&limit=200&sort=-id'))
    assert.ok(rinaAll.every((x) => [DRMS, CS1].includes(companyOf(x))), 'rina: only her mapped PTs, no untagged rows')
  })
  await kase(t, 'AUD-03', 'US-MC-18', '"Riwayat" of the CS1 request is readable in CS1 (requester + Direktur CS1)', async () => {
    const id = need(CTX.req, 'CS1 request')
    assert.ok(st(await A.staff.v1('GET', `/expense-requests/${id}/history`), 200).items.length > 0)
    assert.ok(st(await A.dir.v1('GET', `/expense-requests/${id}/history`), 200).items.length > 0)
  })

  // ================================================================== US-MC-17 sync
  const batch = async (acc, items) => {
    const now = new Date().toISOString()
    return acc.v1('POST', '/sync/batch', { json: { batch_id: uuid(), device_id: await acc.ensureDevice(), clock: { device_time: now, elapsed_ms: 120000, boot_id: uuid() }, items: items.map((it) => ({ client_uuid: uuid(), schema_version: 1, offline: true, device_time: now, elapsed_ms: 120000, ...it })) } })
  }
  const draftPayload = (project) => ({ kind: 'reimburse', title: 'UJI sync', project_id: project, needed_date: addDays(today(), 7), requester_ids: [CTX.andiEmp], lines: [{ client_uuid: uuid(), description: 'x', total: 1000, category_id: CTX.cs1Category }] })
  await kase(t, 'SYN-01', 'US-MC-17', 'sync item company_id=CS1 referencing a DRMS project → rejected COMPANY_MISMATCH', async () => {
    const r = st(await batch(A.andi, [{ type: 'expense_request.draft_upsert', company_id: CS1, payload: draftPayload(need(D.project, 'DRMS project')) }]), 200)
    assert.equal(r.results[0].status, 'rejected')
    assert.equal(r.results[0].errors[0].code, 'COMPANY_MISMATCH')
  })
  await kase(t, 'SYN-02', 'US-MC-17', 'sync item company_id=<DRMS> from a CS1-only user → rejected COMPANY_NOT_ALLOWED', async () => {
    const r = st(await batch(A.staff, [{ type: 'expense_request.draft_upsert', company_id: DRMS, payload: draftPayload(CTX.cs1Project) }]), 200)
    assert.equal(r.results[0].status, 'rejected')
    assert.equal(r.results[0].errors[0].code, 'COMPANY_NOT_ALLOWED')
  })
  await kase(t, 'SYN-03', 'US-MC-17', 'sync items without company_id from a 2-PT account → 409 COMPANY_REQUIRED (nothing processed)', async () => {
    const r = await batch(A.andi, [{ type: 'expense_request.draft_upsert', payload: draftPayload(CTX.cs1Project) }])
    st(r, 409)
    assert.equal(r.body.code, 'COMPANY_REQUIRED')
  })

  // ================================================================== scope rule (owner decision 2026-10-02)
  await kase(t, 'SCP-01', 'Scope rule', '2-PT user (andi) sees DRMS + CS1 consolidated (requests, masters, balances)', async () => {
    const items = st(await A.andi.v1('GET', '/expense-requests?limit=100'), 200).items
    const cos = new Set(items.map((x) => x.companyId))
    assert.ok(cos.has(CS1), 'CS1 requests')
    if (D.requests) assert.ok(cos.has(DRMS), 'DRMS requests')
    assert.ok([...cos].every((c) => [DRMS, CS1].includes(c)))
    const ms = st(await A.andi.v1('GET', '/masters?types=projects'), 200)
    assert.deepEqual(ms.companies.map((c) => c.id).sort((a, b) => a - b), [DRMS, CS1].sort((a, b) => a - b))
    const bal = st(await A.andi.v1('GET', '/cash-accounts/balances'), 200).items
    assert.ok(bal.some((b) => b.companyId === CS1) && bal.every((b) => [DRMS, CS1].includes(b.companyId)))
  })
  await kase(t, 'SCP-02', 'Scope rule', '1-PT users: masters / balances / dashboards never show another PT (also with the cookie or ?company)', async () => {
    for (const k of cs1Only) {
      const ms = st(await A[k].v1('GET', '/masters?types=projects'), 200)
      assert.deepEqual(ms.companies.map((c) => c.id), [CS1], k)
    }
    const bal = st(await A.dir.v1('GET', '/cash-accounts/balances'), 200).items
    assert.ok(bal.every((b) => b.companyId === CS1))
    st(await A.dir.v1('GET', `/cash-accounts/balances?company=${DRMS}`), 403)
  })
  await kase(t, 'SCP-03', 'Scope rule', 'no existence oracle: the same receipt from a 1-PT user (Staff CS1) raises no flag', async () => {
    if (process.env.UAT_DUP_FROM_DRMS === '0') skip('disabled (UAT_DUP_FROM_DRMS=0)')
    const src = need(D.dupSource, 'an active DRMS receipt with a receipt number')
    const d = await cs1Draft(A.staff, need(CTX.staffEmp, 'staff employee'), CTX.staffBank, 'UJI MC4 nota sama, 1 PT', src.amount, { receiptNo: src.receiptNo, vendorName: src.vendorName })
    CTX.dupReq1 = d.id
    const b = st(await A.staff.v1('GET', `/expense-requests/${d.id}`), 200)
    const hits = (b.flags ?? []).filter((f) => f.kind === 'duplicate')
    assert.ok(!hits.some((f) => f.relatedRequestId === src.request), 'no flag pointing at the DRMS request')
    assert.ok(!JSON.stringify(b).includes(`/${D.docToken}/`), 'no DRMS number')
    // cancel at once: a live CS1 copy would be a SAME-PT duplicate for the next case
    st(await A.staff.v1('POST', `/expense-requests/${d.id}/cancel`, { json: { reason: 'UAT MC4: data uji selesai' } }), 200)
    return hits.length ? `${hits.length} same-PT hit(s) from earlier runs ignored` : 'no flag'
  })
  await kase(t, 'SCP-04', 'Scope rule', 'duplicate receipt across PTs: flag only for viewers mapped to the other PT (andi, rina); nothing for CS1-only viewers', async () => {
    if (process.env.UAT_DUP_FROM_DRMS === '0') skip('disabled (UAT_DUP_FROM_DRMS=0)')
    const src = need(D.dupSource, 'an active DRMS receipt with a receipt number')
    const d = await cs1Draft(A.andi, need(CTX.andiEmp, 'andi employee'), CTX.andiBank, 'UJI MC4 nota ganda lintas PT', src.amount, { receiptNo: src.receiptNo, vendorName: src.vendorName })
    CTX.dupReq = d.id
    const dup = (b) => (b.flags ?? []).filter((f) => f.kind === 'duplicate')
    const own = dup(st(await A.andi.v1('GET', `/expense-requests/${d.id}`), 200)).filter((f) => f.relatedRequestId === src.request)
    assert.equal(own.length, 1, 'andi (uploader, mapped to DRMS) sees the flag to the DRMS request')
    assert.ok(own[0].message.includes(`/${D.docToken}/`), 'with the DRMS number')
    st(await A.andi.v1('POST', `/expense-requests/${d.id}/submit`, { json: { signatureMediaId: await sig(A.andi) } }), 200)
    assert.equal(dup(st(await A.rina.v1('GET', `/expense-requests/${d.id}`), 200)).filter((f) => f.relatedRequestId === src.request).length, 1, 'rina (mapped to DRMS) sees it')
    for (const k of ['dir', 'pm']) {
      const b = st(await A[k].v1('GET', `/expense-requests/${d.id}`), 200)
      assert.ok(!dup(b).some((f) => f.relatedRequestId === src.request), `${k} sees no flag to the DRMS request`)
      assert.ok(!JSON.stringify(b).includes(`/${D.docToken}/`), `${k}: no DRMS number`)
      const h = st(await A[k].v1('GET', `/expense-requests/${d.id}/history`), 200)
      assert.ok(!JSON.stringify(h).includes('"flag_raised"') || !JSON.stringify(h).includes('duplicate'), `${k}: no flag in Riwayat`)
    }
    const restDir = docs(await A.dir.rest('GET', `/api/receipt-flags?depth=0&limit=10&where[request][equals]=${d.id}&where[kind][equals]=duplicate`))
    assert.ok(!restDir.some((f) => f.relatedRequest === src.request), 'REST receipt-flags for dir')
    const restRina = docs(await A.rina.rest('GET', `/api/receipt-flags?depth=0&limit=10&where[request][equals]=${d.id}&where[kind][equals]=duplicate`))
    assert.ok(restRina.some((f) => f.relatedRequest === src.request), 'REST receipt-flags for rina')
    const inbox = st(await A.dir.v1('GET', '/approvals/inbox'), 200).items.find((i) => i.id === d.id)
    assert.ok(inbox && inbox.flags.warning === 0, 'dir inbox counts no warning')
  })
  await kase(t, 'SCP-05', 'Scope rule', 'tidy up: the duplicate-test requests are withdrawn / cancelled (final, inactive)', async () => {
    const reason = 'UAT MC4: data uji selesai'
    for (const [acc, id] of [[A.andi, CTX.dupReq], [A.andi, CTX.bodyDraft]]) {
      if (!id) continue
      let s = st(await acc.v1('GET', `/expense-requests/${id}`), 200).status
      if (s === 'pending_ack' || s === 'pending_approval') s = st(await acc.v1('POST', `/expense-requests/${id}/withdraw`, { json: { reason } }), 200).status
      if (s === 'draft') s = st(await acc.v1('POST', `/expense-requests/${id}/cancel`, { json: { reason } }), 200).status
      assert.ok(!['draft', 'pending_ack', 'pending_approval'].includes(s), `request ${id} ${s}`)
    }
  })
  await kase(t, 'SCP-06', 'Scope rule', 'deactivated PT: its media is readable by nobody (2-PT Finance, Direktur, uploader, group admin); /me drops it', async () => {
    if (process.env.UAT_DEACTIVATE_PT !== '1') skip('optional — set UAT_DEACTIVATE_PT=1 (deactivates PT CS1 for ~10 s, then re-activates it)')
    const media = need(CTX.reqReceiptMedia, 'CS1 receipt media')
    const path = `/media/receipts/${media}/file`
    assert.equal((await A.andi.v1('GET', path, { raw: true })).status, 200, 'andi before')
    const off = await A.admin.rest('PATCH', `/api/companies/${CS1}?depth=0`, { json: { active: false, changeReason: 'UAT MC4: uji media PT nonaktif' } })
    st(off, 200, 'deactivate CS1')
    try {
      for (const k of ['andi', 'rina', 'staff', 'admin']) {
        const r = await A[k].v1('GET', path, { raw: true })
        assert.ok([401, 403, 404].includes(r.status), `${k} → ${r.status}`)
      }
      const m = st(await A.andi.v1('GET', '/me'), 200)
      assert.deepEqual(m.companies.map((c) => c.id), [DRMS])
    } finally {
      st(await A.admin.rest('PATCH', `/api/companies/${CS1}?depth=0`, { json: { active: true, changeReason: 'UAT MC4: aktif kembali' } }), 200, 're-activate CS1')
    }
    assert.equal((await A.andi.v1('GET', path, { raw: true })).status, 200, 'andi after re-activation')
  })

  // ================================================================== US-MC-08 (local only) DRMS continues
  await kase(t, 'NUM-02', 'US-MC-08', 'DRMS continues its own series after the CS1 numbers (next DRMS PB = max + 1)', async () => {
    const writer = process.env.UAT_DRMS_WRITER
    if (!writer || CFG.target !== 'local') {
      return `read-only on ${CFG.target}: CS1 started at 1 while the DRMS series stands at ${D.maxDocNo ?? '?'} (set UAT_DRMS_WRITER on the LOCAL target to submit one DRMS request)`
    }
    const w = new Account('drms-writer', writer)
    const m = st(await w.v1('GET', '/me'), 200).companies.find((c) => c.id === DRMS)
    const ms = st(await w.v1('GET', `/masters?types=projects,expense-categories,bank-accounts&company=${DRMS}`), 200).types
    const proj = ms.projects.items[0]
    const before = need(D.maxDocNo, 'DRMS series')
    const d = st(await w.v1('POST', '/expense-requests', { json: { type: 'advance', title: 'UJI lanjut nomor DRMS', projectId: proj.id, requesterIds: [m.employeeId], bankAccountId: ms['bank-accounts'].items.find((b) => b.employee === m.employeeId)?.id, neededDate: addDays(today(), 7), lines: [{ description: 'x', total: 10_000, categoryId: ms['expense-categories'].items[0].id }] } }), 201)
    const s = st(await w.v1('POST', `/expense-requests/${d.id}/submit`, { json: { signatureMediaId: await sig(w) } }), 200)
    assert.equal(Number(s.docNo.split('/')[0]), before + 1, `DRMS ${s.docNo.split('/')[0]} after ${before}`)
    assert.ok(s.docNo.includes('/PB-DRMS/'))
    return `DRMS ${before} → ${before + 1}`
  })
})
