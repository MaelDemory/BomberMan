import { describe, expect, it } from 'vitest';
import type { InputState, PlayerId } from '../src/index';
import { createGame, EMPTY_INPUT, nextInt, predictMove, step } from '../src/index';

// La prédiction client n'a de valeur que si elle reproduit exactement le
// mouvement calculé par le serveur : toute divergence = rubber-banding.
describe('parité prédiction / simulation', () => {
  it('predictMove reproduit step() tick par tick sur 200 ticks de déplacements', () => {
    let state = createGame(77, ['a', 'b']);
    let rng = 0xfeed;

    for (let t = 0; t < 200; t++) {
      const r = nextInt(rng, 16);
      rng = r.state;
      // Mouvements seuls (pas de bombe) : sans explosion ni pose, le seul
      // écart possible entre step() et predictMove serait un bug de mouvement.
      const input: InputState = {
        up: (r.value & 1) !== 0,
        down: (r.value & 2) !== 0,
        left: (r.value & 4) !== 0,
        right: (r.value & 8) !== 0,
        bomb: false,
      };

      const me = state.players[0];
      const predicted = predictMove(state, 'a', { x: me.x, y: me.y, dir: me.dir }, input);
      state = step(state, { a: input } as Record<PlayerId, InputState>);
      const after = state.players[0];

      expect(predicted).not.toBeNull();
      expect({ x: predicted!.x, y: predicted!.y, dir: predicted!.dir }).toEqual({
        x: after.x,
        y: after.y,
        dir: after.dir,
      });
    }
  });

  it('retourne null pour un joueur mort et ne mute pas l’état de référence', () => {
    const dead = createGame(5, ['a', 'b']);
    dead.players[0].alive = false;
    expect(predictMove(dead, 'a', { x: 24, y: 24, dir: 'down' }, EMPTY_INPUT)).toBeNull();

    const alive = createGame(5, ['a', 'b']);
    const snapshot = JSON.stringify(alive);
    predictMove(alive, 'a', { x: 24, y: 24, dir: 'down' }, { ...EMPTY_INPUT, right: true });
    expect(JSON.stringify(alive)).toBe(snapshot);
  });
});
