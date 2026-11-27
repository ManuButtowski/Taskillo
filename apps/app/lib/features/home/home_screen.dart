import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/features/auth/auth_providers.dart';

/// Pantalla principal provisional: saluda al usuario.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final estado = ref.watch(sessionProvider);
    final nombre = estado is SessionActive ? estado.user.displayName : '';
    return Scaffold(
      appBar: AppBar(
        title: const Text('Taskillo'),
        actions: [
          IconButton(
            tooltip: 'Perfil',
            icon: const Icon(Icons.account_circle_outlined),
            onPressed: () => context.push('/perfil'),
          ),
        ],
      ),
      body: Center(
        child: Text('Hola, $nombre',
            style: Theme.of(context).textTheme.headlineSmall),
      ),
    );
  }
}
