import 'package:taskillo/features/auth/auth_repository.dart';

/// Textos de interfaz por código de error de la API (contracts/api.md).
/// Se decide por `code` y por el estado HTTP, nunca por el mensaje del
/// servidor.
String textoDeError(AuthException e) {
  if (e.code == 'network') return _sinConexion;
  if ((e.status ?? 0) >= 500 || e.code == 'internal_error') {
    return 'El servidor tiene un problema ahora mismo. '
        'Inténtalo de nuevo en unos minutos.';
  }
  return switch (e.code) {
    'invalid_credentials' => 'Correo o contraseña incorrectos.',
    'invalid_code' => 'El código no es válido o ha caducado.',
    'invalid_token' => 'El enlace no es válido o ha caducado.',
    'username_taken' => 'Ese nombre de usuario ya está en uso.',
    'email_taken' => 'Ya existe una cuenta con ese correo. Inicia sesión.',
    'weak_password' => textoContrasenaDebil,
    'validation_error' || 'invalid_json' || 'bad_request' =>
      'Revisa los datos: alguno no es válido.',
    'rate_limited' =>
      'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
    'not_found' => 'No se ha encontrado lo que buscabas. Puede que ya no exista.',
    'unauthorized' || 'invalid_refresh_token' =>
      'Tu sesión ha caducado. Inicia sesión de nuevo.',
    _ => 'Ha ocurrido un error inesperado. Inténtalo de nuevo.',
  };
}

const _sinConexion = 'Hace falta conexión para continuar. '
    'Comprueba tu red; si la tienes, puede que el servidor no responda.';

const textoContrasenaDebil =
    'La contraseña es demasiado corta o demasiado común. '
    'Usa al menos 10 caracteres y evita contraseñas habituales.';

/// Errores que tiene sentido reintentar tal cual (red o servidor).
bool esReintentable(AuthException e) =>
    e.code == 'network' ||
    e.code == 'internal_error' ||
    (e.status ?? 0) >= 500;
