/**
 * FR1 web views — styles (pure module, also imported by unit tests): matrix, tabs/chips, timeline,
 * follow-up list, forms (sections, line editor, photo picker, hours bar), wide dialog. Theme tokens
 * only (--pk-* / --viz-*), light + dark via html[data-theme]; touch targets 44 px on coarse pointers.
 */
export const FIELD_STYLE = `
/* D2510 (Nexus tabs-box): the tab bar is a segmented box, the current tab a raised card-coloured pill */
.pk-f3 .pk-ftabs { display: flex; flex-wrap: wrap; gap: 4px; width: fit-content; max-width: 100%; box-sizing: border-box; margin: 0 0 16px; padding: 4px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); background: var(--pk-muted-bg); }
.pk-f3 .pk-ftabs a { display: inline-flex; align-items: center; min-height: 36px; padding: 0 14px; font-size: 13.5px; font-weight: 600; color: var(--pk-muted-fg); text-decoration: none; border-radius: var(--style-radius-m); }
.pk-f3 .pk-ftabs a:hover { color: var(--pk-fg); background: color-mix(in oklab, var(--pk-card) 55%, transparent); }
.pk-f3 .pk-ftabs a[aria-current='page'] { color: var(--pk-primary-hover); background: var(--pk-card); box-shadow: 0 1px 2px rgb(15 23 42 / .12), 0 0 0 1px color-mix(in oklab, var(--pk-border) 70%, transparent); }
.pk-f3 .pk-ftabs a:focus-visible, .pk-f3 .pk-chips a:focus-visible, .pk-f3 .pk-mx a:focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-f3 .pk-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; }
.pk-f3 .pk-chips > span { font-size: 13px; font-weight: 600; color: var(--pk-muted-fg); }
.pk-f3 .pk-chips a { display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid color-mix(in oklab, var(--pk-muted-fg) 45%, var(--pk-input)); font-size: 13px; font-weight: 600; color: var(--pk-fg); text-decoration: none; background: var(--pk-card); }
.pk-f3 .pk-chips a:hover { border-color: var(--pk-primary); color: var(--pk-primary); }
.pk-f3 .pk-chips a[aria-current='true'] { background: var(--pk-primary); border-color: var(--pk-primary); color: var(--pk-on-primary); }
@media (pointer: coarse) { .pk-f3 .pk-chips a, .pk-f3 .pk-ftabs a { min-height: 44px; } }
.pk-f3 .pk-tag { display: inline-flex; align-items: center; justify-content: center; min-width: 84px; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; flex: none; color: var(--pk-primary-hover); background: color-mix(in oklab, var(--pk-primary) 12%, transparent); }
.pk-f3 .pk-tag.servis { color: var(--pk-tone-warn-text); background: color-mix(in oklab, var(--pk-tone-warn-text) 13%, transparent); }
.pk-f3 .pk-tag.aktivitas { color: var(--pk-tone-ok-text); background: color-mix(in oklab, var(--pk-tone-ok-text) 12%, transparent); }
.pk-f3 .pk-tag.harian { color: var(--pk-fg); background: color-mix(in oklab, var(--pk-muted-fg) 14%, transparent); }
/* timesheet matrix (unit × day) */
.pk-f3 .pk-mxw { position: relative; overflow-x: auto; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); }
.pk-f3 table.pk-mx { border-collapse: separate; border-spacing: 0; width: 100%; min-width: 760px; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-mx th, .pk-f3 .pk-mx td { padding: 0; text-align: center; border-bottom: 1px solid var(--pk-border); border-right: 1px solid color-mix(in oklab, var(--pk-border) 60%, transparent); }
.pk-f3 .pk-mx thead th { font-size: 11.5px; font-weight: 600; color: var(--pk-muted-fg); padding: 6px 2px; background: var(--pk-card); }
.pk-f3 .pk-mx thead th.we { color: var(--pk-fg); }
.pk-f3 .pk-mx th.u, .pk-f3 .pk-mx td.u { position: sticky; left: 0; z-index: 1; background: var(--pk-card); text-align: left; padding: 6px 10px; min-width: 132px; max-width: 180px; font-weight: 600; overflow-wrap: break-word; } /* DRMS 16/10: wraps inside 180 px, no ellipsis */
.pk-f3 .pk-mx td.u small { display: block; font-weight: 400; color: var(--pk-muted-fg); font-size: 11px; }
.pk-f3 .pk-mx td.t { padding: 6px 10px; text-align: right; font-weight: 700; white-space: nowrap; }
.pk-f3 .pk-mx tbody tr:last-child td { border-bottom: 0; }
.pk-f3 .pk-mx td.c a, .pk-f3 .pk-mx td.c span { display: flex; align-items: center; justify-content: center; min-width: 32px; min-height: 34px; padding: 0 2px; color: inherit; text-decoration: none; font-weight: 600; }
.pk-f3 .pk-mx td.c a:hover { background: color-mix(in oklab, var(--pk-primary) 10%, transparent); }
.pk-f3 .pk-mx td.missing { background: color-mix(in oklab, var(--pk-tone-bad-text) 13%, var(--pk-card)); }
.pk-f3 .pk-mx td.missing a { color: var(--pk-tone-bad-text); font-weight: 700; }
.pk-f3 .pk-mx td.breakdown { background: color-mix(in oklab, var(--pk-tone-warn-text) 16%, var(--pk-card)); color: var(--pk-tone-warn-text); }
.pk-f3 .pk-mx td.breakdown a { font-weight: 800; }
.pk-f3 .pk-mx td.off span, .pk-f3 .pk-mx td.future span { color: var(--pk-muted-fg); font-weight: 400; }
.pk-f3 .pk-mx td.today { box-shadow: inset 0 0 0 2px var(--pk-primary); }
.pk-f3 .pk-mx .gap { font-size: 10px; margin-left: 1px; color: var(--pk-tone-warn-text); }
.pk-f3 .pk-mx tfoot td { font-weight: 700; padding: 6px 4px; border-top: 2px solid var(--pk-border); border-bottom: 0; }
.pk-f3 .pk-mxlegend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--pk-muted-fg); margin: 0 0 10px; }
.pk-f3 .pk-mxlegend i { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: -3px; margin-right: 6px; border: 1px solid var(--pk-border); }
.pk-f3 .pk-mxlegend i.missing { background: color-mix(in oklab, var(--pk-tone-bad-text) 13%, var(--pk-card)); }
.pk-f3 .pk-mxlegend i.breakdown { background: color-mix(in oklab, var(--pk-tone-warn-text) 16%, var(--pk-card)); }
.pk-f3 .pk-mxlegend i.today { box-shadow: inset 0 0 0 2px var(--pk-primary); }
/* estimate badge */
.pk-f3 .pk-est { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; color: var(--pk-tone-warn-text); background: color-mix(in oklab, var(--pk-tone-warn-text) 12%, transparent); }
.pk-f3 .pk-t td.bad { color: var(--pk-tone-bad-text); font-weight: 700; } .pk-f3 .pk-t td.warn { color: var(--pk-tone-warn-text); font-weight: 700; }
.pk-f3 .pk-t tfoot td { font-weight: 700; border-top: 2px solid var(--pk-border); padding: 9px 10px; }
/* field timeline (by date) */
.pk-f3 .pk-ftl { display: grid; gap: 18px; }
.pk-f3 .pk-ftl > section + section { border-top: 1px solid var(--pk-border); padding-top: 16px; }
.pk-f3 .pk-ftl h3 { margin: 0 0 10px; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--pk-muted-fg); }
.pk-f3 .pk-ftl ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.pk-f3 .pk-ftl li { display: flex; gap: 12px; align-items: flex-start; }
.pk-f3 .pk-ftl li .b { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
.pk-f3 .pk-ftl li .b strong { overflow-wrap: anywhere; }
.pk-f3 .pk-ftl li .b span { color: var(--pk-muted-fg); overflow-wrap: anywhere; }
.pk-f3 .pk-ftl li .b em { font-style: normal; color: var(--pk-tone-bad-text); font-weight: 600; }
@media (max-width: 559px) { .pk-f3 .pk-ftl li { flex-wrap: wrap; } .pk-f3 .pk-ftl li .b { flex-basis: calc(100% - 100px); } }
/* follow-up list */
.pk-f3 .pk-todo { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pk-f3 .pk-todo li { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: var(--style-radius-m); border: 1px solid color-mix(in oklab, var(--pk-border) 70%, transparent); background: color-mix(in oklab, var(--pk-muted-fg) 6%, var(--pk-card)); }
.pk-f3 .pk-todo li.bad { background: color-mix(in oklab, var(--pk-tone-bad-text) 9%, var(--pk-card)); }
.pk-f3 .pk-todo li.warn { background: color-mix(in oklab, var(--pk-tone-warn-text) 11%, var(--pk-card)); }
.pk-f3 .pk-todo li .b { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.pk-f3 .pk-todo li .b span { color: var(--pk-muted-fg); overflow-wrap: anywhere; }
.pk-f3 .pk-todo li.bad .b span { color: var(--pk-tone-bad-text); } .pk-f3 .pk-todo li.warn .b span { color: var(--pk-tone-warn-text); }
.pk-f3 .pk-kpi[data-pk-tile='as-open-alert'] { border-color: color-mix(in oklab, var(--pk-tone-warn-text) 45%, var(--pk-border)); background: color-mix(in oklab, var(--pk-tone-warn-text) 6%, var(--pk-card)); }
.pk-f3 .pk-hist { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; }
.pk-f3 .pk-hist li { border-left: 3px solid var(--pk-border); padding: 2px 0 2px 10px; }
.pk-f3 .pk-hist li.correction { border-left-color: var(--pk-tone-warn-text); }
.pk-f3 .pk-hist small { display: block; color: var(--pk-muted-fg); }
.pk-f3 .pk-rowacts { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.pk-f3 .pk-filter select, .pk-f3 .pk-filter input:not([type='checkbox'], [type='radio']) { min-height: 34px; }
@media (pointer: coarse) { .pk-f3 .pk-filter select, .pk-f3 .pk-filter input:not([type='checkbox'], [type='radio']) { min-height: 44px; } }
/* forms */
.pk-f3 .pk-fsec { display: grid; gap: 14px; padding: 0 0 18px; border-bottom: 1px solid var(--pk-border); }
.pk-f3 .pk-fsec:last-of-type { border-bottom: 0; }
.pk-f3 .pk-fsec h2 { margin: 0; font-size: 16px; line-height: 1.3; }
.pk-f3 .pk-fsec-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.pk-f3 .pk-kgrid.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 479px) { .pk-f3 .pk-kgrid.c3 { grid-template-columns: minmax(0, 1fr); } }
.pk-f3 fieldset.pk-fld, .pk-f3 fieldset.pk-lines { border: 0; margin: 0; padding: 0; min-width: 0; }
.pk-f3 fieldset.pk-fld legend, .pk-f3 fieldset.pk-lines legend { font-size: 13px; font-weight: 600; color: var(--pk-fg); margin: 0 0 6px; padding: 0; }
.pk-f3 .pk-choice .pk-seg { border-radius: var(--style-radius-m); }
.pk-f3 .pk-choice .pk-seg label { border-radius: var(--style-radius-s); }
.pk-f3 .pk-seg label:has(input:checked) { background: var(--pk-primary); color: var(--pk-on-primary); }
.pk-f3 .pk-lines { display: grid; gap: 8px; }
.pk-f3 .pk-lines-h, .pk-f3 .pk-line { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 120px) 76px 72px auto; gap: 6px; align-items: center; }
.pk-f3 .pk-lines-h { font-size: 12px; font-weight: 600; color: var(--pk-muted-fg); }
/* DRMS owner 2026-10-17: service-report spare parts without the part-number column */
.pk-f3 .pk-lines.no-pn .pk-lines-h, .pk-f3 .pk-lines.no-pn .pk-line { grid-template-columns: minmax(0, 1fr) 76px 72px auto; }
/* "Jenis servis" checkbox pills: long names wrap (never cut) */
.pk-f3 .pk-checks .pk-seg label { min-height: 34px; height: auto; padding: 6px 14px; line-height: 1.3; white-space: normal; overflow-wrap: anywhere; text-align: left; }
.pk-f3 .pk-checks .pk-seg label:has(input:disabled) { cursor: not-allowed; opacity: .6; }
.pk-f3 .pk-line :is(input:not([type='checkbox'], [type='radio']), textarea) { width: 100%; min-height: 40px; padding: 6px 8px; font: inherit; font-size: 14px; color: var(--theme-text); background: var(--theme-input-bg, var(--theme-elevation-0)); border: 1px solid var(--pk-input); border-radius: var(--style-radius-s); box-sizing: border-box; }
.pk-f3 .pk-line :is(input, textarea):focus-visible { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-f3 .pk-line :is(input, textarea)[aria-invalid='true'] { border-color: var(--pk-tone-bad-text); }
.pk-f3 .pk-line textarea { line-height: 26px; } /* DRMS 16/10 WrapText: one line = 40 px like the inputs */
.pk-f3 .pk-line .note, .pk-f3 .pk-line .err { grid-column: 1 / -1; }
.pk-f3 .pk-line .err { margin: 0; font-size: 12px; color: var(--pk-tone-bad-text); font-weight: 600; }
.pk-f3 .pk-lines .pk-add { justify-self: start; border-style: dashed; }
.pk-f3 .pk-lines .help { margin: 0; font-size: 12px; color: var(--pk-muted-fg); }
@media (max-width: 559px) {
  .pk-f3 .pk-lines-h { display: none; }
  .pk-f3 .pk-line { grid-template-columns: minmax(0, 1fr) 76px 72px; padding: 8px; border: 1px solid var(--pk-border); border-radius: var(--style-radius-m); }
  .pk-f3 .pk-line > :is(input, textarea):first-child { grid-column: 1 / -1; }
  .pk-f3 .pk-line > button { grid-column: 1 / -1; justify-self: start; }
  .pk-f3 .pk-lines.no-pn .pk-line { grid-template-columns: minmax(0, 1fr) 72px; }
}
@media (pointer: coarse) { .pk-f3 .pk-line :is(input:not([type='checkbox'], [type='radio']), textarea) { min-height: 44px; } }
.pk-f3 .pk-photos { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.pk-f3 .pk-photos li { display: grid; gap: 6px; justify-items: start; }
.pk-f3 .pk-photos img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--style-radius-m); border: 1px solid var(--pk-border); background: var(--viz-track); display: block; }
.pk-f3 .pk-photos li.add { align-self: center; }
.pk-f3 .pk-photos .pk-photo-tag { font-size: 11.5px; color: var(--pk-muted-fg); } /* edit pages: a stored photo (never removed) */
.pk-f3 .pk-photos label.pk-kbtn:has(+ input:focus-visible) { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-f3 .pk-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.pk-f3 .pk-hours { display: flex; gap: 2px; height: 10px; border-radius: 999px; background: var(--viz-track); overflow: hidden; }
.pk-f3 .pk-hours span { display: block; height: 100%; }
.pk-f3 .pk-hours .w { background: var(--viz-1); } .pk-f3 .pk-hours .s { background: var(--pk-tone-warn); } .pk-f3 .pk-hours .b { background: var(--pk-tone-bad); }
.pk-f3 .pk-hours.over { outline: 2px solid var(--pk-tone-bad-text); outline-offset: 1px; }
.pk-f3 .pk-check { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; font-size: 14px; font-weight: 600; cursor: pointer; } /* box: native normalisation (custom.scss) */
.pk-f3 .pk-fsubmit { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; justify-content: space-between; padding-top: 4px; }
.pk-f3 .pk-fsubmit > .pk-note { flex: 1 1 12rem; } /* edit pages: Batal + submit stay together at the end */
.pk-f3 .pk-fsubmit .pk-note { margin: 0; }
.pk-f3 .pk-fsubmit .pk-kbtn { min-height: 46px; padding: 0 22px; font-size: 15px; }
@media (max-width: 559px) { .pk-f3 .pk-fsubmit .pk-kbtn { width: 100%; } }
.pk-dlg.pk-dlg-wide { width: min(720px, calc(100vw - 32px)); }
.pk-dlg.pk-dlg-wide form { max-height: calc(100dvh - 48px); overflow: auto; }
.pk-dlg .pk-kgrid { gap: 12px 16px; }
`
