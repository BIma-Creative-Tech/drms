import React from 'react'

import { niceMax, periodLabel, shortRupiah } from '@/domain/reports/rules'
import type { PillTone } from '@/domain/reports/viz'
import { formatRupiah } from '@/lib/money'

/**
 * Beranda dashboard kit (redesign 2026-09-25, user feedback "terlalu text based"). Server
 * components, no chart library: inline SVG / HTML bars, one tiny client tooltip layer
 * (ChartHover.tsx). Method = dataviz skill:
 * - form first: headline numbers are stat tiles (value + delta + 12-point mini columns), part of
 *   a whole / categories = sorted horizontal bars (no donut), time = columns or line, ordered
 *   stages = ordinal one-hue ramp, budget vs RAB = bullet rows;
 * - colours are ramp steps of src/theme/tokens.ts (no raw hex here), validated with the dataviz
 *   validator per mode against the card surface (light #FFFFFF, dark #111A2E):
 *   categorical Masuk/Keluar light blue-500/orange-500, dark blue-450/orange-500 (all checks PASS;
 *   dark blue-400 failed the lightness band); ordinal light blue 350→450→600→800→900, dark
 *   550→450→400→300→150; komitmen/realisasi pair light 350/600, dark 550/300 (ordinal PASS);
 * - thin marks (≤ 24px bars, 4px rounded data end, square at the baseline, 2px gaps, 2px lines),
 *   solid hairline grid, text in text tokens (never series colour), legend for ≥ 2 series;
 * - every chart has a table view (<details>), tooltips only enhance; marks are focusable;
 * - light + dark via html[data-theme] (Payload), container queries for narrow cards,
 *   one subtle enter animation, none with prefers-reduced-motion.
 * All text goes through React escaping. `data-pk-*` = stable UAT selectors.
 */
