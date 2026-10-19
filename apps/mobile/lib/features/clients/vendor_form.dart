import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../core/network/api_client.dart';
import 'client_form.dart';

// DRMS 16/10 "Vendor" page on the APK (user 2026-10-19, phase 7): `GET|POST /vendor-form`, `GET|PATCH
// /vendor-form/{id}` — vendor detail (incl. NPWP), Kontak PIC and bank accounts in one save.

Map<String, dynamic> _map(Object? v) => v is Map<String, dynamic> ? v : const {};
List<dynamic> _list(Object? v) => v is List ? v : const [];
String? _s(Object? v) => v is String && v.isNotEmpty ? v : null;

class VendorBank {
  VendorBank({
    this.id,
    this.bank,
    this.bankName,
    this.accountNo = '',
    this.accountHolder = '',
    this.isDefault = false,
    this.verified = false,
    this.active = true,
  });
  final int? id;
  int? bank;
  String? bankName;
  String accountNo;
  String accountHolder;
  bool isDefault;
  bool verified;
  bool active;
  bool dirty = false;

  factory VendorBank.fromJson(Map<String, dynamic> j) => VendorBank(
    id: (j['id'] as num?)?.toInt(),
    bank: (j['bank'] as num?)?.toInt(),
    bankName: _s(j['bankName']),
    accountNo: '${j['accountNo'] ?? ''}',
    accountHolder: '${j['accountHolder'] ?? ''}',
    isDefault: j['isDefault'] == true,
    verified: j['verificationStatus'] == 'verified',
    active: j['active'] != false,
  );
}

class VendorFormData {
  VendorFormData(Map<String, dynamic> j)
    : vendor = j['vendor'] is Map<String, dynamic> ? j['vendor'] as Map<String, dynamic> : null,
      companies = [
        for (final c in _list(j['companies']))
          (
            id: (_map(c)['id'] as num).toInt(),
            label: '${_map(c)['shortCode'] ?? ''} — ${_map(c)['name'] ?? ''}',
            canManageBankAccounts: _map(c)['canManageBankAccounts'] == true,
          ),
      ],
      canEdit = j['canEdit'] == true,
      bankAccounts = [for (final b in _list(j['bankAccounts'])) VendorBank.fromJson(_map(b))];
  final Map<String, dynamic>? vendor;
  final List<({int id, String label, bool canManageBankAccounts})> companies;
  final bool canEdit;
  final List<VendorBank> bankAccounts;

  int? get id => (vendor?['id'] as num?)?.toInt();
  String get name => '${vendor?['name'] ?? ''}';
  String? get address => _s(vendor?['address']);
  String? get npwp => _s(vendor?['npwp']);
  bool get active => vendor?['active'] != false;
  List<ClientContact> get contacts => [for (final c in _list(vendor?['contacts'])) ClientContact.fromJson(_map(c))];
}

class VendorFormApi {
  VendorFormApi(this.client);
  final ApiClient client;

  Future<VendorFormData> load(int? id) => client.run(
    (d) => d.get<dynamic>(
      id == null ? '/vendor-form' : '/vendor-form/$id',
      options: id == null ? null : ApiClient.allCompanies(),
    ),
    (data) => VendorFormData(data as Map<String, dynamic>),
  );

  Future<int> save(int? id, Map<String, Object?> body, {required String idempotencyKey}) => client.run((d) {
    final o = ApiClient.allCompanies(Options(headers: {'Idempotency-Key': idempotencyKey}));
    return id == null
        ? d.post<dynamic>('/vendor-form', data: body, options: o)
        : d.patch<dynamic>('/vendor-form/$id', data: body, options: o);
  }, (data) => ((data as Map<String, dynamic>)['id'] as num).toInt());
}

final vendorFormApiProvider = Provider((ref) => VendorFormApi(ref.watch(apiClientProvider)));
final vendorFormProvider = FutureProvider.autoDispose.family<VendorFormData, int?>(
  (ref, id) => ref.watch(vendorFormApiProvider).load(id),
);
