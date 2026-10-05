import React from 'react'

import type { Block, Inline } from './markdown'
import { privacyNoticeBlocks } from './privacy-notice'

/**
 * The bundled privacy notice as React elements, built from the markdown AST (src/legal/markdown.ts): React escapes
 * every text node and no raw-HTML sink is used. No hooks → usable from server components (/privasi, admin shell)
 * and passed as children into the client interstitial.
 */
function inlines(c: readonly Inline[]): React.ReactNode[] {
  return c.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <React.Fragment key={i}>{n.v}</React.Fragment>
      case 'code':
        return <code key={i}>{n.v}</code>
      case 'strong':
        return <strong key={i}>{inlines(n.c)}</strong>
      case 'em':
        return <em key={i}>{inlines(n.c)}</em>
    }
  })
}

function block(b: Block, i: number, skipTitle: boolean): React.ReactNode {
  switch (b.t) {
    case 'h': {
      if (b.level === 1 && skipTitle) return null
      const Tag = `h${Math.min(b.level + (skipTitle ? 1 : 0), 4)}` as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag key={i}>{inlines(b.c)}</Tag>
    }
    case 'p':
      return <p key={i}>{inlines(b.c)}</p>
    case 'ul':
      return (
        <ul key={i}>
          {b.items.map((it, k) => (
            <li key={k}>{inlines(it)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={i}>
          {b.items.map((it, k) => (
            <li key={k}>{inlines(it)}</li>
          ))}
        </ol>
      )
    case 'hr':
      return <hr key={i} />
    case 'table':
      return (
        <div key={i} className="pk-privacy__table">
          <table>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  <th key={k} scope="col">
                    {inlines(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j}>{inlines(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/**
 * `skipTitle`: the caller shows the notice title itself (heading levels shift down by one so the outline stays
 * valid). `blocks` defaults to the bundled notice (a test seam).
 */
export function PrivacyNoticeBody({ skipTitle = false, blocks = privacyNoticeBlocks() }: { skipTitle?: boolean; blocks?: readonly Block[] }) {
  return <div className="pk-privacy">{blocks.map((b, i) => block(b, i, skipTitle))}</div>
}

export default PrivacyNoticeBody
