import '../../expense/data/expense_mappers.dart' show Json, progressPhotosPlaceholderKey;

/// E4 progress reports (US-10/11/12/31, requirements §8 T11). JSON = openapi v1 (`ProgressReport`,
/// `ProjectStageSet`, `ProjectProgressItem`, `SyncProgressReportCopy`). Parsing is tolerant.

int _int(Object? v, [int fallback = 0]) =>
    v is num ? v.toInt() : (v is String ? int.tryParse(v) ?? fallback : fallback);
int? _intN(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double _dbl(Object? v, [double fallback = 0]) =>
    v is num ? v.toDouble() : (v is String ? double.tryParse(v) ?? fallback : fallback);
double? _dblN(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);
String? _strN(Object? v) => v == null ? null : '$v';
Json _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];

/// Maximum photos per report (server PHOTO_LIMIT, DB guard).
const maxProgressPhotos = 5;

/// Edit window after creation (server `editableUntil`).
const progressEditWindow = Duration(hours: 24);

class ProjectStage {
  const ProjectStage({
    required this.id,
    required this.name,
    required this.weightPct,
    required this.sequence,
    required this.progressPct,
    this.active = true,
  });
  final int id;
  final String name;
  final double weightPct;
  final int sequence;
  final double progressPct;
  final bool active;

  factory ProjectStage.fromJson(Json j) => ProjectStage(
    id: _int(j['id']),
    name: '${j['name'] ?? ''}',
    weightPct: _dbl(j['weightPct']),
    sequence: _int(j['sequence']),
    progressPct: _dbl(j['progressPct']),
    active: j['active'] != false,
  );
}

class ProjectStageSet {
  const ProjectStageSet({
    required this.projectId,
    required this.weightSum,
    required this.complete,
    required this.progressPct,
    required this.stages,
    this.fromCache = false,
  });
  final int projectId;
  final double weightSum;

  /// Σ active weights = 100 → reports can be created (else the server answers WEIGHTS_INCOMPLETE).
  final bool complete;
  final double progressPct;
  final List<ProjectStage> stages;

  /// Built from the cached masters (offline), may be older than the server.
  final bool fromCache;

  List<ProjectStage> get activeStages => [
    for (final s in stages)
      if (s.active) s,
  ]..sort((a, b) => a.sequence.compareTo(b.sequence));

  factory ProjectStageSet.fromJson(Json j) => ProjectStageSet(
    projectId: _int(j['projectId']),
    weightSum: _dbl(j['weightSum']),
    complete: j['complete'] == true,
    progressPct: _dbl(j['progressPct']),
    stages: [for (final s in _list(j['stages'])) ProjectStage.fromJson(_map(s))],
  );

  /// Offline fallback from the `project-stages` masters rows of one project.
  factory ProjectStageSet.fromMasters(int projectId, List<Json> rows) {
    final stages = [
      for (final r in rows)
        if (_intN(r['project']) == projectId) ProjectStage.fromJson(r),
    ];
    final active = stages.where((s) => s.active);
    final sum = active.fold<double>(0, (a, s) => a + s.weightPct);
    final progress = active.fold<double>(0, (a, s) => a + s.weightPct * s.progressPct) / 100;
    return ProjectStageSet(
      projectId: projectId,
      weightSum: sum,
      complete: (sum - 100).abs() < 0.001,
      progressPct: double.parse(progress.toStringAsFixed(2)),
      stages: stages,
      fromCache: true,
    );
  }
}

class ProgressPhoto {
  const ProgressPhoto({required this.id, this.width, this.height});
  final int id;
  final int? width;
  final int? height;
}

/// Server report (`ProgressReport`).
class ProgressReport {
  const ProgressReport({
    required this.id,
    this.docNo,
    required this.projectId,
    this.projectCode,
    this.projectName,
    required this.stageId,
    this.stageName,
    this.stageWeightPct,
    required this.reportDate,
    required this.pctBefore,
    required this.pctAfter,
    this.projectPctBefore,
    this.projectPctAfter,
    required this.work,
    this.issues,
    this.reporterId,
    this.reporterName,
    this.photos = const [],
    this.offline = false,
    this.timeTrust,
    this.flags = const [],
    this.receivedAt,
    this.editableUntil,
    this.editable = false,
    this.rev = 1,
    this.clientUuid,
    this.createdAt,
  });

  final int id;
  final String? docNo;
  final int projectId;
  final String? projectCode;
  final String? projectName;
  final int stageId;
  final String? stageName;
  final double? stageWeightPct;
  final String reportDate;
  final double pctBefore;
  final double pctAfter;
  final double? projectPctBefore;
  final double? projectPctAfter;
  final String work;
  final String? issues;
  final int? reporterId;
  final String? reporterName;
  final List<ProgressPhoto> photos;
  final bool offline;
  final String? timeTrust;
  final List<String> flags;
  final String? receivedAt;
  final String? editableUntil;

