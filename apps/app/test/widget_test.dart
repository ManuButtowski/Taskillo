import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:taskillo/app.dart';

void main() {
  testWidgets('La app arranca y muestra la pantalla inicial', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: TaskilloApp()));
    await tester.pumpAndSettle();
    expect(find.text('Taskillo'), findsOneWidget);
  });
}
