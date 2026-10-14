import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { APIError, type CollectionAfterChangeHook, type CollectionBeforeChangeHook, type Field, type FieldAccess, type PayloadRequest } from 'payload'

import { hasRole, isGroupAdmin, relId, type Role } from '@/access/roles'
import { membersWithRole } from '@/domain/companies'
import { COMPANY_DIREKTUR_OWNER, DIREKTUR } from '@/domain/direktur-rules'

/**
 * ADR 0025 — "Direktur definitif" tab of a PT: the legal Direktur (no app account) whose name, title and
 * signature are used when a designated representative ("wakil", a user holding the Direktur role in this PT)
 * decides a Direktur step. Visible to the office roles of the PT (Admin / Direktur / Finance) and group admins;
 * changed by the Admin of the PT or a group admin only (the representatives never configure their own mandate).
 */
const OFFICE: readonly Role[] = ['pk-admin', 'pk-owner', 'pk-finance']

const companyIdOf = (args: { id?: unknown; doc?: unknown }): number | undefined => {
  const id = args.id ?? (args.doc as { id?: unknown } | undefined)?.id
  return typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : undefined
}

export const direkturRead: FieldAccess = ({ req, id, doc }) => isGroupAdmin(req) || hasRole(req, OFFICE, companyIdOf({ id, doc }))
export const direkturUpdate: FieldAccess = ({ req, id, doc }) => isGroupAdmin(req) || hasRole(req, 'pk-admin', companyIdOf({ id, doc }))

/** Label left of the input (D4 form grid, `(payload)/custom.scss` `.pk-ll`). */
const ll = 'pk-ll'

export const DIREKTUR_FIELDS: Field[] = [
  {
    name: 'direktur',
    type: 'group',
    label: 'Direktur definitif',
    access: { read: direkturRead, create: direkturUpdate, update: direkturUpdate },
    admin: {
      description:
        'Direktur sah PT ini yang tidak memakai aplikasi. Saat salah satu wakil di bawah memutuskan langkah Direktur (Persetujuan/Diketahui Direktur, Addendum RAB, pinjaman antar project), PDF, riwayat dan aplikasi menampilkan nama dan tanda tangan Direktur ini. Kosong = setiap Direktur menandatangani dengan tanda tangannya sendiri.',
    },
    fields: [
      { name: 'name', type: 'text', label: 'Nama Direktur', maxLength: 120, admin: { className: ll } },
      { name: 'title', type: 'text', label: 'Jabatan', maxLength: 120, admin: { className: ll, placeholder: 'mis. Direktur Utama' } },
      {
        name: 'signature',
        type: 'upload',
        relationTo: 'media-signatures',
        label: 'Tanda tangan',
        admin: { className: ll, description: 'PNG latar transparan, maks. 800 × 300 px. Unggah file baru (bukan tanda tangan profil pengguna). Hanya Admin, Direktur dan Finance PT ini yang dapat melihatnya.' },
      },
      {
        name: 'representatives',
        type: 'relationship',
        relationTo: 'users',
        hasMany: true,
        label: 'Wakil penanda tangan',
        // only users holding the Direktur role in THIS PT (active membership, active account)
        filterOptions: async ({ id, req }) => {
          const company = typeof id === 'number' ? id : typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : undefined
          if (company === undefined) return false
          const ids = await membersWithRole(req, DIREKTUR, company)
          return ids.length ? { id: { in: ids } } : false
        },
        admin: {
          className: ll,
          description: 'Pengguna dengan peran Direktur di PT ini yang memutuskan langkah Direktur atas nama Direktur definitif. Langkah lain (mis. sebagai PM) tetap memakai tanda tangan pribadinya.',
        },
      },
    ],
  },
]

type DirekturData = { name?: unknown; title?: unknown; signature?: unknown; representatives?: unknown }

const repsOf = (v: unknown): number[] => (Array.isArray(v) ? [...new Set(v.map((x) => relId(x)).filter((x): x is number => x !== undefined))].sort((a, b) => a - b) : [])
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const bad = (message: string, path: string) => new APIError(message, 400, { errors: [{ path, message }] }, true)

