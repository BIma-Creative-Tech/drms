import 'package:flutter/material.dart';

import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../../../shared/widgets/pk_ui.dart';
import '../../../shared/widgets/pk_ui_lapangan.dart';
import '../domain/attendance.dart';

/// Notice of the attendance screens: soft blue hint, soft red refusal (icon + text, never colour alone).
class InfoCard extends StatelessWidget {
  const InfoCard({super.key, required this.text, this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) => PkNotice(
    text: text,
    tone: error ? PkTone.bad : PkTone.info,
    icon: error ? Icons.warning_amber_rounded : Icons.info_outline,
  );
}

/// `Project` / `Pusat biaya` / `Site` (ADR 0023 — history only since ADR 0032).
String siteKindLabel(AppLocalizations t, SiteKind kind) => switch (kind) {
  SiteKind.project => t.siteProject,
  SiteKind.costCenter => t.siteCostCenter,
  SiteKind.site => t.siteSite,
};

/// Glyph of a location kind: project = building site, cost center = office, site = branch office (kantor cabang).
IconData siteKindIcon(SiteKind kind) => switch (kind) {
  SiteKind.project => Icons.apartment,
  SiteKind.costCenter => Icons.business,
  SiteKind.site => Icons.home_work,
};

/// Picker / history label: the location name.
String siteDisplayLabel(AppLocalizations t, ProjectSite s) => s.label;

/// Day flags for display: `OUTSIDE_AREA` (DRMS 13/10 A2) as "Di luar area", other codes as sent.
String flagsText(AppLocalizations t, List<String> flags) =>
    [for (final f in flags) f == 'OUTSIDE_AREA' ? t.attendanceOutsideArea : f].join(', ');

/// Line under the picker: kind (Project / Pusat biaya) and radius.
String siteSubLabel(AppLocalizations t, ProjectSite site) {
  final kind = siteKindLabel(t, site.kind);
  final radius = site.radiusM;
  return radius == null ? kind : '$kind · ${t.attendanceRadius(radius.round())}';
}

/// `Project · P-01 — Gudang` / `Pusat biaya · Ops Palangka` / `Site · BPN — Cabang Balikpapan`.
String siteLabel(AppLocalizations t, ProjectSite s) => '${siteKindLabel(t, s.kind)} · ${s.label}';

/// Indonesian problem text of a client-side geofence check (null = inside).
String? siteProblem(AppLocalizations t, ProjectSite site, ({SiteCheck check, int? distanceM}) res) =>
    switch (res.check) {
      SiteCheck.mocked => t.attendanceMocked,
      SiteCheck.noGeofence => t.attendanceNoGeofence,
      SiteCheck.outside => t.attendanceOutside(res.distanceM ?? 0, site.radiusM?.round() ?? 0),
      SiteCheck.ok => null,
    };

/// Geofence feedback: distance from the point vs the radius (+ GPS accuracy allowance), as a bar with the
/// numbers written out and an inside/outside icon (never colour alone).
class DistanceCard extends StatelessWidget {
  const DistanceCard({super.key, required this.site, required this.distanceM, required this.accuracyM});
  final ProjectSite site;
  final int distanceM;
  final double accuracyM;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final pk = context.pk;
    final radius = site.radiusM ?? 0;
    final allowance = accuracyM.clamp(0, accuracyAllowanceCapM).toDouble();
    final limit = radius + allowance;
    final inside = distanceM <= limit;
    final tone = inside ? PkTone.ok : PkTone.bad;
    final c = pkToneColors(context, tone);
    final scale = limit <= 0 ? 1.0 : (limit * 1.5);
    return Padding(
      key: const Key('attendance-distance'),
      padding: const EdgeInsets.only(bottom: 12),
      child: PkCard(
        radius: PkRadius.md,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                PkIconChip(icon: inside ? Icons.where_to_vote : Icons.wrong_location, tone: tone, size: 40),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    inside ? t.distanceInside : t.distanceOutside,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  '$distanceM m',
                  style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700, color: c.fg),
                ),
              ],
            ),
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, box) {
                final w = box.maxWidth;
                final limitX = (limit / scale * w).clamp(0, w).toDouble();
                final youX = (distanceM / scale * w).clamp(0, w).toDouble();
                return SizedBox(
                  height: 24,
                  child: Stack(
                    children: [
                      Positioned(
                        left: 0,
                        top: 8,
                        width: w,
                        height: 8,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        top: 8,
                        width: limitX,
                        height: 8,
                        child: DecoratedBox(
                          decoration: BoxDecoration(color: pk.okBg, borderRadius: BorderRadius.circular(8)),
                        ),
                      ),
                      Positioned(
                        left: (youX - 9).clamp(0, w - 18).toDouble(),
                        top: 3,
                        child: Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            color: inside ? pk.okText : pk.badText,
                            shape: BoxShape.circle,
                            border: Border.all(color: pk.card, width: 3),
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: 8),
            Text(
              t.distanceDetail(radius.round(), allowance.round(), accuracyM.round()),
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}
