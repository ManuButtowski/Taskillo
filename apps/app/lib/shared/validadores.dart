/// Validadores de formulario con textos en español. Devuelven `null` si el
/// valor es válido. Las reglas replican las del servidor (data-model.md).
final _correo = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
final _usuario = RegExp(r'^[a-zA-Z0-9_]{3,30}$');

const contrasenaMinima = 10;

String? validarCorreo(String? v) {
  final t = (v ?? '').trim();
  if (t.isEmpty) return 'Escribe tu correo.';
  if (!_correo.hasMatch(t)) return 'Escribe un correo válido.';
  return null;
}

String? validarClaveLogin(String? v) =>
    (v ?? '').isEmpty ? 'Escribe tu contraseña.' : null;

String? validarClaveNueva(String? v) {
  final t = v ?? '';
  if (t.isEmpty) return 'Escribe una contraseña.';
  if (t.runes.length < contrasenaMinima) {
    return 'La contraseña debe tener al menos $contrasenaMinima caracteres.';
  }
  if (t.runes.length > 128) return 'La contraseña es demasiado larga.';
  return null;
}

String? validarUsuario(String? v) {
  final t = (v ?? '').trim();
  if (t.isEmpty) return 'Escribe un nombre de usuario.';
  if (!_usuario.hasMatch(t)) {
    return 'Usa de 3 a 30 letras, números o guion bajo.';
  }
  return null;
}

String? validarNombreVisible(String? v) {
  final t = (v ?? '').trim();
  if (t.isEmpty) return 'Escribe tu nombre visible.';
  if (t.length > 100) return 'El nombre visible admite hasta 100 caracteres.';
  return null;
}

/// Quita espacios y guiones y pasa a mayúsculas: `abcd-efgh` -> `ABCDEFGH`.
String normalizarCodigo(String v) =>
    v.replaceAll(RegExp(r'[\s-]'), '').toUpperCase();

String? validarCodigo(String? v) {
  final n = normalizarCodigo(v ?? '');
  if (n.length != 8 || !RegExp(r'^[A-Z0-9]+$').hasMatch(n)) {
    return 'El código tiene 8 letras o números.';
  }
  return null;
}

/// Forma con guion para mostrar y enviar: `ABCD-EFGH`.
String codigoConGuion(String v) {
  final n = normalizarCodigo(v);
  return '${n.substring(0, 4)}-${n.substring(4)}';
}
