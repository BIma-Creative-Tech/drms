import '../../../core/network/api_exception.dart';
import '../../auth/domain/user_profile.dart';
import '../../masters/domain/master_item.dart';

/// ADR 0028 "Pembayaran antar-PT" (payee "PT grup") on the APK: the payee directory, who may file, and the Indonesian
/// texts of the server's intercompany refusals.

/// One entry of the payee directory: another PT of the group with a designated receiving account
/// (`GET /intercompany/payees?company=` item, or the masters type `intercompany-payees` cached for offline use).
/// The account number is always masked here — the full number is only in the request's submit snapshot.
class IntercompanyPayee {
  const IntercompanyPayee({
    required this.companyId,
    required this.shortCode,
    required this.name,
    this.bankName,
    this.accountNoMasked = '',
    this.accountHolder = '',
  });

  /// The RECEIVING PT (`companies` id) = `payeeCompanyId` of the draft.
  final int companyId;
  final String shortCode;
  final String name;
  final String? bankName;
  final String accountNoMasked;
  final String accountHolder;

  /// Picker label: "LAS — PT Contoh Lestari".
  String get label => [shortCode, name].where((e) => e.isNotEmpty).join(' — ');

  /// Account preview: bank · holder.
  String get accountTitle => [?bankName, accountHolder].where((e) => e.isNotEmpty).join(' · ');

  static String? _s(Object? v) => v == null || '$v'.trim().isEmpty ? null : '$v';

  /// `GET /intercompany/payees` item (openapi `IntercompanyPayee`); null when it has no PT id.
  static IntercompanyPayee? fromApiJson(Map<String, dynamic> j) {
    final id = j['companyId'];
    if (id is! num) return null;
    return IntercompanyPayee(
      companyId: id.toInt(),
      shortCode: _s(j['shortCode']) ?? '#$id',
      name: _s(j['name']) ?? '',
      bankName: _s(j['bankName']),
      accountNoMasked: _s(j['accountNoMasked']) ?? '',
      accountHolder: _s(j['accountHolder']) ?? '',
    );
  }

  /// Masters `intercompany-payees` row (offline cache): `id` = `payeeCompanyId` = the receiving PT; `company` is the
  /// PAYING PT (the cache is per paying PT, so the id is unique there).
  static IntercompanyPayee fromMaster(MasterItem m) {
    final x = m.extra;
    final id = x['payeeCompanyId'];
    return IntercompanyPayee(
      companyId: id is num ? id.toInt() : m.id,
      shortCode: _s(x['shortCode']) ?? '#${m.id}',
      name: _s(x['name']) ?? '',
      bankName: _s(x['bankName']),
      accountNoMasked: _s(x['accountNoMasked']) ?? '',
      accountHolder: _s(x['accountHolder']) ?? '',
    );
  }

  @override
  bool operator ==(Object other) =>
      other is IntercompanyPayee &&
      other.companyId == companyId &&
      other.shortCode == shortCode &&
      other.name == name &&
      other.bankName == bankName &&
      other.accountNoMasked == accountNoMasked &&
      other.accountHolder == accountHolder;

  @override
  int get hashCode => Object.hash(companyId, shortCode, name, bankName, accountNoMasked, accountHolder);
}

/// The directory a draft of PT [payingCompanyId] may pick from: never the paying PT itself (the server refuses it).
List<IntercompanyPayee> payeesFor(List<IntercompanyPayee> all, int? payingCompanyId) => [
  for (final p in all)
    if (p.companyId != payingCompanyId) p,
];

/// ADR 0028 owner decision 1 (2026-10-14): Finance, PM or Direktur (`pk-owner`) of the paying PT file a PT grup
/// payment; Staff, Admin and an Owner (`pk-principal`) without one of these roles do not. The server decides on the
/// STORED roles, but `/me` lists EFFECTIVE roles (an Owner also carries `pk-owner`), so for an Owner the APK asks the
/// payee directory: the server lists it (masters `intercompany-payees`) only to a stored Finance / PM / Direktur
/// ([directoryListed]). The server re-checks every write (403).
bool mayFileIntercompanyPayment(Set<Role> roles, {required bool directoryListed}) {
  if (roles.contains(Role.finance) || roles.contains(Role.pm)) return true;
  if (!roles.contains(Role.owner)) return false;
  return !roles.contains(Role.principal) || directoryListed;
}

/// Machine codes of the server's intercompany refusals (openapi: drafts 400, transfer 409).
const intercompanyNoAccountCode = 'INTERCOMPANY_NO_ACCOUNT';
const intercompanyPeriodClosedCode = 'INTERCOMPANY_PERIOD_CLOSED';
const intercompanyAccountChangedCode = 'INTERCOMPANY_ACCOUNT_CHANGED';

/// Filer-role refusal (403) of a PT grup payment — the server's sentence.
const intercompanyFilerMessage = 'Pembayaran antar-PT hanya dapat diajukan oleh Finance, PM atau Direktur di PT ini.';

/// Indonesian message of an intercompany refusal, null for any other problem (then [ProblemException.message]).
/// The server's own sentence names the PT and the dates, so it wins when it is a real sentence; the local texts are
/// the fallback (a server or proxy that sends only the code).
String? intercompanyProblemMessage(ProblemException e) {
  String? sentence(Object? v) {
    final s = v is String ? v.trim() : '';
    return s.length > 10 && s.endsWith('.') && !s.startsWith('Data pengajuan tidak valid') ? s : null;
  }

  String? fieldMessage(String path) => e.errors
      .where((f) => f.path == path || f.path.endsWith('.$path'))
      .map((f) => sentence(f.message))
      .nonNulls
      .firstOrNull;
  final server = sentence(e.detail) ?? sentence(e.title);
  final lockDate = e.body['lockDate'] is String ? e.body['lockDate'] as String : null;
  switch (e.code) {
    case intercompanyNoAccountCode:
      return fieldMessage('payeeCompanyId') ??
          server ??
          'PT penerima belum menetapkan rekening penerimaan antar-PT. Pilih PT lain, atau minta Finance / Admin PT itu '
              'menandai rekening penerimaannya.';
    case intercompanyPeriodClosedCode:
      return server ??
          'Periode PT penerima sudah ditutup${lockDate == null ? '' : ' (tutup buku s/d $lockDate)'}. Transfer antar-PT '
              'tidak dapat dicatat pada tanggal ini — minta Direktur PT penerima membuka kembali periode itu, atau catat '
              'transfer dengan tanggal di periode terbuka.';
    case intercompanyAccountChangedCode:
      return server ?? 'Rekening penerimaan PT penerima berubah sejak pengajuan. Tarik dan ajukan ulang pengajuan ini.';
  }
  // Duplicate document of the same receiving PT (409 with a field error on invoiceNo).
  if (e.status == 409) {
    final dup = fieldMessage('invoiceNo');
    if (dup != null) return dup;
  }
  if (e.status == 403 && (server?.startsWith('Pembayaran antar-PT') ?? false)) return server;
  return null;
}

/// [error] as text: an intercompany refusal in its own words, else the usual API message.
String intercompanyAwareError(Object error, String Function(Object) fallback) =>
    (error is ProblemException ? intercompanyProblemMessage(error) : null) ?? fallback(error);
