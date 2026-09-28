# MC2 — progress log (multi-company: domain, reports, jobs, admin UI, import)

- **Design:** `../adr/0016-multi-company.md`; work list `impact-inventory.md` §MC2-1…MC2-5; wireframes `wireframes.md`.
- **Two parallel branches:** backend (MC2-1…MC2-3, `feat/mc2-backend`, contract `mc2-contract.md`) and admin UI +
  import (MC2-4/MC2-5, `feat/mc2-admin-ui`). Each branch owns its section below; merge keeps both.
- **Purpose of this file:** resume point for another agent. Updated + committed with every work package.

## UI (MC2-4 admin UI, MC2-5 import) — branch `feat/mc2-admin-ui`

Worktree `/opt/src/proyekkas-wt/mc2-ui`, based on `179be5a` (develop + MC1 + 2FA). Containers of this branch (remove
by exact name only, never `docker … prune`): `pk-mc2u-net`, `pk-mc2u-node` (node:24.21.0-bookworm-slim, worktree at
`/w`), `pk-mc2u-pg` (postgres:16.15-bookworm), `pk-mc2u-mailpit`, `pk-mc2u-pw` (playwright v1.55.0-noble).

| WP | Status | Notes |
|---|---|---|
| UI-1 PT switcher | done | `admin/shell/CompanySwitcher.tsx` + pure state `company-switcher.ts`, `POST /api/v1/me/companies` (cookie), `tests/unit/mc2-switcher.test.ts` |
| UI-2 Master Perusahaan | done | tabs + list columns (member count), group-admin create/deactivate (existing access) |
| UI-3 Matriks role `/admin/akses-pt` | open | |
| UI-4 Employee ↔ PT, pickers per PT | done | PT at the top of master forms, required on employee create when ambiguous, 7 pickers filtered per PT |
| UI-5 PT column + filter (lists, custom views) | Payload lists done; custom views open | `admin/company-list.ts` wrapper (33 collections) |
| UI-6 Dashboards per PT | open | depends on the backend contract |
| UI-7 Import `kode_pt` (MC2-5) | open | |

### UI-1 PT switcher (done)

- Server: `admin/shell/modules-server.ts` `loadSwitcher` (active memberships from the request's company context +
  code/name, roles per PT), passed by `ModuleNav` to `ModuleBar`.
- Client: one membership → static code; several → dialog (native checkboxes, "Semua PT saya" tri-state, ≥ 1 PT,
  ↑/↓/Home/End between boxes, Esc = cancel + focus back, focus leaving = cancel), ≤ 768 px bottom sheet portalled to
  `<body>` (the bar's `backdrop-filter` would contain a fixed panel). Terapkan → `POST /api/v1/me/companies` →
  `location.reload()`.
- Endpoint (ADR 0016 §5 "set only by the server"): `{ companyIds: number[] | null }`; null / all memberships → cookie
  cleared (new memberships are then included automatically); foreign PT → 403 `COMPANY_NOT_ALLOWED` + audit
  `access_denied`; cookie `HttpOnly; SameSite=Lax; Secure` (`__Host-` unless `AUTH_COOKIE_INSECURE`), 1 year.
  Documented in OpenAPI (`openapi-companies.ts`, `schemas-companies.ts`) — MC3 may move it next to `/me`.

### UI-2 Master Perusahaan (done)

- `collections/Companies.ts` admin only (no schema change): unnamed tabs Identitas / Operasional / Absensi & retensi /
  Pengingat & notifikasi (every `COMPANY_SETTING_FIELDS` entry in exactly one tab — unit test), list columns
  Kode · Nama · Zona waktu · Anggota (`ui` field + server cell `MemberCountCell`, active memberships) · Aktif · Dibuat,
  search on code/name/legal name. Create + `active` stay group-admin only (MC1 access), shortCode lock unchanged.
- Not built (needs backend): "Saat dibuat: salin penomoran / aturan approval / kategori & jadwal dari DRMS"
  (wireframe §3) → contract TODO.

### UI-4 Employee ↔ PT (done)

- `fields/company.ts`: a CHOSEN PT (`companyField()`) now sits at the top of the form (derived stays read-only in the
  sidebar); `requireCompanyWhenAmbiguous` (Employees: field error "PT wajib dipilih" on create when > 1 PT selected
  — same condition as `defaultCompanyForWrite`); `pickerSameCompany()` = `filterOptions` by the document PT for the
  admin dropdown with the save-time re-read switched off (pattern of `expense-requests.bankAccount`; DB trigger stays
  the guard). Applied: employees.workSchedule, team-assignments.employee/project/costCenter,
  employee-bank-accounts.employee, expense-requests.project/costCenter/requesters. Membership employee picker was
  already per PT (MC1).

### UI-5 PT column + filter (Payload lists done)

- `admin/company-list.ts` `withCompanyListUi` (payload.config.ts): every collection with a top-level `company`
  relationship (30 per-PT + memberships + notifications + audit logs; unit test pins the set) → `company` first in
  `defaultColumns`, cell `CompanyCell` (short-code chip, name in tooltip), `beforeListTable` `CompanyListFilter`
  (only with > 1 PT selected: "Semua pilihan · DRMS · CS1" chips = `where[or][0][and][0][company][equals]`, keeps
  sort/limit/search, "Menampilkan DRMS, CS1 · 42 data"). Users with saved column preferences keep their columns
  (Payload list preferences) until they reset them.

## Open TODOs / notes (UI)

- (filled per WP)
