// Suelo de tiempo de respuesta: las respuestas que no deben delatar si un correo tiene cuenta o
// código pendiente no salen antes de un tiempo mínimo fijo desde que empieza el procesamiento.

/** Suelo por defecto (ms) de las respuestas del registro que no deben revelar existencia. */
export const REGISTER_MIN_RESPONSE_MS = 50;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Timing {
  clock: Clock;
  floorMs: number;
}

export const defaultTiming: Timing = { clock: systemClock, floorMs: REGISTER_MIN_RESPONSE_MS };

/** Anota el inicio ahora; la función devuelta espera lo que falte hasta cumplir el suelo. */
export function startMinDuration({ clock, floorMs }: Timing): () => Promise<void> {
  const start = clock.now();
  return async () => {
    const remaining = floorMs - (clock.now() - start);
    if (remaining > 0) await clock.sleep(remaining);
  };
}
