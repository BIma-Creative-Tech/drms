import '../../../app/theme.dart';
import '../../../shared/icons/iconsax.dart';

/// One menu entry of the web launcher (`GET /api/v1/me/modules`, web `ResolvedItem`): [href] is the web route relative
/// to `/admin`; the APK opens its own screen for it ([apkTargetFor]).
class WebMenuItem {
  const WebMenuItem({required this.href, required this.label, this.kind = 'view', this.badge = 0});
  final String href;
  final String label;
  final String kind;
  final int badge;

  factory WebMenuItem.fromJson(Map<String, dynamic> j) => WebMenuItem(
    href: j['href'] as String,
    label: j['label'] as String,
    kind: (j['kind'] as String?) ?? 'view',
    badge: (j['badge'] as num?)?.toInt() ?? 0,
  );

  Map<String, dynamic> toJson() => {'href': href, 'label': label, 'kind': kind, 'badge': badge};
}

class WebMenuSection {
  const WebMenuSection({this.label, required this.items});
  final String? label;
  final List<WebMenuItem> items;

  factory WebMenuSection.fromJson(Map<String, dynamic> j) => WebMenuSection(
    label: j['label'] as String?,
    items: [for (final i in j['items'] as List<dynamic>) WebMenuItem.fromJson(i as Map<String, dynamic>)],
  );

  Map<String, dynamic> toJson() => {
    'label': label,
    'items': [for (final i in items) i.toJson()],
  };
}

/// A web launcher module (user 2026-10-18: the APK Beranda shows the same modules and sub-menus as the web `/admin`).
class WebModule {
  const WebModule({required this.id, required this.label, this.hint = '', this.badge = 0, required this.sections});
  final String id;
  final String label;
  final String hint;
  final int badge;
  final List<WebMenuSection> sections;

  List<WebMenuItem> get items => [for (final s in sections) ...s.items];

  /// Gradient of the tile (web `moduleGradients`); unknown ids fall back to the dashboard colours.
  PkModule get module => PkModule.values.where((m) => m.name == id).firstOrNull ?? PkModule.dashboard;

  /// Glyph of the tile (web registry `icon`).
  PkIconData get icon => switch (id) {
    'dashboard' => PkIcons.home,
    'persetujuan' => PkIcons.approval,
    'proyek' => PkIcons.project,
    'keuangan' => PkIcons.finance,
    'absensi' => PkIcons.attendance,
    'laporan' => PkIcons.report,
    'pengguna' => PkIcons.users,
    'master' => PkIcons.master,
    'media' => PkIcons.media,
    'pengaturan' => PkIcons.settings,
    'sistem' => PkIcons.system,
    _ => PkIcons.all.first,
  };

  factory WebModule.fromJson(Map<String, dynamic> j) => WebModule(
    id: j['id'] as String,
    label: j['label'] as String,
    hint: (j['hint'] as String?) ?? '',
    badge: (j['badge'] as num?)?.toInt() ?? 0,
    sections: [for (final s in j['sections'] as List<dynamic>) WebMenuSection.fromJson(s as Map<String, dynamic>)],
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'label': label,
    'hint': hint,
    'badge': badge,
    'sections': [for (final s in sections) s.toJson()],
  };
}

List<WebModule> webModulesFromJson(Map<String, dynamic> j) => [
  for (final m in j['modules'] as List<dynamic>) WebModule.fromJson(m as Map<String, dynamic>),
];
