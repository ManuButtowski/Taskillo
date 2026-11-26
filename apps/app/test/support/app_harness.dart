import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:taskillo/app.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/data/generated/exports.dart';
import 'package:taskillo/features/auth/auth_providers.dart';

import 'fake_adapter.dart';
import 'fakes.dart';

/// App montada con todo simulado (red, almacén seguro, perfil).
class AppDePrueba {
  AppDePrueba(this.adapter, this.storage, this.cache, this.container);

  final FakeAdapter adapter;
  final MemoryRefreshStorage storage;
  final MemoryProfileCache cache;
  final ProviderContainer container;
}

/// Responde por ruta (`'POST /auth/login'`) con el manejador indicado.
/// Cualquier ruta no declarada falla el test.
Handler rutas(Map<String, Handler> mapa) => (o) async {
      final clave = '${o.method} ${o.path}';
      final h = mapa[clave];
      if (h == null) throw StateError('Petición no prevista: $clave');
      return h(o);
    };

Future<AppDePrueba> montarApp(
  WidgetTester tester, {
  Handler? handler,
  User? usuario,
  String? refresh,
}) async {
  SharedPreferences.setMockInitialValues({});
  // Pantalla de escritorio: así no hace falta desplazar para tocar botones.
  tester.view.physicalSize = const Size(1000, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  final storage = MemoryRefreshStorage(refresh ?? (usuario != null ? 'R0' : null));
  final cache = MemoryProfileCache(usuario);
  final adapter = FakeAdapter(
      handler ?? (o) async => throw StateError('Sin red simulada: ${o.path}'));
  final container = ProviderContainer(overrides: [
    sharedPreferencesProvider
        .overrideWithValue(await SharedPreferences.getInstance()),
    tokenStoreProvider.overrideWithValue(TokenStore(storage)),
    profileCacheProvider.overrideWithValue(cache),
    deviceInfoProvider.overrideWithValue(FakeDeviceInfo()),
    httpAdapterProvider.overrideWithValue(adapter),
  ]);
  addTearDown(container.dispose);

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const TaskilloApp(),
  ));
  await container.read(sessionProvider.notifier).iniciar();
  await tester.pumpAndSettle();
  return AppDePrueba(adapter, storage, cache, container);
}

Future<void> escribir(WidgetTester tester, String clave, String texto) async {
  await tester.enterText(find.byKey(Key(clave)), texto);
}

Future<void> tocar(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}
