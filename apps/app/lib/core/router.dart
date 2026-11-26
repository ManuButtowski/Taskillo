import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

/// Rutas de la app. Por ahora solo hay una pantalla vacía; las pantallas de
/// cuenta llegan en el bloque 6.
GoRouter crearRouter() => GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const Scaffold(
            body: Center(child: Text('Taskillo')),
          ),
        ),
      ],
    );
