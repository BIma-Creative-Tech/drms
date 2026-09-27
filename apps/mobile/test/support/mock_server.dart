import 'dart:async';
import 'dart:convert';
import 'dart:io';

typedef Handler = FutureOr<(int, Object?)> Function(HttpRequest req, String body);

/// Tiny local HTTP server (loopback, random port) for API-client / sync / token tests.
class MockServer {
  MockServer._(this._server);
  final HttpServer _server;
  final Map<String, Handler> routes = {};
  final List<(String method, String path, Map<String, String> headers, String body)> calls = [];

  static Future<MockServer> start() async {
    final s = MockServer._(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));
    s._server.listen(s._handle);
    return s;
  }

  String get base => 'http://127.0.0.1:${_server.port}';

  void on(String method, String path, Handler h) => routes['$method $path'] = h;

  Future<void> _handle(HttpRequest req) async {
    final bytes = await req.fold<List<int>>(<int>[], (a, b) => a..addAll(b));
    final body = utf8.decode(bytes, allowMalformed: true);
    final headers = <String, String>{};
    req.headers.forEach((k, v) => headers[k.toLowerCase()] = v.join(','));
    calls.add((req.method, req.uri.path, headers, body));
    Handler? h = routes['${req.method} ${req.uri.path}'];
    if (h == null) {
      for (final e in routes.entries) {
        final parts = e.key.split(' ');
        if (parts[0] == req.method && parts[1].endsWith('*') && req.uri.path.startsWith(parts[1].replaceAll('*', ''))) {
          h = e.value;
        }
      }
    }
    final (status, payload) = h == null
        ? (404, {'type': 'about:blank', 'title': 'Not Found', 'status': 404})
        : await h(req, body);
    req.response.statusCode = status;
    if (payload != null) {
      req.response.headers.contentType = status >= 400 ? ContentType('application', 'problem+json') : ContentType.json;
      req.response.write(jsonEncode(payload));
    }
    await req.response.close();
  }

  Iterable<String> pathsCalled() => calls.map((c) => '${c.$1} ${c.$2}');

  Future<void> close() => _server.close(force: true);
}
