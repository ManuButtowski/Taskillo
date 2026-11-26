import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/core/errores.dart';
import 'package:taskillo/shared/validadores.dart';
import 'package:taskillo/shared/widgets.dart';

import 'auth_providers.dart';
import 'auth_repository.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _correo = TextEditingController();
  final _clave = TextEditingController();
  bool _enviando = false;
  AuthException? _error;

  @override
  void dispose() {
    _correo.dispose();
    _clave.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (_enviando) return;
    if (!_form.currentState!.validate()) return;
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref
          .read(sessionProvider.notifier)
          .iniciarSesion(_correo.text.trim(), _clave.text);
      // El router lleva a la pantalla principal al cambiar la sesión.
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _enviando = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    return MarcoDeCuenta(
      titulo: 'Iniciar sesión',
      children: [
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (error != null) ...[
                  AvisoDeError(
                    textoDeError(error),
                    onReintentar: esReintentable(error) ? _enviar : null,
                  ),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  key: const Key('login-correo'),
                  controller: _correo,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  autocorrect: false,
                  validator: validarCorreo,
                  decoration: const InputDecoration(
                    labelText: 'Correo electrónico',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                CampoClave(
                  key: const Key('login-clave'),
                  controller: _clave,
                  etiqueta: 'Contraseña',
                  validator: validarClaveLogin,
                  onFieldSubmitted: (_) => _enviar(),
                ),
                const SizedBox(height: 24),
                BotonPrincipal(
                  key: const Key('login-enviar'),
                  etiqueta: 'Iniciar sesión',
                  enEspera: _enviando,
                  onPressed: _enviar,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _enviando ? null : () => context.go('/registro'),
          child: const Text('Crear cuenta'),
        ),
      ],
    );
  }
}
