import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:taskillo/core/errores.dart';
import 'package:taskillo/data/generated/exports.dart';
import 'package:taskillo/features/auth/auth_providers.dart';
import 'package:taskillo/features/auth/auth_repository.dart';
import 'package:taskillo/shared/validadores.dart';
import 'package:taskillo/shared/widgets.dart';

/// Perfil: datos de la cuenta, nombre visible, contraseña, dispositivos y
/// cierres de sesión.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formNombre = GlobalKey<FormState>();
  final _formClave = GlobalKey<FormState>();
  late final TextEditingController _nombre;
  final _claveActual = TextEditingController();
  final _claveNueva = TextEditingController();

  // Nombre visible.
  bool _guardandoNombre = false;
  AuthException? _errorNombre;
  bool _nombreGuardado = false;

  // Contraseña.
  bool _guardandoClave = false;
  AuthException? _errorClave;
  String? _errorClaveActual;
  String? _errorClaveNueva;
  bool _claveGuardada = false;

  // Dispositivos.
  bool _cargandoDispositivos = true;
  List<Session> _dispositivos = const [];
  AuthException? _errorDispositivos;
  String? _cerrandoDispositivo;
  AuthException? _errorCierreDispositivo;

  // Cierres de sesión.
  bool _cerrandoSesion = false;
  AuthException? _errorCierre;

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  @override
  void initState() {
    super.initState();
    final s = ref.read(sessionProvider);
    _nombre = TextEditingController(
        text: s is SessionActive ? s.user.displayName : '');
    _cargarDispositivos();
  }

  @override
  void dispose() {
    _nombre.dispose();
    _claveActual.dispose();
    _claveNueva.dispose();
    super.dispose();
  }

  Future<void> _cargarDispositivos() async {
    setState(() {
      _cargandoDispositivos = true;
      _errorDispositivos = null;
    });
    try {
      final lista = await _repo.listSessions();
      if (!mounted) return;
      setState(() {
        _dispositivos = lista;
        _cargandoDispositivos = false;
      });
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _errorDispositivos = e;
        _cargandoDispositivos = false;
      });
    }
  }

  Future<void> _guardarNombre() async {
    if (_guardandoNombre || !_formNombre.currentState!.validate()) return;
    setState(() {
      _guardandoNombre = true;
      _errorNombre = null;
      _nombreGuardado = false;
    });
    try {
      await ref
          .read(sessionProvider.notifier)
          .cambiarNombre(_nombre.text.trim());
      if (!mounted) return;
      setState(() {
        _guardandoNombre = false;
        _nombreGuardado = true;
      });
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _guardandoNombre = false;
        _errorNombre = e;
      });
    }
  }

  Future<void> _cambiarClave() async {
    if (_guardandoClave || !_formClave.currentState!.validate()) return;
    setState(() {
      _guardandoClave = true;
      _errorClave = null;
      _errorClaveActual = null;
      _errorClaveNueva = null;
      _claveGuardada = false;
    });
    try {
      await _repo.changePassword(
        currentPassword: _claveActual.text,
        newPassword: _claveNueva.text,
      );
      if (!mounted) return;
      _claveActual.clear();
      _claveNueva.clear();
      setState(() {
        _guardandoClave = false;
        _claveGuardada = true;
      });
      // El servidor ha cerrado las demás sesiones: se refresca la lista.
      _cargarDispositivos();
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _guardandoClave = false;
        switch (e.code) {
          // 403: la contraseña actual falla, pero la sesión sigue valiendo.
          case 'invalid_credentials':
            _errorClaveActual = 'La contraseña actual no es correcta.';
          case 'weak_password':
            _errorClaveNueva = textoDeError(e);
          default:
            _errorClave = e;
        }
      });
    }
  }

  Future<void> _cerrarDispositivo(Session s) async {
    if (_cerrandoDispositivo != null) return;
    setState(() {
      _cerrandoDispositivo = s.deviceId;
      _errorCierreDispositivo = null;
    });
    try {
      await _repo.closeDeviceSession(s.deviceId);
      if (!mounted) return;
      setState(() => _cerrandoDispositivo = null);
      await _cargarDispositivos();
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _cerrandoDispositivo = null;
        // Si ya no existía, basta con refrescar la lista.
        if (e.code == 'not_found') {
          _cargarDispositivos();
        } else {
          _errorCierreDispositivo = e;
        }
      });
    }
  }

  Future<void> _cerrarLocal() async {
    if (_cerrandoSesion) return;
    setState(() => _cerrandoSesion = true);
    await ref.read(sessionProvider.notifier).cerrarSesion();
  }

  Future<void> _confirmarCerrarTodos() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cerrar sesión en todos los dispositivos'),
        content: const Text(
            'Tendrás que iniciar sesión de nuevo en cada uno, también en este.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const Key('confirmar-cerrar-todos'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cerrar todas las sesiones'),
          ),
        ],
      ),
    );
    if (ok == true && mounted) await _cerrarTodos();
  }

  Future<void> _cerrarTodos() async {
    if (_cerrandoSesion) return;
    setState(() {
      _cerrandoSesion = true;
      _errorCierre = null;
    });
    try {
      await ref.read(sessionProvider.notifier).cerrarSesionEnTodos();
    } on AuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _cerrandoSesion = false;
        _errorCierre = e;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final sesion = ref.watch(sessionProvider);
    final user = sesion is SessionActive ? sesion.user : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                if (user != null) ..._cuenta(user),
                _separador(),
                ..._seccionNombre(),
                _separador(),
                ..._seccionClave(),
                _separador(),
                ..._seccionDispositivos(),
                _separador(),
                ..._seccionSesion(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _separador() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Divider(height: 1),
      );

  Widget _titulo(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Semantics(
          header: true,
          child: Text(t, style: Theme.of(context).textTheme.titleMedium),
        ),
      );

  List<Widget> _cuenta(User user) => [
        _titulo('Cuenta'),
        Text(user.email),
        Text('@${user.username}',
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      ];

  List<Widget> _seccionNombre() => [
        _titulo('Nombre visible'),
        Form(
          key: _formNombre,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                key: const Key('perfil-nombre'),
                controller: _nombre,
                textInputAction: TextInputAction.done,
                validator: validarNombreVisible,
                onFieldSubmitted: (_) => _guardarNombre(),
                onChanged: (_) {
                  if (_nombreGuardado) setState(() => _nombreGuardado = false);
                },
                decoration: const InputDecoration(
                  labelText: 'Nombre visible',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              if (_errorNombre != null) ...[
                AvisoDeError(textoDeError(_errorNombre!),
                    onReintentar:
                        esReintentable(_errorNombre!) ? _guardarNombre : null),
                const SizedBox(height: 12),
              ],
              if (_nombreGuardado) ...[
                const AvisoInformativo('Nombre actualizado.',
                    icono: Icons.check_circle_outline),
                const SizedBox(height: 12),
              ],
              Align(
                alignment: Alignment.centerLeft,
                child: BotonPrincipal(
                  key: const Key('perfil-guardar-nombre'),
                  etiqueta: 'Guardar nombre',
                  enEspera: _guardandoNombre,
                  onPressed: _guardarNombre,
                ),
              ),
            ],
          ),
        ),
      ];

  List<Widget> _seccionClave() => [
        _titulo('Cambiar contraseña'),
        Form(
          key: _formClave,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CampoClave(
                key: const Key('clave-actual'),
                controller: _claveActual,
                etiqueta: 'Contraseña actual',
                textInputAction: TextInputAction.next,
                validator: (v) => (v ?? '').isEmpty
                    ? 'Escribe tu contraseña actual.'
                    : null,
                forceErrorText: _errorClaveActual,
                onChanged: (_) {
                  if (_errorClaveActual != null) {
                    setState(() => _errorClaveActual = null);
                  }
                },
              ),
              const SizedBox(height: 16),
              CampoClave(
                key: const Key('clave-nueva'),
                controller: _claveNueva,
                etiqueta: 'Contraseña nueva',
                ayuda: 'Al menos 10 caracteres.',
                autofillHints: const [AutofillHints.newPassword],
                validator: validarClaveNueva,
                forceErrorText: _errorClaveNueva,
                onChanged: (_) {
                  if (_errorClaveNueva != null) {
                    setState(() => _errorClaveNueva = null);
                  }
                },
                onFieldSubmitted: (_) => _cambiarClave(),
              ),
              const SizedBox(height: 12),
              if (_errorClave != null) ...[
                AvisoDeError(textoDeError(_errorClave!),
                    onReintentar:
                        esReintentable(_errorClave!) ? _cambiarClave : null),
                const SizedBox(height: 12),
              ],
              if (_claveGuardada) ...[
                const AvisoInformativo(
                    'Contraseña cambiada. Hemos cerrado la sesión en tus '
                    'otros dispositivos.',
                    icono: Icons.check_circle_outline),
                const SizedBox(height: 12),
              ],
              Align(
                alignment: Alignment.centerLeft,
                child: BotonPrincipal(
                  key: const Key('clave-guardar'),
                  etiqueta: 'Cambiar contraseña',
                  enEspera: _guardandoClave,
                  onPressed: _cambiarClave,
                ),
              ),
            ],
          ),
        ),
      ];

  List<Widget> _seccionDispositivos() {
    final Widget contenido;
    if (_cargandoDispositivos) {
      contenido = const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: CircularProgressIndicator(
              semanticsLabel: 'Cargando dispositivos'),
        ),
      );
    } else if (_errorDispositivos != null) {
      contenido = AvisoDeError(
        textoDeError(_errorDispositivos!),
        onReintentar: _cargarDispositivos,
      );
    } else if (_dispositivos.isEmpty) {
      contenido = const Text('No hay dispositivos con sesión abierta.');
    } else {
      contenido = Column(
        children: [for (final s in _dispositivos) _filaDispositivo(s)],
      );
    }
    return [
      _titulo('Dispositivos'),
      contenido,
      if (_errorCierreDispositivo != null) ...[
        const SizedBox(height: 12),
        AvisoDeError(textoDeError(_errorCierreDispositivo!)),
      ],
    ];
  }

  Widget _filaDispositivo(Session s) {
    final nombre = s.name ?? _nombrePlataforma(s.platform);
    final cerrando = _cerrandoDispositivo == s.deviceId;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(_icono(s.platform)),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(nombre),
                Text(
                  'Última actividad: ${_fecha(s.lastSeenAt.toLocal())}',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          if (s.current)
            Text('Este dispositivo',
                style: Theme.of(context).textTheme.labelLarge)
          else
            Tooltip(
              message: 'Cerrar sesión en $nombre',
              child: TextButton(
                key: Key('cerrar-${s.deviceId}'),
                onPressed:
                    _cerrandoDispositivo == null ? () => _cerrarDispositivo(s) : null,
                child: cerrando
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, semanticsLabel: 'Cerrando sesión'),
                      )
                    : const Text('Cerrar sesión'),
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _seccionSesion() => [
        _titulo('Sesión'),
        if (_errorCierre != null) ...[
          AvisoDeError(textoDeError(_errorCierre!),
              onReintentar: esReintentable(_errorCierre!) ? _cerrarTodos : null),
          const SizedBox(height: 12),
        ],
        Align(
          alignment: Alignment.centerLeft,
          child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              OutlinedButton(
                key: const Key('cerrar-local'),
                onPressed: _cerrandoSesion ? null : _cerrarLocal,
                child: const Text('Cerrar sesión en este dispositivo'),
              ),
              OutlinedButton(
                key: const Key('cerrar-todos'),
                onPressed: _cerrandoSesion ? null : _confirmarCerrarTodos,
                child: const Text('Cerrar sesión en todos'),
              ),
            ],
          ),
        ),
      ];
}

IconData _icono(SessionPlatform p) => switch (p) {
      SessionPlatform.android => Icons.smartphone,
      _ => Icons.computer,
    };

String _nombrePlataforma(SessionPlatform p) => switch (p) {
      SessionPlatform.android => 'Android',
      SessionPlatform.windows => 'Windows',
      SessionPlatform.linux => 'Linux',
      SessionPlatform.macos => 'macOS',
    };

String _fecha(DateTime d) {
  String dos(int n) => n.toString().padLeft(2, '0');
  return '${dos(d.day)}/${dos(d.month)}/${d.year} ${dos(d.hour)}:${dos(d.minute)}';
}
