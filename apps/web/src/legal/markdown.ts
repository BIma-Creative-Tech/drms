/**
 * Minimal, SAFE markdown subset for repo-owned legal texts (employee privacy notice, Q-46 / ASVS 8.3.3).
 *
 * Why not a library: the only markdown package in the lockfile is `marked` 14.0.0, a transitive dependency of the
 * admin's monaco-editor (not a direct dependency, old major, passes raw HTML through → would need a sanitizer and a
 * raw-HTML sink in React). The notice needs a handful of constructs, so this module parses them into a small AST
 * that is rendered two ways, both without any raw-HTML path:
 * - `renderHtml` → an HTML string for API clients (`GET /api/v1/privacy-notice`): every text node is escaped and
 *   only a fixed set of attribute-less tags is emitted;
 * - `PrivacyNoticeBody` (React) → elements built from the same AST (React escapes text; no dangerouslySetInnerHTML).
 *
 * Supported: ATX headings (`#`…`####`), paragraphs (soft line breaks joined with a space), `-`/`*` bullet lists and
 * `1.` ordered lists (indented continuation lines), pipe tables (header + `|---|` separator), `---` rules, and
 * inline `**strong**`, `*em*` / `_em_`, `` `code` `` and backslash escapes. Everything else — raw HTML, links,
 * images — is TEXT (shown literally, escaped). Pure module (no Node/React imports): bundled by
 * scripts/gen-privacy-notice.mjs at generation time and imported by the app.
 */

export type Inline = { t: 'text'; v: string } | { t: 'strong'; c: Inline[] } | { t: 'em'; c: Inline[] } | { t: 'code'; v: string }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET_RE = /^\s{0,3}[-*+]\s+(.*)$/
const ORDERED_RE = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/
const HR_RE = /^\s{0,3}(?:-\s*){3,}$|^\s{0,3}(?:\*\s*){3,}$|^\s{0,3}(?:_\s*){3,}$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

const isTableRow = (line: string) => line.trim().startsWith('|')

/** `| a | b |` → ['a', 'b'] (escaped pipes `\|` stay inside the cell). */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += s[i]
    }
  }
  cells.push(cur.trim())
  return cells
}

/** Inline parser: `**strong**`, `*em*` / `_em_`, `` `code` ``, `\x` escapes; an unmatched marker is literal text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(src[i + 1]!)) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) })
        i = end + 2
        continue
      }
      text += '**' // unmatched pair: literal (never half of it as an em marker)
      i += 2
      continue
    }
    if ((ch === '*' || ch === '_') && src[i + 1] !== ch && src[i + 1] !== ' ' && src[i + 1] !== undefined) {
      // `_` only at a word boundary (snake_case stays text)
      const boundary = ch === '*' || i === 0 || /[\s([{"'—-]/.test(src[i - 1]!)
      let end = src.indexOf(ch, i + 1)
      while (end > 0 && ch === '*' && src[end + 1] === '*') end = src.indexOf(ch, end + 2)
      if (boundary && end > i + 1 && src[end - 1] !== ' ' && (ch === '*' || end + 1 >= src.length || /[\s.,;:!?)\]}"'—-]/.test(src[end + 1]!))) {
        flush()
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

/** Block parser (line based). Never throws; unknown syntax becomes paragraph text. */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null
  const endPara = () => {
    if (para.length) blocks.push({ t: 'p', c: parseInline(para.join(' ')) })
    para = []
  }
  const endList = () => {
    if (list) blocks.push({ t: list.t, items: list.items.map(parseInline) })
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') {
      endPara()
      endList()
      continue
    }
    if (HR_RE.test(line)) {
      endPara()
      endList()
      blocks.push({ t: 'hr' })
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) {
      endPara()
      endList()
      blocks.push({ t: 'h', level: Math.min(h[1]!.length, 4) as 1 | 2 | 3 | 4, c: parseInline(h[2]!) })
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      endPara()
      endList()
      const head = splitRow(line)
      const rows: Inline[][][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i]!)) {
        const cells = splitRow(lines[i]!)
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')))
        i++
      }
      i--
      blocks.push({ t: 'table', head: head.map(parseInline), rows })
      continue
    }
    const b = BULLET_RE.exec(line)
    const o = b ? null : ORDERED_RE.exec(line)
    if (b || o) {
      endPara()
      const kind = b ? 'ul' : 'ol'
      if (list && list.t !== kind) endList()
      list ??= { t: kind, items: [] }
      list.items.push((b ?? o)![1]!.trim())
      continue
    }
    if (list && /^\s+\S/.test(line)) {
      // indented continuation of the last list item
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }
    endList()
    para.push(line.trim())
  }
  endPara()
  endList()
  return blocks
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!)

function inlineHtml(c: readonly Inline[]): string {
  return c
    .map((n) => {
      switch (n.t) {
        case 'text':
          return escapeHtml(n.v)
        case 'code':
          return `<code>${escapeHtml(n.v)}</code>`
        case 'strong':
          return `<strong>${inlineHtml(n.c)}</strong>`
        case 'em':
          return `<em>${inlineHtml(n.c)}</em>`
      }
    })
    .join('')
}

/** HTML of the AST: escaped text, fixed attribute-less tags only (no links, images, scripts, styles). */
export function renderHtml(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'h':
          return `<h${b.level}>${inlineHtml(b.c)}</h${b.level}>`
        case 'p':
          return `<p>${inlineHtml(b.c)}</p>`
        case 'ul':
        case 'ol':
          return `<${b.t}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${b.t}>`
        case 'hr':
          return '<hr>'
        case 'table':
          return (
            `<table><thead><tr>${b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join('')}</tr></thead>` +
            `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
          )
      }
    })
    .join('\n')
}

/** Plain text of inline nodes (titles, labels). */
export function inlineText(c: readonly Inline[]): string {
  return c.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : inlineText(n.c))).join('')
}

/**
 * Version + title of a legal notice: version = the integer after `**Versi:**` (first line that has it; the text
 * after the number, e.g. "(DRAF …)", is ignored), title = the first `#` heading. Throws when either is missing —
 * the generator refuses to bundle a notice without a version (the acknowledgement compares versions).
 */
export function noticeMeta(md: string): { version: number; title: string } {
  const v = /^\s*[-*]?\s*\*\*Versi:?\*\*:?\s*(\d{1,6})\b/m.exec(md)
  if (!v) throw new Error('privacy notice: no "**Versi:** <n>" line')
  const version = Number(v[1])
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('privacy notice: version must be an integer ≥ 1')
  const h = parseMarkdown(md).find((b): b is Extract<Block, { t: 'h' }> => b.t === 'h' && b.level === 1)
  if (!h) throw new Error('privacy notice: no "# title" heading')
  return { version, title: inlineText(h.c).trim() }
}
