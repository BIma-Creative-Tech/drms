import { APIError } from 'payload'

/**
 * Public domain refusal with a stable machine `code` (problem+json `code`, like ProgressError /
 * AddendumError) plus the figures the client needs to explain it (`pkExtra`, e.g. balance before /
 * after for CASH_OVERDRAFT_CONFIRM_REQUIRED). The /api/v1 wrapper copies plain scalar extras into the
 * problem body (http.ts problemExtra); RFC 9457 members are never overridden.
 */
export class CodedError extends APIError {
  constructor(
    status: number,
    message: string,
    readonly pkCode: string,
    readonly pkExtra: Record<string, string | number | boolean | null> = {},
    errors?: Array<{ path: string; message: string }>,
  ) {
    super(message, status, errors ? { errors } : null, true)
  }
}

export function failCoded(status: number, code: string, message: string, extra: Record<string, string | number | boolean | null> = {}, errors?: Array<{ path: string; message: string }>): never {
  throw new CodedError(status, message, code, extra, errors)
}

/** Stable codes of the QA 2026-10-08 finance confirmations / refusals (OpenAPI lists them). */
export const CASH_OVERDRAFT_CONFIRM_REQUIRED = 'CASH_OVERDRAFT_CONFIRM_REQUIRED'
export const BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED = 'BANK_ACCOUNT_UNVERIFIED_CONFIRM_REQUIRED'
export const SHORTFALL_REAPPROVAL_REQUIRED = 'SHORTFALL_REAPPROVAL_REQUIRED'
