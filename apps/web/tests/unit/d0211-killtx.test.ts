import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Prod 0.23.0 500s (2026-11-02): Payload rolls the request transaction back on EVERY error one of its operations throws
 * (killTransaction) — also when the caller catches it — so a read that may be refused (403) or miss (404) passes
 * `disableErrors: true` (null / no rows, nothing thrown) instead of `.catch(...)`. Integration: d0211-killtx.int.test.ts.
 */
const SRC = fileURLToPath(new URL('../../src/', import.meta.url))
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : []
  })

// a one-line Local API read bound to the request (`req`), its error swallowed on the same or the next line
const READ = /\.(find|findByID|count)\(\{.*\breq\b.*\}\)/
const SAME_LINE = /\.(find|findByID|count)\(\{.*\}\)\)?\.catch\(/

describe('request-bound Local API reads never swallow their error', () => {
  it('no `.find / .findByID / .count({ … req … }).catch(` without disableErrors in src/', () => {
    const hits: string[] = []
    for (const f of files(SRC)) {
      const lines = readFileSync(f, 'utf8').split('\n')
      lines.forEach((l, i) => {
        if (!READ.test(l) || l.includes('disableErrors')) return
        if (SAME_LINE.test(l) || (lines[i + 1] ?? '').trim().startsWith('.catch(')) hits.push(`${f.slice(SRC.length)}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
