// Bundles the Payload config + worker loop into one ESM file (runs from the standalone output,
// resolving externals from its traced node_modules).
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// F2b: the worker never renders PDFs (ADR 0008 §2: single documents render in the web process), but
// the Payload config pulls in the /api/v1 endpoints, whose PDF handler lazily imports the renderer.
// esbuild hoists external imports to the top of an ESM bundle → the worker would load
// @react-pdf/renderer at start-up (RAM, worker heap 128 MiB). Replace the render module with a stub.
const noPdfInWorker = {
  name: 'no-pdf-in-worker',
  setup(b) {
    b.onResolve({ filter: /^@\/pdf\/render$/ }, () => ({ path: 'pdf-render-stub', namespace: 'pk-stub' }))
    // F3: report PDF (same renderer) — exports run in the web process only.
    b.onResolve({ filter: /^@\/pdf\/report-render$/ }, () => ({ path: 'pdf-report-render-stub', namespace: 'pk-stub' }))
    b.onLoad({ filter: /^pdf-render-stub$/, namespace: 'pk-stub' }, () => ({
      contents:
        "export class PdfBusyError extends Error {}\nexport async function renderPengajuanBiaya() { throw new Error('PDF rendering runs in the web process only (ADR 0008 §2)') }\n",
      loader: 'js',
    }))
    b.onLoad({ filter: /^pdf-report-render-stub$/, namespace: 'pk-stub' }, () => ({
      contents: "export async function renderReportPdf() { throw new Error('Report PDF rendering runs in the web process only (F3)') }\n",
      loader: 'js',
    }))
  },
}

await build({
  entryPoints: [path.join(root, 'src/worker/index.ts')],
  outfile: path.join(root, 'dist/worker.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  tsconfig: path.join(root, 'tsconfig.json'),
  // Native / optional modules stay external (present in the standalone node_modules).
  // @react-pdf/renderer: pdfkit loads its standard fonts via package subpath imports ('#standard-fonts/…')
  // that do not survive bundling; it is traced into the standalone node_modules by next build.
  external: ['sharp', 'pg-native', 'drizzle-kit', 'drizzle-kit/*', 'esbuild', 'tsx', '@next/env', 'next', 'next/*', 'react', 'react-dom', '@react-pdf/renderer'],
  banner: { js: "import{createRequire as __pkCreateRequire}from'node:module';const require=__pkCreateRequire(import.meta.url);" },
  plugins: [noPdfInWorker],
  logLevel: 'info',
  metafile: false,
})