async function rows(req: PayloadRequest, query: ReturnType<typeof sql>): Promise<Array<Record<string, unknown>>> {
  const adapter = req.payload.db as unknown as PostgresAdapter
  const txId = req.transactionID ? await req.transactionID : undefined
  const db = (txId !== undefined ? adapter.sessions[String(txId)]?.db : undefined) ?? adapter.drizzle
  return ((await db.execute(query)) as unknown as { rows: Array<Record<string, unknown>> }).rows
}

/**
 * Server-side checks of the tab (defence behind the form): a configuration is complete (name + signature) or
 * empty; the signature is a dedicated upload of the editor (never a user's profile signature or a signature
 * already used on a decision) or the one already linked to this PT; every representative holds the Direktur role
 * in this PT. Unchanged values are not re-checked (an unrelated save never fails on a later role change).
 */
export const validateDirektur: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  const d = (data as { direktur?: DirekturData }).direktur
  if (d === undefined || d === null) return data
  const before = ((originalDoc as { direktur?: DirekturData } | undefined)?.direktur ?? {}) as DirekturData
  const companyId = operation === 'update' ? relId((originalDoc as { id?: unknown } | undefined)?.id) : undefined
  const name = text(d.name)
  const sig = relId(d.signature)
  const reps = repsOf(d.representatives)
  const any = name !== '' || text(d.title) !== '' || sig !== undefined || reps.length > 0
  if (any && name === '') throw bad('Nama Direktur definitif wajib diisi (atau kosongkan seluruh isian tab ini).', 'direktur.name')
  if (any && sig === undefined) throw bad('Tanda tangan Direktur definitif wajib diunggah (atau kosongkan seluruh isian tab ini).', 'direktur.signature')
  if (sig !== undefined && sig !== relId(before.signature)) {
    const uid = relId(req.user)
    const r = (
      await rows(
        req,
        sql`SELECT m.uploaded_by_id AS uploader, m.owner_doc_type AS otype, m.owner_doc_id AS oid,
                   EXISTS (SELECT 1 FROM users u WHERE u.signature_id = m.id) AS profile,
                   EXISTS (SELECT 1 FROM approvals a WHERE a.signature_id = m.id) AS used
              FROM media_signatures m WHERE m.id = ${sig}`,
      )
    )[0]
    const linkedHere = r && r.otype === COMPANY_DIREKTUR_OWNER && companyId !== undefined && String(r.oid) === String(companyId)
    // a system write (seed / import, no user) may link any unlinked upload that is no profile / decision signature
    const fresh = r && r.oid === null && (uid === undefined || relId(r.uploader) === uid) && r.profile !== true && r.used !== true
    if (!linkedHere && !fresh) {
      throw bad('Tanda tangan Direktur definitif harus file baru yang Anda unggah di sini (bukan tanda tangan profil pengguna atau tanda tangan yang sudah dipakai).', 'direktur.signature')
    }
  }
  if (reps.join(',') !== repsOf(before.representatives).join(',') && reps.length > 0) {
    if (companyId === undefined) throw bad('Simpan PT terlebih dahulu, lalu pilih wakil penanda tangan.', 'direktur.representatives')
    const direkturs = new Set(await membersWithRole(req, DIREKTUR, companyId))
    if (reps.some((u) => !direkturs.has(u))) throw bad('Wakil penanda tangan harus pengguna aktif dengan peran Direktur di PT ini.', 'direktur.representatives')
  }
  return data
}

/**
 * Links the PT's signature upload to the PT (`owner_doc_type = company_direktur`, `owner_doc_id = <PT id>`,
 * immutable once set — DB trigger): from then on only the office roles of THIS PT read the file (media read
 * rule) and the representatives' personal-signature fallbacks never apply to it.
 */
export const linkDirekturSignature: CollectionAfterChangeHook = async ({ doc, req }) => {
  const sig = relId((doc as { direktur?: DirekturData }).direktur?.signature)
  if (sig === undefined) return doc
  await rows(
    req,
    sql`UPDATE media_signatures SET owner_doc_type = ${COMPANY_DIREKTUR_OWNER}, owner_doc_id = ${String(doc.id)}, updated_at = now()
         WHERE id = ${sig} AND owner_doc_id IS NULL`,
  )
  return doc
}
