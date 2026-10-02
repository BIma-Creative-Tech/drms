#!/usr/bin/env node
// MC4 UAT suite — LOCAL THROWAWAY ONLY: makes the local stack look like staging before the fixture runs.
//   1. owner step B-1 (UAT report §2): the owner's own admin creates the app account admin.uji@proyekkas.test
//      with "Admin grup (semua PT)" through Payload REST (the Keycloak account already exists → linked by e-mail);
//   2. DRMS history ("real" data on staging) made by the existing DRMS UAT accounts through /api/v1:
//      requests in pending_ack / approved / transferred with receipts, a manual cash entry, project stages +
//      a progress report with photo, a budget addendum, an attendance check-in with selfie.
// Refuses any target other than UAT_TARGET=local. Idempotent per output dir (state.json `emulated`).
import { Account, CFG, brief, guard, loadState, png, saveState, today, addDays } from '../lib.mjs'

guard()
if (CFG.target !== 'local') {
  console.error('REFUSED: emulate-staging.mjs is for the local throwaway stack only')
  process.exit(2)
}
const die = (m) => {
  console.error(`EMULATE STOPPED: ${m}`)
  process.exit(1)
}
const owner = new Account('pemilik', 'pemilik.lokal@drms.test')
const staff = new Account('staff.uji', 'staff.uji@proyekkas.test')
const pm = new Account('pm.uji', 'pm.uji@proyekkas.test')
const fin = new Account('finance.uji', 'finance.uji@proyekkas.test')
const dir = new Account('owner.uji', 'owner.uji@proyekkas.test')

// ---------------------------------------------------------------- 1. B-1
const found = await owner.rest('GET', `/api/users?depth=0&where[email][equals]=admin.uji%40proyekkas.test`)
if (found.status !== 200) die(`users read: ${brief(found)}`)
if (found.body.docs.length === 0) {
  const r = await owner.rest('POST', '/api/users?depth=0', { json: { email: 'admin.uji@proyekkas.test', name: 'Admin Uji', groupAdmin: true, active: true } })
  if (r.status !== 201) die(`B-1 create admin.uji: ${brief(r)}`)
  console.log(`B-1: admin.uji created as group admin (id ${r.body.doc.id}), linked to its Keycloak account by e-mail`)
} else console.log('B-1: admin.uji exists')

if (loadState().emulated) {
  console.log('DRMS history already emulated')
  process.exit(0)
}

// ---------------------------------------------------------------- 2. DRMS history
const ok = async (p, want = [200, 201]) => {
  const r = await p
  if (!want.includes(r.status)) die(brief(r))
  return r.body
}
const me = await ok(staff.v1('GET', '/me'))
const drms = me.companies.find((c) => c.code === 'DRMS')
const emp = drms.employeeId
const ms = await ok(staff.v1('GET', `/masters?types=projects,expense-categories,bank-accounts&company=${drms.id}`))
const proj = ms.types.projects.items.find((p) => p.code === 'UJI-PRJ')
const cat = ms.types['expense-categories'].items.find((c) => c.code === 'MAT')
const acc = ms.types['bank-accounts'].items.find((b) => b.employee === emp)
if (!proj || !cat || !acc) die('DRMS UAT masters missing (base + UAT seed)')
const sig = async (a) => a.upload('signatures')

async function request(type, title, amount, withReceipt = true) {
  const d = await ok(staff.v1('POST', '/expense-requests', { json: { type, title, projectId: proj.id, requesterIds: [emp], bankAccountId: acc.id, neededDate: addDays(today(), 14), lines: [{ description: 'Material emulasi', total: amount, categoryId: cat.id }] } }))
  if (withReceipt) {
    const img = await staff.upload('receipts')
    await ok(staff.v1('POST', `/expense-requests/${d.id}/receipts`, { json: { lineId: d.lines[0].id, receiptNo: `EMU-${d.id}`, vendorName: 'Toko Emulasi', receiptDate: addDays(today(), -1), amount, imageId: img } }))
  }
  const s = await ok(staff.v1('POST', `/expense-requests/${d.id}/submit`, { json: { signatureMediaId: await sig(staff) } }))
  return s
}
const ack = async (id) => ok(dir.v1('POST', `/expense-requests/${id}/acknowledge`, { json: { signatureMediaId: await sig(dir) } }))
const approve = async (id) => ok(fin.v1('POST', `/expense-requests/${id}/approve`, { json: { signatureMediaId: await sig(fin) } }))

