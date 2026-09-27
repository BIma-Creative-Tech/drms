import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/core/db/app_database.dart';
import 'package:proyekkas/core/storage/secure_store.dart';
import 'package:sqlite3/sqlite3.dart';

void main() {
  test('SQLite3MultipleCiphers is linked (PRAGMA cipher) and the key encrypts the file', () async {
    final dir = await Directory.systemTemp.createTemp('pk-db');
    final file = File('${dir.path}/t.sqlite');
    final store = MemorySecureStore();
    final key = await loadOrCreateDbKey(store);
    expect(key.length, greaterThanOrEqualTo(43), reason: '256-bit key, base64url');
    expect(await loadOrCreateDbKey(store), key, reason: 'key is stable once created');

    final db = AppDatabase(NativeDatabase(file, setup: (raw) => applyCipherKey(raw, key)));
    await db.kvPut('k', 'rahasia-lokal');
    expect(await db.kvGet('k'), 'rahasia-lokal');
    await db.close();

    final bytes = await file.readAsBytes();
    expect(String.fromCharCodes(bytes.take(16)), isNot(startsWith('SQLite format 3')));
    expect(String.fromCharCodes(bytes).contains('rahasia-lokal'), isFalse);

    final wrong = sqlite3.open(file.path);
    wrong.execute("PRAGMA key = 'salah';");
    expect(() => wrong.select('SELECT * FROM kv_entries'), throwsA(isA<SqliteException>()));
    wrong.close();
    await dir.delete(recursive: true);
  });
}
