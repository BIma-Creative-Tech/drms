import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/report.dart';

/// `/api/v1/reports` (F3; phase 4 on the APK). Reports follow the PT switcher selection like the web page.
class ReportsApi {
  ReportsApi(this.client);
  final ApiClient client;

  Future<List<ReportSummary>> index() => client.run(
    (d) => d.get<dynamic>('/reports'),
    (data) => [
      for (final i in ((data as Map<String, dynamic>)['items'] as List? ?? const []))
        ReportSummary.fromJson(i as Map<String, dynamic>),
    ],
  );

  Future<ReportPage> page(ReportQuery q) => client.run(
    (d) => d.get<dynamic>('/reports/${q.code}', queryParameters: q.query),
    (data) => ReportPage.fromJson(data as Map<String, dynamic>),
  );

  /// `GET /reports/{code}/{format}` with the same filters (audited `export`, 10/min) → bytes + Content-Disposition.
  /// The problem body of a binary request arrives as bytes: 413 / 503 get the web's sentences here.
  Future<({Uint8List bytes, String? disposition})> export(ReportQuery q, String format) async {
    Response<dynamic>? res;
    try {
      final bytes = await client.run(
        (d) async => res = await d.get<dynamic>(
          '/reports/${q.code}/$format',
          queryParameters: ReportQuery(q.code, params: q.params).query,
          options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 2)),
        ),
        (data) => Uint8List.fromList(data as List<int>),
      );
      return (bytes: bytes, disposition: res?.headers.value('content-disposition'));
    } on ProblemException catch (e) {
      final detail = switch (e.status) {
        413 => 'Terlalu banyak baris untuk format ini. Persempit filter atau pakai CSV.',
        503 => 'Pembuat file sedang sibuk, coba lagi.',
        429 => 'Terlalu banyak unduhan. Coba lagi sebentar lagi.',
        _ => null,
      };
      if (detail == null || (e.detail ?? '').isNotEmpty) rethrow;
      throw ProblemException(status: e.status, detail: detail, code: e.code);
    }
  }
}
