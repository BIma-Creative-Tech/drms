# ADR 0025 — Definitive Direktur signature per PT (representative signs as the PT's Direktur)

- **Status:** Accepted (owner requirement DRMS 13/10, Phase A3). Staging first; no production deploy without separate
  owner approval. Number may be renumbered at merge if another ADR took 0025.
- **Date:** 2026-10-13
- **Author:** nextjs developer (branch `feat/d1310-a-ttd`, from `feat/d1310-w3-dash`)
- **Related:** ADR 0006 (audit, append-only approvals), ADR 0008 (PDF), ADR 0013 (Direktur → Finance), ADR 0016
  (roles per PT), ADR 0019 (LPJ shortfall), ADR 0021 (PM → Direktur), ADR 0022 (inter-project loans), ADR 0024.

## Context

Each PT has a **definitive (legal) Direktur** who does **not** use the app. Somebody with app access (a user holding
the Direktur role in that PT) approves on that Direktur's behalf. Until now every decision was signed with the
deciding user's own profile / drawn signature and shown under that user's name, so the PDF "Pengajuan Biaya" and the
history named the stand-in instead of the PT's Direktur.

Owner requirement:

1. Per PT: signature image, name and title (jabatan) of the definitive Direktur, plus which user(s) are the designated
   representatives ("wakil") allowed to sign as that Direktur.
2. When a representative decides the **Direktur step** — only that step — the PT's Direktur signature and name are
   used: the PDF prints them with **no** "disetujui melalui aplikasi oleh <wakil>" note, and logs / history (Log
   perubahan, approval timeline / stepper, notifications, APK detail) show the definitive Direktur's name.
3. Internally the approval row still references the real user (FK, append-only audit, access checks, distinct-person
   rules, incident forensics).
4. A PT without a definitive Direktur behaves as before. A representative deciding another step (e.g. as PM or
   Finance) signs with their own signature.

## Decision

1. **Data per PT** — Perusahaan (PT) → tab **"Direktur definitif"** (group `companies.direktur`): `name`, `title`,
   `signature` (upload → `media-signatures`), `representatives` (users, hasMany, `companies_rels` path
   `direktur.representatives`). A configuration is **complete** (name + signature) or empty; title is optional.
   Representatives must hold the Direktur role (`pk-owner`) in that PT (picker filter + server check). The signature
   must be a **new upload of the editor** (never a user's profile signature or a signature already used on a decision)
   or the one already linked to this PT. Read: office roles of the PT (Admin / Direktur / Finance) + group admins;
   change: **Admin of the PT + group admins only** (the representatives never configure their own mandate).
2. **Direktur step** = a decision position **held by the Direktur role**, never a person named in a rule:
   - "Diketahui" by the role Direktur (ADR 0013 snapshots, Addendum RAB) or delegated to the Direktur tier (F2e);
   - an approval level whose approver is the role Direktur (ADR 0021 PM → Direktur);
   - the same rule for the LPJ shortfall re-approval (ADR 0019 — its snapshot is a request rule);
   - the single Direktur decision of an inter-project loan (ADR 0022) and the Direktur "Diketahui" of an Addendum RAB.
   The PM step (`scope_manager`), Finance levels, named-user steps and the requester/creator signatures (Diajukan /
   Dibuat) are personal. Code: `domain/direktur-rules.ts` (pure) + `domain/direktur-signature.ts`.
3. **Representation** applies when the PT's configuration is complete, the caller is one of its representatives and
   the position decided is a Direktur step — for acknowledge, approve **and reject**. The server decides; a drawn
   `signatureMediaId` sent by the representative is ignored. Otherwise nothing changes (profile / drawn signature;
   409 when a required one is missing).
4. **Approval row** (Class A, append-only): `actor` = the real user (unchanged — G1, one position per person, DB
   triggers, forensics); `actorName` = the definitive Direktur; `signature` / `signatureSha256` = the PT's signature
   media row (immutable); `signatureSource = company` (new enum value); `representedDirektur.name/title` = snapshot at
   decision time. A later change of the PT's Direktur data never alters a signed row, and a re-rendered PDF stays
   identical (the media row is immutable, the name/title come from the row).
5. **Display rules** — everywhere user-facing the definitive Direktur is shown:
   - PDF "Pengajuan Biaya": signature image + "Nama (Jabatan)", no "via app" note (`pdf/data.ts printedName`);
   - approval timeline / stepper (web), shortfall panel, Addendum / loan decision lists, API `approvals[].actorName`,
     APK turn timeline — they all read the stored `actorName`;
   - loans "Diputuskan oleh" (`decidedBy.name`) — from the company-signed decision row;
   - Log perubahan / Riwayat (web + `GET …/history` → APK) and the audit-log report: `audit_logs.actor_display_name`,
     written by `writeAudit` for every row of the deciding request (decision, status change, finalize side effects)
     while `user_id` stays the real user;
   - notifications carry no decider name (verified: templates have no actor placeholder) — nothing to change.
   The admin collection "Approval & tanda tangan" hides the `User` field on company-signed rows; the real user id
   stays in the DB and in the raw audit log (`Sistem → Audit log`, user id column) for forensics.
6. **APK / web hint** — `GET /expense-requests/{id}` returns `direkturSignature {name, title, signatureId}` when the
   caller's next decision is such a Direktur step; the APK decision sheet then shows "Tanda tangan Direktur PT"
   read-only instead of the profile/draw choice; the web decision bar and confirmation name it.
7. **Security**
   - The PT signature file (`media-signatures`, owner link `company_direktur` → PT id, set when the PT is saved,
     immutable — DB trigger) is read only by the office roles of **that** PT and group admins: never through the
     "uploads of members" rule (the uploading Admin may be a member of other PTs), never by Staff / PM, and never
     through the "signature on a request I may read" fallback of `GET /api/v1/media/signatures/{id}/file`.
   - DB backstop (`20261013_910100_d1310_direktur_ttd_guard`): CHECK `signatureSource = company ⇔ snapshot` (decision
     positions only, signature required) and trigger `approvals_signature_company`: a company-signed row is accepted
     only when the actor is a designated representative of the row's PT holding the Direktur role there (active
     account + membership) and the signature / name / title are the PT's **current** ones.

## Consequences

- Positive: documents and history name the legal Direktur; the representation is explicit, immutable and auditable;
  PTs without the configuration are untouched.
- One app account = one decision position per cycle (unchanged): a representative who already decided the PM step of
  a request cannot also decide its Direktur step as the PT's Direktur — another Direktur / representative does.
- A representative's **own** request follows the requester rules (ADR 0024: a Direktur's own request needs no
  approval) — the representation never applies to requests the representative files.
- Forensics: who actually clicked = `approvals.actor_id` / `audit_logs.user_id` (DB, raw audit log), not the UI.

## Rollout

Migrations `20261013_910000_d1310_direktur_ttd` (columns, rels table, enum value) and
`20261013_910100_d1310_direktur_ttd_guard` (CHECK, trigger, owner-link protection) — additive. Admin setup: Perusahaan
(PT) → PT → tab "Direktur definitif": name, title, upload the signature PNG, pick the representatives, Simpan.
Removing the configuration (empty all fields) returns the PT to personal signatures; signed rows keep their snapshot.
