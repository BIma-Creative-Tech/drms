/**
 * E2 Kas UI styles (forms, segmented controls, dialogs, alerts). Colours only through theme tokens
 * (--pk-* / Payload --theme-*, src/theme/tokens.ts → (payload)/custom.scss), so light and dark
 * follow html[data-theme]. Self-contained (not scoped to .pk-f3) because the reason dialog is also
 * used inside the expense-request edit view. Touch targets ≥ 44 px on coarse pointers, visible
 * focus ring on every control, reduced motion respected. D2510 (ADR 0033): Nexus look — soft alerts, rounder
 * dialog, ghost button; the one button box of DRMS 15/10 #5 is unchanged.
 */
export const KAS_STYLE = `
.pk-kbtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-sizing: border-box; min-height: 38px; padding: 0 14px; border-radius: var(--style-radius-m); border: 1px solid var(--pk-btn-border); background: var(--pk-card); color: var(--pk-fg); font: inherit; font-size: 13px; font-weight: 600; line-height: 1.2; cursor: pointer; text-decoration: none; white-space: nowrap; transition: background-color .15s ease, border-color .15s ease, color .15s ease; }
.pk-kbtn:hover { border-color: var(--pk-primary); color: var(--pk-primary); }
.pk-kbtn:focus-visible, .pk-fld :is(input:not([type='checkbox'], [type='radio']), select, textarea):focus-visible, .pk-seg label:has(input:focus-visible) { outline: 2px solid var(--pk-ring); outline-offset: 2px; }
.pk-kbtn[disabled] { opacity: .6; cursor: progress; }
.pk-kbtn.primary { background: var(--pk-primary); border-color: var(--pk-primary); color: var(--pk-on-primary); }
.pk-kbtn.primary:hover { background: var(--pk-primary-hover); border-color: var(--pk-primary-hover); color: var(--pk-on-primary); }
.pk-kbtn.danger { color: var(--pk-tone-bad-text); border-color: color-mix(in oklab, var(--pk-tone-bad-text) 45%, var(--pk-input)); }
.pk-kbtn.danger:hover { background: color-mix(in oklab, var(--pk-tone-bad-text) 10%, transparent); color: var(--pk-tone-bad-text); border-color: var(--pk-tone-bad-text); }
.pk-kbtn.danger-solid { background: var(--pk-tone-bad); border-color: var(--pk-tone-bad); color: #FFFFFF; }
.pk-kbtn.danger-solid:hover { filter: brightness(1.08); color: #FFFFFF; }
.pk-kbtn.sm { min-height: 32px; padding: 0 10px; }
/* D2510 (Nexus btn-ghost): a quiet action next to a primary one — no border until hovered */
.pk-kbtn.ghost { border-color: transparent; background: transparent; }
.pk-kbtn.ghost:hover { border-color: transparent; background: var(--pk-muted-bg); color: var(--pk-fg); }
@media (pointer: coarse) { .pk-kbtn, .pk-kbtn.sm { min-height: 44px; } .pk-fld :is(input:not([type='checkbox'], [type='radio']), select) { min-height: 44px; } }
.pk-kact { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.pk-kform { display: grid; gap: 16px; }
.pk-kgrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
@media (min-width: 760px) { .pk-kgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; } .pk-kgrid .full { grid-column: 1 / -1; } }
.pk-fld { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pk-fld > label, .pk-fld > .lbl { font-size: 13px; font-weight: 600; color: var(--pk-fg); }
.pk-fld .req { color: var(--pk-tone-bad-text); margin-left: 2px; }
/* DRMS 15/10 #2: checkboxes / radios inside a field keep their native 16 px box (custom.scss), never a 40 px input */
.pk-fld :is(input:not([type='checkbox'], [type='radio']), select, textarea) { width: 100%; min-height: 40px; padding: 8px 10px; font: inherit; font-size: 14px; color: var(--theme-text); background: var(--theme-input-bg, var(--theme-elevation-0)); border: 1px solid var(--pk-input); border-radius: var(--style-radius-s); box-sizing: border-box; }
.pk-fld textarea { min-height: 88px; resize: vertical; line-height: 1.5; }
.pk-fld input[type='file'] { padding: 7px 8px; }
.pk-fld [aria-invalid='true'] { border-color: var(--pk-tone-bad-text); }
.pk-fld .help { font-size: 12px; color: var(--pk-muted-fg); margin: 0; line-height: 1.45; }
.pk-fld .err { font-size: 12px; color: var(--pk-tone-bad-text); margin: 0; font-weight: 600; }
.pk-money { position: relative; }
.pk-money > span { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 14px; color: var(--pk-muted-fg); pointer-events: none; }
/* UI feedback 17/10 #1: the generic .pk-fld input rule above (0,2,1; padding 8px 10px) beat a plain .pk-money > input
   (0,1,1), so the typed amount started under the prefix. The .pk-fld selector mirrors that rule's :not() (0,3,1): the
   prefix room wins whatever the order. */
.pk-money > input, .pk-fld .pk-money > input:not([type='checkbox'], [type='radio']) { padding-left: 36px; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 16px; }
.pk-seg { display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; background: var(--pk-muted-bg); border: 1px solid var(--pk-border); width: fit-content; max-width: 100%; }
.pk-seg label { position: relative; display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--pk-muted-fg); cursor: pointer; }
.pk-seg input { position: absolute; opacity: 0; pointer-events: none; }
.pk-seg label:has(input:checked) { background: var(--pk-card); color: var(--pk-fg); box-shadow: 0 1px 2px rgb(15 23 42 / .12); }
.pk-seg.dir label:has(input[value='in']:checked) { color: var(--pk-primary); }
.pk-seg.dir label:has(input[value='out']:checked) { color: var(--pk-tone-warn-text); }
@media (pointer: coarse) { .pk-seg label { min-height: 44px; } }
/* D2510 (Nexus): alerts are soft (daisyUI alert-soft) — the tone as a faint tint + border, text stays --pk-fg (AA) */
.pk-alert { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border-radius: var(--style-radius-l); border: 1px solid color-mix(in oklab, var(--pk-border) 85%, transparent); background: var(--pk-card); font-size: 13px; line-height: 1.5; margin: 0 0 16px; }
.pk-alert > b:first-child { flex: none; width: 20px; height: 20px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 12px; color: #FFFFFF; background: var(--pk-muted-fg); }
.pk-alert.ok { border-color: color-mix(in oklab, var(--pk-tone-ok-text) 28%, var(--pk-border)); background: color-mix(in oklab, var(--pk-tone-ok-text) 8%, var(--pk-card)); } .pk-alert.ok > b:first-child { background: var(--pk-tone-ok); }
.pk-alert.bad { border-color: color-mix(in oklab, var(--pk-tone-bad-text) 28%, var(--pk-border)); background: color-mix(in oklab, var(--pk-tone-bad-text) 8%, var(--pk-card)); } .pk-alert.bad > b:first-child { background: var(--pk-tone-bad); }
.pk-alert.info { border-color: color-mix(in oklab, var(--pk-primary) 24%, var(--pk-border)); background: color-mix(in oklab, var(--pk-primary) 6%, var(--pk-card)); } .pk-alert.info > b:first-child { background: var(--pk-primary); color: var(--pk-on-primary); }
.pk-alert p { margin: 0; }
.pk-dlg { width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid color-mix(in oklab, var(--pk-border) 80%, transparent); border-radius: calc(var(--style-radius-l) * 1.25); background: var(--pk-card); color: var(--pk-fg); box-shadow: 0 24px 48px -12px rgb(15 23 42 / .35); }
.pk-dlg::backdrop { background: rgb(2 6 23 / .55); }
.pk-dlg[open] { animation: pk-dlg-in .18s ease-out; }
@keyframes pk-dlg-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pk-dlg[open] { animation: none; } .pk-kbtn { transition: none; } }
.pk-dlg form, .pk-dlg [role="form"] { display: grid; gap: 14px; padding: 22px 24px; }
.pk-dlg h2 { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3; }
.pk-dlg .desc { margin: 0; font-size: 13px; color: var(--pk-muted-fg); line-height: 1.5; }
.pk-dlg .foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.pk-kerr { color: var(--pk-tone-bad-text); font-size: 12px; font-weight: 600; margin: 0; }
`
