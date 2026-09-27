import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/device/device_integrity.dart';

/// Separate file: the widgets binding (method channels) disables real HTTP for the whole suite.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('id.co.drms.proyekkas/integrity');
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('no Android channel (tests, other platforms) → nothing reported', () async {
    expect(await AndroidIntegrityProbe().check(), isNull);
    expect(await const FixedIntegrityProbe(null).check(), isNull);
  });

  test('reads the Kotlin map (MainActivity "check")', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      expect(call.method, 'check');
      return {'rooted': true, 'emulator': false, 'developerMode': true, 'adbEnabled': false};
    });
    final r = await AndroidIntegrityProbe().check();
    expect(r?.rooted, isTrue);
    expect(r?.developerMode, isTrue);
    expect(r?.mockLocation, isNull);
    expect(r?.risky, isTrue);
  });
}
