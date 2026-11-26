import 'package:flutter_test/flutter_test.dart';

import 'support/app_harness.dart';

void main() {
  testWidgets('La app arranca y, sin sesión, pide iniciar sesión',
      (tester) async {
    await montarApp(tester);
    expect(find.text('Iniciar sesión'), findsWidgets);
  });
}
