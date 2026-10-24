import { z } from 'zod'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 6): GET /company-memberships/matrix — the web "Akses PT (matriks)" page.
 * Pure module (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int()
const role = z.enum(['pk-staff', 'pk-pm', 'pk-finance', 'pk-owner', 'pk-principal', 'pk-admin', 'pk-operator', 'pk-admin-staff'])

export const MembershipMatrixQuery = z
  .object({
    q: z.string().max(80).optional().meta({ description: 'Name / email (like).' }),
    nonaktif: z.enum(['1']).optional().meta({ description: '1 = include inactive accounts.' }),
    hal: z.string().regex(/^\d{1,6}$/).optional().meta({ description: 'Users page (40 per page).' }),
  })
  .meta({ id: 'MembershipMatrixQuery' })

export const MembershipMatrix = z
  .object({
    viewer: z.object({ groupAdmin: z.boolean(), adminOf: z.array(id).meta({ description: 'PTs where the caller is Admin (any membership).' }) }),
    narrowed: z.boolean().meta({ description: 'Columns narrowed to the PT switcher selection.' }),
    roles: z.array(z.object({ value: role, label: z.string(), short: z.string() })).meta({ description: 'Roles in display order. ADR 0026: pk-principal (Owner) only for a group admin; a PT admin sees it where held, locked.' }),
    reasonMin: z.number().int().meta({ description: 'Minimum length of the batch reason.' }),
    companies: z.array(z.object({ id, shortCode: z.string(), name: z.string() })).meta({ description: 'Columns = PTs the caller may edit (Admin PTs / every PT for a group admin), ∩ selection.' }),
    users: z.object({ items: z.array(z.object({ id, name: z.string(), email: z.string(), active: z.boolean() })), page: z.number().int(), totalPages: z.number().int(), totalDocs: z.number().int() }),
    cells: z.array(z.object({ id, user: id, company: id, roles: z.array(role), employee: id.nullable(), active: z.boolean() })).meta({ description: 'EVERY membership of the column PTs (not only the page): unique employee per PT ("already linked"), coverage.' }),
    employees: z.array(z.object({ id, company: id, code: z.string(), name: z.string(), active: z.boolean() })).meta({ description: 'Employees of the column PTs. A cell offers the active ones of its PT not linked to another account there, plus its current one.' }),
    activeUserIds: z.array(id).meta({ description: 'Active accounts among the holders (an inactive account does not count for coverage).' }),
    warnings: z.array(z.string()).meta({ description: 'Coverage of the stored state: a PT without an active Direktur or Finance (warn, never block).' }),
  })
  .meta({ id: 'MembershipMatrix' })
