import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/core/errores.dart';
import 'package:taskillo/shared/validadores.dart';
import 'package:taskillo/shared/widgets.dart';

import 'auth_providers.dart';
import 'auth_repository.dart';

enum _Paso { correo, enviado, datos }

/// Registro en dos pasos: 1) correo; 2) código, usuario, nombre y contraseña.
class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formCorreo = GlobalKey<FormState>();
  final _formDatos = GlobalKey<FormState>();
  final _correo = TextEditingController();
  final _codigo = TextEditingController();
  final _usuario = TextEditingController();
  final _nombre = TextEditingController();
  final _clave = TextEditingController();

  _Paso _paso = _Paso.correo;
  bool _enviando = false;
  AuthException? _error;
  String? _info;
  // Errores que se marcan en su propio campo.
  String? _errorUsuario;
  String? _errorClave;
  // Acción a repetir con "Reintentar".
  Future<void> Function()? _ultimaAccion;

  @override
  void dispose() {
    for (final c in [_correo, _codigo, _usuario, _nombre, _clave]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _ejecutar(
    Future<void> Function() accion, {
    required void Function() alExito,
  }) async {
    if (_enviando) return;
    setState(() {
      _enviando = true;
      _error = null;
      _info = null;
      _errorUsuario = null;
      _errorClave = null;
      _ultimaAccion = () => _ejecutar(accion, alExito: alExito);
    });
    try {
      await accion();
      if (!mounted) return;
      setState(() {
        _enviando = false;
        alExito();
      });
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _enviando = false;
        switch (e.code) {
          case 'username_taken':
            _errorUsuario = textoDeError(e);
          case 'weak_password':
            _errorClave = textoDeError(e);
          default:
            _error = e;
        }
      });
    }
  }

  Future<void> _pedirCodigo() {
    if (!(_formCorreo.currentState?.validate() ?? true)) {
      return Future.value();
    }
    return _ejecutar(
      () => ref.read(sessionProvider.notifier).pedirCodigo(_correo.text.trim()),
      alExito: () => _paso = _Paso.enviado,
    );
  }

  Future<void> _reenviar({required String aviso}) => _ejecutar(
        () => ref
            .read(sessionProvider.notifier)
            .pedirCodigo(_correo.text.trim()),
        alExito: () => _info = aviso,
      );

  Future<void> _completar() {
    if (!_formDatos.currentState!.validate()) return Future.value();
    return _ejecutar(
      () => ref.read(sessionProvider.notifier).completarRegistro(
            email: _correo.text.trim(),
            code: codigoConGuion(_codigo.text),
            username: _usuario.text.trim(),
            displayName: _nombre.text.trim(),
            password: _clave.text,
          ),
      alExito: () {},
    );
  }

  @override
  Widget build(BuildContext context) {
    final error = _error;
    final cabecera = <Widget>[
      if (error != null) ...[
        AvisoDeError(
          textoDeError(error),
          onReintentar: esReintentable(error) ? _ultimaAccion : null,
        ),
        const SizedBox(height: 16),
      ],
      if (_info != null) ...[
        AvisoInformativo(_info!),
        const SizedBox(height: 16),
      ],
    ];
    return switch (_paso) {
      _Paso.correo => MarcoDeCuenta(
          titulo: 'Crear cuenta',
          children: [...cabecera, _pasoCorreo()],
        ),
      _Paso.enviado => MarcoDeCuenta(
          titulo: 'Te hemos enviado un correo',
          children: [...cabecera, _pasoEnviado()],
        ),
      _Paso.datos => MarcoDeCuenta(
          titulo: 'Completa tu cuenta',
          children: [...cabecera, _pasoDatos()],
        ),
    };
  }

  Widget _pasoCorreo() {
    return Form(
      key: _formCorreo,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
              'Escribe tu correo y te enviaremos un código para confirmarlo.'),
          const SizedBox(height: 16),
          TextFormField(
            key: const Key('reg-correo'),
            controller: _correo,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autofillHints: const [AutofillHints.email],
            autocorrect: false,
            validator: validarCorreo,
            onFieldSubmitted: (_) => _pedirCodigo(),
            decoration: const InputDecoration(
              labelText: 'Correo electrónico',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 24),
          BotonPrincipal(
            key: const Key('reg-pedir'),
            etiqueta: 'Enviar código',
            enEspera: _enviando,
            onPressed: _pedirCodigo,
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _enviando ? null : () => context.go('/entrar'),
            child: const Text('Ya tengo cuenta'),
          ),
        ],
      ),
    );
  }

  Widget _pasoEnviado() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Si ${_correo.text.trim()} es correcto, recibirás en unos '
            'minutos un mensaje con un código. Revisa también la carpeta de '
            'correo no deseado.'),
        const SizedBox(height: 24),
        BotonPrincipal(
          etiqueta: 'Ya tengo el código',
          enEspera: _enviando,
          onPressed: () => setState(() {
            _paso = _Paso.datos;
            _error = null;
            _info = null;
          }),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _enviando
              ? null
              : () => _reenviar(aviso: 'Hemos vuelto a enviar el correo.'),
          child: const Text('Volver a enviar'),
        ),
        TextButton(
          onPressed: _enviando ? null : () => context.go('/entrar'),
          child: const Text('Iniciar sesión'),
        ),
      ],
    );
  }

  Widget _pasoDatos() {
    return Form(
      key: _formDatos,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Escribe el código que hemos enviado a '
                '${_correo.text.trim()} y elige cómo te verán los demás.'),
            const SizedBox(height: 16),
            TextFormField(
              key: const Key('reg-codigo'),
              controller: _codigo,
              textInputAction: TextInputAction.next,
              autocorrect: false,
              enableSuggestions: false,
              textCapitalization: TextCapitalization.characters,
              validator: validarCodigo,
              decoration: const InputDecoration(
                labelText: 'Código',
                helperText: 'Con o sin guion, como prefieras.',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              key: const Key('reg-usuario'),
              controller: _usuario,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.newUsername],
              autocorrect: false,
              enableSuggestions: false,
              validator: validarUsuario,
              forceErrorText: _errorUsuario,
              onChanged: (_) {
                if (_errorUsuario != null) {
                  setState(() => _errorUsuario = null);
                }
              },
              decoration: const InputDecoration(
                labelText: 'Nombre de usuario',
                helperText: 'Letras, números y guion bajo (3 a 30).',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextFormField(
              key: const Key('reg-nombre'),
              controller: _nombre,
              textInputAction: TextInputAction.next,
              autofillHints: const [AutofillHints.name],
              validator: validarNombreVisible,
              decoration: const InputDecoration(
                labelText: 'Nombre visible',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            CampoClave(
              key: const Key('reg-clave'),
              controller: _clave,
              etiqueta: 'Contraseña',
              ayuda: 'Al menos 10 caracteres.',
              autofillHints: const [AutofillHints.newPassword],
              validator: validarClaveNueva,
              forceErrorText: _errorClave,
              onChanged: (_) {
                if (_errorClave != null) setState(() => _errorClave = null);
              },
              onFieldSubmitted: (_) => _completar(),
            ),
            const SizedBox(height: 24),
            BotonPrincipal(
              key: const Key('reg-completar'),
              etiqueta: 'Crear cuenta',
              enEspera: _enviando,
              onPressed: _completar,
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _enviando
                  ? null
                  : () {
                      _codigo.clear();
                      _reenviar(aviso: 'Te hemos enviado un código nuevo.');
                    },
              child: const Text('Pedir otro código'),
            ),
          ],
        ),
      ),
    );
  }
}
