import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/features/auth/auth_providers.dart';
import 'package:taskillo/features/auth/auth_repository.dart';

import '../../support/fake_adapter.dart';
import '../../support/fakes.dart';

void main() {
  late MemoryRefreshStorage storage;
  late MemoryProfileCache cache;
  late FakeAdapter adapter;
  late ProviderContainer container;

  void montar(Handler handler) {
    adapter = FakeAdapter(handler);
    container = ProviderContainer(overrides: [
      tokenStoreProvider.overrideWithValue(TokenStore(storage)),
      profileCacheProvider.overrideWithValue(cache),
      deviceInfoProvider.overrideWithValue(FakeDeviceInfo()),
      httpAdapterProvider.overrideWithValue(adapter),
    ]);
    addTearDown(container.dispose);
  }

  SessionState estado() => container.read(sessionProvider);
  SessionController ctl() => container.read(sessionProvider.notifier);

  setUp(() {
    storage = MemoryRefreshStorage();
    cache = MemoryProfileCache();
  });

  test('arranca en estado de carga', () {
    montar((o) async => json(200, {}));
    expect(estado(), isA<SessionLoading>());
  });

  test('arranque sin sesión guardada: anónimo', () async {
    montar((o) async => throw StateError('no debe haber red'));
    await ctl().iniciar();
    expect(estado(), isA<SessionAnonymous>());
  });

  test('arranque con sesión guardada y sin conexión: activa sin esperar al servidor',
      () async {
    storage.value = 'R1';
    cache.user = usuarioEjemplo();
    montar((o) async => throw DioException.connectionError(
        requestOptions: o, reason: 'sin red'));
    await ctl().iniciar();
    final s = estado();
    expect(s, isA<SessionActive>());
    expect((s as SessionActive).user.username, 'ana');
    expect(adapter.requests, isEmpty);
  });

  test('login correcto deja la sesión activa', () async {
    montar((o) async =>
        json(200, {'user': userJson(), 'tokens': tokensJson('A1', 'R1')}));
    await ctl().iniciarSesion('ana@ejemplo.com', 'x');
    expect(estado(), isA<SessionActive>());
    expect(storage.value, 'R1');
  });

  test('login fallido deja anónimo y propaga el error', () async {
    montar((o) async => json(401, errorJson('invalid_credentials')));
    await ctl().iniciar();
    await expectLater(ctl().iniciarSesion('a@b.com', 'mal'),
        throwsA(isA<AuthException>()));
    expect(estado(), isA<SessionAnonymous>());
  });

  test('completar el registro inicia la sesión', () async {
    montar((o) async => o.path.endsWith('/auth/register')
        ? json(202, {})
        : json(201, {'user': userJson(), 'tokens': tokensJson('A1', 'R1')}));
    await ctl().pedirCodigo('ana@ejemplo.com');
    expect(estado(), isNot(isA<SessionActive>()));
    await ctl().completarRegistro(
      email: 'ana@ejemplo.com',
      code: 'ABCD-EFGH',
      username: 'ana',
      displayName: 'Ana',
      password: 'una-clave-larga-1',
    );
    expect(estado(), isA<SessionActive>());
  });

  test('cerrar sesión borra tokens y perfil y pasa a anónimo', () async {
    storage.value = 'R1';
    cache.user = usuarioEjemplo();
    montar((o) async => ResponseBody.fromString('', 204));
    await ctl().iniciar();
    expect(estado(), isA<SessionActive>());
    await ctl().cerrarSesion();
    expect(estado(), isA<SessionAnonymous>());
    expect(storage.value, isNull);
    expect(cache.user, isNull);
  });

  test('si la renovación falla definitivamente, la sesión pasa a anónima',
      () async {
    storage.value = 'R1';
    cache.user = usuarioEjemplo();
    montar((o) async => o.path.endsWith('/auth/refresh')
        ? json(401, errorJson('invalid_refresh_token'))
        : json(401, errorJson('unauthorized')));
    await ctl().iniciar();
    await expectLater(
        container.read(dioProvider).get<Object>('/me'),
        throwsA(isA<DioException>()));
    // La notificación es asíncrona (borra el perfil cacheado).
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(estado(), isA<SessionAnonymous>());
    expect(cache.user, isNull);
    expect(storage.value, isNull);
  });

  test('un fallo de red al renovar no cierra la sesión', () async {
    storage.value = 'R1';
    cache.user = usuarioEjemplo();
    montar((o) async => o.path.endsWith('/auth/refresh')
        ? throw DioException.connectionError(
            requestOptions: o, reason: 'sin red')
        : json(401, errorJson('unauthorized')));
    await ctl().iniciar();
    await expectLater(
        container.read(dioProvider).get<Object>('/me'),
        throwsA(isA<DioException>()));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(estado(), isA<SessionActive>());
    expect(storage.value, 'R1');
  });
}
