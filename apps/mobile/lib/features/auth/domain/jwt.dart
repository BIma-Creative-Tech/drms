import 'dart:convert';

/// Reads JWT claims WITHOUT verifying the signature. Only used to key the local queue by `sub`
/// and to know the access-token expiry; the server verifies every token (ADR 0003 §4).
Map<String, dynamic>? decodeJwtClaims(String? token) {
  if (token == null) return null;
  final parts = token.split('.');
  if (parts.length != 3) return null;
  try {
    final normalized = base64Url.normalize(parts[1]);
    final decoded = jsonDecode(utf8.decode(base64Url.decode(normalized)));
    return decoded is Map<String, dynamic> ? decoded : null;
  } on FormatException {
    return null;
  }
}

String? subjectOf(String? token) => decodeJwtClaims(token)?['sub'] as String?;

DateTime? expiryOf(String? token) {
  final exp = decodeJwtClaims(token)?['exp'];
  return exp is num ? DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000, isUtc: true) : null;
}
