# Runbook — image GHCR & deploy prod ProyekKas (E10)

Status: berlaku mulai branch `feat/s3c-e10-ghcr-ci` (S3 track C). Sumber: `fase1-golive.md` §E10/§6, runbook infra
`docs/runbooks/proyekkas-drms-prod.md` (repo `/opt/infra`, branch `feat/infra-drms-prod`) §6/§11.

**Prinsip:** image dibangun **di runner GitHub**, bukan di VPS (disk & RAM VPS, plan §6). VPS hanya `docker pull`
image yang sudah lolos Trivy, dirujuk dengan **digest**.

## 1. Nama image (keputusan)

| Image | Isi | Dipakai oleh |
|---|---|---|
| `ghcr.io/bctech-adm/proyekkas-web` | target `runner` `apps/web/Dockerfile` (Next standalone + `dist/worker.mjs`) | `drms-pk-web`, `drms-pk-worker` |
| `ghcr.io/bctech-adm/proyekkas-migrate` | target `migrate` (payload migrate + seed) | `drms-pk-migrate`, `drms-pk-seed` |

Nama `proyekkas-*` (bukan `drms-web`/`drms-migrate`) dipilih karena **sudah mengikat** di sisi infra: `.env.example`
prod, runbook infra §6/§11, dan regex allowlist `infra-deploy` v2
(`^ghcr\.io/bctech-adm/proyekkas-web:[0-9]+\.[0-9]+\.[0-9]+@sha256:[0-9a-f]{64}$`). Nama ini juga sama dengan image
lokal staging (`proyekkas-web:0.1.0-stg-<sha>`).

## 2. Cara image dibuat — `.github/workflows/ci.yml` job `image`

Urutan (job `image` hanya jalan setelah `verify`, `integration`, `security` hijau):

1. **Tag & label** dihitung dari ref git (tabel §3). `SOURCE_DATE_EPOCH` = waktu commit (timestamp image reprodusibel).
2. **Build sekali per target** (buildx, `linux/amd64`) — `runner` lalu `migrate`, cache layer di **GitHub Actions
   cache** (`type=gha`, scope `pk-web` / `pk-migrate`, `mode=max`). Webpack butuh ≈ 2 GiB → aman di runner (16 GiB).
   - run *publish* (`develop`, tag `vX.Y.Z`, `ci/ghcr-*`; tidak pernah dari PR): image di-push **tanpa tag**
     (`push-by-digest`) beserta **SBOM** (SPDX) dan **provenance** SLSA (`mode=max`) sebagai attestation. Login GHCR
     memakai `GITHUB_TOKEN` (`permissions: packages: write` hanya di job ini).
   - run lain (PR, `feat/**`, `main`): image di-*load* ke runner saja, tidak ada push.
3. **Trivy 0.74.0** (image dipin digest, sama dengan job `security`) memindai **digest yang persis sama**:
   - *laporan*: HIGH + CRITICAL termasuk yang belum ada perbaikan → tabel jumlah di **job summary** + daftar di log;
   - *gerbang*: `--severity CRITICAL --ignore-unfixed --exit-code 1` → ada CRITICAL yang bisa diperbaiki = job gagal,
     digest **tetap tanpa tag** (tidak bisa dipakai lewat tag; jangan deploy digest tanpa tag).
4. **Tag**: hanya digest yang lolos diberi tag (`docker buildx imagetools create`, tanpa build ulang) — §3.
5. **Summary**: tag dicek menunjuk digest yang dipindai, lalu baris siap tempel untuk `.env` prod:
   `PK_WEB_IMAGE=ghcr.io/bctech-adm/proyekkas-web:<tag>@sha256:…` dan `PK_MIGRATE_IMAGE=…`.

Label OCI di setiap image: `org.opencontainers.image.{title,description,source,revision,version,created,vendor,licenses}`.
`source` = `https://github.com/bctech-adm/drms` → paket GHCR otomatis tertaut ke repo (hak akses mengikuti repo).

Cek SBOM / provenance (butuh login GHCR):
```bash
docker buildx imagetools inspect ghcr.io/bctech-adm/proyekkas-web:X.Y.Z --format '{{json .SBOM}}' | head
docker buildx imagetools inspect ghcr.io/bctech-adm/proyekkas-web:X.Y.Z --format '{{json .Provenance}}' | head
```

## 3. Tag

