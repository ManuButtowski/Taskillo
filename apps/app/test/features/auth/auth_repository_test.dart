import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/core/api_client.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/features/auth/auth_repository.dart';

import '../../support/fake_adapter.dart';
import '../../support/fakes.dart';

final _uuidV7 = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

void main() {
  late MemoryRefreshStorage storage;
  late TokenStore tokens;
  late MemoryProfileCache cache;
  late FakeAdapter adapter;
  late AuthRepository repo;

  void montar(Handler handler) {
    adapter = FakeAdapter(handler);
    final dio = crearApiClient(
      baseUrl: 'http://api.test',
      tokens: tokens,
      onSesionCaducada: () {},
      adapter: adapter,
    );
    repo = AuthRepository(
      dio: dio,
      tokens: tokens,
      cache: cache,
      device: FakeDeviceInfo(),
    );
  }

  ResponseBody sesion() =>
      json(200, {'user': userJson(), 'tokens': tokensJson('A1', 'R1')});

  setUp(() {
    storage = MemoryRefreshStorage();
    tokens = TokenStore(storage);
    cache = MemoryProfileCache();
  });

  group('registro en dos pasos', () {
    test('el paso 1 envía solo el correo, sin Bearer', () async {
      montar((o) async => json(202, {}));
      await repo.requestRegistrationCode('ana@ejemplo.com');
      final r = adapter.requests.single;
      expect(r.path, '/auth/register');
      expect(r.data, {'email': 'ana@ejemplo.com'});
      expect(r.headers.containsKey('Authorization'), isFalse);
    });

    test('el paso 2 envía código, datos y dispositivo, y guarda la sesión',
        () async {
      montar((o) async => json(201, {
            'user': userJson(),
            'tokens': tokensJson('A1', 'R1'),
          }));
      final user = await repo.completeRegistration(
        email: 'ana@ejemplo.com',
        code: 'ABCD-EFGH',
        username: 'ana',
        displayName: 'Ana',
        password: 'una-clave-larga-1',
      );
      final r = adapter.requests.single;
      expect(r.path, '/auth/register/complete');
      final d = r.data as Map;
      expect(d['email'], 'ana@ejemplo.com');
      expect(d['code'], 'ABCD-EFGH');
      expect(d['username'], 'ana');
      expect(d['displayName'], 'Ana');
      expect(d['password'], 'una-clave-larga-1');
      expect(d['timezone'], 'Europe/Madrid');
      final dev = d['device'] as Map;
      expect(dev['id'], matches(_uuidV7));
      expect(dev['platform'], 'windows');
      expect(dev['name'], 'PC de Ana');
      expect(r.headers.containsKey('Authorization'), isFalse);
      expect(user.username, 'ana');
      expect(tokens.accessToken, 'A1');
      expect(storage.value, 'R1');
      expect(cache.user?.username, 'ana');
    });

    test('un código no válido llega como AuthException invalid_code', () async {
      montar((o) async => json(400, errorJson('invalid_code')));
      await expectLater(
        repo.completeRegistration(
          email: 'a@b.com',
          code: 'x',
          username: 'ana',
          displayName: 'Ana',
          password: 'una-clave-larga-1',
        ),
        throwsA(isA<AuthException>()
            .having((e) => e.code, 'code', 'invalid_code')),
      );
      expect(storage.value, isNull);
      expect(cache.user, isNull);
    });

    test('username_taken se propaga para marcarlo en su campo', () async {
      montar((o) async => json(409, errorJson('username_taken')));
      await expectLater(
        repo.completeRegistration(
          email: 'a@b.com',
          code: 'x',
          username: 'ana',
          displayName: 'Ana',
          password: 'una-clave-larga-1',
        ),
        throwsA(isA<AuthException>()
            .having((e) => e.code, 'code', 'username_taken')),
      );
    });

    test('el paso 2 reintenta una vez con otro UUID ante device_id_conflict',
        () async {
      var n = 0;
      montar((o) async => ++n == 1
          ? json(409, errorJson('device_id_conflict'))
          : json(201, {
              'user': userJson(),
              'tokens': tokensJson('A1', 'R1'),
            }));
      await repo.completeRegistration(
        email: 'a@b.com',
        code: 'x',
        username: 'ana',
        displayName: 'Ana',
        password: 'una-clave-larga-1',
      );
      final ids = adapter.requests
          .map((r) => ((r.data as Map)['device'] as Map)['id'])
          .toList();
      expect(ids.length, 2);
      expect(ids[0], isNot(ids[1]));
    });
  });

  group('login', () {
    test('envía correo, contraseña y dispositivo con UUIDv7 y guarda la sesión',
        () async {
      montar((o) async => sesion());
      final user = await repo.login(email: 'ana@ejemplo.com', password: 'x');
      final d = adapter.requests.single.data as Map;
      expect(d['email'], 'ana@ejemplo.com');
      expect(d['password'], 'x');
      expect((d['device'] as Map)['id'], matches(_uuidV7));
      expect((d['device'] as Map)['platform'], 'windows');
      expect(user.id, 'u1');
      expect(tokens.accessToken, 'A1');
      expect(storage.value, 'R1');
      expect(cache.user?.displayName, 'Ana');
    });

    test('ante 409 device_id_conflict genera otro UUID y reintenta una vez',
        () async {
      var n = 0;
      montar((o) async =>
          ++n == 1 ? json(409, errorJson('device_id_conflict')) : sesion());
      await repo.login(email: 'a@b.com', password: 'x');
      final ids = adapter.requests
          .map((r) => ((r.data as Map)['device'] as Map)['id'])
          .toList();
      expect(ids.length, 2);
      expect(ids[0], isNot(ids[1]));
      expect(ids[1], matches(_uuidV7));
    });

    test('si el reintento también da conflicto, falla sin más intentos',
        () async {
      montar((o) async => json(409, errorJson('device_id_conflict')));
      await expectLater(
        repo.login(email: 'a@b.com', password: 'x'),
        throwsA(isA<AuthException>()
            .having((e) => e.code, 'code', 'device_id_conflict')),
      );
      expect(adapter.requests.length, 2);
      expect(storage.value, isNull);
    });

    test('credenciales erróneas: AuthException y nada guardado', () async {
      montar((o) async => json(401, errorJson('invalid_credentials')));
      await expectLater(
        repo.login(email: 'a@b.com', password: 'mal'),
        throwsA(isA<AuthException>()
            .having((e) => e.code, 'code', 'invalid_credentials')),
      );
      expect(adapter.to('/auth/refresh'), isEmpty);
      expect(storage.value, isNull);
      expect(cache.user, isNull);
    });

    test('sin red: AuthException con código network', () async {
      montar((o) async => throw DioException.connectionError(
          requestOptions: o, reason: 'sin red'));
      await expectLater(
        repo.login(email: 'a@b.com', password: 'x'),
        throwsA(isA<AuthException>().having((e) => e.code, 'code', 'network')),
      );
    });
  });

  group('arranque y cierre', () {
    test('restore con tokens y perfil guardados no hace peticiones', () async {
      storage.value = 'R1';
      cache.user = usuarioEjemplo();
      montar((o) async => throw StateError('no debe haber red'));
      final user = await repo.restore();
      expect(user?.username, 'ana');
      expect(adapter.requests, isEmpty);
    });

    test('restore sin refresh token devuelve null', () async {
      cache.user = usuarioEjemplo();
      montar((o) async => throw StateError('no debe haber red'));
      expect(await repo.restore(), isNull);
    });

    test('restore con refresh token pero sin perfil limpia y devuelve null',
        () async {
      storage.value = 'R1';
      montar((o) async => throw StateError('no debe haber red'));
      expect(await repo.restore(), isNull);
      expect(storage.value, isNull);
    });

    test('logout avisa al servidor y borra tokens y perfil', () async {
      storage.value = 'R1';
      tokens.accessToken = 'A1';
      cache.user = usuarioEjemplo();
      montar((o) async => ResponseBody.fromString('', 204));
      await repo.logout();
      expect(adapter.to('/auth/logout').length, 1);
      expect(adapter.to('/auth/logout').single.headers['Authorization'],
          'Bearer A1');
      expect(storage.value, isNull);
      expect(tokens.accessToken, isNull);
      expect(cache.user, isNull);
    });

    test('logout sin conexión borra igualmente lo local y no lanza', () async {
      storage.value = 'R1';
      tokens.accessToken = 'A1';
      cache.user = usuarioEjemplo();
      montar((o) async => throw DioException.connectionError(
          requestOptions: o, reason: 'sin red'));
      await repo.logout();
      expect(storage.value, isNull);
      expect(cache.user, isNull);
    });
  });
}
