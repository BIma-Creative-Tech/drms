import '../../../core/network/api_client.dart';
import '../domain/dashboard.dart';

/// `GET /api/v1/dashboard/{owner,finance,pm,admin,me}` (role-guarded server-side: owner = `pk-owner` = Direktur).
class DashboardApi {
  DashboardApi(this.client);
  final ApiClient client;

  Future<DirekturDashboard> direktur() => client.run(
    (d) => d.get<dynamic>('/dashboard/owner'),
    (data) => DirekturDashboard.fromJson(data as Map<String, dynamic>),
  );

  Future<FinanceDashboard> finance() => client.run(
    (d) => d.get<dynamic>('/dashboard/finance'),
    (data) => FinanceDashboard.fromJson(data as Map<String, dynamic>),
  );

  Future<PmDashboard> pm() =>
      client.run((d) => d.get<dynamic>('/dashboard/pm'), (data) => PmDashboard.fromJson(data as Map<String, dynamic>));

  /// Any role: own requests (Staff home).
  Future<StaffDashboard> me() => client.run(
    (d) => d.get<dynamic>('/dashboard/me'),
    (data) => StaffDashboard.fromJson(data as Map<String, dynamic>),
  );

  Future<AdminDashboard> admin() => client.run(
    (d) => d.get<dynamic>('/dashboard/admin'),
    (data) => AdminDashboard.fromJson(data as Map<String, dynamic>),
  );
}