| Pemicu | Tag image | Untuk |
|---|---|---|
| push ke `develop` | `sha-<sha7>` dan `<versi package.json>-stg-<sha7>` (mis. `0.2.1-stg-1fd7ea7`) | staging |
| push tag git `vX.Y.Z` | `X.Y.Z` (tanpa `v`) | **prod** |
| push ke branch `ci/ghcr-*` | `test-<sha7>` | uji pipeline saja — jangan dideploy |
| PR, `main`, `feat/**`, `fix/**` | — (build + Trivy saja, tanpa push) | verifikasi |

Aturan tag rilis (dicek job, gagal bila dilanggar): format persis `vX.Y.Z`; `X.Y.Z` = `version` di `package.json`;
commit tag harus ada di `main`; tag `X.Y.Z` **belum ada** di GHCR (tag rilis tidak pernah ditimpa — tag lama = jalur
rollback). Tidak ada tag bergerak (`latest`, `X.Y`) — deploy selalu dengan digest.

Rilis prod: merge `release/*` → `main`, `git tag -a vX.Y.Z` di `main`, `git push origin vX.Y.Z` → tunggu run `ci`
tag itu hijau → ambil dua baris `PK_*_IMAGE` dari job summary.

## 4. Visibilitas image (harus privat) — **aksi user**

Repo `bctech-adm/drms` **publik**. Paket yang dibuat workflow dengan `GITHUB_TOKEN` tertaut ke repo dan **mewarisi
visibilitas publik** — terbukti pada push uji pertama 2026-09-26 (`test-ba70515`: manifest bisa diambil tanpa login,
HTTP 200). Isi image tidak memuat secret (hanya placeholder build), tetapi target tetap privat:
GitHub → organisasi `bctech-adm` → Packages → `proyekkas-web` dan `proyekkas-migrate` → *Package settings* →
*Change visibility* → **Private** (sekali per paket; bila dikunci kebijakan org, admin org mengizinkan dulu di
Settings → Packages). *Manage Actions access*: repo `bctech-adm/drms` peran **Write** (agar CI tetap bisa push).
Setelah privat, VPS wajib `docker login ghcr.io` (§6a). Cek (tanpa login harus 401/403):
```bash
T=$(curl -s "https://ghcr.io/token?scope=repository:bctech-adm/proyekkas-web:pull" | sed -E 's/.*"token":"([^"]*)".*/\1/')
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' https://ghcr.io/v2/bctech-adm/proyekkas-web/manifests/<tag>
```
Agent tidak mengubah setelan GitHub.

## 5. Compose prod — `deploy/prod/docker-compose.yml`

Isi = salinan versi infra `web/clients/drms-proyekkas/docker-compose.yml`; **diff harus kosong kecuali komentar**
(nama container/network/volume/limit mengikat router Traefik, pg_hba, backup, reservasi T19). Cek:
```bash
strip(){ sed -E 's/[[:space:]]+#.*$//; /^[[:space:]]*#/d; /^[[:space:]]*$/d' "$1"; }
diff <(strip deploy/prod/docker-compose.yml) <(strip /opt/infra/web/clients/drms-proyekkas/docker-compose.yml) && echo SAMA
```
Ringkas: `drms-pk-migrate` (OWNER, 384m, one-shot) → `drms-pk-web` (384m, `NODE_OPTIONS=--max-old-space-size=256`,
healthcheck `/api/v1/health`) + `drms-pk-worker` (192m, 128, heartbeat) ; `drms-pk-seed` profil `seed`; network
eksternal `drms-kas-edge-prod`, `db-drms`, `drms-kc-admin`; secret file `./secrets/*.secret` milik 1001:1001 0400;
volume `drms_pk_media_prod`. Perubahan compose dibuat di repo app lalu disalin infra Lead (atau sebaliknya) — keduanya
harus tetap identik.

## 6. Deploy prod

### 6a. Sekarang — manual oleh infra Lead (pull di VPS)

Sekali (root, VPS): `docker login ghcr.io` dengan **PAT classic** scope **`read:packages` saja** (GHCR belum menerima
fine-grained token), dari akun mesin/bot bila ada, bertanggal kedaluwarsa — runbook infra §6:
```bash
read -rs CR_PAT && printf '%s' "$CR_PAT" | docker login ghcr.io -u <github-user> --password-stdin; unset CR_PAT
```
Deploy / upgrade:
```bash
cd /opt/infra/web/clients/drms-proyekkas
cp -p .env .env.prev                                  # titik rollback
# edit .env: PK_WEB_IMAGE / PK_MIGRATE_IMAGE = baris dari job summary tag vX.Y.Z (ref@digest)
sudo /opt/infra/scripts/backup.sh run                 # dump pk_drms sebelum migrasi (tidak reversibel)
docker compose config -q && docker compose pull && docker compose up -d
docker compose ps -a                                  # migrate Exited (0); web & worker (healthy)
curl -s -o /dev/null -w '%{http_code}\n' https://drms-kas.bimacreative.tech/api/v1/health   # 200
```

