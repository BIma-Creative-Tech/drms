import 'dart:convert';

import '../../../core/db/app_database.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/master_item.dart';

/// Masters for the pickers, cached in the encrypted DB so drafts can be created offline.
class MastersRepository {
  MastersRepository(this.client, this.db);
  final ApiClient client;
  final AppDatabase db;

  static String _key(String sub) => 'masters:$sub';

  /// Refreshes from the server (full pull; volumes are small, Q-34). Returns false when offline.
  Future<bool> refresh(String sub) async {
    try {
      final data = await client.run(
        (d) => d.get<dynamic>('/masters', queryParameters: {'types': MasterTypes.forApp.join(',')}),
        (data) => data as Map<String, dynamic>,
      );
      await db.kvPut(_key(sub), jsonEncode(data['types'] ?? const {}));
      return true;
    } on NetworkException {
      return false;
    }
  }

  Future<Map<String, List<MasterItem>>> cached(String sub) async {
    final types = await db.kvGetJson(_key(sub)) ?? const {};
    List<Map<String, dynamic>> rows(String t) {
      final v = types[t];
      final items = v is Map<String, dynamic> ? v['items'] : null;
      return items is List ? items.whereType<Map<String, dynamic>>().toList() : const [];
    }

    final bankNames = {for (final b in rows(MasterTypes.banks)) (b['id'] as num).toInt(): '${b['name'] ?? ''}'};
    return {
      for (final t in MasterTypes.forApp)
        t: [for (final r in rows(t)) masterFromJson(t, r, bankNames: bankNames)].where((m) => m.active).toList(),
    };
  }
}