  /// The caller is the reporter and the 24 h window is open (server).
  final bool editable;
  final int rev;
  final String? clientUuid;
  final String? createdAt;

  String get projectLabel => [projectCode, projectName].whereType<String>().where((e) => e.isNotEmpty).join(' — ');

  factory ProgressReport.fromJson(Json j) {
    final p = _map(j['project']);
    final s = _map(j['stage']);
    final r = _map(j['reporter']);
    return ProgressReport(
      id: _int(j['id']),
      docNo: _strN(j['docNo']),
      projectId: _int(p['id']),
      projectCode: _strN(p['code']),
      projectName: _strN(p['name']),
      stageId: _int(s['id']),
      stageName: _strN(s['name']),
      stageWeightPct: _dblN(s['weightPct']),
      reportDate: '${j['reportDate'] ?? ''}',
      pctBefore: _dbl(j['pctBefore']),
      pctAfter: _dbl(j['pctAfter']),
      projectPctBefore: _dblN(j['projectPctBefore']),
      projectPctAfter: _dblN(j['projectPctAfter']),
      work: '${j['work'] ?? ''}',
      issues: _strN(j['issues']),
      reporterId: _intN(r['id']),
      reporterName: _strN(r['name']),
      photos: [
        for (final ph in _list(j['photos']))
          ProgressPhoto(id: _int(_map(ph)['id']), width: _intN(_map(ph)['width']), height: _intN(_map(ph)['height'])),
      ],
      offline: j['offline'] == true,
      timeTrust: _strN(j['timeTrust']),
      flags: [for (final f in _list(j['flags'])) '$f'],
      receivedAt: _strN(j['receivedAt']),
      editableUntil: _strN(j['editableUntil']),
      editable: j['editable'] == true,
      rev: _int(j['rev'], 1),
      clientUuid: _strN(j['clientUuid']),
      createdAt: _strN(j['createdAt']),
    );
  }
}

class ProgressReportPage {
  const ProgressReportPage({required this.items, this.nextCursor});
  final List<ProgressReport> items;
  final String? nextCursor;

  factory ProgressReportPage.fromJson(Json j) => ProgressReportPage(
    items: [for (final i in _list(j['items'])) ProgressReport.fromJson(_map(i))],
    nextCursor: _strN(j['nextCursor']),
  );
}

/// `server_report` of a sync result (snake_case, `SyncProgressReportCopy`).
class ServerReportCopy {
  const ServerReportCopy({
    required this.id,
    required this.rev,
    this.docNo,
    required this.pctBefore,
    required this.pctAfter,
    required this.work,
    this.issues,
    this.photoCount = 0,
    this.editableUntil,
    this.reportDate,
  });
  final int id;
  final int rev;
  final String? docNo;
  final double pctBefore;
  final double pctAfter;
  final String work;
  final String? issues;
  final int photoCount;
  final String? editableUntil;
  final String? reportDate;

  factory ServerReportCopy.fromJson(Json j) => ServerReportCopy(
    id: _int(j['id']),
    rev: _int(j['rev'], 1),
    docNo: _strN(j['doc_no']),
    pctBefore: _dbl(j['pct_before']),
    pctAfter: _dbl(j['pct_after']),
    work: '${j['work'] ?? ''}',
    issues: _strN(j['issues']),
    photoCount: _list(j['photo_media_ids']).length,
    editableUntil: _strN(j['editable_until']),
    reportDate: _strN(j['report_date']),
  );

  bool editableAt(DateTime now) {
    final u = DateTime.tryParse(editableUntil ?? '');
    return u != null && u.isAfter(now);
  }
}

enum ProgressTone {
  none,
  ok,
  warn,
  bad;

  static ProgressTone fromCode(String? c) =>
      ProgressTone.values.firstWhere((t) => t.name == c, orElse: () => ProgressTone.none);
}

/// K-09 progress fisik vs anggaran (`ProjectProgressItem`).
class ProjectProgress {
  const ProjectProgress({
    required this.id,
    required this.code,
    required this.name,
    required this.status,
    this.budget,
    this.committed = 0,
    this.budgetPct,
    required this.progressPct,
    this.stagesComplete = false,
    this.weightSum = 0,
    this.gap,
    this.tone = ProgressTone.none,
    this.toneLabel = '',
    this.lastReportDate,
    this.reportCount = 0,
  });
  final int id;
  final String code;
  final String name;
  final String status;
  final double? budget;
  final double committed;
  final double? budgetPct;
  final double progressPct;
  final bool stagesComplete;
  final double weightSum;

