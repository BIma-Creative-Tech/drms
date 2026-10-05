/**
 * Selfie retention policy (Q-33). Owner decision 2026-10-05: attendance selfies are kept 6 months — the value
 * stated in the employee privacy notice (docs/proyekkas/legal/pemberitahuan-privasi.md §4; a unit test keeps the
 * two equal). Per-PT setting `companies.selfieRetentionMonths`; deleting stays an owner switch
 * (`selfieRetentionDeleteEnabled`, default off = dry run).
 */
export const SELFIE_RETENTION_DEFAULT_MONTHS = 6
