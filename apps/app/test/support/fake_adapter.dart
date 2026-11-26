import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:taskillo/core/token_store.dart';

typedef Handler = Future<ResponseBody> Function(RequestOptions options);

/// Adaptador de dio simulado: registra las peticiones y responde con [handler].
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  Handler handler;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    requests.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}

  Iterable<RequestOptions> to(String path) =>
      requests.where((r) => r.path.endsWith(path));
}

ResponseBody json(int status, Object body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );

Map<String, Object> tokensJson(String access, String refresh) => {
      'accessToken': access,
      'refreshToken': refresh,
      'expiresIn': 900,
    };

Map<String, Object> errorJson(String code) => {
      'error': {'code': code, 'message': 'msg'},
    };

Map<String, Object> userJson() => {
      'id': 'u1',
      'email': 'ana@ejemplo.com',
      'username': 'ana',
      'displayName': 'Ana',
      'timezone': 'Europe/Madrid',
    };

class MemoryRefreshStorage implements RefreshTokenStorage {
  MemoryRefreshStorage([this.value]);
  String? value;

  @override
  Future<String?> read() async => value;
  @override
  Future<void> write(String token) async => value = token;
  @override
  Future<void> delete() async => value = null;
}
