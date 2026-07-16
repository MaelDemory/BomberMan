import { describe, expect, it } from 'vitest';
import type { InputState, PlayerId } from '../src/index';
import { createGame, nextInt, step } from '../src/index';

// Génère une séquence d'inputs pseudo-aléatoire mais reproductible,
// pilotée par le même PRNG que la sim.
function scriptedInputs(seed: number, ids: PlayerId[], ticks: number): Record<PlayerId, InputState>[] {
  let rng = seed;
  const frames: Record<PlayerId, InputState>[] = [];
  for (let t = 0; t < ticks; t++) {
    const frame: Record<PlayerId, InputState> = {};
    for (const id of ids) {
      const r = nextInt(rng, 32);
      rng = r.state;
      frame[id] = {
        up: (r.value & 1) !== 0,
        down: (r.value & 2) !== 0,
        left: (r.value & 4) !== 0,
        right: (r.value & 8) !== 0,
        bomb: (r.value & 16) !== 0,
      };
    }
    frames.push(frame);
  }
  return frames;
}

function run(seed: number, ids: PlayerId[], frames: Record<PlayerId, InputState>[]) {
  let state = createGame(seed, ids);
  for (const frame of frames) state = step(state, frame);
  return state;
}

describe('déterminisme', () => {
  it('même seed + mêmes inputs ⇒ états finaux strictement égaux', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const frames = scriptedInputs(0xc0ffee, ids, 600);
    const s1 = run(42, ids, frames);
    const s2 = run(42, ids, frames);
    expect(s2).toEqual(s1);
  });

  it("l'état survit à un aller-retour JSON sans dérive", () => {
    const ids = ['a', 'b'];
    const frames = scriptedInputs(7, ids, 300);
    let direct = createGame(99, ids);
    let roundTripped = createGame(99, ids);
    for (const frame of frames) {
      direct = step(direct, frame);
      roundTripped = step(JSON.parse(JSON.stringify(roundTripped)), frame);
    }
    expect(roundTripped).toEqual(direct);
  });

  it('des seeds différentes produisent des grilles différentes', () => {
    const a = createGame(1, ['a', 'b']);
    const b = createGame(2, ['a', 'b']);
    expect(a.grid).not.toEqual(b.grid);
  });
});