### 6b. Nanti — `.github/workflows/deploy-prod.yml` (manual + approval), saat ini **INERT**

`workflow_dispatch` dengan input `version` (dijalankan dari tag `vX.Y.Z`): job `resolve` memeriksa tag ada di `main`,
mengambil digest kedua image dari GHCR dan memastikan label `revision` = commit tag; job `deploy` (environment
**`infra-deploy`**, butuh persetujuan reviewer) menjalankan via SSH
`sudo /usr/local/sbin/infra-deploy web/clients/drms-proyekkas --set PK_WEB_IMAGE=<ref@digest> --set PK_MIGRATE_IMAGE=<ref@digest>`
lalu smoke `/api/v1/health` = 200. Job `deploy` **dilewati** selama variabel repo `PROD_DEPLOY_ENABLED` ≠ `true`.

Prasyarat mengaktifkan (urut):
1. Infra: `infra-deploy` v2 (allowlist `--set` + regex, `.env.prev`, dump pra-deploy, tunggu healthy, rollback
   otomatis) — desain runbook infra §11; **belum ada** (versi T01 tidak menerima `--set`).
2. User, GitHub → Settings → Environments → **`infra-deploy`**: *Required reviewers* (≥ 1, bukan pemicu run),
   *Prevent self-review*, *Deployment branches and tags* = tag `v*.*.*` saja.
3. Secret environment `infra-deploy`: `DEPLOY_SSH_KEY` (kunci ed25519 khusus CI; publiknya di
   `~deploy/.ssh/authorized_keys` dengan `restrict,command="…infra-deploy…"`), `DEPLOY_KNOWN_HOSTS` (host key VPS port
   2221, diverifikasi di luar jalur). Variabel environment: `DEPLOY_HOST`, `DEPLOY_PORT=2221`, `DEPLOY_USER=deploy`.
4. Variabel repo `PROD_DEPLOY_ENABLED=true`.

Catatan: workflow `workflow_dispatch` baru muncul di tab Actions setelah file ada di branch default. Runbook infra §9.2
menyebut nama environment `production`; repo app memakai `infra-deploy` (plan E10) — Lead memilih satu, lalu ganti
`environment.name` bila perlu.

Alternatif *pull-based* (timer di VPS yang memantau tag GHCR) **tidak** dipilih: VPS perlu logika seleksi versi dan
tidak ada gerbang approval manusia; deploy prod tetap keputusan eksplisit per rilis.

## 7. Rollback (per tag)

- **Image saja** (migrasi versi baru kompatibel mundur): kembalikan `.env` (`cp -p .env.prev .env`, atau isi
  `PK_*_IMAGE` = ref@digest rilis sebelumnya dari job summary tag lama) → `docker compose up -d`. Migrate versi lama =
  no-op. Daftar digest lama: halaman paket GHCR atau
  `docker buildx imagetools inspect ghcr.io/bctech-adm/proyekkas-web:X.Y.Z`.
- **Skema tidak kompatibel**: restore dump pra-deploy (`restore.sh pk_drms pk_drms_rb --owner pk_drms_owner`) lalu
  tukar — destruktif, **konfirmasi user**; atau migrasi *down* dari tim app.
- **Matikan**: `docker compose down` (tanpa `-v`).
- Dengan `infra-deploy` v2: `sudo infra-deploy --rollback web/clients/drms-proyekkas`.

## 8. Staging

Setelah merge ke `develop`, staging dapat memakai image GHCR (tidak perlu build di VPS): `.env` staging
`PK_WEB_IMAGE=ghcr.io/bctech-adm/proyekkas-web:<ver>-stg-<sha7>@sha256:…` (sama untuk migrate) → `infra-deploy
staging/drms-proyekkas`. Butuh login GHCR yang sama (§6a).

## 9. Kebersihan paket

Tag `test-*` (branch `ci/ghcr-*`) dan `sha-*` boleh dihapus berkala oleh admin paket di GitHub; **jangan** hapus versi
`X.Y.Z` (jalur rollback). Cache GHA dibatasi GitHub 10 GB/repo (LRU otomatis).