  /// budgetPct − progressPct (positive = money ahead of the physical work).
  final double? gap;
  final ProgressTone tone;
  final String toneLabel;
  final String? lastReportDate;
  final int reportCount;

  factory ProjectProgress.fromJson(Json j) => ProjectProgress(
    id: _int(j['id']),
    code: '${j['code'] ?? ''}',
    name: '${j['name'] ?? ''}',
    status: '${j['status'] ?? ''}',
    budget: _dblN(j['budget']),
    committed: _dbl(j['committed']),
    budgetPct: _dblN(j['budgetPct']),
    progressPct: _dbl(j['progressPct']),
    stagesComplete: j['stagesComplete'] == true,
    weightSum: _dbl(j['weightSum']),
    gap: _dblN(j['gap']),
    tone: ProgressTone.fromCode(_strN(j['tone'])),
    toneLabel: '${j['toneLabel'] ?? ''}',
    lastReportDate: _strN(j['lastReportDate']),
    reportCount: _int(j['reportCount']),
  );
}

class ProjectProgressList {
  const ProjectProgressList({required this.asOf, required this.projects, this.warnGapPct, this.badGapPct});
  final String asOf;
  final List<ProjectProgress> projects;
  final double? warnGapPct;
  final double? badGapPct;

  factory ProjectProgressList.fromJson(Json j) => ProjectProgressList(
    asOf: '${j['asOf'] ?? ''}',
    warnGapPct: _dblN(j['warnGapPct']),
    badGapPct: _dblN(j['badGapPct']),
    projects: [for (final p in _list(j['projects'])) ProjectProgress.fromJson(_map(p))],
  );
}

/// Local state of a report written on the phone.
enum ProgressSyncState {
  local,
  queued,
  synced,
  conflict,
  rejected;

  static ProgressSyncState fromCode(String? c) =>
      ProgressSyncState.values.firstWhere((s) => s.name == c, orElse: () => ProgressSyncState.local);
}

/// A report being written or edited on the phone (row of `local_progress_reports`).
class ProgressDraft {
  const ProgressDraft({
    required this.clientUuid,
    required this.projectId,
    this.projectLabel = '',
    required this.stageId,
    this.stageLabel = '',
    this.pctBefore,
    required this.pctAfter,
    this.work = '',
    this.issues,
    this.photoUuids = const [],
    this.serverPhotoCount = 0,
    this.reason,
    this.serverId,
    this.serverRev,
    this.serverPctAfter,
    this.docNo,
    this.editableUntil,
    this.syncState = ProgressSyncState.local,
    this.lastError,
    this.lastErrorCode,
    this.conflictCopy,
    this.offline = false,
    this.updatedAt,
  });

  final String clientUuid;
  final int projectId;
  final String projectLabel;
  final int stageId;
  final String stageLabel;
  final double? pctBefore;
  final double pctAfter;
  final String work;
  final String? issues;
  final List<String> photoUuids;
  final int serverPhotoCount;
  final String? reason;
  final int? serverId;
  final int? serverRev;
  final double? serverPctAfter;
  final String? docNo;
  final String? editableUntil;
  final ProgressSyncState syncState;
  final String? lastError;
  final String? lastErrorCode;
  final ServerReportCopy? conflictCopy;
  final bool offline;
  final DateTime? updatedAt;

  /// The server knows this report → the change is an edit (reason required, ≤ 24 h).
  bool get isEdit => serverId != null;

  int get photoTotal => serverPhotoCount + photoUuids.length;

  ProgressDraft copyWith({
    int? projectId,
    String? projectLabel,
    int? stageId,
    String? stageLabel,
    double? pctBefore,
    double? pctAfter,
    String? work,
    String? issues,
    List<String>? photoUuids,
    String? reason,
    ProgressSyncState? syncState,
  }) => ProgressDraft(
    clientUuid: clientUuid,
    projectId: projectId ?? this.projectId,
    projectLabel: projectLabel ?? this.projectLabel,
    stageId: stageId ?? this.stageId,
    stageLabel: stageLabel ?? this.stageLabel,
    pctBefore: pctBefore ?? this.pctBefore,
    pctAfter: pctAfter ?? this.pctAfter,
    work: work ?? this.work,
    issues: issues ?? this.issues,
    photoUuids: photoUuids ?? this.photoUuids,
    serverPhotoCount: serverPhotoCount,
    reason: reason ?? this.reason,
    serverId: serverId,
    serverRev: serverRev,
    serverPctAfter: serverPctAfter,
    docNo: docNo,
    editableUntil: editableUntil,
    syncState: syncState ?? this.syncState,
    lastError: lastError,
    lastErrorCode: lastErrorCode,
    conflictCopy: conflictCopy,
    offline: offline,
    updatedAt: updatedAt,
  );
}

