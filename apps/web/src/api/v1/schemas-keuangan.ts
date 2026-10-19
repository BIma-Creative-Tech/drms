import { z } from 'zod'

import { CashEntryIntercompany, CashSourceTypeEnum, RequestTypeEnum } from './schemas-flow'

/**
 * User 2026-10-19 (APK ↔ web parity, phase 3 Keuangan): read models of the web pages "Buku kas", "Tutup buku",
 * "Transfer tercatat — dapat dibatalkan" and the "Data …" collection lists, so the APK shows exactly what the web
 * shows. Writes keep using the existing endpoints. Pure zod (bundled by scripts/gen-openapi.mjs).
 */
const id = z.number().int().positive()
const money = z.number().int()
const date = z.string().meta({ description: 'Business date YYYY-MM-DD (PT time zone).' })
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const Option = z.object({ id, label: z.string(), active: z.boolean(), companyId: id.nullable() })

export const KasBook = z
  .object({
    today: date,
    canWrite: z.boolean().meta({ description: 'The caller is Finance in one of the shown PTs ("Kas masuk" / "Kas keluar").' }),
    pts: z.array(
      z.object({
        companyId: id,
        lockDate: z.string().nullable().meta({ description: 'Tutup buku s/d (end of the latest closed month), null = none.' }),
        today: date,
        minDate: z.string().nullable().meta({ description: 'Earliest date of a new posting (day after the lock date).' }),
        write: z.boolean().meta({ description: 'Finance of this PT (record / edit / void).' }),
        reopen: z.boolean().meta({ description: 'Direktur (pk-owner) of this PT (re-open a closed period).' }),
        intercompanyReceiving: z.string().nullable().meta({ description: 'ADR 0028: label of the PT\'s "Rekening penerimaan antar-PT", null = not set.' }),
      }),
    ),
    lookups: z.object({
      accounts: z.array(Option.extend({ openingDate: z.string().nullable(), siteId: id.nullable(), intercompanyReceiving: z.boolean() })),
      sites: z.array(Option),
      projects: z.array(Option),
      costCenters: z.array(Option),
      categories: z.array(Option.extend({ requiresVehicle: z.boolean() })),
      sources: z.array(Option),
      vehicles: z.array(Option),
    }),
    total: money,
    byPt: z.array(z.object({ companyId: id, total: money })),
    flowPeriod: period,
    accounts: z
      .array(z.object({ cashAccountId: id, companyId: id, name: z.string(), balance: money, flowIn: money, flowOut: money, n: z.number().int() }))
      .meta({ description: 'Balance tiles (active or non-zero accounts; site filter) + Σ in / out of flowPeriod.' }),
    page: z.object({
      rows: z.array(
        z.object({
          id,
          companyId: id.nullable(),
          entryNo: z.string(),
          entryDate: date,
          period: z.string().nullable(),
          direction: z.enum(['in', 'out']),
          amount: money,
          status: z.enum(['posted', 'void']),
          sourceType: CashSourceTypeEnum,
          description: z.string().nullable(),
          cashAccountId: id,
          projectId: id.nullable(),
          costCenterId: id.nullable(),
          categoryId: id.nullable(),
          cashInSourceId: id.nullable(),
          vehicleId: id.nullable(),
          proofId: id.nullable(),
          voidReason: z.string().nullable(),
          reversalOf: z.object({ id, entryNo: z.string() }).nullable(),
          reversedBy: z.object({ id, entryNo: z.string() }).nullable(),
          request: z.object({ id, docNo: z.string().nullable() }).nullable(),
          intercompany: CashEntryIntercompany.nullable(),
          canEdit: z.boolean(),
          canVoid: z.boolean(),
          voidHint: z.string().nullable().meta({ description: 'Why Finance has no Void button on this row (shown as a hint).' }),
        }),
      ),
      totalDocs: z.number().int(),
      page: z.number().int(),
      totalPages: z.number().int(),
    }),
  })
  .meta({ id: 'KasBook', description: 'The web "Buku kas" page (/admin/kas): tiles, filters lookups, one page of the ledger.' })

export const KasPeriods = z
  .object({
    company: id.nullable().meta({ description: 'The PT shown; null = several Kas PTs and none chosen (pick one from `pts`).' }),
    pts: z.array(z.object({ companyId: id, lockDate: z.string().nullable() })),
    today: date.nullable(),
    lockDate: z.string().nullable(),
    booksStart: z.string().nullable(),
    latestClosed: period.nullable(),
    canReopen: z.boolean(),
    closable: z.array(period),
    rows: z.array(
      z.object({
        period,
        state: z.enum(['closed', 'open', 'current']),
        explicit: z.boolean().meta({ description: 'A "closed" closing row exists for this month (else it is locked by a later close: "Terkunci").' }),
        n: z.number().int(),
        tin: money,
        tout: money,
        voids: z.number().int(),
        nKoreksi: z.number().int(),
        koreksi: money,
        canClose: z.boolean(),
        canReopen: z.boolean(),
      }),
    ),
    history: z.array(
      z.object({
        id,
        period,
        status: z.enum(['closed', 'reopened']),
        note: z.string().nullable(),
        closedBy: z.string().nullable(),
        closedAt: z.string().nullable(),
        reopenedBy: z.string().nullable(),
        reopenedAt: z.string().nullable(),
        reopenReason: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'KasPeriods', description: 'The web "Tutup buku" page (/admin/tutup-buku) of one PT.' })

export const VoidableTransferList = z
  .object({
    items: z.array(
      z.object({
        transferId: id,
        companyId: id.nullable(),
        transferNo: z.string(),
        transferDate: z.string(),
        amount: money,
        cashAccountId: id.nullable(),
        cashEntryId: id.nullable(),
        requestId: id,
        requestNo: z.string().nullable(),
        requestTitle: z.string(),
        requestType: RequestTypeEnum,
        canVoid: z.boolean().meta({ description: 'Finance of the request PT (POST /expense-requests/{id}/transfers/{tid}/void).' }),
      }),
    ),
    total: z.number().int(),
    page: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'VoidableTransferList', description: 'Posted transfers whose request is still "Sudah Ditransfer" (web Antrian Transfer › Transfer tercatat).' })

export const DataList = z
  .object({
    collection: z.string(),
    label: z.string(),
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    items: z.array(z.object({ id: z.union([z.number(), z.string()]), title: z.string(), cells: z.record(z.string(), z.string().nullable()) })),
    totalDocs: z.number().int(),
    page: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({ id: 'DataList', description: 'A web collection list (columns = the list\'s default columns), values as display text.' })

export const DataDetail = z
  .object({
    collection: z.string(),
    label: z.string(),
    id: z.union([z.number(), z.string()]),
    title: z.string(),
    fields: z.array(z.object({ key: z.string(), label: z.string(), value: z.string().nullable() })),
  })
  .meta({ id: 'DataDetail', description: 'Every readable field of one document, as display text (read-only).' })
