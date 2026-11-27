import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:taskillo/core/api_client.dart';
import 'package:taskillo/core/config.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/data/generated/exports.dart';

import 'auth_repository.dart';
import 'device_info.dart';
import 'profile_cache.dart';

/// Estado de la sesión de la app.
sealed class SessionState {
  const SessionState();
}

/// Arrancando: aún no se ha leído lo guardado.
class SessionLoading extends SessionState {
  const SessionLoading();
}

class SessionAnonymous extends SessionState {
  /// [caducada]: la sesión se cerró porque ya no valía (no por voluntad del
  /// usuario); el login lo explica.
  const SessionAnonymous({this.caducada = false});
  final bool caducada;
}

class SessionActive extends SessionState {
  const SessionActive(this.user);
  final User user;
}

/// Se sobrescribe en `main` con la instancia ya cargada.
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider sin valor'),
);

final tokenStoreProvider = Provider<TokenStore>(
  (ref) => TokenStore(SecureRefreshTokenStorage()),
);

final profileCacheProvider = Provider<ProfileCache>(
  (ref) => SharedPreferencesProfileCache(ref.watch(sharedPreferencesProvider)),
);

final deviceInfoProvider = Provider<DeviceInfoProvider>(
  (ref) => const SystemDeviceInfoProvider(),
);

/// Adaptador HTTP opcional (los tests inyectan uno simulado).
final httpAdapterProvider = Provider<HttpClientAdapter?>((ref) => null);

/// `true` mientras el cliente renueva la sesión en segundo plano.
final renovandoSesionProvider =
    NotifierProvider<_Renovando, bool>(_Renovando.new);

class _Renovando extends Notifier<bool> {
  @override
  bool build() => false;
  void fijar(bool valor) => state = valor;
}

final dioProvider = Provider<Dio>(
  (ref) => crearApiClient(
    baseUrl: apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    adapter: ref.watch(httpAdapterProvider),
    onSesionCaducada: () =>
        ref.read(sessionProvider.notifier).sesionCaducada(),
    onRenovando: (v) => ref.read(renovandoSesionProvider.notifier).fijar(v),
  ),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    dio: ref.watch(dioProvider),
    tokens: ref.watch(tokenStoreProvider),
    cache: ref.watch(profileCacheProvider),
    device: ref.watch(deviceInfoProvider),
  ),
);

final sessionProvider =
    NotifierProvider<SessionController, SessionState>(SessionController.new);

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionLoading();

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  /// Lee la sesión guardada sin esperar al servidor.
  Future<void> iniciar() async {
    final user = await _repo.restore();
    state = user == null ? const SessionAnonymous() : SessionActive(user);
  }

  Future<void> pedirCodigo(String email) =>
      _repo.requestRegistrationCode(email);

  Future<void> completarRegistro({
    required String email,
    required String code,
    required String username,
    required String displayName,
    required String password,
  }) async {
    final user = await _repo.completeRegistration(
      email: email,
      code: code,
      username: username,
      displayName: displayName,
      password: password,
    );
    state = SessionActive(user);
  }

  Future<void> iniciarSesion(String email, String password) async {
    final user = await _repo.login(email: email, password: password);
    state = SessionActive(user);
  }

  Future<void> cerrarSesion() async {
    await _repo.logout();
    state = const SessionAnonymous();
  }

  /// Cambia el nombre visible; la pantalla principal lo refleja al instante.
  Future<void> cambiarNombre(String displayName) async {
    final user = await _repo.updateDisplayName(displayName);
    state = SessionActive(user);
  }

  /// Cierra la sesión en todos los dispositivos. Si no hay red, falla y la
  /// sesión local sigue abierta.
  Future<void> cerrarSesionEnTodos() async {
    await _repo.logoutAll();
    state = const SessionAnonymous();
  }

  /// Llamado por el cliente de API cuando la renovación falla de forma
  /// definitiva: los tokens ya están borrados; se limpia también el perfil.
  Future<void> sesionCaducada() async {
    await _repo.clearLocal();
    state = const SessionAnonymous(caducada: true);
  }
}
