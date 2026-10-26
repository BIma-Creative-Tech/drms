# ADR 0032 — Hapus site, absensi per lokasi project, role Admin Staff

- **Status:** accepted (user decisions 2026-10-24, DRMS 24/10 stream "absensi"); D4 amended 2026-10-26 (see
  "Amendment 2026-10-26" — Karyawan Non-OnSite anywhere again). Staging first; no production deploy without the usual
  release approval.
- **Date:** 2026-10-24
- **Branch:** `feat/d2410-absensi` (from `origin/main` 0.19.1)
- **Amends:** ADR 0023 (multiple sites per PT, incl. its amendment 2026-10-13 / revision 2026-10-14 "OnSite / Non-OnSite,
  Di luar area") and the attendance rules of ADR 0010 / E6 (US-01/02/14/15). ADR 0029 (fund check) is touched only by
  the open question in §4.
- **Related:** ADR 0016 (roles per PT), ADR 0018 (privacy ack), ADR 0021 (pk-operator precedent), ADR 0031 (Pusat
  Biaya = akun kas).

## Context

The owner introduced sites (kantor cabang) on 2026-10-11 (ADR 0023) and attendance types OnSite / Non-OnSite on
2026-10-13/14 (Non-OnSite = no location restriction, outside every location recorded "Di luar area" against the home
site / head office). In practice the projects carry the attendance points (`projects.lat/lng/radiusM`), the sites were
an extra master to maintain, "Di luar area" let office staff check in from anywhere, and nobody besides the PM (APK,
team only) could record attendance for workers without a phone or an account (tukang harian).

## Decisions (user, 2026-10-24)

| # | Decision |
|---|---|
| D1 | **Sites are removed from the product.** No Site menu / form / create; no site on Data Karyawan ("Site penempatan"), Project, Akun kas, Penugasan tim; no site filter / column / card on Tim hari ini, rekap, reports, dashboards, Kas, cash balances, project list; no site on `/me`; no site UI on the APK. |
| D2 | **Attendance locations are projects** (plus cost centers that already have a point — the existing code offered them). Sites are no longer offered; a site check-in from an old APK is refused (OnSite) or treated as a hint (Non-OnSite). Work-schedule fallback: employee → PT (no home-site default). The PM team scope has no team sites. |
| D3 | **Site team assignments** become project assignments: a site sits under projects (`projects.site_id`), so the audited data migration turns each site assignment into assignments of the site's active projects; without such a project a running assignment is ended (§3). |
| D4 | **Karyawan Non-OnSite** may check in AND out only inside the geofence of ANY active registered location (project / cost center with a point) of its PT — no assignment needed; the containing location is picked automatically (the nearest when several); outside every location → refused with a clear Indonesian message (no new "Di luar area" record). A check-out closes the day's open check-in. OnSite unchanged (inside the chosen location). Mock location still refused. |
| D5 | **New role `pk-admin-staff` "Admin Staff"** (per PT): reads every attendance (incl. selfies, audited) and correction of the PT; records check-in / check-out ON BEHALF of any employee of the PT, also employees WITHOUT a user account — web (new endpoint + page, the admin's camera + GPS) and APK (the existing on-behalf screen / sync item); corrects attendance with a mandatory reason (never own); reads the employees of the PT (no bank accounts); sees the attendance menus (Tim hari ini, Absenkan karyawan, Rekap, Jadwal read, Laporan Absensi). **No finance / request access** unless another role is held. The PM keeps its team-scoped on-behalf (APK). |
| D6 | No table or column is dropped (history, rollback): the site columns become hidden legacy columns. |

## Decision

### 1. Sites (D1, D2, D6)

- `sites` collection: `admin.hidden`, `create: denyAll` (update stays for a deactivation), registry menu and icon
  removed, "Buat site dari pusat biaya" removed (component, importMap, `domain/sites.ts`).
- `employees.homeSite`, `projects.site`, `cash_accounts.site`, `team_assignments.site`: `legacySiteField` — hidden in
  every form / list / APK data form, field access create/update `false` (system writes still pass the company hook and
  the DB trigger). The TeamAssignments guard refuses a NEW or CHANGED site for a user request ("Penugasan ke site tidak
  tersedia lagi"); a legacy row may still get its end date. The go-live import CLI (system request) still reads the
  workbook's legacy Site sheet / `kode_site` (follow-up, see open questions).
- `attendances.site` stays read-only for history; the DB trigger `pk_attendance_site` keeps filling it for project
  check-ins (harmless). Legacy site check-ins stay visible (office scope = whole PT) with the label "Site".
- Removed: report parameter `site` and its filter field, dashboard `?site=` and the `sites` blocks (owner / finance /
  PM; cards "Saldo kas per site", "Ringkasan per site"), Kas `site` filter and `lookups.sites`, `/cash-accounts/balances
  ?site=`, `/projects?site=` and `ProjectListItem.site`, `TeamTodayQuery.site_id`, `EmployeeRef.homeSite`,
  `domain/reports/sites.ts`. The `onlySites` SQL plumbing of `domain/reports/scope.ts` stays inert (nothing sets it)
  until the legacy columns are dropped.
- Kept for APK ≤ 0.11.1 (answers, never crashes): `GET /api/v1/sites` → empty list; masters type `sites` → empty on a
  full read, every site of the PTs as a tombstone (`deleted: true`) on a delta read (the old cache drops them);
  `GET /attendance/locations` keeps `homeSiteId` / `referenceSite` (null) and `isHeadOffice` / `home` (false); sync
  `site_id` stays in the strict schema (OnSite → `VALIDATION` "Site tidak lagi dipakai sebagai lokasi absen…";
  Non-OnSite → only a hint). `assignmentChoices.sites` of the onboarding form is always empty.

### 2. Attendance rules (D2, D4)

- Registered locations of a PT (`eligibility.ts registeredLocations`): projects (not arsip / dibatalkan / deleted) and
  active cost centers, both with a point; radius = own, else the PT default.
- OnSite: unchanged — the chosen location must contain the fix (`NO_GEOFENCE` / `OUTSIDE_GEOFENCE`).
- Non-OnSite (`record.ts resolveNonOnsite`): the requested location when the fix lies inside it, else the nearest
  registered location containing the fix; none → `OUTSIDE_GEOFENCE` "Anda di luar semua lokasi terdaftar PT. Karyawan
  Non-OnSite hanya bisa absen masuk / pulang di dalam area lokasi project (atau pusat biaya) PT-nya…". A check-out
  with an open check-in today is recorded at that open location (closes the pair); when the fix lies inside ANOTHER
  registered location the row gets the flag `CHECK_OUT_ELSEWHERE` and `distance_m` = the distance to the open location.
  `attendances.outside_area` is never set for a new row; the "Di luar area" label stays for the rows of 14–24/10.
- Web Absen page and APK: no "Di luar area" entry, no home-site / head-office badges; the APK shows the new refusal
  text, the type hints and help texts (Data Karyawan, Pengguna form) describe the new rule.

### 3. Data migration of site team assignments (D3)

`20261024_200000_d2410_site_assignments` (data only, idempotent, run as `<prefix>_owner`). For every team assignment
with `site_id` (any state):

1. Matching projects = projects of the same PT with `projects.site_id` = the site, status not selesai / arsip /
   dibatalkan, not soft-deleted, ordered by code — minus the projects the employee already has a running assignment to.
2. ≥ 1 project → **convert**: the row takes the first project (`project_id` set, `site_id` cleared —
   `team_assignments_location_one` holds) and one new row per further project is added (same employee, role, start and
   end date).
3. No project and the row still running (no end date, or ending today or later, Asia/Makassar) → **ended now**
   (`end_date` = migration time, never before its start date).
4. No project and already ended → **kept** as history.

Each conversion / closure is logged: a `RAISE NOTICE` + payload logger line, and an `audit_logs` row (source
`system`, doc_type `team_assignment`, `update` old → new for a converted / ended row, `create` for an added row,
`new_value.v.migration` = the migration name). `down()` reverts from those audit rows (added rows deleted, site restored,
old end date restored).

### 4. Cash accounts flagged with a site — fund check (open question)

The site field of cash accounts disappears from the UI, but **the existing exclusion is kept**: an account already
flagged with a site stays outside the PT fund pool of ADR 0029 (fund check `pk_fund_balance`, Dana tersedia, the
source list of inter-PT loans, the APK pool filter). Changing the money rule silently was judged not low-risk (it can
turn a "dana kurang" refusal into an approval). The fund panel still names the excluded accounts ("akun kas cabang
(site lama) … tidak dihitung"). **To decide by the owner:** count those accounts from now on (one data migration that
clears `cash_accounts.site_id`, audited) or keep them excluded (then the Admin needs a way to clear the flag).

**Decided 2026-10-24 (user):** every project is mapped to a cash account (ADR 0031), so the funds are recomputed
**without** the site exclusion. Migration `20261024_500000_d2410_site_accounts_fund` clears every
`cash_accounts.site_id` (one `audit_logs` row per account, source `system`, old → new, RAISE NOTICE; `down()` restores
the flags from those rows) and patches `pk_fund_balance` (every active account of the PT) and `pk_icl_transfer_guard`
(paying account = any active account of the paying PT) from their current definitions. The service (`fundAccounts`:
`excludedSiteAccounts` stays in the contract, always 0), the inter-PT loan source list (web + APK) and the fund panel
text ("akun kas cabang (site lama) … tidak dihitung", web + APK) follow.

### 5. Role Admin Staff (D5)

- `ROLES` += `pk-admin-staff`, `ROLE_LABELS` "Admin Staff", `PANEL_ROLES`, role matrix short "AdmS", onboarding / akses
  role pickers (from `ROLES`; APK list too), OpenAPI role enums. Migrations `20261024_210000_d2410_admin_staff_enums`
  (enum values: `enum_company_memberships_roles`, `enum_approval_rules_steps_approver_role`,
  `enum_approval_rules_acknowledge_role` — the rule hook still allows only decision roles there — and
  `enum_attendances_source` += `admin`; snapshot `.json` = full schema of main + these values) and
  `20261024_210100_d2410_admin_staff_guard` (`attendances_source_fields`: `admin` like `pm` — recorder + reason ≥ 3).
- Access: Attendances / AttendanceCorrections read = whole PT; selfies (`media-selfies` read of the PT's attendance
  selfies + own uploads; GET `/attendance/{id}/selfie` audited `view_sensitive`); Employees read (whole PT; employee bank
  accounts stay closed; phone stays hidden); Projects / cost centers read (names and points — money stays field-guarded);
  own user, own notifications; selfie upload. Restricted panel (Admin Staff only): users, notifications, attendances,
  corrections, employees, work schedules, holidays. Dashboard layout "Admin Staff" with the attendance shortcuts.
- Attendance scope (`OFFICE_ATT`): whole PT for Tim hari ini, rekap, team grid, Jadwal (read; write stays Admin /
  Direktur), Laporan Absensi (`attendanceOfficeScope`); `/attendance/recap`, `/team-today`, `/{id}/correct` accept the
  role. Corrections (`corrections.ts`, `mayCorrect`): Admin Staff like Admin — never own, reason mandatory.
- On-behalf: `record.ts onBehalfActor` (shared by sync and web) — Admin Staff of the location's PT wins over PM; never
  the own employee; employee active, of a mapped PT, of the location's PT; account optional. `recordAttendance` source
  `admin` requires pk-admin-staff in the location's PT; the employee's own type rule is evaluated against the
  Admin Staff's fix. Rows: source `admin` "Diabsenkan oleh Admin Staff", `recorded_by`, `on_behalf_reason`; recap /
  report / stamp say "diabsenkan (oleh <nama>)" / "diabsenkan Admin Staff <nama>".
- Web: page **Absensi · Absenkan karyawan** (`/admin/absensi/absenkan`, menu item for the role) with
  `GET /api/v1/attendance/on-behalf/options` (employees incl. `hasAccount`, locations per PT) and
  `POST /api/v1/attendance/on-behalf` (same gates as the web self check-in: syncAttendanceEnabled, privacy ack).
- `/me` capabilities `attendanceOnBehalf` (PM or Admin Staff) and `attendanceAdminStaff`.
- APK: `Role.adminStaff`, bottom bar = the Operator bar (Beranda, Absensi with the team tab, Profil) unless a higher
  role is held; `canSeeTeamAttendance` / `canAttendOnBehalf` / `canCorrectAttendance` include it; the on-behalf screen
  lists the Admin Staff candidates from the options endpoint (cached for offline items) next to the PM's team members;
  a Non-OnSite employee is recorded at the location containing the fix; menu "Absenkan karyawan" → on-behalf screen.

## Consequences

- Positive: one place for attendance points (the project); Non-OnSite staff can no longer check in from home; workers
  without a phone / account can be recorded by an Admin Staff without giving it finance access; no data lost.
- Negative / watch: projects without a point cannot take attendance (Admin must fill lat/lng); site-flagged cash
  accounts stay excluded from the fund pool until the owner decides (§4); the import workbook still has Site columns.
- Old APKs (≤ 0.11.1): keep working; a cached site location is refused for OnSite with a clear message; the "Di luar
  area" entry disappears once the location list is refreshed (referenceSite null).

## Rollback

Code revert + `down()` of the data migration (restores the site assignments from its audit rows); the enum values are
harmless without the role; the guard `down()` is refused while an `admin` attendance row exists. The hidden site
columns were never dropped.

## Open questions (owner)

1. ~~Cash accounts already flagged with a site: count them in the fund pool from now on, or keep them excluded (§4)?~~
   Decided 2026-10-24: counted (§4).
2. Go-live import workbook: drop the Site sheet / `kode_site` columns (needs the committed template / sample `.xlsx`
   regenerated) — until then the CLI import still writes the hidden legacy columns.
3. ~~Should the web on-behalf page also be offered to the PM (team-scoped), or stay Admin Staff only?~~ Decided
   2026-10-24 (user): the PM gets **Absensi → Absenkan karyawan** too, scoped like the APK PM on-behalf (employees and
   locations of the PM's team projects); the Admin Staff stays PT-wide.

## Amendment 2026-10-26 — Karyawan Non-OnSite may check in anywhere again (DRMS 26/10 #2)

User request (2026-10-26): "untuk karyawan non-onsite, ini bisa melakukan absensi dimana pun tidak terbatas pada lokasi
terdaftar dan tetap bisa mengajukan pengajuan selama di assign di proyek tersebut".

**D4 is replaced for Karyawan Non-OnSite** (the rule of ADR 0023 revision 2026-10-14 returns, without sites):

- Check-in AND check-out **anywhere**, no assignment needed. The fix inside the geofence of an active registered
  location of the own PT → recorded there exactly as in §2 (the requested one when it contains the fix, else the nearest
  containing one; a check-out closes the day's open check-in, flag `CHECK_OUT_ELSEWHERE` inside another location).
- The fix outside every registered location → **not refused**: recorded with `attendances.outside_area = true`
  ("Di luar area", day / recap flag `OUTSIDE_AREA`) referenced to the **nearest** active registered location of the PT
  (project or cost center with a point — the home site / head office reference of 14/10 is gone with the sites),
  `distance_m` = the distance to its point. A check-out with an open check-in closes that pair at the open location,
  flagged "Di luar area" (`distance_m` to the open location; `NO_REFERENCE_POINT` when it has no point any more).
- The PT has no registered location with a point at all → refused `NO_GEOFENCE` ("Absen belum bisa dicatat: PT Anda
  belum punya lokasi terdaftar … Hubungi Admin.") — nothing to reference.
- One write path (`record.ts resolveNonOnsite`): web self check-in, APK sync (online and offline items), PM on-behalf
  (the requested location must still be a team location; the employee a team member) and Admin Staff on-behalf (the
  employee's type rule against the recorder's fix). `NON_ONSITE_OUTSIDE` is now the informative note "Di luar lokasi
  terdaftar — absen dicatat "Di luar area"" (web + APK show it before the confirmation popup), no longer a refusal.
- Unchanged: OnSite (inside the CHOSEN location's geofence, else `OUTSIDE_GEOFENCE`), mock location refused, selfie
  and GPS required, privacy acknowledgement, own PT only. `GET /attendance/locations` keeps `referenceSite` null (the
  server picks the nearest location itself, so APK ≤ 0.11.1 never sends a site for it). No migration (the column
  `outside_area` exists since 20261013_620000), no schema change of the API (descriptions only).
- **Requests (pengajuan) are not widened:** a Non-OnSite employee — like any Staff — files only for active projects it
  is assigned to (`domain/expense/drafts.ts` G10, the CALLER's assignment scope; the attendance type plays no part).
- Display: the "Di luar area" chip of the recap stamp (web), the report column "Di luar area (ref. …)", the Absensi list
  column / filter, the APK recap tile and day flag show the new rows like the 14–24/10 history.
- Consequence (accepted by the user): office staff can again check in from home / on the road; the record says it was
  outside, where it is referenced and how far away.
