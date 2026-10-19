import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Downloaded report exports (user 2026-10-19, phase 4 Laporan): saved in the app cache and handed to other apps by
/// MainActivity `id.co.drms.proyekkas/files` + ReportFileProvider (read-only content URI) — no plugin. [name] is a
/// plain file name (letters, digits, `._-`).
abstract interface class ReportFiles {
  Future<bool> save(String name, Uint8List bytes);

  /// Opens the file in a viewer app (PDF reader, spreadsheet); false = no app can open it.
  Future<bool> open(String name);

  /// Android share sheet (WhatsApp, email, Drive, …).
  Future<bool> share(String name);

  /// Copies the file into Download/ProyekKas (Android 10+); false on older Android or an error.
  Future<bool> download(String name);
}

class AndroidReportFiles implements ReportFiles {
  static const _channel = MethodChannel('id.co.drms.proyekkas/files');

  Future<bool> _call(String method, Map<String, Object?> args) async {
    try {
      return await _channel.invokeMethod<bool>(method, args) ?? false;
    } on Object {
      return false;
    }
  }

  @override
  Future<bool> save(String name, Uint8List bytes) => _call('save', {'name': name, 'bytes': bytes});

  @override
  Future<bool> open(String name) => _call('open', {'name': name});

  @override
  Future<bool> share(String name) => _call('share', {'name': name});

  @override
  Future<bool> download(String name) => _call('download', {'name': name});
}

final reportFilesProvider = Provider<ReportFiles>((ref) => AndroidReportFiles());

/// A safe cache file name from the server's Content-Disposition (`filename="Rekap Kas 2026-10.pdf"`), else
/// `<fallback>.<format>`.
String reportFileName(String? contentDisposition, {required String fallback, required String format}) {
  final m = RegExp(
    r'''filename\*?=(?:UTF-8'')?"?([^";]+)"?''',
    caseSensitive: false,
  ).firstMatch(contentDisposition ?? '');
  var name = m == null ? '' : Uri.decodeComponent(m.group(1)!.trim());
  name = name.replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '_').replaceAll(RegExp(r'^[._-]+'), '');
  if (name.isEmpty || !name.toLowerCase().endsWith('.$format')) {
    name = '${fallback.replaceAll(RegExp(r'[^A-Za-z0-9-]+'), '_')}.$format';
  }
  return name.length > 140 ? '${name.substring(0, 130)}.$format' : name;
}

/// A document picked with the Android picker (`id.co.drms.proyekkas/picker`).
typedef PickedFile = ({String name, Uint8List? bytes, bool tooLarge});

/// System document picker (ACTION_OPEN_DOCUMENT, no permission) — phase 5b RAP Excel import. null = cancelled.
abstract interface class FilePicker {
  Future<PickedFile?> pick({required List<String> mimeTypes, int maxBytes});
}

class AndroidFilePicker implements FilePicker {
  static const _channel = MethodChannel('id.co.drms.proyekkas/picker');

  @override
  Future<PickedFile?> pick({required List<String> mimeTypes, int maxBytes = 2 * 1024 * 1024}) async {
    try {
      final r = await _channel.invokeMapMethod<String, Object?>('pick', {'mimeTypes': mimeTypes, 'maxBytes': maxBytes});
      if (r == null) return null;
      final bytes = r['bytes'];
      return (
        name: '${r['name'] ?? 'file'}',
        bytes: bytes is Uint8List ? bytes : null,
        tooLarge: r['tooLarge'] == true,
      );
    } on Object {
      return null;
    }
  }
}

final filePickerProvider = Provider<FilePicker>((ref) => AndroidFilePicker());
