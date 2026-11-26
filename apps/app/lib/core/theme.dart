import 'package:material_ui/material_ui.dart';

const _semilla = Color(0xFF3F6FD8);

ThemeData temaClaro() => ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: _semilla),
      useMaterial3: true,
    );

ThemeData temaOscuro() => ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: _semilla,
        brightness: Brightness.dark,
      ),
      useMaterial3: true,
    );
