# ADR 0033 — Admin layout gaya Nexus: sidebar kiri + top bar ramping (supersedes navigasi ADR 0014)

- **Status:** accepted (user decision 2026-10-25, plan "revamp layout admin DRMS — Nexus CRM + Corporate Finance").
  Staging first; no production deploy without the usual release approval.
- **Date:** 2026-10-25
- **Branch:** `feat/d2510-web-ui-shell` (PR-1 of 4: shell → dashboard per peran → list & form → halaman custom)
- **Supersedes:** ADR 0014 §1 (Odoo top bar + launcher at `/admin`) and owner decision DRMS 13/10 #9 / D2 ("no module
  menu in the bar, the module landing page has the tiles"). ADR 0014 §2–4 (registry, inline Iconsax SVG, `motion`)
  stay. ADR 0015 (APK copies the web tokens) is untouched: no token value changes.
- **References:** https://nexus.daisyui.com/dashboards/crm, https://nexus.daisyui.com/dashboards/corporate-finance
  (layout and components only — not the daisyUI palette).

## Context

The user wants the admin to look like the Nexus daisyUI dashboards: a left sidebar with grouped, collapsible menus, a
slim top bar (search, actions, profile), page header with breadcrumbs, and card-based pages (KPI tiles, tables inside
cards, soft badges). Since 2026-09-27 the admin had no sidebar (launcher grid at `/admin`, module landing tiles).

## Decision

1. **Shell.** `admin.components.Nav` (`src/admin/shell/ModuleNav.tsx`) still renders the whole shell. The client
   `ModuleBar.tsx` now renders `AppSidebar.tsx` (every visible module of `resolveModules`; a single-item module is a
   link, a larger one a collapsible group with its section labels; the current module's group opens by itself;
   badges as before) + the slim bar (sidebar toggle, menu search, "+ Buat", PT switcher, bell, avatar menu) + the
   breadcrumb line. `custom.scss` turns Payload's `.template-default` into a grid `[sidebar | bar / crumbs / page]`.
2. **Sidebar modes.** Desktop: full 264px or compact 76px (icons only, expands over the page on hover / keyboard
   focus); the choice is a `pk-side` cookie (Path=/admin, 1 year) read by `ModuleNav` so the first paint has the
   right width. ≤ 1024px: off-canvas drawer with backdrop, focus moves in, Esc / backdrop / navigating closes it.
3. **Menu search.** Ctrl+K / ⌘K or the bar field opens `CommandPalette.tsx`: a modal combobox over the caller's
   already-resolved menu items (`nav-search.ts`, pure, no API). It only links — targets re-check access.
4. **Home.** `/admin` (Payload dashboard view, still `Launcher.tsx` so the import map is unchanged) redirects to the
   caller's first visible menu item — the role dashboard `/admin/dashboard` for every role that has it. The launcher
   grid is gone; `/admin/modul/<id>` stays (breadcrumb home, bookmarks, APK parity) with Nexus quick-action cards.
   Breadcrumb home outside every module is "Beranda" (was "Semua modul").
5. **No CSS framework.** Tailwind/daisyUI are not installed: Payload ships its own CSS in `@layer payload-default`,
   Tailwind's preflight would fight it and needs PostCSS + a new dependency review. The daisyUI patterns (card,
   badge-soft, status dot, progress, collapse menu) are rebuilt as `pk-*` classes on the existing `--pk-*` tokens.
   The page surface is a layout-only mix (`--pk-page` = muted 50% over background, light mode), so `tokens.ts`, the
   WCAG token tests and the APK drift test are unchanged.

## Consequences

- Every former landing tile is also a sidebar item (same resolved list) — one click less to any page.
- `data-pk-nav-link` values of the bar stay (`notifikasi`, `quick-create`, avatar items); `launcher` / `module-home`
  are gone; sidebar links carry `data-pk-side-mod` / `data-pk-side-link`.
- Follow-up PRs restyle the dashboard per role (Finance after Corporate Finance, the others after CRM), the list and
  edit chrome, and the custom pages on the same primitives.
