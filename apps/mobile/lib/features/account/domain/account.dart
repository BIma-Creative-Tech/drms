/// Own account (`GET /api/v1/me/account`) — the web "Profil & tanda tangan" (user 2026-10-19). Name, email and phone
/// are Admin-managed; only the profile signature is self-service (F2c).
class MeAccount {
  const MeAccount({
    required this.id,
    required this.email,
    required this.name,
    required this.phone,
    required this.displayName,
    required this.signatureId,
  });

  factory MeAccount.fromJson(Map<String, dynamic> j) => MeAccount(
    id: (j['id'] as num).toInt(),
    email: j['email'] as String? ?? '',
    name: j['name'] as String?,
    phone: j['phone'] as String?,
    displayName: j['displayName'] as String? ?? '',
    signatureId: ((j['signature'] as Map<String, dynamic>?)?['id'] as num?)?.toInt(),
  );

  final int id;
  final String email;
  final String? name;
  final String? phone;
  final String displayName;

  /// `media-signatures` id of the profile signature; null = none (decisions then need a drawn signature).
  final int? signatureId;
}

enum TwoFactorState { active, inactive, unknown }

class Authenticator {
  const Authenticator({required this.id, required this.label, required this.createdAt});
  final String id;
  final String? label;

  /// ISO 8601 (server).
  final String? createdAt;
}

/// Own 2FA status (`GET /api/v1/me/security`, ADR 0017). Changing it runs on the web page [manageUrl].
class MeSecurity {
  const MeSecurity({required this.state, required this.authenticators, required this.manageUrl});

  factory MeSecurity.fromJson(Map<String, dynamic> j) {
    final tf = j['twoFactor'] as Map<String, dynamic>? ?? const {};
    return MeSecurity(
      state: switch (tf['state']) {
        'active' => TwoFactorState.active,
        'inactive' => TwoFactorState.inactive,
        _ => TwoFactorState.unknown,
      },
      authenticators: [
        for (final a in (tf['authenticators'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
          Authenticator(id: a['id'] as String, label: a['label'] as String?, createdAt: a['createdAt'] as String?),
      ],
      manageUrl: j['manageUrl'] as String? ?? '',
    );
  }

  final TwoFactorState state;
  final List<Authenticator> authenticators;
  final String manageUrl;
}