export const VIZ_STYLE = `
.pk-f3 {
  --viz-1: var(--color-blue-500); --viz-2: var(--color-warning-500);
  --viz-soft: var(--color-blue-350); --viz-strong: var(--color-blue-600);
  --viz-o1: var(--color-blue-350); --viz-o2: var(--color-blue-450); --viz-o3: var(--color-blue-600); --viz-o4: var(--color-blue-800); --viz-o5: var(--color-blue-900);
  --viz-mute: var(--color-base-300); --viz-grid: var(--pk-border); --viz-axis: var(--color-base-250); --viz-ink: var(--pk-fg);
  --viz-track: var(--pk-muted-bg); --viz-surface: var(--pk-card);
  --pk-in: var(--viz-1); --pk-out: var(--viz-2);
}
html[data-theme='dark'] .pk-f3 {
  --viz-1: var(--color-blue-450); --viz-2: var(--color-warning-500);
  --viz-soft: var(--color-blue-550); --viz-strong: var(--color-blue-300);
  --viz-o1: var(--color-blue-550); --viz-o2: var(--color-blue-450); --viz-o3: var(--color-blue-400); --viz-o4: var(--color-blue-300); --viz-o5: var(--color-blue-150);
  --viz-mute: var(--color-base-650); --viz-axis: var(--color-base-700);
}
.pk-f3 .pk-dash-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 8px 16px; margin: 24px 0 16px; }
.pk-f3 .pk-dash-head h1 { margin: 0; font-size: 28px; line-height: 1.2; }
.pk-f3 .pk-dash-head p { margin: 4px 0 0; color: var(--pk-muted-fg); font-size: 13px; }
.pk-f3 .pk-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; margin: 0 0 24px; }
.pk-f3 .pk-kpis { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.pk-f3 .pk-kpis.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } .pk-f3 .pk-kpis.c6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 1279px) { .pk-f3 .pk-kpis.c6 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1099px) { .pk-f3 .pk-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pk-f3 .pk-kpis.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 899px) { .pk-f3 .pk-kpis.c6, .pk-f3 .pk-kpis.c3 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 559px) { .pk-f3 .pk-kpis, .pk-f3 .pk-kpis.c3, .pk-f3 .pk-kpis.c6 { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
.pk-f3 .pk-card { grid-column: span 12; min-width: 0; background: var(--pk-card); border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); box-shadow: var(--pk-shadow); padding: 16px 18px; container-type: inline-size; display: flex; flex-direction: column; }
.pk-f3 .pk-card.s3 { grid-column: span 3; } .pk-f3 .pk-card.s4 { grid-column: span 4; } .pk-f3 .pk-card.s5 { grid-column: span 5; }
.pk-f3 .pk-card.s6 { grid-column: span 6; } .pk-f3 .pk-card.s7 { grid-column: span 7; } .pk-f3 .pk-card.s8 { grid-column: span 8; }
@media (max-width: 1279px) { .pk-f3 .pk-card.s3, .pk-f3 .pk-card.s4, .pk-f3 .pk-card.s5 { grid-column: span 6; } .pk-f3 .pk-card.s7, .pk-f3 .pk-card.s8 { grid-column: span 12; } }
@media (max-width: 899px) { .pk-f3 .pk-card.s3, .pk-f3 .pk-card.s4, .pk-f3 .pk-card.s5, .pk-f3 .pk-card.s6 { grid-column: span 12; } .pk-f3 .pk-bento { gap: 12px; } }
.pk-f3 .pk-card-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; margin: 0 0 12px; }
.pk-f3 .pk-card-h h2 { margin: 0; font-size: 16px; line-height: 1.3; }
.pk-f3 .pk-card-h .sub { display: block; margin-top: 2px; font-size: 12px; color: var(--pk-muted-fg); font-family: var(--font-body); letter-spacing: 0; font-weight: 400; }
.pk-f3 .pk-card-h a { font-size: 12px; font-weight: 600; color: var(--pk-primary); text-decoration: none; white-space: nowrap; }
.pk-f3 .pk-card-h a:hover { text-decoration: underline; }
.pk-f3 .pk-card-b { flex: 1; min-width: 0; }
.pk-f3 .pk-card-f { margin: 12px 0 0; font-size: 12px; color: var(--pk-muted-fg); }
/* stat tiles */
.pk-f3 .pk-kpi { position: relative; background: var(--pk-card); border: 1px solid var(--pk-border); border-radius: var(--style-radius-l); box-shadow: var(--pk-shadow); padding: 14px 16px 12px; min-width: 0; display: flex; flex-direction: column; gap: 4px; transition: box-shadow .2s ease, border-color .2s ease; }
.pk-f3 .pk-kpi:has(a.pk-kpi-link:hover) { box-shadow: var(--pk-shadow-hover); border-color: color-mix(in oklab, var(--pk-primary) 35%, var(--pk-border)); }
.pk-f3 .pk-kpi-l { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--pk-muted-fg); margin: 0; }
.pk-f3 .pk-kpi-l .ic { width: 28px; height: 28px; border-radius: 8px; display: inline-grid; place-items: center; background: color-mix(in oklab, var(--pk-primary) 12%, transparent); color: var(--pk-primary); flex: none; }
.pk-f3 .pk-kpi-l .ic svg { width: 16px; height: 16px; }
.pk-f3 .pk-kpi-v { font-family: var(--pk-font-heading); font-size: clamp(22px, 1.9vw, 26px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; margin: 6px 0 0; color: var(--pk-fg); overflow-wrap: anywhere; }
.pk-f3 .pk-kpi.hero .pk-kpi-v { font-size: clamp(36px, 3.6vw, 48px); }
.pk-f3 .pk-kpi-x { font-size: 12px; color: var(--pk-muted-fg); margin: 0; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-kpi-x b { color: var(--pk-fg); font-weight: 600; }
.pk-f3 .pk-kpi a.pk-kpi-link { position: absolute; inset: 0; border-radius: inherit; }
.pk-f3 .pk-kpi a.pk-kpi-link:focus-visible { outline: var(--accessibility-outline); outline-offset: 2px; }
.pk-f3 .pk-kpi .pk-kpi-more { margin-top: auto; padding-top: 6px; font-size: 12px; font-weight: 600; color: var(--pk-primary); }
.pk-f3 .pk-delta { display: block; margin: 0; font-size: 12px; line-height: 1.45; font-weight: 600; color: var(--pk-muted-fg); }
.pk-f3 .pk-delta > span:first-child { margin-right: 4px; font-size: 10px; }
.pk-f3 .pk-delta.good { color: var(--pk-tone-ok-text); } .pk-f3 .pk-delta.bad { color: var(--pk-tone-bad-text); }
.pk-f3 .pk-delta span { font-weight: 400; color: var(--pk-muted-fg); }
.pk-f3 svg.pk-spark { width: 100%; height: 34px; display: block; margin: 6px 0 2px; }
.pk-f3 svg.pk-spark rect { fill: var(--viz-mute); } .pk-f3 svg.pk-spark rect.cur { fill: var(--viz-1); }
.pk-f3 svg.pk-spark line { stroke: var(--viz-axis); stroke-width: 1; vector-effect: non-scaling-stroke; }
.pk-f3 .pk-meter { height: 8px; border-radius: 999px; background: color-mix(in oklab, var(--viz-1) 16%, var(--viz-track)); overflow: hidden; margin: 8px 0 4px; }
.pk-f3 .pk-meter > span { display: block; height: 100%; border-radius: 999px; background: var(--viz-1); }
.pk-f3 .pk-meter.warn > span { background: var(--pk-tone-warn); } .pk-f3 .pk-meter.over > span { background: var(--pk-tone-bad); }
.pk-f3 .pk-split { display: flex; height: 8px; gap: 2px; margin: 8px 0 4px; }
.pk-f3 .pk-split > span { border-radius: 2px; min-width: 2px; } .pk-f3 .pk-split > span:first-child { border-radius: 999px 2px 2px 999px; } .pk-f3 .pk-split > span:last-child { border-radius: 2px 999px 999px 2px; }
.pk-f3 .pk-split .o1 { background: var(--viz-o1); } .pk-f3 .pk-split .o2 { background: var(--viz-o3); }
/* legend */
.pk-f3 .pk-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--pk-muted-fg); margin: 0 0 8px; }
.pk-f3 .pk-legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.pk-f3 .pk-legend .ln { display: inline-block; width: 2px; height: 12px; margin-right: 6px; vertical-align: -2px; background: var(--viz-ink); }
/* key colours shared by svg marks, legend swatches, bars and tooltip keys */
.pk-f3 .in { fill: var(--viz-1); background: var(--viz-1); } .pk-f3 .out { fill: var(--viz-2); background: var(--viz-2); }
.pk-f3 .s1 { fill: var(--viz-1); background: var(--viz-1); } .pk-f3 .soft { fill: var(--viz-soft); background: var(--viz-soft); } .pk-f3 .strong { fill: var(--viz-strong); background: var(--viz-strong); }
.pk-f3 .o1 { background: var(--viz-o1); } .pk-f3 .o2 { background: var(--viz-o2); } .pk-f3 .o3 { background: var(--viz-o3); } .pk-f3 .o4 { background: var(--viz-o4); } .pk-f3 .o5 { background: var(--viz-o5); } .pk-f3 .mute { background: var(--viz-mute); fill: var(--viz-mute); }
/* svg charts: wide/narrow variants by card width (container query) */
.pk-f3 .pk-svgc svg { width: 100%; height: auto; display: block; overflow: visible; }
.pk-f3 .pk-svgc .narrow { display: none; }
@container (max-width: 520px) { .pk-f3 .pk-svgc .wide { display: none; } .pk-f3 .pk-svgc .narrow { display: block; } }
.pk-f3 .pk-svgc text { fill: var(--pk-muted-fg); font-size: 11px; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-svgc text.lab { fill: var(--pk-fg); font-weight: 600; }
.pk-f3 .pk-svgc .grid { stroke: var(--viz-grid); stroke-width: 1; }
.pk-f3 .pk-svgc .base { stroke: var(--viz-axis); stroke-width: 1; }
.pk-f3 .pk-svgc .ln { fill: none; stroke: var(--viz-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.pk-f3 .pk-svgc .area { fill: var(--viz-1); fill-opacity: .1; stroke: none; }
.pk-f3 .pk-svgc .dot { fill: var(--viz-1); stroke: var(--viz-surface); stroke-width: 2; }
.pk-f3 .pk-svgc .band { fill: transparent; }
.pk-f3 .pk-svgc .xh { stroke: var(--viz-ink); stroke-width: 1; opacity: 0; }
.pk-f3 .pk-svgc .hit { outline: none; cursor: default; }
.pk-f3 .pk-svgc a.hit { cursor: pointer; }
.pk-f3 .pk-svgc .hit:hover .xh, .pk-f3 .pk-svgc .hit:focus-visible .xh { opacity: .35; }
.pk-f3 .pk-svgc .hit:hover path, .pk-f3 .pk-svgc .hit:focus-visible path { filter: brightness(1.08); }
.pk-f3 .pk-svgc .hit:focus-visible .band { stroke: var(--pk-ring); stroke-width: 2; }
/* horizontal bar lists (categories, accounts, pipeline, bullets) */
.pk-f3 .pk-hbars { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.pk-f3 .pk-hbar { display: grid; grid-template-columns: minmax(0, 38%) minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; color: inherit; text-decoration: none; border-radius: 6px; padding: 2px 4px; margin: 0 -4px; }
.pk-f3 a.pk-hbar:hover, .pk-f3 .pk-hbar:focus-visible { background: color-mix(in oklab, var(--pk-primary) 6%, transparent); }
.pk-f3 .pk-hbar .l { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-f3 .pk-hbar .t { position: relative; height: 12px; }
.pk-f3 .pk-hbar .t > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; min-width: 2px; }
.pk-f3 .pk-hbar .v { font-size: 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--pk-muted-fg); }
.pk-f3 .pk-hbar .v b { color: var(--pk-fg); font-weight: 600; }
.pk-f3 .pk-hbars .sep { border-top: 1px solid var(--pk-border); margin: 2px 0; }
@container (max-width: 420px) { .pk-f3 .pk-hbar { grid-template-columns: minmax(0, 1fr) auto; } .pk-f3 .pk-hbar .l { grid-column: 1 / -1; } }
/* bullet rows */
.pk-f3 .pk-bullet { display: grid; grid-template-columns: minmax(0, 34%) minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; color: inherit; text-decoration: none; padding: 4px; margin: 0 -4px; border-radius: 6px; }
.pk-f3 a.pk-bullet:hover, .pk-f3 a.pk-bullet:focus-visible { background: color-mix(in oklab, var(--pk-primary) 6%, transparent); }
.pk-f3 .pk-bullet .l { font-size: 13px; min-width: 0; } .pk-f3 .pk-bullet .l span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-f3 .pk-bullet .l small { display: block; color: var(--pk-muted-fg); font-size: 11px; }
.pk-f3 .pk-bullet .t { position: relative; height: 18px; background: var(--viz-track); border-radius: 4px; }
.pk-f3 .pk-bullet .t .c { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 0 4px 4px 0; background: var(--viz-soft); }
.pk-f3 .pk-bullet .t .r { position: absolute; left: 0; top: 6px; height: 6px; border-radius: 0 3px 3px 0; background: var(--viz-strong); }
.pk-f3 .pk-bullet .t .m { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--viz-ink); border-radius: 1px; }
.pk-f3 .pk-bullet .t .w { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--pk-muted-fg); opacity: .6; }
.pk-f3 .pk-bullet .v { font-size: 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
@container (max-width: 460px) { .pk-f3 .pk-bullet { grid-template-columns: minmax(0, 1fr) auto; } .pk-f3 .pk-bullet .t { grid-column: 1 / -1; grid-row: 2; } }
/* tables */
.pk-f3 .pk-tw { position: relative; overflow-x: auto; margin: 0 -18px; padding: 0 18px; }
.pk-f3 table.pk-t { width: 100%; border-collapse: collapse; font-size: 13px; }
.pk-f3 .pk-t th { text-align: left; font-size: 12px; font-weight: 600; color: var(--pk-muted-fg); padding: 8px 10px; border-bottom: 1px solid var(--pk-border); white-space: nowrap; }
.pk-f3 .pk-t th[aria-sort] { color: var(--pk-fg); }
.pk-f3 .pk-t th .so { margin-left: 4px; font-size: 10px; opacity: .8; }
.pk-f3 .pk-t td { padding: 9px 10px; border-bottom: 1px solid var(--pk-border); vertical-align: middle; }
.pk-f3 .pk-t tbody tr:last-child td { border-bottom: 0; }
.pk-f3 .pk-t tbody tr:hover td { background: color-mix(in oklab, var(--pk-primary) 4%, transparent); }
.pk-f3 .pk-t .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pk-f3 .pk-t td a { color: var(--pk-primary); font-weight: 600; text-decoration: none; } .pk-f3 .pk-t td a:hover { text-decoration: underline; }
.pk-f3 .pk-t .sub { display: block; color: var(--pk-muted-fg); font-size: 12px; max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pk-f3 .pk-t .dir { display: inline-block; width: 18px; font-weight: 700; }
.pk-f3 .pk-t .dir.in { color: var(--pk-primary); background: none; } .pk-f3 .pk-t .dir.out { color: var(--pk-tone-warn-text); background: none; }
.pk-f3 .pk-t tr.void td { color: var(--pk-muted-fg); } .pk-f3 .pk-t tr.void .amt { text-decoration: line-through; }
@container (max-width: 640px) { .pk-f3 .pk-t .sec { display: none; } }
.pk-f3 .pk-t .nw { white-space: nowrap; }
/* pills */
.pk-f3 .pk-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; line-height: 18px; white-space: nowrap; color: var(--pk-muted-fg); background: color-mix(in oklab, var(--pk-muted-fg) 12%, transparent); }
.pk-f3 .pk-pill.progress { color: var(--pk-primary); background: color-mix(in oklab, var(--pk-primary) 12%, transparent); }
.pk-f3 .pk-pill.ok { color: var(--pk-tone-ok-text); background: color-mix(in oklab, var(--pk-tone-ok-text) 12%, transparent); }
.pk-f3 .pk-pill.warn { color: var(--pk-tone-warn-text); background: color-mix(in oklab, var(--pk-tone-warn-text) 12%, transparent); }
.pk-f3 .pk-pill.bad { color: var(--pk-tone-bad-text); background: color-mix(in oklab, var(--pk-tone-bad-text) 12%, transparent); }
/* table view of a chart */
.pk-f3 details.pk-tv { margin: 12px 0 0; font-size: 12px; }
.pk-f3 details.pk-tv summary { cursor: pointer; color: var(--pk-muted-fg); font-weight: 600; width: fit-content; }
.pk-f3 details.pk-tv[open] summary { margin-bottom: 6px; }
/* empty state */
.pk-f3 .pk-es { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; padding: 20px 12px; color: var(--pk-muted-fg); font-size: 13px; min-height: 96px; }
.pk-f3 .pk-es svg { width: 28px; height: 28px; opacity: .7; }
.pk-f3 .pk-es a { font-weight: 600; color: var(--pk-primary); }
/* tooltip */
.pk-hover-root { position: relative; }
.pk-f3 .pk-tip { position: absolute; z-index: 20; pointer-events: none; transform: translate(12px, -50%); min-width: 150px; max-width: 280px; padding: 8px 10px; border-radius: 8px; background: var(--pk-card); color: var(--pk-fg); border: 1px solid var(--pk-border); box-shadow: 0 8px 24px -6px rgb(15 23 42 / .25); font-size: 12px; }
.pk-f3 .pk-tip.flip { transform: translate(calc(-100% - 12px), -50%); }
.pk-f3 .pk-tip-t { color: var(--pk-muted-fg); margin-bottom: 4px; }
.pk-f3 .pk-tip-r { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.pk-f3 .pk-tip-r b { font-variant-numeric: tabular-nums; }
.pk-f3 .pk-tip-r span { color: var(--pk-muted-fg); }
.pk-f3 .pk-tip-r .k { display: inline-block; width: 12px; height: 2px; border-radius: 1px; }
/* skeleton */
.pk-f3 .pk-skel { background: var(--viz-track); border-radius: var(--style-radius-l); min-height: 110px; position: relative; overflow: hidden; }
.pk-f3 .pk-skel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--pk-card) 60%, transparent), transparent); transform: translateX(-100%); animation: pk-shimmer 1.4s ease-in-out infinite; }
@keyframes pk-shimmer { to { transform: translateX(100%); } }
/* one subtle enter animation */
.pk-f3 .pk-anim { animation: pk-rise .35s cubic-bezier(.2,.7,.2,1) both; animation-delay: calc(var(--i, 0) * 35ms); }
@keyframes pk-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .pk-f3 .pk-anim, .pk-f3 .pk-skel::after { animation: none; } .pk-f3 .pk-kpi { transition: none; } }
@media (forced-colors: active) { .pk-f3 .pk-hbar .t > span, .pk-f3 .pk-bullet .t .c, .pk-f3 .pk-bullet .t .r, .pk-f3 .pk-meter > span { background: CanvasText; } }
`

