import * as migration_20260923_103218_initial from './20260923_103218_initial';
import * as migration_20260923_103219_security from './20260923_103219_security';
import * as migration_20260923_122029_email from './20260923_122029_email';
import * as migration_20260923_133049_f2a_flow from './20260923_133049_f2a_flow';
import * as migration_20260923_133050_f2a_security from './20260923_133050_f2a_security';
import * as migration_20260923_161853_f2b_lpj_notifications from './20260923_161853_f2b_lpj_notifications';
import * as migration_20260923_161854_f2b_security from './20260923_161854_f2b_security';
import * as migration_20260924_020343_f2e_uat_fixes from './20260924_020343_f2e_uat_fixes';
import * as migration_20260924_020344_f2e_security from './20260924_020344_f2e_security';
import * as migration_20260924_025114_f4_mobile_sync from './20260924_025114_f4_mobile_sync';
import * as migration_20260924_025115_f4_security from './20260924_025115_f4_security';
import * as migration_20260924_110138_f3_reports from './20260924_110138_f3_reports';
import * as migration_20260925_015425_f4b_device_integrity from './20260925_015425_f4b_device_integrity';
import * as migration_20260925_023715_f4b_attendance from './20260925_023715_f4b_attendance';
import * as migration_20260925_023716_f4b_attendance_security from './20260925_023716_f4b_attendance_security';
import * as migration_20260926_022918_e1_approval_direktur_finance from './20260926_022918_e1_approval_direktur_finance';
import * as migration_20260926_091848_e6_attendance from './20260926_091848_e6_attendance';
import * as migration_20260926_095319_e4_progress_reports from './20260926_095319_e4_progress_reports';
import * as migration_20260926_104606_s2b_attendance_reminders from './20260926_104606_s2b_attendance_reminders';
import * as migration_20260926_114555_e5_budget_addenda from './20260926_114555_e5_budget_addenda';
import * as migration_20260926_131136_s3a_e9_hardening from './20260926_131136_s3a_e9_hardening';
import * as migration_20260926_133934_s3b_data_import from './20260926_133934_s3b_data_import';
import * as migration_20260926_141606_s3e_uat_gap_fixes from './20260926_141606_s3e_uat_gap_fixes';
import * as migration_20260927_230033_mc1_companies from './20260927_230033_mc1_companies';
import * as migration_20260927_234849_mc1_company_columns from './20260927_234849_mc1_company_columns';
import * as migration_20260928_000100_mc1_security from './20260928_000100_mc1_security';
import * as migration_20260928_000200_mc1_numbering from './20260928_000200_mc1_numbering';
import * as migration_20260928_090000_two_factor_audit from './20260928_090000_two_factor_audit';
import * as migration_20260930_120000_mc4_list_company_column from './20260930_120000_mc4_list_company_column';
import * as migration_20261002_080000_mc4_scope_rule from './20261002_080000_mc4_scope_rule';
import * as migration_20261003_090000_mc4_audit_company_backfill from './20261003_090000_mc4_audit_company_backfill';
import * as migration_20261005_090000_privacy_notice from './20261005_090000_privacy_notice';
import * as migration_20261005_090100_selfie_retention_6m from './20261005_090100_selfie_retention_6m';
import * as migration_20261008_090000_qa_finance_integrity from './20261008_090000_qa_finance_integrity';

