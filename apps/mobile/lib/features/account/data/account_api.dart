import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../domain/account.dart';

/// Own account endpoints (user 2026-10-19, APK ↔ web parity phase 2). Account data is app-wide, not per PT.
class AccountApi {
  AccountApi(this.client);
  final ApiClient client;

  Future<MeAccount> account() => client.run(
    (d) => d.get<dynamic>('/me/account', options: ApiClient.allCompanies()),
    (data) => MeAccount.fromJson(data as Map<String, dynamic>),
  );

  /// `PUT /me/signature`: [mediaId] = a `media-signatures` row this user uploaded; null removes the signature.
  Future<MeAccount> setSignature(int? mediaId) => client.run(
    (d) => d.put<dynamic>('/me/signature', data: {'signatureMediaId': mediaId}, options: ApiClient.allCompanies()),
    (data) => MeAccount.fromJson(data as Map<String, dynamic>),
  );

  /// PNG → `media-signatures` id (server: PNG only, resized to ≤ 800×300).
  Future<int> uploadSignature(Uint8List png) => client.run(
    (d) => d.post<dynamic>(
      '/media/signatures',
      data: FormData.fromMap({
        'file': MultipartFile.fromBytes(png, filename: 'signature.png', contentType: DioMediaType.parse('image/png')),
      }),
      options: ApiClient.allCompanies(),
    ),
    (data) => ((data as Map<String, dynamic>)['id'] as num).toInt(),
  );

  Future<Uint8List> signatureImage(int id) => client.run(
    (d) => d.get<dynamic>(
      '/media/signatures/$id/file',
      options: ApiClient.allCompanies(Options(responseType: ResponseType.bytes)),
    ),
    (data) => Uint8List.fromList(data as List<int>),
  );

  Future<MeSecurity> security() => client.run(
    (d) => d.get<dynamic>('/me/security', options: ApiClient.allCompanies()),
    (data) => MeSecurity.fromJson(data as Map<String, dynamic>),
  );
}
