import type { Clock } from '../../src/lib/min-duration.js';

/** Reloj falso: el tiempo solo avanza con `advance` o `sleep`, y `sleep` no espera de verdad. */
export class FakeClock implements Clock {
  time = 0;
  sleeps: number[] = [];
  now() {
    return this.time;
  }
  advance(ms: number) {
    this.time += ms;
  }
  async sleep(ms: number) {
    this.sleeps.push(ms);
    this.time += ms;
  }
}
