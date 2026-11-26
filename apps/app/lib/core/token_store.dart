import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:taskillo/data/generated/exports.dart';

/// Almacén persistente y seguro del refresh token.
abstract interface class RefreshTokenStorage {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> delete();
}

/// Implementación real sobre `flutter_secure_storage` (Credential Locker en
/// Windows, Keystore en Android).
class SecureRefreshTokenStorage implements RefreshTokenStorage {
  SecureRefreshTokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  static const _clave = 'refresh_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _clave);

  @override
  Future<void> write(String token) => _storage.write(key: _clave, value: token);

  @override
  Future<void> delete() => _storage.delete(key: _clave);
}

/// Tokens de la sesión: el de acceso vive solo en memoria; el de renovación,
/// en el almacenamiento seguro.
class TokenStore {
  TokenStore(this._storage);

  final RefreshTokenStorage _storage;
  String? accessToken;

  Future<String?> refreshToken() => _storage.read();

  Future<void> save(Tokens tokens) async {
    accessToken = tokens.accessToken;
    await _storage.write(tokens.refreshToken);
  }

  Future<void> clear() async {
    accessToken = null;
    await _storage.delete();
  }
}
