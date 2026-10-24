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
import * as migration_20261008_120000_qa_flow_lpj_totals from './20261008_120000_qa_flow_lpj_totals';
import * as migration_20261008_120100_qa_flow_lpj_source from './20261008_120100_qa_flow_lpj_source';
import * as migration_20261008_120200_qa_flow_orphan_job from './20261008_120200_qa_flow_orphan_job';
import * as migration_20261009_090000_qa_settlements_guard_merge from './20261009_090000_qa_settlements_guard_merge';
import * as migration_20261009_120000_list_row_actions_column from './20261009_120000_list_row_actions_column';
import * as migration_20261010_080000_p2s_operator_role from './20261010_080000_p2s_operator_role';
import * as migration_20261010_090000_p2s_urgency_level from './20261010_090000_p2s_urgency_level';
import * as migration_20261010_100000_fr1_foundation from './20261010_100000_fr1_foundation';
import * as migration_20261010_110000_fr1_field_reports from './20261010_110000_fr1_field_reports';
import * as migration_20261010_120000_fr1_security from './20261010_120000_fr1_security';
import * as migration_20261010_130000_approval_pm_direktur from './20261010_130000_approval_pm_direktur';
import * as migration_20261011_100000_p3_rap from './20261011_100000_p3_rap';
import * as migration_20261011_110000_p3_security from './20261011_110000_p3_security';
import * as migration_20261012_100000_d1010_project_pm from './20261012_100000_d1010_project_pm';
import * as migration_20261012_200000_d1010_schema from './20261012_200000_d1010_schema';
import * as migration_20261012_200100_d1010_data from './20261012_200100_d1010_data';
import * as migration_20261012_300000_d1010_lines_lpj_photos from './20261012_300000_d1010_lines_lpj_photos';
import * as migration_20261012_300100_d1010_lines_guard from './20261012_300100_d1010_lines_guard';
import * as migration_20261012_300200_d1010_pb_monthly from './20261012_300200_d1010_pb_monthly';
import * as migration_20261012_400000_d1010_rap_cost_center from './20261012_400000_d1010_rap_cost_center';
import * as migration_20261012_400100_d1010_rap_guard from './20261012_400100_d1010_rap_guard';
import * as migration_20261013_100000_d1010_project_loans from './20261013_100000_d1010_project_loans';
import * as migration_20261013_100100_d1010_project_loans_guard from './20261013_100100_d1010_project_loans_guard';
import * as migration_20261013_200000_d1010_sites from './20261013_200000_d1010_sites';
import * as migration_20261013_200100_d1010_sites_guard from './20261013_200100_d1010_sites_guard';
import * as migration_20261013_300000_d1010_approval_config from './20261013_300000_d1010_approval_config';
import * as migration_20261013_300000_d1010_approval_config_data from './20261013_300000_d1010_approval_config_data';
import * as migration_20261013_300000_d1010_approval_config_guard from './20261013_300000_d1010_approval_config_guard';
import * as migration_20261013_400000_d1010_rap_all from './20261013_400000_d1010_rap_all';
import * as migration_20261013_400100_d1010_rap_all_guard from './20261013_400100_d1010_rap_all_guard';
import * as migration_20261013_500000_attachments_owner_link from './20261013_500000_attachments_owner_link';
import * as migration_20261013_610000_d1310_renumber from './20261013_610000_d1310_renumber';
import * as migration_20261013_620000_d1310_onsite from './20261013_620000_d1310_onsite';
import * as migration_20261013_620100_d1310_onsite_guard from './20261013_620100_d1310_onsite_guard';
import * as migration_20261013_630000_d1310_owner_role from './20261013_630000_d1310_owner_role';
import * as migration_20261013_630100_d1310_owner_role_guard from './20261013_630100_d1310_owner_role_guard';
import * as migration_20261013_630200_d1310_owner_role_data from './20261013_630200_d1310_owner_role_data';
import * as migration_20261013_700000_d1310_vendor_payments from './20261013_700000_d1310_vendor_payments';
import * as migration_20261013_700100_d1310_vendor_payments_guard from './20261013_700100_d1310_vendor_payments_guard';
import * as migration_20261013_700200_d1310_vendor_payments_data from './20261013_700200_d1310_vendor_payments_data';
import * as migration_20261013_910000_d1310_direktur_ttd from './20261013_910000_d1310_direktur_ttd';
import * as migration_20261013_910100_d1310_direktur_ttd_guard from './20261013_910100_d1310_direktur_ttd_guard';
import * as migration_20261014_100000_d1310_intercompany_enums from './20261014_100000_d1310_intercompany_enums';
import * as migration_20261014_100100_d1310_intercompany from './20261014_100100_d1310_intercompany';
import * as migration_20261014_100200_d1310_intercompany_guard from './20261014_100200_d1310_intercompany_guard';
import * as migration_20261014_100300_d1310_intercompany_data from './20261014_100300_d1310_intercompany_data';
import * as migration_20261015_100000_d1310_fundcheck_enums from './20261015_100000_d1310_fundcheck_enums';
import * as migration_20261015_100100_d1310_fundcheck_loans from './20261015_100100_d1310_fundcheck_loans';
import * as migration_20261015_100200_d1310_fundcheck_guard from './20261015_100200_d1310_fundcheck_guard';
import * as migration_20261015_100300_d1310_fundcheck_data from './20261015_100300_d1310_fundcheck_data';
import * as migration_20261015_150000_d1510_finance_rule_data from './20261015_150000_d1510_finance_rule_data';
import * as migration_20261015_200000_d1510_approval_reroute from './20261015_200000_d1510_approval_reroute';
import * as migration_20261015_210000_d1510_approval_inflight_trim from './20261015_210000_d1510_approval_inflight_trim';
import * as migration_20261016_100000_d1610_partner_contacts from './20261016_100000_d1610_partner_contacts';
import * as migration_20261016_200000_d1610_soft_delete_enums from './20261016_200000_d1610_soft_delete_enums';
import * as migration_20261016_200100_d1610_soft_delete from './20261016_200100_d1610_soft_delete';
import * as migration_20261016_220000_d1610_wakil_pm_direktur from './20261016_220000_d1610_wakil_pm_direktur';
import * as migration_20261017_100000_d1710_service_types from './20261017_100000_d1710_service_types';
import * as migration_20261021_100000_d2110_pb_enums from './20261021_100000_d2110_pb_enums';
import * as migration_20261021_100100_d2110_pb_schema from './20261021_100100_d2110_pb_schema';
import * as migration_20261021_100200_d2110_pb_guard from './20261021_100200_d2110_pb_guard';
import * as migration_20261022_100000_d2210_pb_fund from './20261022_100000_d2210_pb_fund';
import * as migration_20261024_200000_d2410_site_assignments from './20261024_200000_d2410_site_assignments';
import * as migration_20261024_210000_d2410_admin_staff_enums from './20261024_210000_d2410_admin_staff_enums';
import * as migration_20261024_210100_d2410_admin_staff_guard from './20261024_210100_d2410_admin_staff_guard';

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
    name: '20260927_234849_mc1_company_columns',
  },
  {
    up: migration_20260928_000100_mc1_security.up,
    down: migration_20260928_000100_mc1_security.down,
    name: '20260928_000100_mc1_security',
  },
  {
    up: migration_20260928_000200_mc1_numbering.up,
    down: migration_20260928_000200_mc1_numbering.down,
    name: '20260928_000200_mc1_numbering',
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
  {
    up: migration_20261008_120000_qa_flow_lpj_totals.up,
    down: migration_20261008_120000_qa_flow_lpj_totals.down,
    name: '20261008_120000_qa_flow_lpj_totals',
  },
  {
    up: migration_20261008_120100_qa_flow_lpj_source.up,
    down: migration_20261008_120100_qa_flow_lpj_source.down,
    name: '20261008_120100_qa_flow_lpj_source',
  },
  {
    up: migration_20261008_120200_qa_flow_orphan_job.up,
    down: migration_20261008_120200_qa_flow_orphan_job.down,
    name: '20261008_120200_qa_flow_orphan_job',
  },
  {
    up: migration_20261009_090000_qa_settlements_guard_merge.up,
    down: migration_20261009_090000_qa_settlements_guard_merge.down,
    name: '20261009_090000_qa_settlements_guard_merge',
  },
  {
    up: migration_20261009_120000_list_row_actions_column.up,
    down: migration_20261009_120000_list_row_actions_column.down,
    name: '20261009_120000_list_row_actions_column',
  },
  {
    up: migration_20261010_080000_p2s_operator_role.up,
    down: migration_20261010_080000_p2s_operator_role.down,
    name: '20261010_080000_p2s_operator_role',
  },
  {
    up: migration_20261010_090000_p2s_urgency_level.up,
    down: migration_20261010_090000_p2s_urgency_level.down,
    name: '20261010_090000_p2s_urgency_level',
  },
  {
    up: migration_20261010_100000_fr1_foundation.up,
    down: migration_20261010_100000_fr1_foundation.down,
    name: '20261010_100000_fr1_foundation',
  },
  {
    up: migration_20261010_110000_fr1_field_reports.up,
    down: migration_20261010_110000_fr1_field_reports.down,
    name: '20261010_110000_fr1_field_reports',
  },
  {
    up: migration_20261010_120000_fr1_security.up,
    down: migration_20261010_120000_fr1_security.down,
    name: '20261010_120000_fr1_security',
  },
  {
    up: migration_20261010_130000_approval_pm_direktur.up,
    down: migration_20261010_130000_approval_pm_direktur.down,
    name: '20261010_130000_approval_pm_direktur',
  },
  {
    up: migration_20261011_100000_p3_rap.up,
    down: migration_20261011_100000_p3_rap.down,
    name: '20261011_100000_p3_rap',
  },
  {
    up: migration_20261011_110000_p3_security.up,
    down: migration_20261011_110000_p3_security.down,
    name: '20261011_110000_p3_security',
  },
  {
    up: migration_20261012_100000_d1010_project_pm.up,
    down: migration_20261012_100000_d1010_project_pm.down,
    name: '20261012_100000_d1010_project_pm',
  },
  {
    up: migration_20261012_200000_d1010_schema.up,
    down: migration_20261012_200000_d1010_schema.down,
    name: '20261012_200000_d1010_schema',
  },
  {
    up: migration_20261012_200100_d1010_data.up,
    down: migration_20261012_200100_d1010_data.down,
    name: '20261012_200100_d1010_data',
  },
  {
    up: migration_20261012_300000_d1010_lines_lpj_photos.up,
    down: migration_20261012_300000_d1010_lines_lpj_photos.down,
    name: '20261012_300000_d1010_lines_lpj_photos',
  },
  {
    up: migration_20261012_300100_d1010_lines_guard.up,
    down: migration_20261012_300100_d1010_lines_guard.down,
    name: '20261012_300100_d1010_lines_guard',
  },
  {
    up: migration_20261012_300200_d1010_pb_monthly.up,
    down: migration_20261012_300200_d1010_pb_monthly.down,
    name: '20261012_300200_d1010_pb_monthly',
  },
  {
    up: migration_20261012_400000_d1010_rap_cost_center.up,
    down: migration_20261012_400000_d1010_rap_cost_center.down,
    name: '20261012_400000_d1010_rap_cost_center',
  },
  {
    up: migration_20261012_400100_d1010_rap_guard.up,
    down: migration_20261012_400100_d1010_rap_guard.down,
    name: '20261012_400100_d1010_rap_guard',
  },
  {
    up: migration_20261013_100000_d1010_project_loans.up,
    down: migration_20261013_100000_d1010_project_loans.down,
    name: '20261013_100000_d1010_project_loans',
  },
  {
    up: migration_20261013_100100_d1010_project_loans_guard.up,
    down: migration_20261013_100100_d1010_project_loans_guard.down,
    name: '20261013_100100_d1010_project_loans_guard',
  },
  {
    up: migration_20261013_200000_d1010_sites.up,
    down: migration_20261013_200000_d1010_sites.down,
    name: '20261013_200000_d1010_sites',
  },
  {
    up: migration_20261013_200100_d1010_sites_guard.up,
    down: migration_20261013_200100_d1010_sites_guard.down,
    name: '20261013_200100_d1010_sites_guard',
  },
  {
    up: migration_20261013_300000_d1010_approval_config.up,
    down: migration_20261013_300000_d1010_approval_config.down,
    name: '20261013_300000_d1010_approval_config',
  },
  {
    up: migration_20261013_300000_d1010_approval_config_data.up,
    down: migration_20261013_300000_d1010_approval_config_data.down,
    name: '20261013_300000_d1010_approval_config_data',
  },
  {
    up: migration_20261013_300000_d1010_approval_config_guard.up,
    down: migration_20261013_300000_d1010_approval_config_guard.down,
    name: '20261013_300000_d1010_approval_config_guard',
  },
  {
    up: migration_20261013_400000_d1010_rap_all.up,
    down: migration_20261013_400000_d1010_rap_all.down,
    name: '20261013_400000_d1010_rap_all',
  },
  {
    up: migration_20261013_400100_d1010_rap_all_guard.up,
    down: migration_20261013_400100_d1010_rap_all_guard.down,
    name: '20261013_400100_d1010_rap_all_guard',
  },
  {
    up: migration_20261013_500000_attachments_owner_link.up,
    down: migration_20261013_500000_attachments_owner_link.down,
    name: '20261013_500000_attachments_owner_link',
  },
  {
    up: migration_20261013_610000_d1310_renumber.up,
    down: migration_20261013_610000_d1310_renumber.down,
    name: '20261013_610000_d1310_renumber',
  },
  {
    up: migration_20261013_620000_d1310_onsite.up,
    down: migration_20261013_620000_d1310_onsite.down,
    name: '20261013_620000_d1310_onsite',
  },
  {
    up: migration_20261013_620100_d1310_onsite_guard.up,
    down: migration_20261013_620100_d1310_onsite_guard.down,
    name: '20261013_620100_d1310_onsite_guard',
  },
  {
    up: migration_20261013_630000_d1310_owner_role.up,
    down: migration_20261013_630000_d1310_owner_role.down,
    name: '20261013_630000_d1310_owner_role',
  },
  {
    up: migration_20261013_630100_d1310_owner_role_guard.up,
    down: migration_20261013_630100_d1310_owner_role_guard.down,
    name: '20261013_630100_d1310_owner_role_guard',
  },
  {
    up: migration_20261013_630200_d1310_owner_role_data.up,
    down: migration_20261013_630200_d1310_owner_role_data.down,
    name: '20261013_630200_d1310_owner_role_data',
  },
  {
    up: migration_20261013_700000_d1310_vendor_payments.up,
    down: migration_20261013_700000_d1310_vendor_payments.down,
    name: '20261013_700000_d1310_vendor_payments',
  },
  {
    up: migration_20261013_700100_d1310_vendor_payments_guard.up,
    down: migration_20261013_700100_d1310_vendor_payments_guard.down,
    name: '20261013_700100_d1310_vendor_payments_guard',
  },
  {
    up: migration_20261013_700200_d1310_vendor_payments_data.up,
    down: migration_20261013_700200_d1310_vendor_payments_data.down,
    name: '20261013_700200_d1310_vendor_payments_data',
  },
  {
    up: migration_20261013_910000_d1310_direktur_ttd.up,
    down: migration_20261013_910000_d1310_direktur_ttd.down,
    name: '20261013_910000_d1310_direktur_ttd',
  },
  {
    up: migration_20261013_910100_d1310_direktur_ttd_guard.up,
    down: migration_20261013_910100_d1310_direktur_ttd_guard.down,
    name: '20261013_910100_d1310_direktur_ttd_guard',
  },
  {
    up: migration_20261014_100000_d1310_intercompany_enums.up,
    down: migration_20261014_100000_d1310_intercompany_enums.down,
    name: '20261014_100000_d1310_intercompany_enums',
  },
  {
    up: migration_20261014_100100_d1310_intercompany.up,
    down: migration_20261014_100100_d1310_intercompany.down,
    name: '20261014_100100_d1310_intercompany',
  },
  {
    up: migration_20261014_100200_d1310_intercompany_guard.up,
    down: migration_20261014_100200_d1310_intercompany_guard.down,
    name: '20261014_100200_d1310_intercompany_guard',
  },
  {
    up: migration_20261014_100300_d1310_intercompany_data.up,
    down: migration_20261014_100300_d1310_intercompany_data.down,
    name: '20261014_100300_d1310_intercompany_data',
  },
  {
    up: migration_20261015_100000_d1310_fundcheck_enums.up,
    down: migration_20261015_100000_d1310_fundcheck_enums.down,
    name: '20261015_100000_d1310_fundcheck_enums',
  },
  {
    up: migration_20261015_100100_d1310_fundcheck_loans.up,
    down: migration_20261015_100100_d1310_fundcheck_loans.down,
    name: '20261015_100100_d1310_fundcheck_loans',
  },
  {
    up: migration_20261015_100200_d1310_fundcheck_guard.up,
    down: migration_20261015_100200_d1310_fundcheck_guard.down,
    name: '20261015_100200_d1310_fundcheck_guard',
  },
  {
    up: migration_20261015_100300_d1310_fundcheck_data.up,
    down: migration_20261015_100300_d1310_fundcheck_data.down,
    name: '20261015_100300_d1310_fundcheck_data',
  },
  {
    up: migration_20261015_150000_d1510_finance_rule_data.up,
    down: migration_20261015_150000_d1510_finance_rule_data.down,
    name: '20261015_150000_d1510_finance_rule_data',
  },
  {
    up: migration_20261015_200000_d1510_approval_reroute.up,
    down: migration_20261015_200000_d1510_approval_reroute.down,
    name: '20261015_200000_d1510_approval_reroute',
  },
  {
    up: migration_20261015_210000_d1510_approval_inflight_trim.up,
    down: migration_20261015_210000_d1510_approval_inflight_trim.down,
    name: '20261015_210000_d1510_approval_inflight_trim',
  },
  {
    up: migration_20261016_100000_d1610_partner_contacts.up,
    down: migration_20261016_100000_d1610_partner_contacts.down,
    name: '20261016_100000_d1610_partner_contacts',
  },
  {
    up: migration_20261016_200000_d1610_soft_delete_enums.up,
    down: migration_20261016_200000_d1610_soft_delete_enums.down,
    name: '20261016_200000_d1610_soft_delete_enums',
  },
  {
    up: migration_20261016_200100_d1610_soft_delete.up,
    down: migration_20261016_200100_d1610_soft_delete.down,
    name: '20261016_200100_d1610_soft_delete',
  },
  {
    up: migration_20261016_220000_d1610_wakil_pm_direktur.up,
    down: migration_20261016_220000_d1610_wakil_pm_direktur.down,
    name: '20261016_220000_d1610_wakil_pm_direktur',
  },
  {
    up: migration_20261017_100000_d1710_service_types.up,
    down: migration_20261017_100000_d1710_service_types.down,
    name: '20261017_100000_d1710_service_types',
  },
  {
    up: migration_20261021_100000_d2110_pb_enums.up,
    down: migration_20261021_100000_d2110_pb_enums.down,
    name: '20261021_100000_d2110_pb_enums',
  },
  {
    up: migration_20261021_100100_d2110_pb_schema.up,
    down: migration_20261021_100100_d2110_pb_schema.down,
    name: '20261021_100100_d2110_pb_schema',
  },
  {
    up: migration_20261021_100200_d2110_pb_guard.up,
    down: migration_20261021_100200_d2110_pb_guard.down,
    name: '20261021_100200_d2110_pb_guard',
  },
  {
    up: migration_20261022_100000_d2210_pb_fund.up,
    down: migration_20261022_100000_d2210_pb_fund.down,
    name: '20261022_100000_d2210_pb_fund',
  },
  {
    up: migration_20261024_200000_d2410_site_assignments.up,
    down: migration_20261024_200000_d2410_site_assignments.down,
    name: '20261024_200000_d2410_site_assignments',
  },
  {
    up: migration_20261024_210000_d2410_admin_staff_enums.up,
    down: migration_20261024_210000_d2410_admin_staff_enums.down,
    name: '20261024_210000_d2410_admin_staff_enums',
  },
  {
    up: migration_20261024_210100_d2410_admin_staff_guard.up,
    down: migration_20261024_210100_d2410_admin_staff_guard.down,
    name: '20261024_210100_d2410_admin_staff_guard',
  },
];
