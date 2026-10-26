import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/network/api_exception.dart';
import 'package:proyekkas/core/network/provider_retry.dart';

/// DRMS 26/10 #3: Riverpod 3 retried every failed provider (10×, 0.2 … 6.4 s) while the screen showed "loading" — a
/// 409 "Akun Anda belum terhubung ke data karyawan" appeared only after ~30 s. A final API answer is not retried any
/// more; network failures / 5xx still are (an offline read recovers on its own). The offline sync queue has its own
/// backoff (sync_engine.dart) and never relied on provider retries.
const _noEmployee = ProblemException(
  status: 409,
  title: 'Conflict',
  detail: 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.',
);

void main() {
  group('isRetryableError / providerRetry', () {
    test('final API answers are not retried', () {
      for (final status in [400, 403, 404, 409, 410, 422]) {
        final e = ProblemException(status: status);
        expect(isRetryableError(e), isFalse, reason: '$status');
        expect(providerRetry(0, e), isNull, reason: '$status');
      }
      for (final e in const <ApiException>[
        UnauthorizedException(),
        DeviceRevokedException(),
        UpgradeRequiredException('1.0.0'),
      ]) {
        expect(providerRetry(0, e), isNull, reason: '$e');
      }
    });

    test('network failures, 5xx, 408 and 429 keep the Riverpod backoff (10 attempts, 0.2 … 6.4 s)', () {
      for (final e in const <Object>[
        NetworkException(),
        ProblemException(status: 500),
        ProblemException(status: 503),
        ProblemException(status: 408),
        ProblemException(status: 429),
      ]) {
        expect(providerRetry(0, e), const Duration(milliseconds: 200), reason: '$e');
        expect(providerRetry(3, e), const Duration(milliseconds: 1600), reason: '$e');
        expect(providerRetry(9, e), const Duration(milliseconds: 6400), reason: '$e');
        expect(providerRetry(10, e), isNull, reason: '$e');
      }
    });

    test('non-API failures keep the Riverpod default (exceptions retried, errors not)', () {
      expect(providerRetry(0, const FormatException('x')), const Duration(milliseconds: 200));
      expect(providerRetry(0, StateError('bug')), isNull);
    });
  });

  group('ProviderContainer(retry: providerRetry)', () {
    test('409: the error is final at once (one call, no loading state)', () async {
      var calls = 0;
      final p = FutureProvider<int>((ref) async {
        calls++;
        throw _noEmployee;
      });
      final c = ProviderContainer(retry: providerRetry);
      addTearDown(c.dispose);
      final sub = c.listen(p, (_, _) {});
      addTearDown(sub.close);
      await expectLater(c.read(p.future), throwsA(same(_noEmployee)));
      await Future<void>.delayed(const Duration(milliseconds: 600));
      final v = c.read(p);
      expect(v, isA<AsyncError<int>>());
      expect(v.isLoading, isFalse);
      expect(v.retrying, isFalse);
      expect((v.error! as ApiException).message, 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin.');
      expect(calls, 1);
    });

    test('offline: retried until it works (the read recovers without a tap)', () async {
      var calls = 0;
      final p = FutureProvider<int>((ref) async {
        calls++;
        if (calls < 3) throw const NetworkException();
        return 42;
      });
      final c = ProviderContainer(retry: providerRetry);
      addTearDown(c.dispose);
      final sub = c.listen(p, (_, _) {});
      addTearDown(sub.close);
      await Future<void>.delayed(const Duration(milliseconds: 900)); // 200 ms + 400 ms backoff
      expect(c.read(p).value, 42);
      expect(calls, 3);
    });
  });
}