export const rp = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatRupiah(v))
/** Compact Rupiah for tiles/labels (auto-compact rule): Rp 12,5 jt · Rp 1,2 M. The exact value is always nearby. */
export const rpShort = (v: number) => (v < 0 ? `−Rp ${shortRupiah(-v)}` : `Rp ${shortRupiah(v)}`)
const pctText = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(digits).replace('.', ',')}%`)
const tip = (t: string, r: Array<[string, string, string?]>) => JSON.stringify({ t, r })

// ---------------------------------------------------------------- icons (inline SVG, decorative)

const ICONS: Record<string, React.ReactNode> = {
  wallet: <path d="M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2Zm13 6h2" />,
  clock: <path d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  send: <path d="M4 12h12m0 0-5-5m5 5-5 5M20 5v14" />,
  target: <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15 0a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-4 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />,
  inbox: <path d="M4 13h4l1 3h6l1-3h4M4 13l2-8h12l2 8M4 13v6h16v-6" />,
  check: <path d="M5 12l4 4 10-10" />,
  down: <path d="M12 5v14m0 0-6-6m6 6 6-6" />,
  up: <path d="M12 19V5m0 0-6 6m6-6 6 6" />,
  scale: <path d="M12 4v16M5 8h14M7 8l-3 7h6L7 8Zm10 0-3 7h6l-3-7Z" />,
  doc: <path d="M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6m-6 4h6" />,
  users: <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m18 0v-1a4 4 0 0 0-3-3.9M14 4.1a4 4 0 0 1 0 7.8M13.5 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />,
  empty: <path d="M4 7h16M4 7l2 12h12l2-12M4 7l3-4h10l3 4M10 11h4" />,
}

export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {ICONS[name] ?? ICONS.doc}
    </svg>
  )
}

// ---------------------------------------------------------------- layout

export function DashHead({ title, note, children }: { title: string; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="pk-dash-head">
      <div>
        <h1>{title}</h1>
        {note ? <p>{note}</p> : null}
      </div>
      {children}
    </header>
  )
}

export function Bento({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="pk-bento" role={label ? 'region' : undefined} aria-label={label}>
      {children}
    </div>
  )
}

export function KpiRow({ children, cols = 4 }: { children: React.ReactNode; cols?: 3 | 4 | 6 }) {
  return <div className={`pk-kpis c${cols}`}>{children}</div>
}

type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12
export function Card({ id, title, sub, span = 12, action, foot, i = 0, children }: { id: string; title: string; sub?: React.ReactNode; span?: Span; action?: { href: string; label: string }; foot?: React.ReactNode; i?: number; children: React.ReactNode }) {
  const hid = `pk-card-${id}`
  return (
    <section className={`pk-card s${span} pk-anim`} style={{ '--i': i } as React.CSSProperties} aria-labelledby={hid} data-pk-card={id}>
      <div className="pk-card-h">
        <h2 id={hid}>
          {title}
          {sub ? <span className="sub">{sub}</span> : null}
        </h2>
        {action ? <a href={action.href}>{action.label} →</a> : null}
      </div>
      <div className="pk-card-b">{children}</div>
      {foot ? <p className="pk-card-f">{foot}</p> : null}
    </section>
  )
}

export function EmptyState({ text, action }: { text: string; action?: { href: string; label: string } }) {
  return (
    <div className="pk-es" data-pk-empty>
      <Icon name="empty" />
      <span>{text}</span>
      {action ? <a href={action.href}>{action.label}</a> : null}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="pk-bento" aria-busy="true" aria-live="polite" data-pk-skeleton>
      <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Memuat data beranda…
      </span>
      <div className="pk-kpis">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="pk-skel" />
        ))}
      </div>
      <div className="pk-card s8 pk-skel" style={{ minHeight: 280 }} />
      <div className="pk-card s4 pk-skel" style={{ minHeight: 280 }} />
    </div>
  )
}

// ---------------------------------------------------------------- stat tile

export type DeltaSpec = { diff: number; pct: number | null; dir: 'up' | 'down' | 'flat' }

/** Signed change vs a named period; colour = direction × whether up is good (neutral = ink only). */
export function Delta({ d, good = 'neutral', vs, money = true }: { d: DeltaSpec; good?: 'up' | 'down' | 'neutral'; vs: string; money?: boolean }) {
  const cls = good === 'neutral' || d.dir === 'flat' ? '' : (d.dir === good ? 'good' : 'bad')
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■'
  const abs = money ? rpShort(Math.abs(d.diff)) : String(Math.abs(d.diff))
  const sign = d.dir === 'up' ? '+' : d.dir === 'down' ? '−' : '±'
  return (
    <p className={`pk-delta ${cls}`}>
      <span aria-hidden style={{ color: 'inherit', fontWeight: 600 }}>
        {arrow}
      </span>
      {sign}
      {abs}
      {d.pct !== null ? ` (${sign}${Math.abs(d.pct).toFixed(1).replace('.', ',')}%)` : ''} <span>{vs}</span>
    </p>
  )
}

/** 12-point mini columns: history in the de-emphasis hue, the current period in the accent. */
export function Sparkline({ values, label }: { values: Array<{ label: string; value: number }>; label: string }) {
  if (values.length < 2) return null
  const W = 120
  const H = 34
  const max = Math.max(0, ...values.map((v) => v.value))
  const min = Math.min(0, ...values.map((v) => v.value))
  const span = max - min || 1
  const y0 = H - ((0 - min) / span) * H
  const band = W / values.length
  const bw = Math.max(2, Math.min(8, band - 2))
  return (
    <svg className="pk-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${values.map((v) => `${v.label} ${rpShort(v.value)}`).join(', ')}`}>
      {values.map((v, i) => {
        const h = (Math.abs(v.value) / span) * H
        const y = v.value >= 0 ? y0 - h : y0
        return <rect key={i} className={i === values.length - 1 ? 'cur' : ''} x={i * band + (band - bw) / 2} y={y} width={bw} height={Math.max(v.value === 0 ? 0 : 1, h)} rx={1} />
      })}
      <line x1={0} x2={W} y1={y0} y2={y0} />
    </svg>
  )
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'ok' | 'warn' | 'over' | 'none' }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className={`pk-meter ${tone ?? ''}`} role="presentation">
      <span style={{ width: `${w}%` }} />
    </div>
  )
}

