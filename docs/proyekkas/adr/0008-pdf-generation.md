# ADR 0008 — PDF generation for "Pengajuan Biaya" (client form replica + receipt photos)

- **Status:** accepted (user, GATE F0 2026-09-23); implementation recorded after F2b, layout approved by the user 2026-09-24 (see Revision history)
- **Date:** 2026-09-23
- **Author:** Analyst/Architect — Phase 0
- **Related:** lead prompt "Temuan tambahan" #3, #5, #6; `reference/contoh-form-pengajuan-biaya-drms.jpg`;
  requirements v1.0 M13 (export PDF); ADR 0002 (RAM), 0004 (media formats), 0007 (numbering);
  `../architecture.md` §9.3

## Context

Mandatory output (lead prompt #6): a PDF that looks like the client's form — header (company name
"PT DOUBLE REZKI MAKMUR SEJAHTERA", title "PENGAJUAN BIAYA", free-text subject line, logo), date
"20 September 2026", number `228/PB-DRMS/20/IX/2026`, item table (No, Uraian, Jumlah, Satuan, Harga
Satuan, Total, Keterangan), GRAND TOTAL `Rp 1.447.500`, 4 signature boxes (Diajukan Oleh — may be
several names, Dibuat Oleh, Diketahui Oleh, Approval) with name and signature image, transfer info box
(bank, account holder, account number), then **receipt photos** on the same/next pages. Used for the
physical archive. RAM budget is tight (ADR 0002).

User decision 2026-09-23 (coordinator; brief §1 updated): line **`total` is the primary user-entered value**;
`unitPrice` is informational (if empty, display `total ÷ qty`); **no server rule `qty × unitPrice = total`**;
grand total = Σ line totals (server-computed). PDF therefore prints the stored `total` per line and shows
`Harga Satuan` = stored `unitPrice` or blank/derived.

### Options verified (npm registry / GitHub API, fetched 2026-09-23)

| Option | Version | License | Last publish / repo push | Runtime | Notes |
|---|---|---|---|---|---|
| `@react-pdf/renderer` | 4.9.0 | MIT | 2026-08-27 / 2026-09-22 | in-process Node, no browser; peer `react ^16.8…^19` | flexbox layout (`@react-pdf/layout` 5.2.0 uses `yoga-layout`), depends on `pdfkit`; images **JPEG/PNG/SVG only** (`@react-pdf/image` 3.1.2 `isValidFormat`) |
| `pdfkit` | 0.20.2 | MIT | 2026-08-30 / 2026-09-19 | in-process | imperative drawing; manual table layout |
| `pdf-lib` | 1.17.1 | MIT | **2021-11-06** / repo push 2024-07-17 | in-process | fails CLAUDE.md §0.10 maintenance (< 6 months) |
| `pdfmake` | 0.3.11 | MIT | 2026-06-12 | in-process | declarative tables; alternative |
| Headless Chromium: `playwright-core` 1.63.0 / `puppeteer-core` 25.11.0 | — | Apache-2.0 | 2026-09 | needs a Chromium binary in the image or a separate service | HTML/CSS fidelity; heavy RAM (UNVERIFIED figure) |
| Gotenberg | v8.37.0 (2026-09-11) | MIT | repo push 2026-09-18 | separate container (Chromium + LibreOffice) | extra container; RAM not in budget (figure UNVERIFIED) |

Node Intl in the platform image (`node:24.21.0-alpine`, `docker exec control-plane node -e …`, ICU 78.3):
`Intl.NumberFormat('id-ID').format(1447500)` → `1.447.500`; `DateTimeFormat('id-ID',{dateStyle:'long',
timeZone:'Asia/Makassar'})` → `20 September 2026` ✔ (full ICU present).

## Decision

1. **`@react-pdf/renderer@4.9.0`** (pin exact) rendering server-side from a React template
   `src/pdf/PengajuanBiaya.tsx`; same React 19 already in the app (peer satisfied).
2. **Where it runs**: single-document PDF is rendered **synchronously in `drms-pk-web`** on
   `GET /api/v1/expense-requests/{id}/pdf` (and an admin "Cetak PDF" button), guarded by an in-process
   semaphore (max 2 concurrent renders; further requests wait ≤ 10 s then 503 + retry) and a size budget
   (≤ 12 receipt images per PDF page set; more → worker job). Batch/period PDFs → worker job
   (`pdf.batchExport`), result stored temporarily (24 h) in media and delivered by signed URL (ADR 0004).
3. **Not stored by default** (regenerated from immutable data: numbered request, line snapshots,
   approvals with signature references). Optional "final archive" snapshot at `Selesai` stored in
   `media-attachments` if the client wants a frozen file (client question; +≈1–2 MB/request).
