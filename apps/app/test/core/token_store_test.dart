import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/core/token_store.dart';
import 'package:taskillo/data/generated/exports.dart';

import '../support/fake_adapter.dart';

void main() {
  test('save guarda el refresh en el almacén y el access en memoria', () async {
    final storage = MemoryRefreshStorage();
    final store = TokenStore(storage);
    await store
        .save(Tokens(accessToken: 'A', refreshToken: 'R', expiresIn: 900));
    expect(store.accessToken, 'A');
    expect(storage.value, 'R');
    expect(await store.refreshToken(), 'R');
  });

  test('clear borra ambos', () async {
    final storage = MemoryRefreshStorage('R');
    final store = TokenStore(storage)..accessToken = 'A';
    await store.clear();
    expect(store.accessToken, isNull);
    expect(storage.value, isNull);
  });
}
