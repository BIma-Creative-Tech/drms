import type { Metadata } from 'next'

import { readLatestRelease } from '@/lib/app-release'

import { DownloadView } from './DownloadView'

// Manifest read from the media volume per request (a release must show up without a rebuild).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Unduh ProyekKas',
  description: 'Unduh aplikasi Android ProyekKas untuk karyawan PT DRMS.',
}

/** GET /unduh — public (no login), see DownloadView and src/lib/app-release.ts. */
export default async function UnduhPage() {
  return <DownloadView release={await readLatestRelease()} />
}
