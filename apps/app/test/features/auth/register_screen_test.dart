import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/app_harness.dart';
import '../../support/fake_adapter.dart';

Map<String, Object> _auth() =>
    {'user': userJson(), 'tokens': tokensJson('A1', 'R1')};

Future<AppDePrueba> _abrir(
    WidgetTester tester, Map<String, Handler> extra) async {
  final app = await montarApp(tester,
      handler: rutas({
        'POST /auth/register': (o) async => json(202, {}),
        ...extra,
      }));
  await tocar(tester, find.text('Crear cuenta'));
  return app;
}

Future<void> _paso1(WidgetTester tester) async {
  await escribir(tester, 'reg-correo', 'ana@ejemplo.com');
  await tocar(tester, find.byKey(const Key('reg-pedir')));
}

Future<void> _irAlPaso2(WidgetTester tester) async {
  await _paso1(tester);
  await tocar(tester, find.text('Ya tengo el código'));
}

Future<void> _rellenarPaso2(WidgetTester tester,
    {String codigo = 'abcd-efgh', String usuario = 'ana_01'}) async {
  await escribir(tester, 'reg-codigo', codigo);
  await escribir(tester, 'reg-usuario', usuario);
  await escribir(tester, 'reg-nombre', 'Ana');
  await escribir(tester, 'reg-clave', 'una-clave-larga-1');
}

void main() {
  testWidgets('paso 1: solo pide el correo y valida en local', (tester) async {
    final app = await _abrir(tester, {});
    expect(find.byKey(const Key('reg-usuario')), findsNothing);
    await tocar(tester, find.byKey(const Key('reg-pedir')));
    expect(find.text('Escribe tu correo.'), findsOneWidget);
    expect(app.adapter.requests, isEmpty);
  });

  testWidgets('paso 1: confirmación y opciones de reenviar e iniciar sesión',
      (tester) async {
    final app = await _abrir(tester, {});
    await _paso1(tester);
    expect(find.text('Te hemos enviado un correo'), findsOneWidget);
    expect(find.text('Volver a enviar'), findsOneWidget);
    expect(find.text('Iniciar sesión'), findsOneWidget);
    await tocar(tester, find.text('Volver a enviar'));
    expect(app.adapter.to('/auth/register'), hasLength(2));
    expect(find.text('Te hemos enviado un correo'), findsOneWidget);
  });

  testWidgets('paso 1: sin red muestra el aviso y permite reintentar',
      (tester) async {
    var fallar = true;
    await _abrir(tester, {
      'POST /auth/register': (o) async {
        if (fallar) {
          throw DioException.connectionError(
              requestOptions: o, reason: 'sin red');
        }
        return json(202, {});
      },
    });
    await _paso1(tester);
    expect(find.textContaining('Hace falta conexión'), findsOneWidget);
    expect(find.text('Te hemos enviado un correo'), findsNothing);
    fallar = false;
    await tocar(tester, find.text('Reintentar'));
    expect(find.text('Te hemos enviado un correo'), findsOneWidget);
  });

  testWidgets('"Iniciar sesión" del paso 1 vuelve al login', (tester) async {
    await _abrir(tester, {});
    await _paso1(tester);
    await tocar(tester, find.text('Iniciar sesión'));
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
  });

  testWidgets('paso 2: completa el registro (código sin guion y en minúsculas)',
      (tester) async {
    final app = await _abrir(tester, {
      'POST /auth/register/complete': (o) async => json(201, _auth()),
    });
    await _irAlPaso2(tester);
    await _rellenarPaso2(tester, codigo: 'abcdefgh');
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.text('Hola, Ana'), findsOneWidget);
    final cuerpo = app.adapter.to('/auth/register/complete').single.data;
    final m = (cuerpo is String ? jsonDecode(cuerpo) : cuerpo) as Map;
    expect(m['email'], 'ana@ejemplo.com');
    expect(m['code'], 'ABCD-EFGH');
  });

  testWidgets('paso 2: validación local de cada campo', (tester) async {
    final app = await _abrir(tester, {});
    await _irAlPaso2(tester);
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.text('El código tiene 8 letras o números.'), findsOneWidget);
    expect(find.text('Escribe un nombre de usuario.'), findsOneWidget);
    expect(find.text('Escribe tu nombre visible.'), findsOneWidget);
    expect(find.text('Escribe una contraseña.'), findsOneWidget);
    await _rellenarPaso2(tester, usuario: 'a!');
    await escribir(tester, 'reg-clave', 'corta');
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.text('Usa de 3 a 30 letras, números o guion bajo.'),
        findsOneWidget);
    expect(find.text('La contraseña debe tener al menos 10 caracteres.'),
        findsOneWidget);
    expect(app.adapter.to('/auth/register/complete'), isEmpty);
  });

  testWidgets('paso 2: código no válido ofrece pedir otro', (tester) async {
    final app = await _abrir(tester, {
      'POST /auth/register/complete': (o) async =>
          json(400, errorJson('invalid_code')),
    });
    await _irAlPaso2(tester);
    await _rellenarPaso2(tester);
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.text('El código no es válido o ha caducado.'), findsOneWidget);
    await tocar(tester, find.text('Pedir otro código'));
    expect(app.adapter.to('/auth/register'), hasLength(2));
    expect(find.text('Te hemos enviado un código nuevo.'), findsOneWidget);
  });

  testWidgets('paso 2: nombre de usuario ocupado se marca en su campo',
      (tester) async {
    await _abrir(tester, {
      'POST /auth/register/complete': (o) async =>
          json(409, errorJson('username_taken')),
    });
    await _irAlPaso2(tester);
    await _rellenarPaso2(tester);
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.text('Ese nombre de usuario ya está en uso.'), findsOneWidget);
    // El resto de datos se conserva para probar otro nombre.
    expect(find.text('abcd-efgh'), findsOneWidget);
  });

  testWidgets('paso 2: contraseña débil según el servidor', (tester) async {
    await _abrir(tester, {
      'POST /auth/register/complete': (o) async =>
          json(422, errorJson('weak_password')),
    });
    await _irAlPaso2(tester);
    await _rellenarPaso2(tester);
    await tocar(tester, find.byKey(const Key('reg-completar')));
    expect(find.textContaining('demasiado común'), findsOneWidget);
  });

  testWidgets('Enter en la contraseña completa el registro', (tester) async {
    final app = await _abrir(tester, {
      'POST /auth/register/complete': (o) async => json(201, _auth()),
    });
    await _irAlPaso2(tester);
    await _rellenarPaso2(tester);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    expect(app.adapter.to('/auth/register/complete'), hasLength(1));
  });
}
