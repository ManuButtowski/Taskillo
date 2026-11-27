import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/features/auth/auth_providers.dart';
import 'package:taskillo/features/auth/forgot_password_screen.dart';
import 'package:taskillo/features/auth/login_screen.dart';
import 'package:taskillo/features/auth/register_screen.dart';
import 'package:taskillo/features/home/home_screen.dart';
import 'package:taskillo/features/profile/profile_screen.dart';

const _publicas = {'/entrar', '/registro', '/olvide'};

/// Rutas de la app. La sesión decide a dónde se puede ir: sin sesión, solo las
/// pantallas de cuenta; con sesión, nunca vuelven a verse.
final routerProvider = Provider<GoRouter>((ref) {
  final cambios = ValueNotifier<int>(0);
  ref.listen<SessionState>(sessionProvider, (_, _) => cambios.value++);

  final router = GoRouter(
    initialLocation: '/',
    refreshListenable: cambios,
    redirect: (context, state) {
      final sesion = ref.read(sessionProvider);
      final ruta = state.matchedLocation;
      return switch (sesion) {
        SessionLoading() => ruta == '/cargando' ? null : '/cargando',
        SessionAnonymous() => _publicas.contains(ruta) ? null : '/entrar',
        SessionActive() =>
          (_publicas.contains(ruta) || ruta == '/cargando') ? '/' : null,
      };
    },
    routes: [
      GoRoute(path: '/', builder: (_, _) => const HomeScreen()),
      GoRoute(path: '/cargando', builder: (_, _) => const _Cargando()),
      GoRoute(path: '/entrar', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/registro', builder: (_, _) => const RegisterScreen()),
      GoRoute(path: '/olvide', builder: (_, _) => const ForgotPasswordScreen()),
      GoRoute(path: '/perfil', builder: (_, _) => const ProfileScreen()),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    cambios.dispose();
  });
  return router;
});

class _Cargando extends StatelessWidget {
  const _Cargando();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(
          child: CircularProgressIndicator(semanticsLabel: 'Abriendo Taskillo'),
        ),
      );
}