const r1 = await request('reimburse', 'Emulasi DRMS menunggu diketahui', 150_000)
const r2 = await request('reimburse', 'Emulasi DRMS ditransfer', 200_000)
await ack(r2.id)
let d2 = await approve(r2.id)
for (const rc of d2.receipts) await ok(fin.v1('POST', `/expense-requests/${r2.id}/receipts/${rc.id}/verify`, { json: {} }))
d2 = await ok(fin.v1('POST', `/expense-requests/${r2.id}/verify-receipts`, { json: {} }))
const bal = await ok(fin.v1('GET', `/cash-accounts/balances?company=${drms.id}`))
const cashAcc = { id: (bal.items[0] ?? die("no DRMS cash account")).cashAccountId }
const proof = await fin.upload('transfer-proofs')
await ok(fin.v1('POST', `/expense-requests/${r2.id}/transfer`, { json: { cashAccountId: cashAcc.id, bankRef: `EMU-TRF-${r2.id}`, proofMediaId: proof } }))
const r3 = await request('advance', 'Emulasi DRMS uang muka disetujui', 300_000, false)
await ack(r3.id)
await approve(r3.id)
await ok(fin.v1('POST', '/cash-entries', { json: { direction: 'out', cashAccountId: cashAcc.id, amount: 75_000, description: 'Emulasi kas keluar DRMS', categoryId: cat.id } }))

// project stages + progress report (PM of UJI-PRJ = pm.uji)
const stagesOf = (b) => b.stages ?? b.items ?? b
let stages = stagesOf(await ok(dir.v1('GET', `/projects/${proj.id}/stages`))).filter((x) => x.active !== false)
if (!stages.length) stages = stagesOf(await ok(dir.v1('PUT', `/projects/${proj.id}/stages`, { json: { stages: [{ name: 'Persiapan', weightPct: 40, sequence: 1 }, { name: 'Pekerjaan utama', weightPct: 60, sequence: 2 }], reason: 'Emulasi tahapan' } })))
const stage = stages[0]
const photo = await pm.upload('progress-photos')
await ok(pm.v1('POST', '/progress-reports', { json: { projectId: proj.id, stageId: stage.id, pctAfter: 20, work: 'Emulasi pekerjaan persiapan', photoIds: [photo] } }))
await ok(pm.v1('POST', '/budget-addenda', { json: { projectId: proj.id, addition: 5_000_000, reason: 'Emulasi addendum DRMS', submit: true } }))

// attendance with selfie: geofence on the project + attendance switched on for DRMS (local only)
await ok(dir.rest('PATCH', `/api/projects/${proj.id}?depth=0`, { json: { lat: -3.32, lng: 114.59, radiusM: 500 } }))
await ok(owner.rest('PATCH', `/api/companies/${drms.id}?depth=0`, { json: { syncAttendanceEnabled: true } }))
const selfie = await staff.upload('selfies')
const now = new Date().toISOString()
const batch = await ok(
  staff.v1('POST', '/sync/batch', {
    json: {
      batch_id: crypto.randomUUID(),
      device_id: await staff.ensureDevice(),
      clock: { device_time: now, elapsed_ms: 100000, boot_id: crypto.randomUUID() },
      items: [{ client_uuid: crypto.randomUUID(), type: 'attendance.check_in', company_id: drms.id, schema_version: 1, offline: false, device_time: now, elapsed_ms: 100000, payload: { project_id: proj.id, lat: -3.3201, lng: 114.5901, accuracy_m: 10, is_mocked: false, selfie_media_id: selfie, camera_lens: 'front' } }],
    },
  }),
)
console.log(`attendance: ${batch.results[0].status} ${JSON.stringify(batch.results[0].errors)}`)
saveState({ emulated: { at: new Date().toISOString(), drms: drms.id, pendingAck: r1.id, transferred: r2.id, approved: r3.id } })
console.log(`DRMS history emulated: requests ${r1.id} (pending_ack) ${r2.id} (transferred) ${r3.id} (approved), cash entry, progress report, addendum, attendance`)
