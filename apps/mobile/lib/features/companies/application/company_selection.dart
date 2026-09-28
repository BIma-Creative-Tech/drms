import 'dart:convert';

import 'package:flutter/foundation.dart' show setEquals;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/logging/log.dart';
import '../../auth/domain/user_profile.dart';

/// PT switcher selection (MC3, ADR 0016 §8, wireframe §1b): null = "Semua PT" (no `X-Company-Ids`
/// header), otherwise a non-empty subset of the memberships. Persisted per Keycloak `sub` in the
/// encrypted DB (`company_selection:<sub>`), so every user of a shared phone keeps their own choice.
final companySelectionProvider = NotifierProvider<CompanySelection, Set<int>?>(CompanySelection.new);

/// `X-Company-Ids` value of the selection (ascending ids) or null = all PTs. The API client is rebuilt
/// when it changes, so every server list re-loads for the new PT set.
final companyHeaderProvider = Provider<String?>((ref) => companyHeaderValue(ref.watch(companySelectionProvider)));

String? companyHeaderValue(Set<int>? ids) => ids == null || ids.isEmpty ? null : (ids.toList()..sort()).join(',');

class CompanySelection extends Notifier<Set<int>?> {
  String? _sub;

  @override
  Set<int>? build() => null;

  static String storageKey(String sub) => 'company_selection:$sub';

  /// Keeps only memberships of [profile]; empty / every membership / no memberships known = null
  /// ("Semua PT" — the same rows, without a header that could go stale).
  static Set<int>? normalize(Iterable<int>? ids, UserProfile profile) {
    if (ids == null || profile.companies.isEmpty) return null;
    final member = {for (final c in profile.companies) c.id};
    final kept = ids.toSet().intersection(member);
    if (kept.isEmpty || kept.length == member.length) return null;
    return kept;
  }

  /// Sign-in / app start: the stored choice of [sub], narrowed to the memberships of [profile].
  Future<void> restore(String sub, UserProfile profile) async {
    _sub = sub;
    Set<int>? stored;
    try {
      final raw = await ref.read(databaseProvider).kvGetJson(storageKey(sub));
      final ids = raw?['ids'];
      if (ids is List) stored = {for (final e in ids.whereType<num>()) e.toInt()};
    } on Object catch (e) {
      Log.w('company: stored selection unreadable', e);
    }
    _set(normalize(stored, profile));
  }

  /// After a `/me` refresh: a PT that is no longer a membership leaves the selection.
  Future<void> reconcile(String sub, UserProfile profile) async {
    _sub = sub;
    final next = normalize(state, profile);
    if (!_same(next, state)) await _store(next);
    _set(next);
  }

  /// PT switcher "Terapkan": [ids] null = "Semua PT"; stored for [sub] (the signed-in user).
  Future<void> select(Set<int>? ids, UserProfile profile, {String? sub}) async {
    if (sub != null) _sub = sub;
    final next = normalize(ids, profile);
    _set(next);
    await _store(next);
  }

  /// 403 `COMPANY_NOT_ALLOWED`: back to "Semua PT" (the caller refreshes `/me`).
  Future<void> reset() async {
    if (state == null) return;
    _set(null);
    await _store(null);
  }

  /// Logout: nothing selected in memory (the stored choice of that user stays for the next login).
  void clear() {
    _sub = null;
    _set(null);
  }

  void _set(Set<int>? next) {
    if (!_same(next, state)) state = next;
  }

  static bool _same(Set<int>? a, Set<int>? b) =>
      (a == null && b == null) || (a != null && b != null && setEquals(a, b));

  Future<void> _store(Set<int>? ids) async {
    final sub = _sub;
    if (sub == null) return;
    try {
      await ref
          .read(databaseProvider)
          .kvPut(storageKey(sub), jsonEncode({'ids': ids == null ? null : (ids.toList()..sort())}));
    } on Object catch (e) {
      Log.w('company: selection not stored', e);
    }
  }
}
