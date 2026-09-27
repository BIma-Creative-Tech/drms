import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// One GPS fix for attendance (ADR 0010 decision 8). [isMocked] = Android `Position.isMocked`
/// ("true on Android … when the location came from the mocked provider", geolocator_platform_interface).
class LocationFix {
  const LocationFix({required this.lat, required this.lng, required this.accuracyM, required this.isMocked});
  final double lat;
  final double lng;
  final double accuracyM;
  final bool isMocked;
}

enum LocationProblem { serviceDisabled, permissionDenied, permissionDeniedForever, timeout, unavailable }

class LocationException implements Exception {
  const LocationException(this.problem);
  final LocationProblem problem;

  String get message => switch (problem) {
    LocationProblem.serviceDisabled => 'GPS/lokasi HP mati. Nyalakan lokasi lalu coba lagi.',
    LocationProblem.permissionDenied => 'Izin lokasi belum diberikan. Izinkan akses lokasi untuk absen.',
    LocationProblem.permissionDeniedForever =>
      'Izin lokasi ditolak permanen. Buka Pengaturan HP → Aplikasi → ProyekKas → Izin → Lokasi.',
    LocationProblem.timeout => 'Sinyal GPS lemah. Pindah ke tempat terbuka lalu coba lagi.',
    LocationProblem.unavailable => 'Lokasi tidak bisa dibaca. Coba lagi.',
  };
}

abstract interface class LocationService {
  /// Current fix (asks for the while-in-use permission when needed). Throws [LocationException].
  Future<LocationFix> current();
}

/// geolocator 14.0.3: service check → permission → `getCurrentPosition` (high accuracy, 30 s limit).
/// Works offline (GPS needs no data connection).
class GeolocatorLocationService implements LocationService {
  @override
  Future<LocationFix> current() async {
    if (!await Geolocator.isLocationServiceEnabled()) throw const LocationException(LocationProblem.serviceDisabled);
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.deniedForever) {
      throw const LocationException(LocationProblem.permissionDeniedForever);
    }
    if (perm == LocationPermission.denied || perm == LocationPermission.unableToDetermine) {
      throw const LocationException(LocationProblem.permissionDenied);
    }
    try {
      final p = await Geolocator.getCurrentPosition(
        locationSettings: AndroidSettings(accuracy: LocationAccuracy.high, timeLimit: const Duration(seconds: 30)),
      );
      return LocationFix(lat: p.latitude, lng: p.longitude, accuracyM: p.accuracy, isMocked: p.isMocked);
    } on LocationServiceDisabledException {
      throw const LocationException(LocationProblem.serviceDisabled);
    } on PermissionDeniedException {
      throw const LocationException(LocationProblem.permissionDenied);
    } on TimeoutException {
      throw const LocationException(LocationProblem.timeout);
    } on Object {
      throw const LocationException(LocationProblem.unavailable);
    }
  }
}

class FixedLocationService implements LocationService {
  FixedLocationService(this.fix, {this.error});
  LocationFix fix;
  LocationException? error;
  int calls = 0;
  @override
  Future<LocationFix> current() async {
    calls++;
    if (error != null) throw error!;
    return fix;
  }
}
