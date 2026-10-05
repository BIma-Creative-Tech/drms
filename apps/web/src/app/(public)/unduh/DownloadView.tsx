import React from 'react'

import { downloadName, formatPublishedAt, formatSize, type ReleaseManifest } from '@/lib/app-release'
import { PRIVACY_PATH } from '@/legal/paths'
import { BRAND_NAME, BRAND_PRODUCT } from '@/theme/graphics'

import { PublicBrand } from '../PublicBrand'

/** Stable download URL (also the value for Pengaturan → "URL unduh APK" on prod). */
export const APK_PATH = '/unduh/proyekkas.apk'

/**
 * `/unduh` content: server component, no hooks, no client JS (the page works with scripts blocked).
 * `release` = the current manifest + byte size, or null while nothing is published.
 */
export function DownloadView({ release }: { release: { manifest: ReleaseManifest; size: number } | null }) {
  return (
    <main className="pk-pub__main">
      <PublicBrand />

      <h1 className="pk-pub__title">Unduh aplikasi Android</h1>
      <p className="pk-pub__lead">Aplikasi {BRAND_NAME} untuk HP Android karyawan.</p>
      <p className="pk-pub__notice" role="note">
        {`Hanya untuk karyawan PT ${BRAND_PRODUCT}.`}
      </p>

      {release ? (
        <>
          <section className="pk-pub__card" aria-labelledby="pk-pub-rilis">
            <h2 id="pk-pub-rilis" className="pk-pub__h2">
              {BRAND_NAME} {release.manifest.version}
            </h2>
            <dl className="pk-pub__facts">
              <div>
                <dt>Versi</dt>
                <dd>{release.manifest.version}</dd>
              </div>
              <div>
                <dt>Ukuran</dt>
                <dd>{formatSize(release.size)}</dd>
              </div>
              <div>
                <dt>Dirilis</dt>
                <dd>{formatPublishedAt(release.manifest.publishedAt)}</dd>
              </div>
              <div>
                <dt>Perangkat</dt>
                <dd>Android 64-bit (arm64)</dd>
              </div>
            </dl>
            <a className="pk-pub__button" href={APK_PATH} download={downloadName(release.manifest)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
                <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Unduh APK
            </a>
          </section>

          {release.manifest.notes?.length ? (
            <section className="pk-pub__card" aria-labelledby="pk-pub-baru">
              <h2 id="pk-pub-baru" className="pk-pub__h2">
                Yang baru di versi {release.manifest.version}
              </h2>
              {/* Plain text from the manifest (React escapes it) — never rendered as HTML/markdown. */}
              <ul className="pk-pub__notes">
                {release.manifest.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="pk-pub__card" aria-labelledby="pk-pub-pasang">
            <h2 id="pk-pub-pasang" className="pk-pub__h2">
              Cara memasang
            </h2>
            <ol className="pk-pub__steps">
              <li>
                Ketuk <strong>Unduh APK</strong> dan tunggu sampai unduhan selesai.
              </li>
              <li>
                Buka file <strong>{downloadName(release.manifest)}</strong> dari notifikasi unduhan atau aplikasi File.
              </li>
              <li>
                Bila Android meminta, ketuk <strong>Setelan</strong> lalu aktifkan <strong>Izinkan dari sumber ini</strong>, kemudian
                kembali.
              </li>
              <li>
                Ketuk <strong>Instal</strong>, lalu <strong>Buka</strong>. Bila muncul peringatan Play Protect, pilih{' '}
                <strong>Detail lainnya → Tetap instal</strong>.
              </li>
            </ol>
            <p className="pk-pub__hint">
              <strong>Memperbarui aplikasi:</strong> pasang APK versi baru di atas versi lama, tanpa menghapus aplikasi. Data dan
              login tetap tersimpan.
            </p>
          </section>

          <details className="pk-pub__card pk-pub__verify">
            <summary className="pk-pub__h2">Verifikasi file (opsional)</summary>
            <p className="pk-pub__hint">Untuk admin/IT: cocokkan sidik jari berikut sebelum menyebarkan file.</p>
            <dl className="pk-pub__hashes">
              <dt>SHA-256 file APK</dt>
              <dd>
                <code>{release.manifest.sha256}</code>
              </dd>
              <dt>SHA-256 sertifikat penandatangan</dt>
              <dd>
                <code>{release.manifest.certSha256}</code>
              </dd>
            </dl>
          </details>
        </>
      ) : (
        <section className="pk-pub__card" aria-labelledby="pk-pub-kosong">
          <h2 id="pk-pub-kosong" className="pk-pub__h2">
            APK belum tersedia
          </h2>
          <p className="pk-pub__hint">Belum ada versi yang diterbitkan di server ini. Hubungi admin perusahaan.</p>
        </section>
      )}

      <p className="pk-pub__footer">
        <a href={PRIVACY_PATH}>Pemberitahuan privasi</a>
      </p>
    </main>
  )
}
