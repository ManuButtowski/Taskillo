import 'package:material_ui/material_ui.dart';

const _semilla = Color(0xFF3F6FD8);

ThemeData temaClaro() => _tema(ColorScheme.fromSeed(seedColor: _semilla));

ThemeData temaOscuro() => _tema(
      ColorScheme.fromSeed(seedColor: _semilla, brightness: Brightness.dark),
    );

/// Tema Material 3. Todo botón mide al menos 48 dp de alto.
ThemeData _tema(ColorScheme esquema) {
  const minimo = Size(64, 48);
  return ThemeData(
    colorScheme: esquema,
    useMaterial3: true,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: minimo),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: minimo),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(minimumSize: minimo),
    ),
  );
}