export const migrations = [
  {
    up: migration_20260923_103218_initial.up,
    down: migration_20260923_103218_initial.down,
    name: '20260923_103218_initial',
  },
  {
    up: migration_20260923_103219_security.up,
    down: migration_20260923_103219_security.down,
    name: '20260923_103219_security',
  },
  {
    up: migration_20260923_122029_email.up,
    down: migration_20260923_122029_email.down,
    name: '20260923_122029_email',
  },
  {
    up: migration_20260923_133049_f2a_flow.up,
    down: migration_20260923_133049_f2a_flow.down,
    name: '20260923_133049_f2a_flow',
  },
  {
    up: migration_20260923_133050_f2a_security.up,
    down: migration_20260923_133050_f2a_security.down,
    name: '20260923_133050_f2a_security',
  },
  {
    up: migration_20260923_161853_f2b_lpj_notifications.up,
    down: migration_20260923_161853_f2b_lpj_notifications.down,
    name: '20260923_161853_f2b_lpj_notifications',
  },
  {
    up: migration_20260923_161854_f2b_security.up,
    down: migration_20260923_161854_f2b_security.down,
    name: '20260923_161854_f2b_security',
  },
  {
    up: migration_20260924_020343_f2e_uat_fixes.up,
    down: migration_20260924_020343_f2e_uat_fixes.down,
    name: '20260924_020343_f2e_uat_fixes',
  },
  {
    up: migration_20260924_020344_f2e_security.up,
    down: migration_20260924_020344_f2e_security.down,
    name: '20260924_020344_f2e_security',
  },
  {
    up: migration_20260924_025114_f4_mobile_sync.up,
    down: migration_20260924_025114_f4_mobile_sync.down,
    name: '20260924_025114_f4_mobile_sync',
  },
  {
    up: migration_20260924_025115_f4_security.up,
    down: migration_20260924_025115_f4_security.down,
    name: '20260924_025115_f4_security',
  },
  {
    up: migration_20260924_110138_f3_reports.up,
    down: migration_20260924_110138_f3_reports.down,
    name: '20260924_110138_f3_reports',
  },
  {
    up: migration_20260925_015425_f4b_device_integrity.up,
    down: migration_20260925_015425_f4b_device_integrity.down,
    name: '20260925_015425_f4b_device_integrity',
  },
  {
    up: migration_20260925_023715_f4b_attendance.up,
    down: migration_20260925_023715_f4b_attendance.down,
    name: '20260925_023715_f4b_attendance',
  },
  {
    up: migration_20260925_023716_f4b_attendance_security.up,
    down: migration_20260925_023716_f4b_attendance_security.down,
    name: '20260925_023716_f4b_attendance_security',
  },
  {
    up: migration_20260926_022918_e1_approval_direktur_finance.up,
    down: migration_20260926_022918_e1_approval_direktur_finance.down,
    name: '20260926_022918_e1_approval_direktur_finance',
  },
  {
    up: migration_20260926_091848_e6_attendance.up,
    down: migration_20260926_091848_e6_attendance.down,
    name: '20260926_091848_e6_attendance',
  },
  {
    up: migration_20260926_095319_e4_progress_reports.up,
    down: migration_20260926_095319_e4_progress_reports.down,
    name: '20260926_095319_e4_progress_reports',
  },
  {
    up: migration_20260926_104606_s2b_attendance_reminders.up,
    down: migration_20260926_104606_s2b_attendance_reminders.down,
    name: '20260926_104606_s2b_attendance_reminders',
  },
  {
    up: migration_20260926_114555_e5_budget_addenda.up,
    down: migration_20260926_114555_e5_budget_addenda.down,
    name: '20260926_114555_e5_budget_addenda',
  },
  {
    up: migration_20260926_131136_s3a_e9_hardening.up,
    down: migration_20260926_131136_s3a_e9_hardening.down,
    name: '20260926_131136_s3a_e9_hardening',
  },
  {
    up: migration_20260926_133934_s3b_data_import.up,
    down: migration_20260926_133934_s3b_data_import.down,
    name: '20260926_133934_s3b_data_import',
  },
  {
    up: migration_20260926_141606_s3e_uat_gap_fixes.up,
    down: migration_20260926_141606_s3e_uat_gap_fixes.down,
    name: '20260926_141606_s3e_uat_gap_fixes',
  },
  {
    up: migration_20260927_230033_mc1_companies.up,
    down: migration_20260927_230033_mc1_companies.down,
    name: '20260927_230033_mc1_companies',
  },
  {
    up: migration_20260927_234849_mc1_company_columns.up,
    down: migration_20260927_234849_mc1_company_columns.down,
    name: '20260927_234849_mc1_company_columns'
  },
  {
    up: migration_20260928_000100_mc1_security.up,
    down: migration_20260928_000100_mc1_security.down,
    name: '20260928_000100_mc1_security'
  },
  {
    up: migration_20260928_000200_mc1_numbering.up,
    down: migration_20260928_000200_mc1_numbering.down,
    name: '20260928_000200_mc1_numbering'
  },
  {
    up: migration_20260928_090000_two_factor_audit.up,
    down: migration_20260928_090000_two_factor_audit.down,
    name: '20260928_090000_two_factor_audit',
  },
  {
    up: migration_20260930_120000_mc4_list_company_column.up,
    down: migration_20260930_120000_mc4_list_company_column.down,
    name: '20260930_120000_mc4_list_company_column',
  },
  {
    up: migration_20261002_080000_mc4_scope_rule.up,
    down: migration_20261002_080000_mc4_scope_rule.down,
    name: '20261002_080000_mc4_scope_rule',
  },
  {
    up: migration_20261003_090000_mc4_audit_company_backfill.up,
    down: migration_20261003_090000_mc4_audit_company_backfill.down,
    name: '20261003_090000_mc4_audit_company_backfill',
  },
  {
    up: migration_20261005_090000_privacy_notice.up,
    down: migration_20261005_090000_privacy_notice.down,
    name: '20261005_090000_privacy_notice',
  },
  {
    up: migration_20261005_090100_selfie_retention_6m.up,
    down: migration_20261005_090100_selfie_retention_6m.down,
    name: '20261005_090100_selfie_retention_6m',
  },
  {
    up: migration_20261008_090000_qa_finance_integrity.up,
    down: migration_20261008_090000_qa_finance_integrity.down,
    name: '20261008_090000_qa_finance_integrity',
  },
];
