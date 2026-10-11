import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Base: payload templates/blank/next.config.ts @v3.90.1 + control-plane hardening.
const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '../..')

const nextConfig: NextConfig = {
  output: 'standalone',
  // npm workspaces hoist node_modules to the repo root → trace from there.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // F2b: pdfkit (@react-pdf/renderer, a default server-external package) loads its standard fonts
  // with require('#standard-fonts/<Name>') → js/standard-fonts/*.cjs; the tracer only picks the .mjs
  // variants, so the standalone image failed at the first render ("Cannot find module …/Helvetica.cjs",
  // found by the F2b image smoke test). Globs are resolved from apps/web (Next docs: output.md).
  outputFileTracingIncludes: { '/api/*': ['../../node_modules/pdfkit/js/standard-fonts/**/*'] },
  poweredByHeader: false,
  // F1 spike (g): Turbopack production builds were OOM-killed at 1536 and 1900 MiB caps; webpack
  // with memory optimisations keeps the build inside the RAM budget (report §g).
  experimental: { webpackMemoryOptimizations: true },
  // F2a: `next build` type-checks in a second Node process while the webpack process is still
  // resident → the 2 GiB build cap was exceeded (OOM 137 at "Running TypeScript", measured with
  // docker build --memory 2g). Type checking is a separate, required CI gate (`npm run typecheck`
  // in the verify job, which the build job depends on), so the build skips it
  // (TypeScriptConfig.ignoreBuildErrors: "Do not run TypeScript during production builds").
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: true,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return webpackConfig
  },
  // Static security headers. The nonce-based CSP is set per request in src/proxy.ts.
  // HSTS is handled by Traefik.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // camera + geolocation for this origin only: web self check-in (live selfie + GPS, item 14
            // DRMS 10/10; `geolocation=()` had blocked the GPS of the web check-in since 2026-10-09).
            value: 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()',
          },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
      // Public APK download page + file (src/app/(public)/unduh): for DRMS employees only, never indexed.
      // `:path*` also matches `/unduh` itself.
      { source: '/unduh/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // Public home page (src/app/(public)/page.tsx): links to the login and /unduh, never indexed.
      { source: '/', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // Employee privacy notice (src/app/(public)/privasi): public, for DRMS employees, never indexed.
      { source: '/privasi', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
