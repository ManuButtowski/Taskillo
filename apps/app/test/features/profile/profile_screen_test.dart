import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/features/auth/auth_providers.dart';

import '../../support/app_harness.dart';
import '../../support/fake_adapter.dart';
import '../../support/fakes.dart';

Map<String, Object> _sesion(String id, String nombre,
        {bool actual = false, String plataforma = 'windows'}) =>
    {
      'deviceId': id,
      'platform': plataforma,
      'name': nombre,
      'lastSeenAt': '2026-11-20T10:00:00.000Z',
      'createdAt': '2026-11-01T10:00:00.000Z',
      'current': actual,
    };

List<Map<String, Object>> _dispositivos() => [
      _sesion('d-1', 'PC de Ana', actual: true),
      _sesion('d-2', 'Móvil de Ana', plataforma: 'android'),
    ];

Map<String, Object> _lista(List<Map<String, Object>> s) => {'sessions': s};

/// Abre la app con sesión y entra en el perfil.
Future<AppDePrueba> _perfil(
  WidgetTester tester,
  Map<String, Handler> extra, {
  List<Map<String, Object>>? dispositivos,
}) async {
  final app = await montarApp(tester,
      usuario: usuarioEjemplo(),
      handler: rutas({
        'GET /me/sessions': (o) async =>
            json(200, _lista(dispositivos ?? _dispositivos())),
        'POST /auth/logout': (o) async => ResponseBody.fromString('', 204),
        ...extra,
      }));
  await tocar(tester, find.byTooltip('Perfil'));
  return app;
}

Map _cuerpo(RequestOptions o) {
  final d = o.data;
  return (d is String ? jsonDecode(d) : d) as Map;
}

