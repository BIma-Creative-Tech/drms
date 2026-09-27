import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)),
  '@': fileURLToPath(new URL('./src', import.meta.url)),
}

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    /**
     * E9: unit-test coverage gate (`npm run test:coverage`, CI job verify). Scope = server-side
     * TypeScript under src/ (generated files, migrations, seed data and React views excluded:
     * the views and DB-bound services are exercised by the integration suite, not counted here).
     * Thresholds sit a few points BELOW the measured baseline of 2026-09-26 (see
     * docs/proyekkas/security/asvs-l1-checklist.md §CI) so the gate catches regressions without
     * failing on noise; raise them when coverage grows.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/migrations/**', 'src/payload-types.ts', 'src/api/v1/openapi.generated.ts', 'src/seed/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      thresholds: { lines: 30, statements: 28, functions: 25, branches: 18 },
    },
  },
})
