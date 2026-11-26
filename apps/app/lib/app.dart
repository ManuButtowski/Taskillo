import 'package:material_ui/material_ui.dart';

import 'core/router.dart';
import 'core/theme.dart';

class TaskilloApp extends StatelessWidget {
  const TaskilloApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Taskillo',
      theme: temaClaro(),
      darkTheme: temaOscuro(),
      routerConfig: crearRouter(),
    );
  }
}
