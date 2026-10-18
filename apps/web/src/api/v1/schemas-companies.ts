import { z } from 'zod'

/** MC2-4 web PT switcher (ADR 0016 §5). Pure zod (bundled by scripts/gen-openapi.mjs). */
export const MeCompaniesBody = z
  .strictObject({
    companyIds: z
      .array(z.number().int().positive())
      .max(50)
      .nullable()
      .meta({ description: 'PTs to show (each must be an active membership of the caller); null = all memberships ("Semua PT", cookie cleared).' }),
  })
  .meta({ id: 'MeCompaniesBody' })

export const MeCompaniesResult = z
  .object({
    selected: z.array(z.number().int()).meta({ description: 'Effective selection after the change (ascending ids).' }),
    all: z.boolean().meta({ description: 'true = every membership selected (no cookie stored).' }),
  })
  .meta({ id: 'MeCompaniesResult' })

/** User 2026-10-18: web launcher modules for the APK menu (GET /me/modules). */
const MeModuleItem = z.object({
  href: z.string().meta({ description: 'Web route relative to /admin (e.g. /persetujuan, /collections/projects); the APK maps it to its own screen.' }),
  label: z.string(),
  kind: z.enum(['collection', 'global', 'view']),
  badge: z.number().int(),
})
export const MeModules = z
  .object({
    modules: z.array(
      z.object({
        id: z.string().meta({ description: 'Module id (dashboard, persetujuan, proyek, keuangan, absensi, laporan, pengguna, master, media, pengaturan, sistem).' }),
        label: z.string(),
        hint: z.string(),
        badge: z.number().int(),
        sections: z.array(z.object({ label: z.string().nullable(), items: z.array(MeModuleItem) })),
      }),
    ),
  })
  .meta({ id: 'MeModules' })
