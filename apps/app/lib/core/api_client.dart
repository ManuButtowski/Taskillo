import 'dart:async';

import 'package:dio/dio.dart';
import 'package:taskillo/data/generated/exports.dart';

import 'config.dart';
import 'token_store.dart';

/// Marca una petición como pública (sin Bearer y sin renovación en 401).
const extraPublica = 'publica';

const _extraReintentada = 'reintentada';

/// Crea el cliente HTTP de la API con renovación transparente de sesión.
Dio crearApiClient({
  required String baseUrl,
  required TokenStore tokens,
  required void Function() onSesionCaducada,
  HttpClientAdapter? adapter,
}) {
  final opciones = BaseOptions(
    baseUrl: '$baseUrl$apiPrefix',
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 20),
    contentType: Headers.jsonContentType,
  );
  final dio = Dio(opciones);
  // El cliente de renovación no lleva el interceptor: así no puede recursar.
  final dioRenovar = Dio(opciones);
  if (adapter != null) {
    dio.httpClientAdapter = adapter;
    dioRenovar.httpClientAdapter = adapter;
  }
  dio.interceptors.add(_AuthInterceptor(
    dio: dio,
    dioRenovar: dioRenovar,
    tokens: tokens,
    onSesionCaducada: onSesionCaducada,
  ));
  return dio;
}

/// Resultado de un intento de renovación.
enum _Renovacion { ok, caducada, fallo }

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor({
    required this.dio,
    required this.dioRenovar,
    required this.tokens,
    required this.onSesionCaducada,
  });

  final Dio dio;
  final Dio dioRenovar;
  final TokenStore tokens;
  final void Function() onSesionCaducada;

  /// Cerrojo: una sola renovación a la vez; el resto de peticiones la esperan.
  Future<_Renovacion>? _renovando;
  DioException? _ultimoFalloRed;

  bool _esPublica(RequestOptions o) => o.extra[extraPublica] == true;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final access = tokens.accessToken;
    if (!_esPublica(options) && access != null) {
      options.headers['Authorization'] = 'Bearer $access';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
      DioException err, ErrorInterceptorHandler handler) async {
    final o = err.requestOptions;
    if (err.response?.statusCode != 401 ||
        _esPublica(o) ||
        o.extra[_extraReintentada] == true) {
      return handler.next(err);
    }

    final usado = o.headers['Authorization'];
    final actual = tokens.accessToken;
    // Si otra petición ya renovó mientras esta volaba, basta con reintentar.
    if (actual != null && usado != 'Bearer $actual') {
      return _reintentar(o, err, handler);
    }

    final resultado = await (_renovando ??= _renovar().whenComplete(() {
      _renovando = null;
    }));
    switch (resultado) {
      case _Renovacion.ok:
        return _reintentar(o, err, handler);
      case _Renovacion.caducada:
        return handler.next(err);
      case _Renovacion.fallo:
        // Sin red o error del servidor: la sesión sigue; se informa del fallo.
        return handler.next(_ultimoFalloRed ?? err);
    }
  }

  Future<void> _reintentar(RequestOptions o, DioException original,
      ErrorInterceptorHandler handler) async {
    final nuevo = o.copyWith(
      headers: {...o.headers, 'Authorization': 'Bearer ${tokens.accessToken}'},
      extra: {...o.extra, _extraReintentada: true},
    );
    try {
      handler.resolve(await dio.fetch<Object?>(nuevo));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<_Renovacion> _renovar() async {
    _ultimoFalloRed = null;
    final refresh = await tokens.refreshToken();
    if (refresh == null) {
      await tokens.clear();
      onSesionCaducada();
      return _Renovacion.caducada;
    }
    try {
      final r = await dioRenovar.post<Map<String, Object?>>(
        '/auth/refresh',
        data: RefreshRequest(refreshToken: refresh).toJson(),
      );
      final nuevos = RefreshResponse.fromJson(r.data!).tokens;
      await tokens.save(nuevos);
      return _Renovacion.ok;
    } on DioException catch (e) {
      final data = e.response?.data;
      final codigo = data is Map && data['error'] is Map
          ? (data['error'] as Map)['code']
          : null;
      if (e.response?.statusCode == 401 && codigo == 'invalid_refresh_token') {
        await tokens.clear();
        onSesionCaducada();
        return _Renovacion.caducada;
      }
      _ultimoFalloRed = e;
      return _Renovacion.fallo;
    }
  }
}
