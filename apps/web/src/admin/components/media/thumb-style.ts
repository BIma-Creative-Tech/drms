/**
 * D2510 image preview (web 0.21.1): styles of ImageThumb / ThumbList, rendered ONCE for the whole admin by the
 * LightboxProvider (admin.components.providers). Unlayered like the views' style strings, so a thumbnail looks the
 * same in a custom view, a Payload edit form or a list cell. Colours = --pk-* tokens only (light + dark follow the
 * theme); long file names wrap (owner rule 2026-10-16, no ellipsis); ≥ 44 px targets on touch screens.
 */
export const THUMB_STYLE = `
.pk-thumb { position: relative; box-sizing: border-box; display: inline-grid; place-items: center; flex: none; width: var(--pk-thumb, 64px); height: var(--pk-thumb, 64px); margin: 0; padding: 0; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m, 6px); background: var(--pk-muted-bg); color: var(--pk-muted-fg); overflow: hidden; vertical-align: middle; text-decoration: none; cursor: zoom-in; transition: border-color .15s ease, box-shadow .15s ease; }
.pk-thumb img { display: block; width: 100%; height: 100%; max-width: none; object-fit: cover; border: 0; border-radius: 0; }
.pk-thumb:hover { border-color: var(--pk-primary); box-shadow: 0 0 0 1px var(--pk-primary); }
.pk-thumb:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-thumb.fill { width: 100%; height: 100%; border: 0; border-radius: inherit; }
.pk-thumb.fill:hover { box-shadow: none; }
.pk-thumb.file { display: inline-flex; align-items: center; gap: 6px; width: auto; height: auto; min-height: 32px; max-width: 100%; padding: 4px 10px; font-size: 12px; font-weight: 600; line-height: 1.35; color: var(--pk-primary); background: var(--pk-card); overflow-wrap: anywhere; cursor: pointer; }
.pk-thumb.file svg { flex: none; }
.pk-thumb.missing { cursor: default; border-style: dashed; }
.pk-thumb.missing:hover { border-color: var(--pk-border); box-shadow: none; }
.pk-thumb-list { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pk-thumb-list > li { display: grid; gap: 3px; justify-items: center; min-width: 0; margin: 0; }
.pk-thumb-list > li > small { max-width: 96px; font-size: 11px; line-height: 1.3; color: var(--pk-muted-fg); text-align: center; overflow-wrap: anywhere; }
.pk-thumb-field { margin-bottom: var(--spacing-field, 16px); }
.pk-thumb-field .pk-thumb-empty { font-size: 13px; color: var(--pk-muted-fg); }
@media (pointer: coarse) { .pk-thumb { min-width: 44px; min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .pk-thumb { transition: none; } }
`
