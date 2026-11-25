import { v7 as uuidv7 } from 'uuid';
import type { buildTestApp } from './app.js';
import { codeFrom, postJson } from './http.js';

export const PASSWORD = 'una-contrasena-larga-y-rara-7391';

export interface Account {
  email: string;
  password: string;
  username: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
}

let nextIp = 1;
/** IP distinta en cada llamada, para que los límites por IP no interfieran entre pasos de preparación. */
export const freshIp = () => ({
  'x-forwarded-for': `172.16.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`,
});

/** Crea una cuenta recorriendo los dos pasos del registro con la API real. */
export async function registerAccount(
  t: ReturnType<typeof buildTestApp>,
  email: string,
  options: { username?: string; password?: string; platform?: string; deviceName?: string } = {},
): Promise<Account> {
  const username = options.username ?? email.split('@')[0]!.replace(/[^a-z0-9_]/gi, '_');
  const password = options.password ?? PASSWORD;
  await postJson(t.app, '/auth/register', { email }, freshIp());
  const code = codeFrom(t.mailer.last());
  const deviceId = uuidv7();
  const res = await postJson(
    t.app,
    '/auth/register/complete',
    {
      email,
      code,
      username,
      displayName: 'Nombre Visible',
      password,
      device: { id: deviceId, platform: options.platform ?? 'windows', name: options.deviceName ?? 'Portátil' },
    },
    freshIp(),
  );
  if (res.status !== 201) throw new Error(`registro de ${email} falló: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    user: { id: string };
    tokens: { accessToken: string; refreshToken: string };
  };
  return {
    email,
    password,
    username,
    userId: json.user.id,
    deviceId,
    accessToken: json.tokens.accessToken,
    refreshToken: json.tokens.refreshToken,
  };
}

export function loginBody(account: Pick<Account, 'email' | 'password'>, device: Record<string, unknown> = {}) {
  return {
    email: account.email,
    password: account.password,
    device: { id: uuidv7(), platform: 'android', name: 'Móvil', ...device },
  };
}
