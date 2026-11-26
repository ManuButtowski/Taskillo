import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/shared/widgets.dart';

void main() {
  Future<void> montar(WidgetTester tester) => tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: CampoClave(
              controller: TextEditingController(text: 'secreta-123'),
              etiqueta: 'Contraseña'),
        ),
      ));

  EditableText campo(WidgetTester tester) =>
      tester.widget<EditableText>(find.byType(EditableText));

  testWidgets('oculta el texto por defecto y sin sugerencias ni autocorrección',
      (tester) async {
    await montar(tester);
    final c = campo(tester);
    expect(c.obscureText, isTrue);
    expect(c.autocorrect, isFalse);
    expect(c.enableSuggestions, isFalse);
  });

  testWidgets('el botón de mostrar contraseña alterna la visibilidad',
      (tester) async {
    await montar(tester);
    await tester.tap(find.byTooltip('Mostrar contraseña'));
    await tester.pump();
    expect(campo(tester).obscureText, isFalse);
    // Mostrarla no activa sugerencias ni autocorrección.
    expect(campo(tester).autocorrect, isFalse);
    expect(campo(tester).enableSuggestions, isFalse);
    await tester.tap(find.byTooltip('Ocultar contraseña'));
    await tester.pump();
    expect(campo(tester).obscureText, isTrue);
  });
}