/// Client-side checks (the server re-checks everything). Keys: `stage`, `pctAfter`, `work`, `issues`,
/// `photos`, `reason`. Values are Indonesian messages.
Map<String, String> validateProgress(ProgressDraft d, {ProjectStageSet? stages, DateTime? now}) {
  final e = <String, String>{};
  if (stages != null && !stages.fromCache && !stages.complete && !d.isEdit) {
    e['stage'] = 'Bobot tahapan project belum 100% (sekarang ${fmtPct(stages.weightSum)}). Laporan belum bisa dibuat.';
  }
  if (d.pctAfter.isNaN || d.pctAfter < 0 || d.pctAfter > 100) {
    e['pctAfter'] = 'Progress harus 0–100%.';
  } else if (d.pctBefore != null && d.pctAfter + 1e-9 < d.pctBefore!) {
    e['pctAfter'] = 'Progress tidak boleh turun (sebelumnya ${fmtPct(d.pctBefore!)}).';
  }
  final work = d.work.trim();
  if (work.length < 3) e['work'] = 'Pekerjaan wajib diisi (min. 3 karakter).';
  if (work.length > 2000) e['work'] = 'Pekerjaan maks. 2000 karakter.';
  if ((d.issues ?? '').length > 2000) e['issues'] = 'Kendala maks. 2000 karakter.';
  if (d.photoTotal > maxProgressPhotos) e['photos'] = 'Maksimal $maxProgressPhotos foto per laporan.';
  if (d.isEdit) {
    final r = (d.reason ?? '').trim();
    if (r.length < 3) e['reason'] = 'Alasan edit wajib diisi (min. 3 karakter).';
    if (r.length > 1000) e['reason'] = 'Alasan maks. 1000 karakter.';
    final until = DateTime.tryParse(d.editableUntil ?? '');
    if (until != null && !until.isAfter(now ?? DateTime.now())) {
      e['reason'] = 'Laporan hanya dapat diedit 24 jam setelah dibuat.';
    }
  }
  return e;
}

/// `SyncProgressReportPayload` with the local photo ids in [progressPhotosPlaceholderKey]; the sync
/// engine uploads them (`POST /media/progress-photos`) and fills `photo_media_ids` just before sending.
/// A new report carries project/stage/pct/work; an edit carries only what changed plus the reason.
Json progressPayload(ProgressDraft d) {
  String? issues() => (d.issues ?? '').trim().isEmpty ? null : d.issues!.trim();
  if (!d.isEdit) {
    return {
      'report_client_uuid': d.clientUuid,
      'project_id': d.projectId,
      'stage_id': d.stageId,
      'pct_after': roundPct(d.pctAfter),
      'work': d.work.trim(),
      'issues': issues(),
      progressPhotosPlaceholderKey: d.photoUuids,
    };
  }
  return {
    'report_id': d.serverId,
    if (d.serverPctAfter == null || roundPct(d.serverPctAfter!) != roundPct(d.pctAfter))
      'pct_after': roundPct(d.pctAfter),
    'work': d.work.trim(),
    'issues': issues(),
    'reason': (d.reason ?? '').trim(),
    progressPhotosPlaceholderKey: d.photoUuids,
  };
}

/// Online REST bodies (used when `features.syncProgressReports` is off): `ProgressReportCreate` /
/// `ProgressReportUpdate` (camelCase).
Json progressCreateBody(ProgressDraft d, List<int> photoIds) => {
  'projectId': d.projectId,
  'stageId': d.stageId,
  'pctAfter': roundPct(d.pctAfter),
  'work': d.work.trim(),
  'issues': (d.issues ?? '').trim().isEmpty ? null : d.issues!.trim(),
  'photoIds': photoIds,
  'clientUuid': d.clientUuid,
};

Json progressUpdateBody(ProgressDraft d, List<int> photoIds) => {
  if (d.serverPctAfter == null || roundPct(d.serverPctAfter!) != roundPct(d.pctAfter)) 'pctAfter': roundPct(d.pctAfter),
  'work': d.work.trim(),
  'issues': (d.issues ?? '').trim().isEmpty ? null : d.issues!.trim(),
  if (photoIds.isNotEmpty) 'addPhotoIds': photoIds,
  'reason': (d.reason ?? '').trim(),
};

/// Server keeps 2 decimals.
double roundPct(double v) => (v * 100).roundToDouble() / 100;

/// `45.5` → `45,5%`, `50` → `50%`.
String fmtPct(double v) {
  final r = roundPct(v);
  final s = r == r.roundToDouble()
      ? r.toStringAsFixed(0)
      : r.toStringAsFixed(r * 10 == (r * 10).roundToDouble() ? 1 : 2);
  return '${s.replaceAll('.', ',')}%';
}
