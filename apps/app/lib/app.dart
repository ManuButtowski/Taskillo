import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import 'core/router.dart';
import 'core/theme.dart';

class TaskilloApp extends ConsumerWidget {
  const TaskilloApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Taskillo',
      theme: temaClaro(),
      darkTheme: temaOscuro(),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
