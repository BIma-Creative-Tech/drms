# ADR 0014 — Admin navigation "gaya Odoo": module launcher + top menu bar, icon and animation dependencies

- **Status:** accepted (2026-09-27, user approved screenshots + Iconsax licence)
- **Date:** 2026-09-27
- **Related:** plan `tolong-rubah-tampilan-managementnya` (user decision: launcher at `/admin`, tiles = Iconsax on a
  gradient, Dashboard as its own module at `/admin/dashboard`); /opt/infra CLAUDE.md §0.10 (trusted OSS, licence,
  < 6 months maintenance, exact pins); ADR 0001 (Payload admin); `src/lib/csp.ts` (nonce CSP).

## Decision

1. **Navigation.** `admin.components.Nav` → `src/admin/shell/ModuleNav.tsx` (server) + `ModuleBar.tsx` (client).
   Verified in `@payloadcms/next` 3.90.1 `templates/Default/index.js`: the custom Nav replaces `DefaultNav` on every
   DefaultTemplate page (built-in list/edit/account views and our Frame/Shell-wrapped custom views), with
   serverProps `{payload, permissions, user, i18n, …}` and clientProps `{visibleEntities}`. The template's
   2-column grid + sidebar toggler are overridden in `custom.scss` (`@layer payload`) so the bar sits on top at
   full width. The `header` slot was not needed. Replacing Nav drops `beforeNavLinks`/`afterNavLinks` → removed
   from `payload.config.ts`; `F2NavLinks.tsx` retired (role rules + badges moved to `src/admin/modules/registry.ts`
   and `src/admin/shell/modules-server.ts`, `data-pk-nav-link` attributes kept).
2. **Module registry** `src/admin/modules/registry.ts` = single source of truth (11 modules). A unit test guards that
   every collection/global maps to exactly one module. Visibility = Payload read permission ∧ `visibleEntities`
   (admin.hidden, F2c staff whitelist) ∧ registry role rules. The menu is a convenience, not a guard (views and
   `/api/v1` re-check).
3. **Icons: inline SVG, no icon package.**
4. **Animation: `motion` 13.4.0 (MIT), exact pin.** No anime.js (motion covers stagger, layout pill, sheet).

## Dependency evaluation (2026-09-27, npm registry + GitHub API)

| Candidate | Licence | Last release / commit | React 19 / RSC | Size | Verdict |
|---|---|---|---|---|---|
| `iconsax-reactjs` 0.0.8 | MIT (wrapper, © Erfan Khadivar) | npm 2025-04-13, repo `rendinjast/iconsax-react` last push 2025-04-14 (≈ 17 months) | peer `react: *`, `forwardRef` components, no `'use client'` needed | 15 MB unpacked, `sideEffects:false` (tree-shakes) | **Rejected** — fails "< 6 months since last commit" |
| `iconsax-react` 0.0.8 | MIT (same repo) | npm 2022-05-05 | same + `prop-types` dependency | similar | **Rejected** — unmaintained |
| Inline SVG from Iconsax | Artwork: *Iconsax Free License* (docs.iconsax.io/license-and-terms/license): personal + commercial use integrated in a final product, no attribution required; redistribution as loose icons forbidden | n/a (static path data) | pure data, renders in server + client components | ~20 glyphs, ≈ 12 KB source | **Chosen** |
| `motion` 13.4.0 (+ `framer-motion` / `motion-dom` / `motion-utils` 13.x) | MIT | 13.4.x released 2026-09 (actively maintained); 13.4.0 = newest version ≥ 7 days old (`.npmrc min-release-age=7`) | peer `react ^18 \|\| ^19`; used only in `'use client'` components | client-only chunk | **Chosen** |

Icon path data was rendered once from `iconsax-reactjs@0.0.8` (`dist/cjs/<Name>.js`, Bulk + Linear variants) into
`src/admin/modules/icons.ts`; nothing from the package is installed. Only the glyphs we render are shipped, as part
of the product UI (not as an icon set).

**Licence decision (user, 2026-09-27): accepted.** For this project "open source" in §0.10 means *free of cost*;
the Iconsax Free License (free commercial use inside the product) qualifies. Background: the Iconsax artwork licence is a custom free licence, not one of the OSI licences listed in
§0.10 (MIT/Apache-2/BSD/LGPL/AGPL). The npm wrappers declare MIT, but that covers the wrapper code. Embedding the glyphs
in our own product is explicitly allowed by Iconsax; if a strict OSI-only reading is required, the fallback is to swap
`icons.ts` for an MIT/ISC set (e.g. Lucide) without touching any component.

## Consequences

- CSP unchanged: motion writes inline `style` (allowed: `style-src 'unsafe-inline'`), no script injection.
- `prefers-reduced-motion` → `MotionConfig reducedMotion="user"` + the existing global reduced-motion CSS.
- Accessibility: white glyph ≥ 3:1 on every gradient stop (light + dark, `tests/unit/theme.test.ts`), visible focus
  rings, ←/→ between menu entries, ↓/Esc in dropdowns, focus-trapped mobile sheet, `aria-current="page"`.
- Old deep links unchanged; only the home `/admin` changed (launcher) and the role dashboard moved to `/admin/dashboard`.
