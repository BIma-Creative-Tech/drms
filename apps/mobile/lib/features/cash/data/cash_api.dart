import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/cash_book.dart';

/// User 2026-10-19 (phase 3): the web "Buku kas", "Tutup buku" and "Transfer tercatat" on the APK. Online only; every
/// write carries an Idempotency-Key (one per distinct body), like the web forms.
class CashApi {
  CashApi(this.client);
  final ApiClient client;

  /// A write belongs to ONE document / PT: the role in that PT counts, not the PT switcher.
  Options _idem(String key) => ApiClient.allCompanies(Options(headers: {'Idempotency-Key': key}));

  /// `GET /kas/book` of the PT switcher selection (Finance / Direktur).
  Future<CashBook> book(CashFilter filter, {int page = 1}) => client.run(
    (d) => d.get<dynamic>('/kas/book', queryParameters: filter.query(page: page)),
    (data) => CashBook.fromJson(data as Map<String, dynamic>),
  );

  /// `POST /cash-entries` (Finance of `company`) → the new entry's number (KM/… or KK/…). A 409
  /// `CASH_OVERDRAFT_CONFIRM_REQUIRED` asks for `confirmOverdraft`.
  Future<String> create(Map<String, dynamic> body, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/cash-entries', data: body, options: _idem(idempotencyKey)),
    (data) => '${(data as Map<String, dynamic>)['entryNo'] ?? ''}',
  );

  /// `PATCH /cash-entries/{id}` (manual entries of an open period; `reason` required).
  Future<void> update(int id, Map<String, dynamic> body, {required String idempotencyKey}) =>
      client.run((d) => d.patch<dynamic>('/cash-entries/$id', data: body, options: _idem(idempotencyKey)), (_) {});

  /// `POST /cash-entries/{id}/void` → the reversal's number.
  Future<String?> voidEntry(int id, String reason, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>('/cash-entries/$id/void', data: {'reason': reason.trim()}, options: _idem(idempotencyKey)),
    (data) => (data as Map<String, dynamic>?)?['reversal']?['entryNo'] as String?,
  );

  /// Proof photo (compressed JPEG) → `media-attachments` id (`POST /media/attachments`).
  Future<int> uploadAttachment(Uint8List bytes, {required String filename}) => client.run(
    (d) => d.post<dynamic>(
      '/media/attachments',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: filename, contentType: DioMediaType.parse('image/jpeg')),
      }),
      options: ApiClient.allCompanies(),
    ),
    (data) => ((data as Map<String, dynamic>)['id'] as num).toInt(),
  );

  /// Bytes of an attachment (`GET /media/attachments/{id}/file`) — the "Bukti" of an entry.
  Future<Uint8List> attachment(int id) => client.run(
    (d) => d.get<List<int>>(
      '/media/attachments/$id/file',
      options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes)),
    ),
    (data) => Uint8List.fromList(data as List<int>),
  );

  /// `GET /kas/periods?company=` — one PT's closing overview (or the PT chooser).
  Future<PeriodOverview> periods(int? company) => client.run(
    (d) => d.get<dynamic>('/kas/periods', queryParameters: {'company': ?company}),
    (data) => PeriodOverview.fromJson(data as Map<String, dynamic>),
  );

  /// `POST /period-closings` {period, note?, company}.
  Future<void> close(String period, int company, {String? note, required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/period-closings',
      data: {'period': period, 'company': company, if (note != null && note.trim().isNotEmpty) 'note': note.trim()},
      options: _idem(idempotencyKey),
    ),
    (_) {},
  );

  /// `POST /period-closings/{period}/reopen?company=` {reason} (Direktur).
  Future<void> reopen(String period, int company, String reason, {required String idempotencyKey}) => client.run(
    (d) => d.post<dynamic>(
      '/period-closings/$period/reopen',
      queryParameters: {'company': company},
      data: {'reason': reason.trim()},
      options: _idem(idempotencyKey),
    ),
    (_) {},
  );

  /// `GET /transfers/voidable` of the PT switcher selection.
  Future<VoidablePage> voidableTransfers({String q = '', int page = 1, int per = 20}) => client.run(
    (d) => d.get<dynamic>(
      '/transfers/voidable',
      queryParameters: {if (q.trim().isNotEmpty) 'q': q.trim(), 'page': page, 'per': per},
    ),
    (data) => VoidablePage.fromJson(data as Map<String, dynamic>),
  );

  /// `POST /expense-requests/{id}/transfers/{tid}/void` {reason} (Finance of the request's PT).
  Future<void> voidTransfer(int requestId, int transferId, String reason, {required String idempotencyKey}) =>
      client.run(
        (d) => d.post<dynamic>(
          '/expense-requests/$requestId/transfers/$transferId/void',
          data: {'reason': reason.trim()},
          options: _idem(idempotencyKey),
        ),
        (_) {},
      );
}
