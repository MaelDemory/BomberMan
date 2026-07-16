/*
 * PRNG mulberry32 en opérations entières 32 bits uniquement (Math.imul, >>>),
 * pour garantir des résultats identiques sur Node et dans le navigateur.
 * L'état est un simple number JSON-sérialisable, jamais caché dans une closure.
 */

// Parameters
//   state — état PRNG courant (uint32)
// What it does
//   Avance le PRNG mulberry32 d'un pas.
// Output
//   { value, state } — value dans [0, 1), state à passer à l'appel suivant
export function nextRand(state: number): { value: number; state: number } {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}

// Parameters
//   state — état PRNG courant (uint32)
//   n — borne supérieure exclusive
// What it does
//   Tire un entier uniforme dans [0, n).
// Output
//   { value, state } — entier tiré et nouvel état PRNG
export function nextInt(state: number, n: number): { value: number; state: number } {
  const r = nextRand(state);
  return { value: Math.floor(r.value * n), state: r.state };
}
