import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/features/auth/auth_providers.dart';

import '../../support/app_harness.dart';
import '../../support/fake_adapter.dart';
import '../../support/fakes.dart';

Map<String, Object> _auth() =>
    {'user': userJson(), 'tokens': tokensJson('A1', 'R1')};

Future<void> _rellenarLogin(WidgetTester tester) async {
  await escribir(tester, 'login-correo', 'ana@ejemplo.com');
  await escribir(tester, 'login-clave', 'una-clave-larga-1');
}

void main() {
  group('servidor caído', () {
    testWidgets('login: 500 con JSON muestra el mensaje y permite reintentar',
        (tester) async {
      var caido = true;
      await montarApp(tester,
          handler: rutas({
            'POST /auth/login': (o) async => caido
                ? json(500, errorJson('internal_error'))
                : json(200, _auth()),
          }));
      await _rellenarLogin(tester);
      await tocar(tester, find.byKey(const Key('login-enviar')));
      expect(find.textContaining('El servidor tiene un problema'),
          findsOneWidget);
      caido = false;
      await tocar(tester, find.text('Reintentar'));
      expect(find.text('Hola, Ana'), findsOneWidget);
    });

    testWidgets('login: 502 de un proxy (sin JSON) también se trata como caída',
        (tester) async {
      await montarApp(tester,
          handler: rutas({
            'POST /auth/login': (o) async =>
                ResponseBody.fromString('<html>Bad Gateway</html>', 502),
          }));
      await _rellenarLogin(tester);
      await tocar(tester, find.byKey(const Key('login-enviar')));
      expect(find.textContaining('El servidor tiene un problema'),
          findsOneWidget);
      expect(find.text('Reintentar'), findsOneWidget);
    });

    testWidgets('login: servidor sin respuesta (tiempo agotado) con reintento',
        (tester) async {
      var cae = true;
      await montarApp(tester,
          handler: rutas({
            'POST /auth/login': (o) async {
              if (cae) {
                throw DioException.receiveTimeout(
                    timeout: const Duration(seconds: 20), requestOptions: o);
              }
              return json(200, _auth());
            },
          }));
      await _rellenarLogin(tester);
      await tocar(tester, find.byKey(const Key('login-enviar')));
      expect(find.textContaining('Hace falta conexión'), findsOneWidget);
      cae = false;
      await tocar(tester, find.text('Reintentar'));
      expect(find.text('Hola, Ana'), findsOneWidget);
    });

    testWidgets('registro paso 2: servidor caído conserva los datos y reintenta',
        (tester) async {
      var caido = true;
      await montarApp(tester,
          handler: rutas({
            'POST /auth/register': (o) async => json(202, {}),
            'POST /auth/register/complete': (o) async => caido
                ? json(503, errorJson('internal_error'))
                : json(201, _auth()),
          }));
      await tocar(tester, find.text('Crear cuenta'));
      await escribir(tester, 'reg-correo', 'ana@ejemplo.com');
      await tocar(tester, find.byKey(const Key('reg-pedir')));
      await tocar(tester, find.text('Ya tengo el código'));
      await escribir(tester, 'reg-codigo', 'abcd-efgh');
      await escribir(tester, 'reg-usuario', 'ana_01');
      await escribir(tester, 'reg-nombre', 'Ana');
      await escribir(tester, 'reg-clave', 'una-clave-larga-1');
      await tocar(tester, find.byKey(const Key('reg-completar')));
      expect(find.textContaining('El servidor tiene un problema'),
          findsOneWidget);
      expect(find.text('ana_01'), findsOneWidget);
      caido = false;
      await tocar(tester, find.text('Reintentar'));
      expect(find.text('Hola, Ana'), findsOneWidget);
    });
  });

  group('sesión expirada', () {
    testWidgets('una petición con refresh inválido devuelve al login con aviso',
        (tester) async {
      final app = await montarApp(tester,
          usuario: usuarioEjemplo(),
          handler: rutas({
            'GET /me/sessions': (o) async =>
                json(401, errorJson('unauthorized')),
            'POST /auth/refresh': (o) async =>
                json(401, errorJson('invalid_refresh_token')),
          }));
      await tocar(tester, find.byTooltip('Perfil'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('login-correo')), findsOneWidget);
      expect(find.text('Tu sesión ha caducado. Inicia sesión de nuevo.'),
          findsOneWidget);
      expect(app.storage.value, isNull);
      expect(app.cache.user, isNull);
    });

    testWidgets('cerrar sesión por voluntad propia no muestra el aviso',
        (tester) async {
      await montarApp(tester,
          usuario: usuarioEjemplo(),
          handler: rutas({
            'GET /me/sessions': (o) async => json(200, {'sessions': []}),
            'POST /auth/logout': (o) async => ResponseBody.fromString('', 204),
          }));
      await tocar(tester, find.byTooltip('Perfil'));
      await tocar(tester, find.byKey(const Key('cerrar-local')));
      expect(find.byKey(const Key('login-correo')), findsOneWidget);
      expect(find.textContaining('ha caducado'), findsNothing);
    });

    testWidgets('al volver a iniciar sesión entra y el aviso desaparece',
        (tester) async {
      final app = await montarApp(tester,
          usuario: usuarioEjemplo(),
          handler: rutas({
            'GET /me/sessions': (o) async =>
                json(401, errorJson('unauthorized')),
            'POST /auth/refresh': (o) async =>
                json(401, errorJson('invalid_refresh_token')),
            'POST /auth/login': (o) async => json(200, _auth()),
          }));
      await tocar(tester, find.byTooltip('Perfil'));
      await tester.pumpAndSettle();
      await _rellenarLogin(tester);
      await tocar(tester, find.byKey(const Key('login-enviar')));
      expect(find.text('Hola, Ana'), findsOneWidget);
      expect(app.container.read(sessionProvider), isA<SessionActive>());
      expect(find.textContaining('ha caducado'), findsNothing);
    });
  });

  group('renovación en segundo plano', () {
    testWidgets('muestra un indicador discreto mientras dura y lo quita después',
        (tester) async {
      final refresco = Completer<ResponseBody>();
      var renovada = false;
      final app = await montarApp(tester,
          usuario: usuarioEjemplo(),
          handler: rutas({
            'GET /me/sessions': (o) async => renovada
                ? json(200, {'sessions': []})
                : json(401, errorJson('unauthorized')),
            'POST /auth/refresh': (o) => refresco.future,
          }));
      await tester.tap(find.byTooltip('Perfil'));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      // No bloquea: la pantalla sigue ahí.
      expect(find.text('Perfil'), findsWidgets);
      renovada = true;
      refresco.complete(json(200, {'tokens': tokensJson('A2', 'R2')}));
      await tester.pumpAndSettle();
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(app.storage.value, 'R2');
      expect(find.text('Dispositivos'), findsOneWidget);
    });

    testWidgets(
        'si la renovación falla por red, el indicador desaparece y la sesión sigue',
        (tester) async {
      final app = await montarApp(tester,
          usuario: usuarioEjemplo(),
          handler: rutas({
            'GET /me/sessions': (o) async =>
                json(401, errorJson('unauthorized')),
            'POST /auth/refresh': (o) async =>
                throw DioException.connectionError(
                    requestOptions: o, reason: 'sin red'),
          }));
      await tocar(tester, find.byTooltip('Perfil'));
      await tester.pumpAndSettle();
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(app.container.read(sessionProvider), isA<SessionActive>());
      expect(find.textContaining('Hace falta conexión'), findsOneWidget);
    });
  });
}
