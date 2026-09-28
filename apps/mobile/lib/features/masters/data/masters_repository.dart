import 'dart:convert';

import 'package:dio/dio.dart';

import '../../../core/db/app_database.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/master_item.dart';

/// Masters for the pickers, cached in the encrypted DB so drafts can be created offline.
///
/// MC3 (ADR 0016 §8): one cache per user AND PT — `masters:<sub>:<pt>` = `{etag, version, types}` from
/// `GET /masters` with `X-Company-Ids: <pt>`; the weak `ETag` is sent back as `If-None-Match` and a 304
/// keeps the cache. Shared masters (`shared: true`) come with every PT and are de-duplicated on read.
/// Without known PTs (server before MC3) the single cache `masters:<sub>` of 0.2.x is used.
class MastersRepository {
  MastersRepository(this.client, this.db);
  final ApiClient client;
  final AppDatabase db;

  static String legacyKey(String sub) => 'masters:$sub';
  static String companyKey(String sub, int companyId) => 'masters:$sub:$companyId';
  static String _indexKey(String sub) => 'masters-index:$sub';

  /// Refreshes from the server (full pull per PT; volumes are small, Q-34). [companyIds] = the account's
  /// memberships (all of them, not only the selected PTs: drafts of every PT must work offline); null or
  /// empty = legacy single request. Returns false when offline.
  Future<bool> refresh(String sub, {List<int>? companyIds}) async {
    try {
      if (companyIds == null || companyIds.isEmpty) {
        final data = await client.run(
          (d) => d.get<dynamic>('/masters', queryParameters: {'types': MasterTypes.forApp.join(',')}),
          (data) => data as Map<String, dynamic>,
        );
        await db.kvPut(legacyKey(sub), jsonEncode(data['types'] ?? const {}));
        return true;
      }
      for (final pt in companyIds) {
        await _refreshCompany(sub, pt);
      }
      await db.kvPut(_indexKey(sub), jsonEncode(companyIds));
      return true;
    } on NetworkException {
      return false;
    }
  }

  Future<void> _refreshCompany(String sub, int pt) async {
    final key = companyKey(sub, pt);
    final cached = await db.kvGetJson(key);
    final etag = cached?['etag'] as String?;
    Response<dynamic>? res;
    await client.run((d) async {
      final r = await d.get<dynamic>(
        '/masters',
        queryParameters: {'types': MasterTypes.forApp.join(',')},
        options: ApiClient.forCompany(
          pt,
          Options(
            headers: {'If-None-Match': ?etag},
            validateStatus: (s) => s != null && ((s >= 200 && s < 300) || s == 304),
          ),
        ),
      );
      res = r;
      return r;
    }, (_) {});
    final r = res;
    if (r == null || r.statusCode == 304) return; // unchanged: keep the cache
    final data = r.data;
    if (data is! Map<String, dynamic>) return;
    final version = [
      for (final c in (data['companies'] as List<dynamic>? ?? const []))
        if (c is Map<String, dynamic> && (c['id'] as num?)?.toInt() == pt) c['version'],
    ].firstOrNull;
    await db.kvPut(
      key,
      jsonEncode({
        'etag': r.headers.value('etag'),
        'version': version,
        'sharedVersion': data['sharedVersion'],
        'types': data['types'] ?? const {},
      }),
    );
  }

  /// Stored ETag of PT [companyId] (tests / diagnostics).
  Future<String?> etagOf(String sub, int companyId) async =>
      (await db.kvGetJson(companyKey(sub, companyId)))?['etag'] as String?;

  /// Cached masters of [sub]: of PT [companyId] only (pickers of a draft / report of that PT), of the PTs
  /// [companyIds] (lists of the PT switcher scope), or of every cached PT when both are null. Rows of a
  /// PT-scoped read whose `company` names another PT are dropped (defence in depth).
  Future<Map<String, List<MasterItem>>> cached(String sub, {int? companyId, Iterable<int>? companyIds}) async {
    final wanted = companyId != null ? {companyId} : companyIds?.toSet();
    final index = await db.kvGet(_indexKey(sub));
    final cachedPts = index == null
        ? const <int>[]
        : (jsonDecode(index) as List<dynamic>).whereType<num>().map((e) => e.toInt());
    final pts = [
      for (final p in cachedPts)
        if (wanted == null || wanted.contains(p)) p,
    ];
    final sources = <Map<String, dynamic>>[];
    if (cachedPts.isEmpty) {
      final legacy = await db.kvGetJson(legacyKey(sub));
      if (legacy != null) sources.add(legacy);
    } else {
      for (final p in pts) {
        final v = await db.kvGetJson(companyKey(sub, p));
        final types = v?['types'];
        if (types is Map<String, dynamic>) sources.add(types);
      }
    }

    List<Map<String, dynamic>> rows(String t) {
      final seen = <int>{};
      return [
        for (final types in sources)
          if (types[t] case {'items': final List<dynamic> items})
            for (final r in items.whereType<Map<String, dynamic>>())
              if (seen.add((r['id'] as num?)?.toInt() ?? -1) &&
                  (wanted == null || r['company'] == null || wanted.contains((r['company'] as num).toInt())))
                r,
      ];
    }

    final bankNames = {for (final b in rows(MasterTypes.banks)) (b['id'] as num).toInt(): '${b['name'] ?? ''}'};
    return {
      for (final t in MasterTypes.forApp)
        t: [for (final r in rows(t)) masterFromJson(t, r, bankNames: bankNames)].where((m) => m.active).toList(),
    };
  }
}