4. **Layout** (A4 portrait, 10 mm margins): page 1 = header (logo from `media-company`, company name,
   title, subject), TGL/NO block, item table with empty spacer rows like the client form, GRAND TOTAL
   (highlighted cell), 4 signature boxes (label, signature image, name; "Diajukan Oleh" joins multiple
   names with ", "), transfer box (bank name, account holder, account number from the chosen
   `employee-bank-accounts` row). Pages 2..n = receipt photos, 2 per page (or 4 small), each captioned with
   line no, receipt no, vendor, date, amount and **validation flags** (amount diff vs line, date after
   request date, duplicate) — flags printed only on an internal copy variant (`?variant=internal`).
5. **Images**: receipts/progress stored as JPEG, signatures/logo PNG (ADR 0004) → embed directly; a
   `pdf` image size (max 1200 px) is used to cap memory; PDF (non-image) attachments are listed by
   name, not merged (merging PDFs would need `pdf-lib`, rejected above).
6. **Formatting**: amounts `Rp` + `Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })` (custom
   prefix to control the space character — the separator emitted by the `currency` style is
   **UNVERIFIED** as regular space vs NBSP); dates `id-ID` long form in company TZ; Roman month only in
   the document number (ADR 0007). Font: embed an OFL-licensed TTF (e.g. Inter or Noto Sans — **choice
   and license file to be verified by nextjs-developer**); fallback built-in Helvetica (PDF standard font,
   covers Indonesian Latin text).
7. **Acceptance test (F2)**: seed = client form (3 lines: BBM Hilux 1 × "bulan" total 600.000; Penginapan
   2 kamar total 677.000 (unit price 339.000 display-only); Makan siang total 170.500; grand total
   **Rp 1.447.500**; signatures Budi, Doni / Citra / Budi Hartono / sari; transfer Mandiri,
   Doni Pratama, 1234567890123) → PDF snapshot test (text extraction) + visual review vs the JPG by the
   user; flags visible on internal variant: Penginapan receipt 676.876 vs line 677.000 (diff 124 vs
   rounding tolerance), BBM and Makan receipts dated 21/09 after request date 20/09, unit "bulan" for BBM.
   Measured peak RSS of one render with 3 receipt images must be reported (F2 gate).

## As implemented (F2b, `develop` `59ba0a4`)

Verified in `apps/web/src/pdf/{render.ts,data.ts,PengajuanBiaya.tsx}`,
`src/api/v1/endpoints/expense-requests.ts` (`pdfEndpoint`), `next.config.ts`, `scripts/build-worker.mjs`,
`package.json`, `tests/integration/form-228.int.test.ts`:
- **Renderer:** `@react-pdf/renderer` **4.9.0** (MIT, pinned exact) with React 19.3.0, template
  `src/pdf/PengajuanBiaya.tsx`. English hyphenation disabled (`Font.registerHyphenationCallback`) because it
  splits Indonesian words wrongly.
- **Font (decision §6 resolved):** built-in **Helvetica** / Helvetica-Bold (PDF standard fonts, WinAnsi) —
  no font file is shipped, so there is **no font licensing** to track; the OFL TTF option was not taken.
- **Images:** receipt JPEGs (and PNG signatures/logo) are **passed through as stored** (read from the media
  volume, `media-*` JPEG/PNG only; WebP or PDF attachments are not embedded). There is **no separate `pdf`
  image size**: the stored receipt (≤ 2000 px, ADR 0004) is used; a file > 3 MiB is skipped (RAM guard).
  At most 12 receipt images per PDF (`MAX_RECEIPT_IMAGES`); further receipts are printed as caption only.
- **Endpoint:** `GET /api/v1/expense-requests/{id}/pdf[?variant=internal]` — same read access as the request
  (else 404), Draft/unnumbered → 409, internal variant Finance/Owner/Admin only (else 403), rate limit
  10/min per user. Data load + one **`export` audit row per download** (`field=pdf`, variant, status) in one
  transaction; the render runs **outside** it (no DB connection held). Response `attachment`,
  `Cache-Control: private, no-store`.
- **Concurrency:** in-process semaphore **2** concurrent renders; a further request waits ≤ **10 s**, then
  **503** + `Retry-After: 10`.
- **Web only; the worker never loads the renderer.** The `/api/v1` endpoints are part of the Payload config the
  worker bundles, and esbuild hoists the external import → `scripts/build-worker.mjs` replaces `@/pdf/render`
  with a throwing **stub** (plugin `no-pdf-in-worker`). Batch/period PDFs (§2 worker job) are **not built**.
- **Standalone tracing:** pdfkit loads its standard fonts via `require('#standard-fonts/<Name>')`
  (`js/standard-fonts/*.cjs`); Next's tracer only picked the `.mjs` variants and the first render in the
  image failed (`Cannot find module …/Helvetica.cjs`). Fix: `outputFileTracingIncludes:
  { '/api/*': ['../../node_modules/pdfkit/js/standard-fonts/**/*'] }` in `next.config.ts`.
