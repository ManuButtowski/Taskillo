import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/core/api_client.dart';
import 'package:taskillo/core/token_store.dart';

import '../support/fake_adapter.dart';

void main() {
  late MemoryRefreshStorage storage;
  late TokenStore tokens;
  late FakeAdapter adapter;
  late Dio dio;
  var caducadas = 0;

  void montar(Handler handler) {
    adapter = FakeAdapter(handler);
    dio = crearApiClient(
      baseUrl: 'http://api.test',
      tokens: tokens,
      onSesionCaducada: () => caducadas++,
      adapter: adapter,
    );
  }

  setUp(() {
    caducadas = 0;
    storage = MemoryRefreshStorage('R1');
    tokens = TokenStore(storage)..accessToken = 'A1';
  });

  test('usa la URL base con el prefijo /api/v1 y añade el Bearer', () async {
    montar((o) async => json(200, {'ok': true}));
    await dio.get<Object>('/me');
    final r = adapter.requests.single;
    expect(r.uri.toString(), 'http://api.test/api/v1/me');
    expect(r.headers['Authorization'], 'Bearer A1');
  });

  test('las peticiones públicas no llevan Bearer', () async {
    montar((o) async => json(202, {}));
    await dio.post<Object>('/auth/register',
        data: {'email': 'a@b.com'},
        options: Options(extra: {extraPublica: true}));
    expect(
        adapter.requests.single.headers.containsKey('Authorization'), isFalse);
  });

  test('un 401 renueva, guarda los tokens rotados y reintenta una vez',
      () async {
    montar((o) async {
      if (o.path.endsWith('/auth/refresh')) {
        expect(o.data, {'refreshToken': 'R1'});
        return json(200, {'tokens': tokensJson('A2', 'R2')});
      }
      return o.headers['Authorization'] == 'Bearer A2'
          ? json(200, {'ok': true})
          : json(401, errorJson('unauthorized'));
    });
    final r = await dio.get<Object>('/me');
    expect(r.statusCode, 200);
    expect(tokens.accessToken, 'A2');
    expect(storage.value, 'R2');
    expect(adapter.to('/auth/refresh').length, 1);
    expect(adapter.to('/me').length, 2);
    expect(caducadas, 0);
  });

  test('con varias peticiones en un 401 solo hay una renovación', () async {
    final gate = Completer<void>();
    montar((o) async {
      if (o.path.endsWith('/auth/refresh')) {
        await gate.future;
        return json(200, {'tokens': tokensJson('A2', 'R2')});
      }
      return o.headers['Authorization'] == 'Bearer A2'
          ? json(200, {'ok': true})
          : json(401, errorJson('unauthorized'));
    });
    final futuros = [
      dio.get<Object>('/me'),
      dio.get<Object>('/me/sessions'),
      dio.get<Object>('/me'),
    ];
    await Future<void>.delayed(const Duration(milliseconds: 50));
    gate.complete();
    final rs = await Future.wait(futuros);
    expect(rs.map((r) => r.statusCode), [200, 200, 200]);
    expect(adapter.to('/auth/refresh').length, 1);
  });

  test('una petición que falló con un token ya renovado reintenta sin renovar',
      () async {
    final gate = Completer<void>();
    montar((o) async {
      if (o.headers['Authorization'] == 'Bearer A1') {
        await gate.future;
        return json(401, errorJson('unauthorized'));
      }
      return json(200, {'ok': true});
    });
    final lenta = dio.get<Object>('/me');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    // Otra petición renovó mientras tanto.
    tokens.accessToken = 'A2';
    gate.complete();
    final r = await lenta;
    expect(r.statusCode, 200);
    expect(adapter.to('/auth/refresh'), isEmpty);
  });

  test('si el reintento vuelve a dar 401 no entra en bucle ni cierra la sesión',
      () async {
    montar((o) async {
      if (o.path.endsWith('/auth/refresh')) {
        return json(200, {'tokens': tokensJson('A2', 'R2')});
      }
      return json(401, errorJson('unauthorized'));
    });
    await expectLater(
      dio.get<Object>('/me'),
      throwsA(isA<DioException>()
          .having((e) => e.response?.statusCode, 'status', 401)),
    );
    expect(adapter.to('/auth/refresh').length, 1);
    expect(adapter.to('/me').length, 2);
    expect(caducadas, 0);
  });

  test('un fallo de red al renovar no cierra la sesión ni borra tokens',
      () async {
    montar((o) async {
      if (o.path.endsWith('/auth/refresh')) {
        throw DioException.connectionError(
            requestOptions: o, reason: 'sin red');
      }
      return json(401, errorJson('unauthorized'));
    });
    await expectLater(
      dio.get<Object>('/me'),
      throwsA(isA<DioException>()
          .having((e) => e.type, 'type', DioExceptionType.connectionError)),
    );
    expect(caducadas, 0);
    expect(storage.value, 'R1');
    expect(tokens.accessToken, 'A1');
  });

  test('un 5xx al renovar tampoco cierra la sesión', () async {
    montar((o) async => o.path.endsWith('/auth/refresh')
        ? json(503, errorJson('internal_error'))
        : json(401, errorJson('unauthorized')));
    await expectLater(dio.get<Object>('/me'), throwsA(isA<DioException>()));
    expect(caducadas, 0);
    expect(storage.value, 'R1');
  });

  test('un invalid_refresh_token borra los tokens y avisa de sesión caducada',
      () async {
    montar((o) async => o.path.endsWith('/auth/refresh')
        ? json(401, errorJson('invalid_refresh_token'))
        : json(401, errorJson('unauthorized')));
    await expectLater(dio.get<Object>('/me'), throwsA(isA<DioException>()));
    expect(caducadas, 1);
    expect(storage.value, isNull);
    expect(tokens.accessToken, isNull);
  });

  test('sin refresh token guardado, el 401 cierra la sesión', () async {
    storage.value = null;
    montar((o) async => json(401, errorJson('unauthorized')));
    await expectLater(dio.get<Object>('/me'), throwsA(isA<DioException>()));
    expect(adapter.to('/auth/refresh'), isEmpty);
    expect(caducadas, 1);
  });

  test('el 401 de una petición pública (login) no dispara renovación',
      () async {
    montar((o) async => json(401, errorJson('invalid_credentials')));
    await expectLater(
      dio.post<Object>('/auth/login',
          data: {}, options: Options(extra: {extraPublica: true})),
      throwsA(isA<DioException>()),
    );
    expect(adapter.to('/auth/refresh'), isEmpty);
    expect(caducadas, 0);
  });

  test('un 403 (contraseña actual errónea) no toca la sesión', () async {
    montar((o) async => json(403, errorJson('invalid_credentials')));
    await expectLater(dio.post<Object>('/me/password', data: {}),
        throwsA(isA<DioException>()));
    expect(adapter.to('/auth/refresh'), isEmpty);
    expect(caducadas, 0);
    expect(storage.value, 'R1');
  });
}
