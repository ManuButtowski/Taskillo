import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/app_harness.dart';
import '../../support/fake_adapter.dart';

Future<AppDePrueba> _abrir(WidgetTester tester, Handler envio) async {
  final app = await montarApp(tester,
      handler: rutas({'POST /auth/forgot-password': envio}));
  await tocar(tester, find.text('He olvidado mi contraseña'));
  return app;
}

void main() {
  testWidgets('se llega desde el login y pide el correo', (tester) async {
    await _abrir(tester, (o) async => json(202, {}));
    expect(find.byKey(const Key('olvide-correo')), findsOneWidget);
  });

  testWidgets('valida el correo en local', (tester) async {
    final app = await _abrir(tester, (o) async => json(202, {}));
    await tocar(tester, find.byKey(const Key('olvide-enviar')));
    expect(find.text('Escribe tu correo.'), findsOneWidget);
    await escribir(tester, 'olvide-correo', 'no-es-correo');
    await tocar(tester, find.byKey(const Key('olvide-enviar')));
    expect(find.text('Escribe un correo válido.'), findsOneWidget);
    expect(app.adapter.requests, isEmpty);
  });

  testWidgets('envía la petición y explica que llegará un correo',
      (tester) async {
    final app = await _abrir(tester, (o) async => json(202, {}));
    await escribir(tester, 'olvide-correo', 'ana@ejemplo.com');
    await tocar(tester, find.byKey(const Key('olvide-enviar')));
    expect(find.text('Revisa tu correo'), findsOneWidget);
    expect(find.textContaining('te llegará un mensaje con un enlace'),
        findsOneWidget);
    final cuerpo = app.adapter.to('/auth/forgot-password').single.data;
    final m = (cuerpo is String ? jsonDecode(cuerpo) : cuerpo) as Map;
    expect(m['email'], 'ana@ejemplo.com');
  });

  testWidgets('Enter envía y "Volver a enviar" repite la petición',
      (tester) async {
    final app = await _abrir(tester, (o) async => json(202, {}));
    await escribir(tester, 'olvide-correo', 'ana@ejemplo.com');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    await tocar(tester, find.text('Volver a enviar'));
    expect(app.adapter.to('/auth/forgot-password'), hasLength(2));
    expect(find.text('Hemos vuelto a enviar el correo.'), findsOneWidget);
  });

  testWidgets('"Volver a iniciar sesión" regresa al login', (tester) async {
    await _abrir(tester, (o) async => json(202, {}));
    await tocar(tester, find.text('Volver a iniciar sesión'));
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
  });

  testWidgets('límite de intentos y sin red muestran su mensaje',
      (tester) async {
    var caso = 0;
    await _abrir(tester, (o) async {
      caso++;
      if (caso == 1) return json(429, errorJson('rate_limited'));
      throw DioException.connectionError(requestOptions: o, reason: 'sin red');
    });
    await escribir(tester, 'olvide-correo', 'ana@ejemplo.com');
    await tocar(tester, find.byKey(const Key('olvide-enviar')));
    expect(find.textContaining('Demasiados intentos'), findsOneWidget);
    await tocar(tester, find.byKey(const Key('olvide-enviar')));
    expect(find.textContaining('Hace falta conexión'), findsOneWidget);
  });
}
