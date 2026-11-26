import 'dart:async';

import 'package:dio/dio.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/features/auth/auth_providers.dart';

import '../../support/app_harness.dart';
import '../../support/fake_adapter.dart';
import '../../support/fakes.dart';

Map<String, Object> _auth() =>
    {'user': userJson(), 'tokens': tokensJson('A1', 'R1')};

void main() {
  testWidgets('sin sesión se muestra el inicio de sesión', (tester) async {
    await montarApp(tester);
    expect(find.text('Iniciar sesión'), findsWidgets);
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
    expect(find.byKey(const Key('login-clave')), findsOneWidget);
    expect(find.text('Crear cuenta'), findsOneWidget);
  });

  testWidgets('validación local: campos vacíos y correo mal formado',
      (tester) async {
    final app = await montarApp(tester);
    await tocar(tester, find.byKey(const Key('login-enviar')));
    expect(find.text('Escribe tu correo.'), findsOneWidget);
    expect(find.text('Escribe tu contraseña.'), findsOneWidget);
    await escribir(tester, 'login-correo', 'esto-no-es-un-correo');
    await tocar(tester, find.byKey(const Key('login-enviar')));
    expect(find.text('Escribe un correo válido.'), findsOneWidget);
    expect(app.adapter.requests, isEmpty);
  });

  testWidgets('login correcto entra en la pantalla principal', (tester) async {
    await montarApp(tester,
        handler: rutas({'POST /auth/login': (o) async => json(200, _auth())}));
    await escribir(tester, 'login-correo', 'ana@ejemplo.com');
    await escribir(tester, 'login-clave', 'una-clave-larga-1');
    await tocar(tester, find.byKey(const Key('login-enviar')));
    expect(find.text('Hola, Ana'), findsOneWidget);
  });

  testWidgets('Enter en la contraseña envía el formulario', (tester) async {
    final app = await montarApp(tester,
        handler: rutas({'POST /auth/login': (o) async => json(200, _auth())}));
    await escribir(tester, 'login-correo', 'ana@ejemplo.com');
    await escribir(tester, 'login-clave', 'una-clave-larga-1');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(app.adapter.to('/auth/login'), hasLength(1));
    expect(find.text('Hola, Ana'), findsOneWidget);
  });

  testWidgets('credenciales erróneas: mensaje genérico en español',
      (tester) async {
    await montarApp(tester,
        handler: rutas({
          'POST /auth/login': (o) async =>
              json(401, errorJson('invalid_credentials')),
        }));
    await escribir(tester, 'login-correo', 'ana@ejemplo.com');
    await escribir(tester, 'login-clave', 'mala-clave-123');
    await tocar(tester, find.byKey(const Key('login-enviar')));
    expect(find.text('Correo o contraseña incorrectos.'), findsOneWidget);
    // El mensaje del servidor ('msg') no se muestra: se decide por el código.
    expect(find.text('msg'), findsNothing);
  });

  testWidgets('indicador de espera y sin envíos duplicados', (tester) async {
    final completer = Completer<ResponseBody>();
    final app = await montarApp(tester,
        handler: rutas({'POST /auth/login': (o) => completer.future}));
    await escribir(tester, 'login-correo', 'ana@ejemplo.com');
    await escribir(tester, 'login-clave', 'una-clave-larga-1');
    await tester.tap(find.byKey(const Key('login-enviar')));
    await tester.pump();
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byKey(const Key('login-enviar')), warnIfMissed: false);
    await tester.pump(const Duration(milliseconds: 50));
    expect(app.adapter.to('/auth/login'), hasLength(1));
    completer.complete(json(200, _auth()));
    await tester.pumpAndSettle();
    expect(find.text('Hola, Ana'), findsOneWidget);
  });

  testWidgets('sin conexión: aviso "hace falta conexión"', (tester) async {
    await montarApp(tester,
        handler: rutas({
          'POST /auth/login': (o) async => throw DioException.connectionError(
              requestOptions: o, reason: 'sin red'),
        }));
    await escribir(tester, 'login-correo', 'ana@ejemplo.com');
    await escribir(tester, 'login-clave', 'una-clave-larga-1');
    await tocar(tester, find.byKey(const Key('login-enviar')));
    expect(find.textContaining('Hace falta conexión'), findsOneWidget);
  });

  testWidgets('"Crear cuenta" lleva al registro', (tester) async {
    await montarApp(tester);
    await tocar(tester, find.text('Crear cuenta'));
    expect(find.byKey(const Key('reg-correo')), findsOneWidget);
  });

  testWidgets('con sesión guardada se abre directamente la principal',
      (tester) async {
    final app = await montarApp(tester, usuario: usuarioEjemplo());
    expect(find.text('Hola, Ana'), findsOneWidget);
    expect(app.container.read(sessionProvider), isA<SessionActive>());
  });
}
