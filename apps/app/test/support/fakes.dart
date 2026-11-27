import 'package:taskillo/data/generated/exports.dart';
import 'package:taskillo/features/auth/device_info.dart';
import 'package:taskillo/features/auth/profile_cache.dart';

class FakeDeviceInfo implements DeviceInfoProvider {
  @override
  Future<DeviceDescriptor> describe() async => const DeviceDescriptor(
        platform: DevicePlatform.windows,
        name: 'PC de Ana',
        timezone: 'Europe/Madrid',
      );
}

class MemoryProfileCache implements ProfileCache {
  MemoryProfileCache([this.user]);
  User? user;

  @override
  Future<User?> read() async => user;
  @override
  Future<void> write(User u) async => user = u;
  @override
  Future<void> clear() async => user = null;
}

User usuarioEjemplo() => User.fromJson({
      'id': 'u1',
      'email': 'ana@ejemplo.com',
      'username': 'ana',
      'displayName': 'Ana',
      'timezone': 'Europe/Madrid',
    });
