import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'features/auth/auth_providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(overrides: [
    sharedPreferencesProvider.overrideWithValue(prefs),
  ]);
  // Lee la sesión guardada sin esperar al servidor.
  container.read(sessionProvider.notifier).iniciar();
  runApp(UncontrolledProviderScope(
    container: container,
    child: const TaskilloApp(),
  ));
}
