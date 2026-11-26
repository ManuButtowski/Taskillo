import 'package:material_ui/material_ui.dart';

/// Marco común de las pantallas de cuenta: contenido centrado, con tope de
/// ancho y desplazable (teclado en Android, ventanas pequeñas en Windows).
class MarcoDeCuenta extends StatelessWidget {
  const MarcoDeCuenta({
    super.key,
    required this.titulo,
    required this.children,
    this.leading,
  });

  final String titulo;
  final List<Widget> children;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final texto = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: FocusTraversalGroup(
                policy: OrderedTraversalPolicy(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (leading != null) ...[leading!, const SizedBox(height: 16)],
                    Semantics(
                      header: true,
                      child: Text(titulo, style: texto.headlineSmall),
                    ),
                    const SizedBox(height: 24),
                    ...children,
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Aviso de error en línea, anunciado por los lectores de pantalla. Si hay
/// [onReintentar], ofrece el botón "Reintentar".
class AvisoDeError extends StatelessWidget {
  const AvisoDeError(this.mensaje, {super.key, this.onReintentar});

  final String mensaje;
  final VoidCallback? onReintentar;

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.errorContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: c.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(mensaje, style: TextStyle(color: c.onErrorContainer)),
                  if (onReintentar != null)
                    TextButton(
                      onPressed: onReintentar,
                      child: const Text('Reintentar'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Aviso informativo en línea (sin error).
class AvisoInformativo extends StatelessWidget {
  const AvisoInformativo(this.mensaje, {super.key, this.icono = Icons.info_outline});

  final String mensaje;
  final IconData icono;

  @override
  Widget build(BuildContext context) {
    final c = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: c.secondaryContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icono, color: c.onSecondaryContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(mensaje,
                  style: TextStyle(color: c.onSecondaryContainer)),
            ),
          ],
        ),
      ),
    );
  }
}

/// Botón principal con indicador de espera: mientras [enEspera] no se puede
/// pulsar y muestra un círculo de progreso.
class BotonPrincipal extends StatelessWidget {
  const BotonPrincipal({
    super.key,
    required this.etiqueta,
    required this.onPressed,
    this.enEspera = false,
  });

  final String etiqueta;
  final VoidCallback? onPressed;
  final bool enEspera;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: enEspera ? null : onPressed,
      child: enEspera
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                semanticsLabel: 'Enviando',
              ),
            )
          : Text(etiqueta),
    );
  }
}

/// Campo de contraseña con botón para mostrar u ocultar el texto.
class CampoClave extends StatefulWidget {
  const CampoClave({
    super.key,
    required this.controller,
    required this.etiqueta,
    this.validator,
    this.onFieldSubmitted,
    this.textInputAction = TextInputAction.done,
    this.autofillHints = const [AutofillHints.password],
    this.forceErrorText,
    this.onChanged,
    this.enabled = true,
    this.ayuda,
  });

  final TextEditingController controller;
  final String etiqueta;
  final FormFieldValidator<String>? validator;
  final ValueChanged<String>? onFieldSubmitted;
  final TextInputAction textInputAction;
  final Iterable<String> autofillHints;
  final String? forceErrorText;
  final ValueChanged<String>? onChanged;
  final bool enabled;
  final String? ayuda;

  @override
  State<CampoClave> createState() => _CampoClaveState();
}

class _CampoClaveState extends State<CampoClave> {
  bool _oculta = true;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      enabled: widget.enabled,
      obscureText: _oculta,
      autocorrect: false,
      enableSuggestions: false,
      textInputAction: widget.textInputAction,
      autofillHints: widget.autofillHints,
      forceErrorText: widget.forceErrorText,
      onChanged: widget.onChanged,
      onFieldSubmitted: widget.onFieldSubmitted,
      validator: widget.validator,
      decoration: InputDecoration(
        labelText: widget.etiqueta,
        helperText: widget.ayuda,
        border: const OutlineInputBorder(),
        suffixIcon: IconButton(
          tooltip: _oculta ? 'Mostrar contraseña' : 'Ocultar contraseña',
          icon: Icon(_oculta ? Icons.visibility_outlined : Icons.visibility_off_outlined),
          onPressed: () => setState(() => _oculta = !_oculta),
        ),
      ),
    );
  }
}
