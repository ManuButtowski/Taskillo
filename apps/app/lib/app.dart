import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'core/router.dart';
import 'core/theme.dart';
import 'features/auth/auth_providers.dart';

class TaskilloApp extends ConsumerWidget {
  const TaskilloApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Taskillo',
      theme: temaClaro(),
      darkTheme: temaOscuro(),
      routerConfig: ref.watch(routerProvider),
      builder: (context, child) => Stack(
        children: [
          ?child,
          const _IndicadorDeRenovacion(),
        ],
      ),
    );
  }
}

/// Barra fina arriba del todo mientras se renueva la sesión en segundo plano.
/// No bloquea la interfaz ni intercepta toques.
class _IndicadorDeRenovacion extends ConsumerWidget {
  const _IndicadorDeRenovacion();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(renovandoSesionProvider)) return const SizedBox.shrink();
    return const Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: IgnorePointer(
        child: LinearProgressIndicator(
          minHeight: 3,
          semanticsLabel: 'Renovando la sesión',
        ),
      ),
    );
  }
}
