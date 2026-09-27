import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

/// One recorded request: method, full URL, headers and the decoded form body.
typedef FakeCall = ({String method, Uri uri, Map<String, dynamic> headers, Map<String, String> form});

/// Answer for a request: a JSON response `(status, body)`, or throw a [DioException] to simulate a
/// transport failure.
typedef FakeResponder = (int, Object?) Function(FakeCall call);

/// Mocked HTTP client for dio: no sockets, every request is answered by [respond].
class FakeDioAdapter implements HttpClientAdapter {
  FakeDioAdapter(this.respond);
  FakeResponder respond;
  final List<FakeCall> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final bytes = requestStream == null
        ? <int>[]
        : await requestStream.fold<List<int>>(<int>[], (a, b) => a..addAll(b));
    final raw = utf8.decode(bytes);
    final call = (
      method: options.method,
      uri: options.uri,
      headers: Map<String, dynamic>.of(options.headers),
      form: raw.isEmpty ? <String, String>{} : Uri.splitQueryString(raw),
    );
    calls.add(call);
    final (status, body) = respond(call);
    return ResponseBody.fromString(
      body == null ? '' : jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio fakeDio(FakeDioAdapter adapter) => Dio()..httpClientAdapter = adapter;
