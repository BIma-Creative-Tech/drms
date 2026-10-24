import 'package:flutter/material.dart';

import '../../../app/theme.dart';
import '../../../l10n/gen/app_localizations.dart';
import '../domain/attendance.dart';

class InfoCard extends StatelessWidget {
  const InfoCard({super.key, required this.text, this.error = false});
  final String text;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: error ? scheme.errorContainer : scheme.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(error ? Icons.warning_amber_rounded : Icons.info_outline, size: 20),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        ),
      ),
    );
  }
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
    final radius = site.radiusM ?? 0;
    final allowance = accuracyM.clamp(0, accuracyAllowanceCapM).toDouble();
    final limit = radius + allowance;
    final inside = distanceM <= limit;
    final color = inside ? context.pk.okText : context.pk.badText;
    final scale = limit <= 0 ? 1.0 : (limit * 1.5);
    return Card(
      key: const Key('attendance-distance'),
      elevation: 0,
      color: color.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(PkTokens.radius),
        side: BorderSide(color: color.withValues(alpha: 0.4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(inside ? Icons.where_to_vote : Icons.wrong_location, color: color),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    inside ? t.distanceInside : t.distanceOutside,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                Text('$distanceM m', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, c) {
                final w = c.maxWidth;
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
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        top: 8,
                        width: limitX,
                        height: 8,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: context.pk.okText.withValues(alpha: 0.35),
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ),
                      Positioned(
                        left: (youX - 8).clamp(0, w - 16).toDouble(),
                        top: 4,
                        child: Container(
                          width: 16,
                          height: 16,
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                            border: Border.all(color: theme.colorScheme.surface, width: 2),
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
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
