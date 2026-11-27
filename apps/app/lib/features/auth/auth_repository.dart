import 'package:dio/dio.dart';
import 'package:taskillo/core/api_client.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/data/generated/exports.dart';
import 'package:uuid/uuid.dart';

import 'device_info.dart';
import 'profile_cache.dart';

/// Error de la API o de red, listo para mostrar. La interfaz decide por
/// [code], nunca por [message].
class AuthException implements Exception {
  const AuthException(this.code, this.message, {this.status});

  /// Código de la API (`invalid_code`, `username_taken`...), `network` o
  /// `unknown`.
  final String code;
  final String message;
  final int? status;

  @override
  String toString() => 'AuthException($code)';
}

class AuthRepository {
  AuthRepository({
    required this.dio,
    required this.tokens,
    required this.cache,
    required this.device,
    String Function()? newDeviceId,
  }) : _newDeviceId = newDeviceId ?? (() => const Uuid().v7());

  final Dio dio;
  final TokenStore tokens;
  final ProfileCache cache;
  final DeviceInfoProvider device;
  final String Function() _newDeviceId;

  static final _publica = Options(extra: {extraPublica: true});

  /// Pide el correo de recuperación de contraseña (la respuesta es siempre la
  /// misma, exista o no la cuenta).
  Future<void> requestPasswordReset(String email) => _llamar(() async {
        await dio.post<Object?>(
          '/auth/forgot-password',
          data: ForgotPasswordRequest(email: email).toJson(),
          options: _publica,
        );
      });

  /// Paso 1 del registro: pide el código por correo.
  Future<void> requestRegistrationCode(String email) => _llamar(() async {
        await dio.post<Object?>(
          '/auth/register',
          data: RegisterRequest(email: email).toJson(),
          options: _publica,
        );
      });

  /// Paso 2: completa el registro con el código e inicia la sesión.
  Future<User> completeRegistration({
    required String email,
    required String code,
    required String username,
    required String displayName,
    required String password,
  }) async {
    final d = await device.describe();
    return _conReintentoDeDispositivo('/auth/register/complete', (id) {
      return RegisterCompleteRequest(
        email: email,
        code: code,
        username: username,
        displayName: displayName,
        password: password,
        timezone: d.timezone,
        device: Device(id: id, platform: d.platform, name: d.name),
      ).toJson();
    });
  }

  Future<User> login({required String email, required String password}) async {
    final d = await device.describe();
    return _conReintentoDeDispositivo('/auth/login', (id) {
      return LoginRequest(
        email: email,
        password: password,
        device: Device(id: id, platform: d.platform, name: d.name),
      ).toJson();
    });
  }

  /// Cambia el nombre visible y actualiza la copia local del perfil.
  Future<User> updateDisplayName(String displayName) => _llamar(() async {
        final r = await dio.patch<Map<String, Object?>>(
          '/me',
          data: UpdateMeRequest(displayName: displayName).toJson(),
        );
        final user = UserResponse.fromJson(r.data!).user;
        await cache.write(user);
        return user;
      });

  /// Cambia la contraseña. El servidor cierra las demás sesiones; la de este
  /// dispositivo sigue abierta.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) =>
      _llamar(() async {
        await dio.post<Object?>(
          '/me/password',
          data: ChangePasswordRequest(
            currentPassword: currentPassword,
            newPassword: newPassword,
          ).toJson(),
        );
      });

  /// Dispositivos con sesión abierta (el actual viene marcado por la API).
  Future<List<Session>> listSessions() => _llamar(() async {
        final r = await dio.get<Map<String, Object?>>('/me/sessions');
        return SessionList.fromJson(r.data!).sessions;
      });

  /// Cierra la sesión de otro dispositivo.
  Future<void> closeDeviceSession(String deviceId) => _llamar(() async {
        await dio.delete<Object?>('/me/sessions/${Uri.encodeComponent(deviceId)}');
      });

  /// Cierra todas las sesiones. A diferencia de [logout], si no hay red falla:
  /// no se puede asegurar que las demás sesiones se hayan cerrado.
  Future<void> logoutAll() async {
    await _llamar(() async {
      await dio.post<Object?>('/auth/logout-all');
    });
    await clearLocal();
  }

  /// Arranque: devuelve el usuario de la sesión guardada sin tocar la red.
  Future<User?> restore() async {
    final refresh = await tokens.refreshToken();
    if (refresh == null) return null;
    final user = await cache.read();
    if (user == null) {
      // Sesión a medias (sin perfil que mostrar): se descarta.
      await clearLocal();
      return null;
    }
    return user;
  }

  /// Cierra la sesión: avisa al servidor si hay red y borra siempre los datos
  /// locales.
  Future<void> logout() async {
    try {
      await dio.post<Object?>('/auth/logout');
    } on DioException {
      // Sin red o sesión ya inválida: lo local se borra igualmente.
    } finally {
      await clearLocal();
    }
  }

  /// Borra tokens y perfil cacheado (sin avisar al servidor).
  Future<void> clearLocal() async {
    await tokens.clear();
    await cache.clear();
  }

  /// Envía la petición con un UUIDv7 de dispositivo nuevo; ante
  /// `device_id_conflict` genera otro y reintenta una sola vez.
  Future<User> _conReintentoDeDispositivo(
    String path,
    Map<String, Object?> Function(String deviceId) cuerpo,
  ) async {
    Future<AuthResponse> intento() => _llamar(() async {
          final r = await dio.post<Map<String, Object?>>(
            path,
            data: cuerpo(_newDeviceId()),
            options: _publica,
          );
          return AuthResponse.fromJson(r.data!);
        });

    AuthResponse resp;
    try {
      resp = await intento();
    } on AuthException catch (e) {
      if (e.code != 'device_id_conflict') rethrow;
      resp = await intento();
    }
    await tokens.save(resp.tokens);
    await cache.write(resp.user);
    return resp.user;
  }

  /// Ejecuta una llamada traduciendo los errores de dio a [AuthException].
  Future<T> _llamar<T>(Future<T> Function() f) async {
    try {
      return await f();
    } on DioException catch (e) {
      throw _traducir(e);
    }
  }

  AuthException _traducir(DioException e) {
    final resp = e.response;
    if (resp == null) {
      return const AuthException(
          'network', 'No hay conexión con el servidor. Inténtalo de nuevo.');
    }
    final data = resp.data;
    if (data is Map && data['error'] is Map) {
      final err = data['error'] as Map;
      return AuthException(
        '${err['code'] ?? 'unknown'}',
        '${err['message'] ?? 'Ha ocurrido un error.'}',
        status: resp.statusCode,
      );
    }
    return AuthException('unknown', 'Ha ocurrido un error.',
        status: resp.statusCode);
  }
}