void main() {
  testWidgets('desde la principal se abre el perfil con los datos de la cuenta',
      (tester) async {
    await _perfil(tester, {});
    expect(find.text('Perfil'), findsWidgets);
    expect(find.text('ana@ejemplo.com'), findsOneWidget);
    expect(find.text('@ana'), findsOneWidget);
    expect(find.byKey(const Key('perfil-nombre')), findsOneWidget);
  });

  testWidgets('lista los dispositivos y marca "Este dispositivo"',
      (tester) async {
    await _perfil(tester, {});
    expect(find.text('PC de Ana'), findsOneWidget);
    expect(find.text('Móvil de Ana'), findsOneWidget);
    expect(find.text('Este dispositivo'), findsOneWidget);
    // Solo el otro dispositivo tiene botón propio de cierre.
    expect(find.byKey(const Key('cerrar-d-2')), findsOneWidget);
    expect(find.byKey(const Key('cerrar-d-1')), findsNothing);
  });

  testWidgets('la lista muestra estado de carga y error con reintento',
      (tester) async {
    var falla = true;
    await _perfil(tester, {
      'GET /me/sessions': (o) async {
        if (falla) {
          throw DioException.connectionError(
              requestOptions: o, reason: 'sin red');
        }
        return json(200, _lista(_dispositivos()));
      },
    });
    expect(find.textContaining('Hace falta conexión'), findsOneWidget);
    falla = false;
    await tocar(tester, find.text('Reintentar'));
    expect(find.text('Móvil de Ana'), findsOneWidget);
  });

  testWidgets('cambiar el nombre visible lo actualiza en la cuenta',
      (tester) async {
    final app = await _perfil(tester, {
      'PATCH /me': (o) async => json(200, {
            'user': {...userJson(), 'displayName': 'Ana María'}
          }),
    });
    await escribir(tester, 'perfil-nombre', 'Ana María');
    await tocar(tester, find.byKey(const Key('perfil-guardar-nombre')));
    expect(find.text('Nombre actualizado.'), findsOneWidget);
    expect(_cuerpo(app.adapter.to('/me').single)['displayName'], 'Ana María');
    expect(app.cache.user!.displayName, 'Ana María');
    final s = app.container.read(sessionProvider) as SessionActive;
    expect(s.user.displayName, 'Ana María');
  });

  testWidgets('el nombre visible vacío no se envía', (tester) async {
    final app = await _perfil(tester, {});
    await escribir(tester, 'perfil-nombre', '  ');
    await tocar(tester, find.byKey(const Key('perfil-guardar-nombre')));
    expect(find.text('Escribe tu nombre visible.'), findsOneWidget);
    expect(app.adapter.to('/me'), isEmpty);
  });

  testWidgets('cambiar la contraseña: éxito, avisa y limpia los campos',
      (tester) async {
    final app = await _perfil(tester, {
      'POST /me/password': (o) async => ResponseBody.fromString('', 204),
    });
    await escribir(tester, 'clave-actual', 'la-clave-vieja-1');
    await escribir(tester, 'clave-nueva', 'la-clave-nueva-22');
    await tocar(tester, find.byKey(const Key('clave-guardar')));
    expect(find.textContaining('Contraseña cambiada'), findsOneWidget);
    final m = _cuerpo(app.adapter.to('/me/password').single);
    expect(m['currentPassword'], 'la-clave-vieja-1');
    expect(m['newPassword'], 'la-clave-nueva-22');
    // La sesión de este dispositivo sigue abierta.
    expect(app.container.read(sessionProvider), isA<SessionActive>());
    expect(find.text('la-clave-vieja-1'), findsNothing);
  });

  testWidgets('contraseña actual errónea (403): se marca en su campo y no '
      'cierra la sesión', (tester) async {
    final app = await _perfil(tester, {
      'POST /me/password': (o) async =>
          json(403, errorJson('invalid_credentials')),
    });
    await escribir(tester, 'clave-actual', 'no-es-esta-1234');
    await escribir(tester, 'clave-nueva', 'la-clave-nueva-22');
    await tocar(tester, find.byKey(const Key('clave-guardar')));
    expect(find.text('La contraseña actual no es correcta.'), findsOneWidget);
    expect(app.container.read(sessionProvider), isA<SessionActive>());
    expect(app.storage.value, isNotNull);
  });

  testWidgets('contraseña nueva débil según el servidor (422)',
      (tester) async {
    await _perfil(tester, {
      'POST /me/password': (o) async => json(422, errorJson('weak_password')),
    });
    await escribir(tester, 'clave-actual', 'la-clave-vieja-1');
    await escribir(tester, 'clave-nueva', 'passwordpassword');
    await tocar(tester, find.byKey(const Key('clave-guardar')));
    expect(find.textContaining('demasiado común'), findsOneWidget);
  });

  testWidgets('validación local de la contraseña', (tester) async {
    final app = await _perfil(tester, {});
    await tocar(tester, find.byKey(const Key('clave-guardar')));
    expect(find.text('Escribe tu contraseña actual.'), findsOneWidget);
    expect(find.text('Escribe una contraseña.'), findsOneWidget);
    await escribir(tester, 'clave-actual', 'la-clave-vieja-1');
    await escribir(tester, 'clave-nueva', 'corta');
    await tocar(tester, find.byKey(const Key('clave-guardar')));
    expect(find.text('La contraseña debe tener al menos 10 caracteres.'),
        findsOneWidget);
    expect(app.adapter.to('/me/password'), isEmpty);
  });

  testWidgets('cerrar sesión en otro dispositivo lo quita de la lista',
      (tester) async {
    var borrado = false;
    final app = await _perfil(tester, {
      'GET /me/sessions': (o) async => json(
          200,
          _lista(borrado
              ? [_sesion('d-1', 'PC de Ana', actual: true)]
              : _dispositivos())),
      'DELETE /me/sessions/d-2': (o) async {
        borrado = true;
        return ResponseBody.fromString('', 204);
      },
    });
    await tocar(tester, find.byKey(const Key('cerrar-d-2')));
    expect(app.adapter.to('/me/sessions/d-2'), hasLength(1));
    expect(find.text('Móvil de Ana'), findsNothing);
    expect(find.text('PC de Ana'), findsOneWidget);
  });

  testWidgets('cerrar sesión en todos pide confirmación y vuelve al login',
      (tester) async {
    final app = await _perfil(tester, {
      'POST /auth/logout-all': (o) async => ResponseBody.fromString('', 204),
    });
    await tocar(tester, find.byKey(const Key('cerrar-todos')));
    // Cancelar no hace nada.
    await tocar(tester, find.text('Cancelar'));
    expect(app.adapter.to('/auth/logout-all'), isEmpty);
    await tocar(tester, find.byKey(const Key('cerrar-todos')));
    await tocar(tester, find.byKey(const Key('confirmar-cerrar-todos')));
    expect(app.adapter.to('/auth/logout-all'), hasLength(1));
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
    expect(app.storage.value, isNull);
    expect(app.cache.user, isNull);
  });

  testWidgets('cerrar sesión en todos sin red: avisa y no cierra la sesión',
      (tester) async {
    final app = await _perfil(tester, {
      'POST /auth/logout-all': (o) async => throw DioException.connectionError(
          requestOptions: o, reason: 'sin red'),
    });
    await tocar(tester, find.byKey(const Key('cerrar-todos')));
    await tocar(tester, find.byKey(const Key('confirmar-cerrar-todos')));
    expect(find.textContaining('Hace falta conexión'), findsOneWidget);
    expect(app.container.read(sessionProvider), isA<SessionActive>());
  });

  testWidgets('cerrar sesión en este dispositivo borra lo local y va al login',
      (tester) async {
    final app = await _perfil(tester, {});
    await tocar(tester, find.byKey(const Key('cerrar-local')));
    expect(app.adapter.to('/auth/logout'), hasLength(1));
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
    expect(app.storage.value, isNull);
    expect(app.cache.user, isNull);
  });

  testWidgets('cerrar sesión local funciona aunque no haya red',
      (tester) async {
    final app = await _perfil(tester, {
      'POST /auth/logout': (o) async => throw DioException.connectionError(
          requestOptions: o, reason: 'sin red'),
    });
    await tocar(tester, find.byKey(const Key('cerrar-local')));
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
    expect(app.storage.value, isNull);
  });
}