- **Layout:** as §4; receipts on **separate pages, 2 per page**. **Approved by the user 2026-09-24.**
  Logo: `company-settings.logo` (`media-company`) when set, else a placeholder circle with the company code —
  **real logo pending (Q-32)**.
- **Measured RAM (F2 gate item):** isolated render of the form-228 fixture with 3 receipt photos in a child
  process (`--max-old-space-size=256`, test `form-228.int`) → peak RSS **≈ 138 MiB**; staging web container
  cgroup peak **149 MiB** after 3 renders (reported by the implementer/Lead 2026-09-24; figures not
  re-measured by the docs agent).
- **Not stored** (decision §3 unchanged): regenerated on every download; no "final archive" snapshot yet.

## Alternatives

| Alternative | Rejected because |
|---|---|
| Headless Chromium in web image | +Chromium binary in image (size, CVEs → Trivy gate), high RAM per render (UNVERIFIED but known to be hundreds of MiB) — no budget (ADR 0002) |
| Gotenberg container | Extra always-on container outside the 2.5 GiB budget; overkill for one template |
| `pdfkit` directly | Viable, lower-level; manual table/pagination code; react-pdf uses pdfkit underneath anyway |
| `pdfmake` | Viable; kept as fallback if react-pdf fails the F2 RAM/fidelity test |
| `pdf-lib` | Unmaintained per §0.10 (last publish 2021) |

## Consequences

- No extra container, no browser; templates are React components (same skills as the admin).
- WebP cannot be embedded → media formats constrained (ADR 0004).
- Pixel-perfect replica of an Excel-made form is not guaranteed; target is "recognisably the same form".

## Security implications

- Rendering uses only server data (no user HTML) → no HTML injection/SSRF surface (unlike Chromium).
- PDF endpoint enforces the same read access as the expense request; internal variant only for
  Finance/Owner/Admin. Rate-limited (Traefik + semaphore) to avoid CPU/RAM DoS.
- Bank account number printed → PDF download is audited as `export` (ADR 0006).

## Rollback

Switch renderer behind the `PdfRenderer` port (pdfmake/pdfkit) — templates rewritten, API unchanged.

## Proposed CLAUDE.md changes (need user approval; author does not edit)

None.

## Revision history

- **2026-09-23 (F0 gate):** accepted by user.
- **2026-09-24 (F2b):** "As implemented" section added, verified against `develop` `59ba0a4`:
  `@react-pdf/renderer` 4.9.0 (MIT) with built-in Helvetica (no font licensing; §6 font choice closed),
  receipt JPEGs passed through as stored (no `pdf` image size), `outputFileTracingIncludes` for the pdfkit
  standard fonts, PDF renderer stubbed out of the worker bundle (no batch PDF yet), semaphore 2 / 10 s → 503,
  every download audited `export`; measured peak RSS ≈ 138 MiB isolated / 149 MiB web cgroup after 3 renders.
  Layout approved by the user 2026-09-24 (receipts on separate pages, 2 per page); logo pending (Q-32).
  Status stays accepted.
- **2026-09-24 (F3):** report PDFs (Q-F3-5: Rekap Kas, Pengeluaran per Kategori, Anggaran Project; A4 landscape,
  ≤ 500 rows, `pdf/ReportPdf.tsx`) with the same renderer; the semaphore moved to `lib/heavy-gate.ts` and is now
  **shared with the XLSX exports** (2 concurrent, 10 s → 503); the worker bundle stubs `@/pdf/report-render` too.
  Measured on the production image `pk-f3-web:measure` (target `runner`, built with `docker build --memory 2g`: OK, 6 min 57 s),
  `--memory 384m --memory-swap 384m --cpus 0.75`, `NODE_OPTIONS=--max-old-space-size=256` (= staging), app role on a
  throwaway DB with 597 requests, 49 624 audit rows and 10 000 ledger rows in one month. cgroup v2 `memory.current` /
  `memory.peak`: idle **70 MiB** (peak 108 MiB during start-up); Owner Beranda HTML ×3 (heaviest dashboard: 9 KPI
  queries + approval inbox + SVG chart) **107 MiB**, peak 147 MiB, 1.3–3.3 s; dashboard APIs owner/finance ×3 106 MiB;
  report pages 117 MiB; **XLSX 10 000 rows** (Buku Kas, 387 KB, 2.5 s) 137 MiB, second run peak **213 MiB**;
  **2 × XLSX 10 000 rows + 1 report PDF concurrently**: cgroup peak **223 MiB** (58 % of 384 MiB; process VmHWM
  271 MiB incl. shared file pages), third request waited on the shared gate (5.0 s / 7.8 s); CSV 10 000 rows
  (streamed, 916 KB) 156 MiB; back to 105 MiB after 20 s. No OOM, no error log. `write-excel-file` is bundled into
  the server chunks by webpack (not needed in the traced `node_modules`); verified by a real XLSX download.
  Status stays accepted.
