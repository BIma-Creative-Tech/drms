/**
 * DRMS 10/10 12c: pure helpers of the shared image lightbox (unit-tested). A thumbnail opts in with
 * `<a href={full image} data-pk-lightbox="<group>" target="_blank">` — without JS the link still opens
 * the image in a new tab (progressive enhancement); PDFs simply do not carry the attribute.
 */
export const LIGHTBOX_ATTR = 'data-pk-lightbox'

/** `caption` (D2510 0.21.1, `data-pk-lightbox-caption`): second line under the title — date / time / location. */
export type LightboxItem = { src: string; title: string; caption?: string }

export type ZoomMode = 'fit' | 'actual'

/** Next / previous index within the group, wrapping around. */
export function step(index: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0
  return (((index + dir) % length) + length) % length
}

/** Keyboard → lightbox action (Esc is handled by <dialog> itself). */
export function keyAction(key: string): 'next' | 'prev' | 'zoom' | 'first' | 'last' | null {
  switch (key) {
    case 'ArrowRight':
    case 'PageDown':
      return 'next'
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev'
    case '+':
    case '=':
    case '-':
    case 'z':
    case 'Z':
      return 'zoom'
    case 'Home':
      return 'first'
    case 'End':
      return 'last'
    default:
      return null
  }
}

/** Horizontal swipe (touch) → navigation; short or mostly vertical moves are ignored. */
export function swipeAction(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return null
  return dx < 0 ? 'next' : 'prev'
}

/** Group members in DOM order + the index of the clicked link. */
export function collect(anchors: ReadonlyArray<{ href: string; title: string; caption?: string | null }>, clickedHref: string, clickedIndex?: number): { items: LightboxItem[]; index: number } {
  const items = anchors.map((a): LightboxItem => (a.caption ? { src: a.href, title: a.title, caption: a.caption } : { src: a.href, title: a.title }))
  const index = clickedIndex ?? Math.max(0, items.findIndex((i) => i.src === clickedHref))
  return { items, index }
}
