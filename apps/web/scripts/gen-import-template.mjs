// Generates the go-live import workbooks (plan fase1-golive E11) from src/import/spec.ts:
//   docs/proyekkas/templates/drms-impor-golive-template.xlsx  (blank client template)
//   docs/proyekkas/templates/drms-impor-golive-contoh-fiktif.xlsx  (fictional sample, tests/training)
// Usage: node scripts/gen-import-template.mjs [--check]   (--check: exit 1 if a committed file differs)
// The .xlsx output is deterministic (fixed zip timestamps), so --check is byte-exact.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.resolve(root, '../../docs/proyekkas/templates')

const tmp = mkdtempSync(path.join(os.tmpdir(), 'pk-import-template-'))
try {
  const bundle = path.join(tmp, 'template.mjs')
  await build({
    entryPoints: [path.join(root, 'src/import/template.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    tsconfig: path.join(root, 'tsconfig.json'),
    logLevel: 'warning',
  })
  const { buildTemplate, buildSample } = await import(pathToFileURL(bundle).href)
  const targets = [
    [path.join(outDir, 'drms-impor-golive-template.xlsx'), Buffer.from(buildTemplate())],
    [path.join(outDir, 'drms-impor-golive-contoh-fiktif.xlsx'), Buffer.from(buildSample())],
  ]
  if (process.argv.includes('--check')) {
    let drift = false
    for (const [file, content] of targets) {
      let current = Buffer.alloc(0)
      try {
        current = readFileSync(file)
      } catch {
        // missing → drift
      }
      if (!current.equals(content)) {
        drift = true
        console.error(`import template drift: ${path.relative(process.cwd(), file)} is not up to date — run npm run gen:import-template`)
      }
    }
    if (drift) process.exit(1)
    console.log('import templates up to date')
  } else {
    mkdirSync(outDir, { recursive: true })
    for (const [file, content] of targets) {
      writeFileSync(file, content)
      console.log(`wrote ${path.relative(process.cwd(), file)}`)
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
