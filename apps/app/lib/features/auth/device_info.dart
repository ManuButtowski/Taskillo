import 'dart:io' show Platform;

import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:taskillo/data/generated/exports.dart';

/// Datos del dispositivo que se envían al iniciar sesión.
class DeviceDescriptor {
  const DeviceDescriptor({
    required this.platform,
    this.name,
    required this.timezone,
  });

  final DevicePlatform platform;
  final String? name;

  /// Identificador IANA (por ejemplo `Europe/Madrid`).
  final String timezone;
}

abstract interface class DeviceInfoProvider {
  Future<DeviceDescriptor> describe();
}

class SystemDeviceInfoProvider implements DeviceInfoProvider {
  const SystemDeviceInfoProvider();

  static const zonaPorDefecto = 'Europe/Madrid';

  @override
  Future<DeviceDescriptor> describe() async {
    String zona;
    try {
      zona = (await FlutterTimezone.getLocalTimezone()).identifier;
    } on Object {
      zona = zonaPorDefecto;
    }
    String? nombre;
    try {
      nombre = Platform.localHostname;
    } on Object {
      nombre = null;
    }
    return DeviceDescriptor(
      platform: _plataforma(),
      name: nombre,
      timezone: zona,
    );
  }

  DevicePlatform _plataforma() {
    if (Platform.isAndroid) return DevicePlatform.android;
    if (Platform.isWindows) return DevicePlatform.windows;
    if (Platform.isMacOS) return DevicePlatform.macos;
    return DevicePlatform.linux;
  }
}
