import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/core/router.dart';

import '../support/app_harness.dart';
import '../support/fake_adapter.dart';
import '../support/fakes.dart';

void main() {
  testWidgets('sin sesión, /perfil redirige al inicio de sesión', (tester) async {
    final app = await montarApp(tester);
    app.container.read(routerProvider).go('/perfil');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
    expect(find.text('Perfil'), findsNothing);
  });

  testWidgets('sin sesión, la principal también redirige al login',
      (tester) async {
    final app = await montarApp(tester);
    app.container.read(routerProvider).go('/');
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('login-correo')), findsOneWidget);
  });

  testWidgets('con sesión, /entrar y /registro redirigen a la principal',
      (tester) async {
    final app = await montarApp(tester, usuario: usuarioEjemplo());
    final router = app.container.read(routerProvider);
    for (final ruta in ['/entrar', '/registro', '/olvide']) {
      router.go(ruta);
      await tester.pumpAndSettle();
      expect(find.text('Hola, Ana'), findsOneWidget, reason: ruta);
      expect(find.byKey(const Key('login-correo')), findsNothing);
    }
  });

  testWidgets('con sesión, /perfil sigue accesible', (tester) async {
    final app = await montarApp(tester,
        usuario: usuarioEjemplo(),
        handler: rutas({
          'GET /me/sessions': (o) async => json(200, {'sessions': []}),
        }));
    app.container.read(routerProvider).go('/perfil');
    await tester.pumpAndSettle();
    expect(find.text('Dispositivos'), findsOneWidget);
  });
}
