import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:taskillo/data/generated/exports.dart';

/// Copia local del perfil del usuario, para abrir la app sin red.
abstract interface class ProfileCache {
  Future<User?> read();
  Future<void> write(User user);
  Future<void> clear();
}

class SharedPreferencesProfileCache implements ProfileCache {
  SharedPreferencesProfileCache(this._prefs);

  static const _clave = 'perfil_usuario';
  final SharedPreferences _prefs;

  @override
  Future<User?> read() async {
    final texto = _prefs.getString(_clave);
    if (texto == null) return null;
    try {
      return User.fromJson(jsonDecode(texto) as Map<String, Object?>);
    } on Object {
      // Copia corrupta: se descarta en lugar de bloquear el arranque.
      await _prefs.remove(_clave);
      return null;
    }
  }

  @override
  Future<void> write(User user) =>
      _prefs.setString(_clave, jsonEncode(user.toJson()));

  @override
  Future<void> clear() => _prefs.remove(_clave);
}
