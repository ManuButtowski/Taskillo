import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/data/generated/exports.dart';

void main() {
  test('los modelos generados leen la respuesta de login del contrato', () {
    final r = AuthResponse.fromJson({
      'user': {
        'id': 'u1',
        'email': 'a@b.com',
        'username': 'ana',
        'displayName': 'Ana',
        'timezone': 'Europe/Madrid',
      },
      'tokens': {'accessToken': 'a', 'refreshToken': 'r', 'expiresIn': 900},
    });
    expect(r.user.username, 'ana');
    expect(r.tokens.expiresIn, 900);
  });

  test('el formato de error del contrato se lee con código y mensaje', () {
    final e = Error2.fromJson({
      'error': {'code': 'device_id_conflict', 'message': 'x'},
    });
    expect(e.error.code, 'device_id_conflict');
  });
}
