/// Origen de la API (sin `/api/v1`). Se fija al compilar con
/// `--dart-define=API_BASE_URL=...`.
const apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://localhost:3000',
);

/// Prefijo de versión de la API.
const apiPrefix = '/api/v1';
