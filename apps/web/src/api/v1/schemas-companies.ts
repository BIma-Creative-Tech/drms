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
