# Release notes (user-facing)

`apk/<X.Y.Z>.md` — what changed in APK version X.Y.Z, **in Indonesian, for field employees**: short bullets, no
technical terms, at most ~8 bullets (hard limits: 15 bullets, 300 characters each). An optional first line
`# ProyekKas X.Y.Z` is a title (ignored on /unduh and in the app). Plain text only: `**bold**`, `` `code` `` and
`[text](url)` are reduced to their text.

Write the file **before** pushing the tag `mobile-vX.Y.Z`. It is used in three places:

1. GitHub Release of the tag (`.github/workflows/mobile.yml` job `release-prod`; the job fails before building when the
   file is missing).
2. `/unduh` "Yang baru di versi X.Y.Z" — `publish-apk.mjs --notes` (runbook `docs/proyekkas/runbooks/rilis-apk.md`).
3. In the APK — `GET /api/v1/app/config` `releaseNotes` (from the same manifest, only while the published APK is the
   configured "Versi APK terbaru"): home banner "Versi baru tersedia" → sheet, and the "Perbarui aplikasi" screen.

Web releases (`vX.Y.Z` tags) take their GitHub Release text from the `## [X.Y.Z]` section of `CHANGELOG.md`
(`.github/workflows/release-notes.yml`).