export function KpiTile({
  id,
  label,
  icon,
  value,
  title,
  kpi,
  href,
  more,
  hero,
  i = 0,
  children,
}: {
  id: string
  label: string
  icon: string
  value: React.ReactNode
  /** exact value for the accessible name (value may be compact) */
  title?: string
  kpi?: string
  href?: string
  more?: string
  hero?: boolean
  i?: number
  children?: React.ReactNode
}) {
  return (
    <div className={`pk-kpi pk-anim${hero ? ' hero' : ''}`} style={{ '--i': i } as React.CSSProperties} data-pk-tile={id}>
      <p className="pk-kpi-l">
        <span className="ic">
          <Icon name={icon} />
        </span>
        {label}
      </p>
      <p className="pk-kpi-v" data-pk-kpi={kpi} title={title}>
        {value}
      </p>
      {children}
      {href ? (
        <>
          <span className="pk-kpi-more" aria-hidden>
            {more ?? 'Lihat rincian'} →
          </span>
          <a className="pk-kpi-link" href={href} aria-label={`${label}: ${title ?? (typeof value === 'string' ? value : '')} — ${more ?? 'lihat rincian'}`} />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------- table view twin

export function TableView({ children, summary = 'Tabel angka' }: { children: React.ReactNode; summary?: string }) {
  return (
    <details className="pk-tv">
      <summary>{summary}</summary>
      <div className="pk-tw">{children}</div>
    </details>
  )
}

// ---------------------------------------------------------------- columns (time × up to 2 series)

type ColSeries = { key: string; label: string; cls: string }
type ColRow = { period: string; values: number[] }

function columnsSvg(rows: ColRow[], series: ColSeries[], W: number, H: number, hrefOf: ((p: string) => string) | undefined, labelEvery: number, aria: string) {
  const left = 52
  const right = 6
  const top = 10
  const bottom = 24
  const plotH = H - top - bottom
  const max = niceMax(Math.max(1, ...rows.flatMap((r) => r.values)))
  const band = (W - left - right) / rows.length
  const n = series.length
  const bar = Math.max(3, Math.min(24, (band - 8 - (n - 1) * 2) / n))
  const y = (v: number) => top + plotH - (v / max) * plotH
  const ticks = [0, 0.5, 1].map((t) => t * max)
  const path = (x: number, v: number) => {
    const h = Math.max(0, (v / max) * plotH)
    if (h <= 0) return ''
    const r = Math.min(4, bar / 2, h)
    const yy = top + plotH - h
    return `M${x},${top + plotH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bar - r} Q${x + bar},${yy} ${x + bar},${yy + r} V${top + plotH} Z`
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'grid'} x1={left} x2={W - right} y1={y(t)} y2={y(t)} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end">
            {shortRupiah(t)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const bx = left + i * band
        const x0 = bx + (band - (bar * n + (n - 1) * 2)) / 2
        const tipText = tip(
          periodLabel(r.period),
          series.map((s, k) => [s.label, formatRupiah(r.values[k] ?? 0), s.cls]),
        )
        const inner = (
          <>
            <rect className="band" x={bx + 1} y={top} width={band - 2} height={plotH} rx={4} />
            <line className="xh" x1={bx + band / 2} x2={bx + band / 2} y1={top} y2={top + plotH} />
            {series.map((s, k) => {
              const d = path(x0 + k * (bar + 2), r.values[k] ?? 0)
              return d ? <path key={s.key} d={d} className={s.cls} /> : null
            })}
          </>
        )
        const aria = `${periodLabel(r.period)}: ${series.map((s, k) => `${s.label} ${formatRupiah(r.values[k] ?? 0)}`).join(', ')}`
        return (
          <g key={r.period}>
            {hrefOf ? (
              <a className="hit" href={hrefOf(r.period)} data-tip={tipText} aria-label={aria}>
                {inner}
              </a>
            ) : (
              <g className="hit" tabIndex={0} data-tip={tipText} role="img" aria-label={aria}>
                {inner}
              </g>
            )}
            {i % labelEvery === (rows.length - 1) % labelEvery ? (
              <text x={bx + band / 2} y={H - 6} textAnchor="middle">
                {periodLabel(r.period).split(' ')[0]}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Monthly columns on ONE Rupiah axis (never dual axis). 1–2 series; legend always for 2; each
 * month is one focusable/linked hit band carrying a tooltip with every series (crosshair rule).
 */
export function ColumnsChart({ id, rows, series, hrefOf, aria, empty }: { id: string; rows: ColRow[]; series: ColSeries[]; hrefOf?: (p: string) => string; aria: string; empty: string }) {
  if (rows.length === 0 || rows.every((r) => r.values.every((v) => v === 0))) return <EmptyState text={empty} />
  return (
    <div data-pk-chart={id}>
      {series.length > 1 ? (
        <div className="pk-legend" aria-hidden>
          {series.map((s) => (
            <span key={s.key}>
              <i className={`sw ${s.cls}`} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="pk-svgc">
        <div className="wide">{columnsSvg(rows, series, 720, 250, hrefOf, 1, aria)}</div>
        <div className="narrow">{columnsSvg(rows, series, 360, 220, hrefOf, rows.length > 6 ? 2 : 1, aria)}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- line (trend, single series)

function lineSvg(rows: Array<{ period: string; value: number; extra?: string }>, W: number, H: number, fmt: (v: number) => string, label: string, labelEvery: number, aria: string) {
  const left = 40
  const right = 44
  const top = 12
  const bottom = 24
  const plotH = H - top - bottom
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)))
  const step = rows.length > 1 ? (W - left - right) / (rows.length - 1) : 0
  const x = (i: number) => left + i * step
  const y = (v: number) => top + plotH - (v / max) * plotH
  const pts = rows.map((r, i) => `${x(i)},${y(r.value)}`)
  const last = rows[rows.length - 1]!
  const ticks = [0, 0.5, 1].map((t) => t * max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
      {ticks.map((t) => (
        <g key={t}>
          <line className={t === 0 ? 'base' : 'grid'} x1={left} x2={W - right} y1={y(t)} y2={y(t)} />
          <text x={left - 8} y={y(t) + 4} textAnchor="end">
            {Number.isInteger(t) ? t : t.toFixed(1)}
          </text>
        </g>
      ))}
      <path className="area" d={`M${x(0)},${y(0)} L${pts.join(' L')} L${x(rows.length - 1)},${y(0)} Z`} />
      <path className="ln" d={`M${pts.join(' L')}`} />
      <circle className="dot" cx={x(rows.length - 1)} cy={y(last.value)} r={4.5} />
      <text className="lab" x={x(rows.length - 1) + 8} y={y(last.value) + 4}>
        {fmt(last.value)}
      </text>
      {rows.map((r, i) => {
        const bx = x(i) - step / 2
        const rows2: Array<[string, string, string?]> = [[label, fmt(r.value), 's1']]
        if (r.extra) rows2.push(['nilai', r.extra])
        return (
          <g key={r.period}>
            <g className="hit" tabIndex={0} role="img" data-tip={tip(periodLabel(r.period), rows2)} aria-label={`${periodLabel(r.period)}: ${fmt(r.value)} ${label}${r.extra ? `, ${r.extra}` : ''}`}>
              <rect className="band" x={Math.max(left - 6, bx)} y={top} width={Math.max(8, step)} height={plotH} rx={4} />
              <line className="xh" x1={x(i)} x2={x(i)} y1={top} y2={top + plotH} />
            </g>
            {i % labelEvery === (rows.length - 1) % labelEvery ? (
              <text x={x(i)} y={H - 6} textAnchor="middle">
                {periodLabel(r.period).split(' ')[0]}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export function LineChart({ id, rows, fmt, label, aria, empty }: { id: string; rows: Array<{ period: string; value: number; extra?: string }>; fmt: (v: number) => string; label: string; aria: string; empty: string }) {
  if (rows.length < 2 || rows.every((r) => r.value === 0)) return <EmptyState text={empty} />
  return (
    <div className="pk-svgc" data-pk-chart={id}>
      <div className="wide">{lineSvg(rows, 720, 220, fmt, label, 1, aria)}</div>
      <div className="narrow">{lineSvg(rows, 360, 200, fmt, label, rows.length > 6 ? 2 : 1, aria)}</div>
    </div>
  )
}

// ---------------------------------------------------------------- horizontal bars (sorted, one series)

export type HBarItem = { key: string; label: string; value: number; cls?: string; href?: string; extra?: string; attrs?: Record<string, string> }

/** Sorted horizontal bars (categories, accounts, cost centers). One series → one colour, no legend box. */
export function HBarList({ id, items, fmt, exact = fmt, empty, max: forcedMax }: { id: string; items: HBarItem[]; fmt: (v: number) => string; exact?: (v: number) => string; empty: string; max?: number }) {
  if (items.length === 0) return <EmptyState text={empty} />
  const max = forcedMax ?? Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="pk-hbars" data-pk-chart={id}>
      {items.map((it) => {
        const w = Math.max(0, Math.min(100, (it.value / max) * 100))
        const body = (
          <>
            <span className="l" title={it.label}>
              {it.label}
            </span>
            <span className="t" aria-hidden>
              <span className={it.cls ?? 's1'} style={{ width: `${w}%` }} />
            </span>
            <span className="v">
              <b>{fmt(it.value)}</b>
              {it.extra ? ` · ${it.extra}` : ''}
            </span>
          </>
        )
        const t = tip(it.label, [[it.extra ?? '', exact(it.value), it.cls ?? 's1']])
        return (
          <li key={it.key} {...it.attrs}>
            {it.href ? (
              <a className="pk-hbar" href={it.href} data-tip={t}>
                {body}
              </a>
            ) : (
              <div className="pk-hbar" tabIndex={0} data-tip={t}>
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- pipeline (ordinal stages)

export type PipelineRow = { key: string; label: string; count: number; sum: number; href?: string }

/** Ordered stages in a one-hue ordinal ramp (stage order = colour order); exit bucket in the de-emphasis gray. */
export function PipelineBars({ id, stages, exit, empty }: { id: string; stages: PipelineRow[]; exit: PipelineRow; empty: string }) {
  const all = [...stages, exit]
  if (all.every((s) => s.count === 0)) return <EmptyState text={empty} />
  const max = Math.max(1, ...all.map((s) => s.count))
  const row = (s: PipelineRow, cls: string) => {
    const body = (
      <>
        <span className="l" title={s.label}>
          {s.label}
        </span>
        <span className="t" aria-hidden>
          <span className={cls} style={{ width: `${(s.count / max) * 100}%` }} />
        </span>
        <span className="v">
          <b>{s.count}</b> · {rpShort(s.sum)}
        </span>
      </>
    )
    const t = tip(s.label, [
      ['pengajuan', String(s.count), cls],
      ['grand total', formatRupiah(s.sum)],
    ])
    return (
      <li key={s.key} data-pk-stage={s.key}>
        {s.href ? (
          <a className="pk-hbar" href={s.href} data-tip={t}>
            {body}
          </a>
        ) : (
          <div className="pk-hbar" tabIndex={0} data-tip={t}>
            {body}
          </div>
        )}
      </li>
    )
  }
  return (
    <ul className="pk-hbars" data-pk-chart={id}>
      {stages.map((s, i) => row(s, `o${Math.min(5, i + 1)}`))}
      <li className="sep" aria-hidden />
      {row(exit, 'mute')}
    </ul>
  )
}

// ---------------------------------------------------------------- bullet rows (komitmen/realisasi vs RAB)

export type BulletRow = { key: string; label: string; sub?: string; budget: number | null; committed: number; realized: number; pct: number | null; pctRealized: number | null; badge: React.ReactNode; href?: string; attrs?: Record<string, string> }

export function BulletLegend({ warnPct }: { warnPct: number }) {
  return (
    <div className="pk-legend" aria-hidden>
      <span>
        <i className="sw soft" />
        Komitmen
      </span>
      <span>
        <i className="sw strong" />
        Realisasi
      </span>
      <span>
        <i className="ln" />
        RAB (100%)
      </span>
      <span>
        <i className="ln" style={{ width: 1, opacity: 0.6, background: 'var(--pk-muted-fg)' }} />
        Batas waspada {warnPct}%
      </span>
    </div>
  )
}

export function BulletRows({ id, rows, warnPct, empty }: { id: string; rows: BulletRow[]; warnPct: number; empty: string }) {
  if (rows.length === 0) return <EmptyState text={empty} />
  const scale = Math.min(150, Math.max(110, ...rows.map((r) => r.pct ?? 0), ...rows.map((r) => r.pctRealized ?? 0)))
  const at = (p: number) => `${Math.max(0, Math.min(100, (p / scale) * 100))}%`
  return (
    <ul className="pk-hbars" data-pk-chart={id}>
      {rows.map((r) => {
        const t = tip(r.label, [
          ['komitmen', `${formatRupiah(r.committed)} (${pctText(r.pct)})`, 'soft'],
          ['realisasi', `${formatRupiah(r.realized)} (${pctText(r.pctRealized)})`, 'strong'],
          ['RAB', rp(r.budget)],
        ])
        const body = (
          <>
            <span className="l">
              <span title={r.label}>{r.label}</span>
              {r.sub ? <small>{r.sub}</small> : null}
            </span>
            {r.budget ? (
              <span className="t" aria-hidden>
                <span className="c" style={{ width: at(r.pct ?? 0) }} />
                <span className="r" style={{ width: at(r.pctRealized ?? 0) }} />
                <span className="w" style={{ left: at(warnPct) }} />
                <span className="m" style={{ left: `calc(${at(100)} - 1px)` }} />
              </span>
            ) : (
              <span className="t" aria-hidden style={{ background: 'none' }} />
            )}
            <span className="v">
              <span>
                <b>{pctText(r.pct)}</b> komitmen · {pctText(r.pctRealized)} realisasi
              </span>
              {r.badge}
            </span>
          </>
        )
        return (
          <li key={r.key} {...r.attrs}>
            {r.href ? (
              <a className="pk-bullet" href={r.href} data-tip={t}>
                {body}
              </a>
            ) : (
              <div className="pk-bullet" tabIndex={0} data-tip={t}>
                {body}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- tables & pills

const PILL_ICON: Record<PillTone, string> = { wait: '◷', progress: '●', ok: '✓', warn: '▲', bad: '✕', none: '○' }

export function StatusPill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span className={`pk-pill ${tone}`} data-pk-status-tone={tone}>
      <span aria-hidden>{PILL_ICON[tone]}</span>
      {label}
    </span>
  )
}

export type Col<T> = { key: string; label: string; num?: boolean; sec?: boolean; sort?: 'ascending' | 'descending'; cell: (r: T) => React.ReactNode }

/** Compact card table; `sort` marks the column the rows are ordered by (aria-sort + arrow). */
export function DataTable<T>({ id, cols, rows, rowKey, rowAttrs, caption, empty }: { id: string; cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string | number; rowAttrs?: (r: T) => Record<string, string | undefined>; caption: string; empty: React.ReactNode }) {
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="pk-tw">
      <table className="pk-t" data-pk-table={id}>
        <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{caption}</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} scope="col" className={`${c.num ? 'n' : ''} ${c.sec ? 'sec' : ''}`} aria-sort={c.sort}>
                {c.label}
                {c.sort ? (
                  <span className="so" aria-hidden>
                    {c.sort === 'ascending' ? '▲' : '▼'}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} {...(rowAttrs ? rowAttrs(r) : {})}>
              {cols.map((c) => (
                <td key={c.key} className={`${c.num ? 'n' : ''} ${c.sec ? 'sec' : ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { pctText }
