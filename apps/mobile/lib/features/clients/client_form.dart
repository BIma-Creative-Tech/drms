import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/network/api_client.dart';

// DRMS 16/10 "Klien" page on the APK (user 2026-10-19, phase 5a): `GET|POST /client-form`, `GET|PATCH
// /client-form/{id}` — one save of the client detail and its Kontak PIC (the web's tabbed page).

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
String? _s(Object? v) => v is String && v.isNotEmpty ? v : null;

class ClientContact {
  ClientContact({this.id, this.name = '', this.position, this.phone, this.email, this.notes, this.isPrimary = false});
  final String? id;
  String name;
  String? position;
  String? phone;
  String? email;
  String? notes;
  bool isPrimary;

  factory ClientContact.fromJson(Map<String, dynamic> j) => ClientContact(
    id: _s(j['id']),
    name: '${j['name'] ?? ''}',
    position: _s(j['position']),
    phone: _s(j['phone']),
    email: _s(j['email']),
    notes: _s(j['notes']),
    isPrimary: j['isPrimary'] == true,
  );

  Map<String, Object?> toJson() => {
    'id': ?id,
    'name': name.trim(),
    'position': position?.trim(),
    'phone': phone?.trim(),
    'email': email?.trim(),
    'notes': notes?.trim(),
    'isPrimary': isPrimary,
  };
}

class ClientFormData {
  const ClientFormData({
    this.id,
    this.name = '',
    this.address,
    this.active = true,
    this.contacts = const [],
    this.companies = const [],
    this.canEdit = false,
    this.projects = const [],
  });
  final int? id;
  final String name;
  final String? address;
  final bool active;
  final List<ClientContact> contacts;

  /// Create: the PTs the caller may create in; edit: the client's PT. (id, "CODE — Name")
  final List<(int, String)> companies;
  final bool canEdit;
  final List<String> projects;

  factory ClientFormData.fromJson(Map<String, dynamic> j) {
    final c = j['client'] is Map<String, dynamic> ? j['client'] as Map<String, dynamic> : null;
    return ClientFormData(
      id: (c?['id'] as num?)?.toInt(),
      name: '${c?['name'] ?? ''}',
      address: _s(c?['address']),
      active: c?['active'] != false,
      contacts: [for (final x in _list(c?['contacts'])) ClientContact.fromJson(_map(x))],
      companies: [
        for (final x in _list(j['companies']))
          ((_map(x)['id'] as num).toInt(), '${_map(x)['shortCode'] ?? ''} — ${_map(x)['name'] ?? ''}'),
      ],
      canEdit: j['canEdit'] == true,
      projects: [
        for (final p in _list(j['projects'])) [_map(p)['code'], _map(p)['name']].whereType<String>().join(' '),
      ],
    );
  }
}

class ClientFormApi {
  ClientFormApi(this.client);
  final ApiClient client;

  Future<ClientFormData> load(int? id) => client.run(
    (d) => d.get<dynamic>(
      id == null ? '/client-form' : '/client-form/$id',
      options: id == null ? null : ApiClient.allCompanies(),
    ),
    (data) => ClientFormData.fromJson(data as Map<String, dynamic>),
  );

  /// POST (new) / PATCH (edit) → the client id.
  Future<int> save(int? id, Map<String, Object?> body, {required String idempotencyKey}) => client.run((d) {
    final o = ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey}));
    return id == null
        ? d.post<dynamic>('/client-form', data: body, options: o)
        : d.patch<dynamic>('/client-form/$id', data: body, options: o);
  }, (data) => ((data as Map<String, dynamic>)['id'] as num).toInt());
}

final clientFormApiProvider = Provider((ref) => ClientFormApi(ref.watch(apiClientProvider)));

final clientFormProvider = FutureProvider.autoDispose.family<ClientFormData, int?>(
  (ref, id) => ref.watch(clientFormApiProvider).load(id),
);
