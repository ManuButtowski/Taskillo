import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/core/errores.dart';
import 'package:taskillo/shared/validadores.dart';
import 'package:taskillo/shared/widgets.dart';

import 'auth_providers.dart';
import 'auth_repository.dart';

/// "He olvidado mi contraseña": pide el enlace por correo. El enlace del
/// correo abre el navegador del sistema, donde se elige la contraseña nueva.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _correo = TextEditingController();
  bool _enviando = false;
  bool _enviado = false;
  bool _reenviado = false;
  AuthException? _error;

  @override
  void dispose() {
    _correo.dispose();
    super.dispose();
  }

  Future<void> _enviar({bool reenvio = false}) async {
    if (_enviando) return;
    if (!(_form.currentState?.validate() ?? true)) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .requestPasswordReset(_correo.text.trim());
      if (!mounted) return;
      setState(() {
        _enviando = false;
        _enviado = true;
        _reenviado = reenvio;
      });
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _enviando = false;
        _error = e;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return MarcoDeCuenta(
      titulo: _enviado ? 'Revisa tu correo' : 'He olvidado mi contraseña',
      children: [
        if (error != null) ...[
          AvisoDeError(
            textoDeError(error),
            onReintentar:
                esReintentable(error) ? () => _enviar(reenvio: _enviado) : null,
          ),
          const SizedBox(height: 16),
        ],
        if (_enviado) ..._confirmacion() else _formulario(),
      ],
    );
  }

  Widget _formulario() {
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Escribe el correo de tu cuenta y te enviaremos un enlace '
              'para elegir una contraseña nueva.'),
          const SizedBox(height: 16),
          TextFormField(
            key: const Key('olvide-correo'),
            controller: _correo,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            autocorrect: false,
            validator: validarCorreo,
            onFieldSubmitted: (_) => _enviar(),
            decoration: const InputDecoration(
              labelText: 'Correo electrónico',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          BotonPrincipal(
            key: const Key('olvide-enviar'),
            etiqueta: 'Enviar enlace',
            enEspera: _enviando,
            onPressed: _enviar,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _enviando ? null : () => context.go('/entrar'),
            child: const Text('Volver a iniciar sesión'),
          ),
        ],
      ),
    );
  }

  List<Widget> _confirmacion() {
    return [
      // Mismo texto exista o no la cuenta: no se revela nada.
      Text('Si hay una cuenta con ${_correo.text.trim()}, te llegará un '
          'mensaje con un enlace para elegir una contraseña nueva. Ábrelo en '
          'el navegador; caduca en una hora.'),
      if (_reenviado) ...[
        const SizedBox(height: 16),
        const AvisoInformativo('Hemos vuelto a enviar el correo.'),
      ],
      const SizedBox(height: 24),
      BotonPrincipal(
        etiqueta: 'Volver a iniciar sesión',
        onPressed: () => context.go('/entrar'),
      ),
      const SizedBox(height: 8),
      OutlinedButton(
        onPressed: _enviando ? null : () => _enviar(reenvio: true),
        child: _enviando
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2, semanticsLabel: 'Enviando'),
              )
            : const Text('Volver a enviar'),
      ),
    ];
  }
}
