/** ¿Es (o envuelve) una violación de unicidad de postgres (23505), opcionalmente de una restricción concreta? */
export function isUniqueViolation(err: unknown, constraint?: string | string[]): boolean {
  const names = constraint === undefined ? undefined : Array.isArray(constraint) ? constraint : [constraint];
  // Drizzle envuelve el error de postgres en DrizzleQueryError (cause).
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505' && (!names || (pg.constraint_name && names.includes(pg.constraint_name)))) {
      return true;
    }
  }
  return false;
}
