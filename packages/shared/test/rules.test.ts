import { describe, expect, it } from 'vitest';
import type { GameState, InputState, PlayerId } from '../src/index';
import {
  BOMB_FUSE_TICKS,
  createGame,
  EMPTY_INPUT,
  FLAME_TICKS,
  GRID_W,
  parseClientMsg,
  step,
  Tile,
  TILE,
} from '../src/index';

const IDLE: Record<PlayerId, InputState> = {};

function pressing(id: PlayerId, keys: Partial<InputState>): Record<PlayerId, InputState> {
  return { [id]: { ...EMPTY_INPUT, ...keys } };
}

function advance(state: GameState, ticks: number, inputs: Record<PlayerId, InputState> = IDLE): GameState {
  for (let i = 0; i < ticks; i++) state = step(state, inputs);
  return state;
}

function setTile(state: GameState, tx: number, ty: number, tile: Tile): void {
  state.grid[ty * GRID_W + tx] = tile;
}

function flameAt(state: GameState, tx: number, ty: number): boolean {
  return state.flames.some((f) => f.x === tx && f.y === ty);
}

describe('déplacement', () => {
  it('avance vers une case libre et bute contre un mur', () => {
    // Le couloir (1,1) → (2,1) est toujours dégagé par createGame.
    let state = createGame(123, ['a']);
    const startX = state.players[0].x;
    state = step(state, pressing('a', { right: true }));
    expect(state.players[0].x).toBe(startX + state.players[0].speed);

    // Vers le haut : (1,0) est un mur de bordure, le joueur s'arrête au bord de sa case.
    let blocked = createGame(123, ['a']);
    blocked = advance(blocked, 20, pressing('a', { up: true }));
    expect(blocked.players[0].y).toBe(1 * TILE + 6); // hitbox collée au mur
  });
});

describe('bombes et explosions', () => {
  it('explose après la mèche, la flamme détruit les blocs et est stoppée par les murs', () => {
    let state = createGame(123, ['a']);
    setTile(state, 2, 1, Tile.Soft);
    state = step(state, pressing('a', { bomb: true }));
    expect(state.bombs).toHaveLength(1);

    state = advance(state, BOMB_FUSE_TICKS);
    expect(state.bombs).toHaveLength(0);
    expect(flameAt(state, 1, 1)).toBe(true); // centre
    expect(flameAt(state, 2, 1)).toBe(true); // le bloc détruit est couvert par la flamme
    expect(flameAt(state, 3, 1)).toBe(false); // ...et l'arrête
    expect(flameAt(state, 0, 1)).toBe(false); // mur de bordure : jamais de flamme
    expect(state.grid[1 * GRID_W + 2]).toBe(Tile.Floor); // bloc détruit

    state = advance(state, FLAME_TICKS);
    expect(state.flames).toHaveLength(0); // flammes éteintes
  });

  it('déclenche les bombes voisines en chaîne au même tick', () => {
    let state = createGame(123, ['a']);
    setTile(state, 2, 1, Tile.Floor);
    setTile(state, 3, 1, Tile.Floor);
    setTile(state, 4, 1, Tile.Floor);
    state = step(state, pressing('a', { bomb: true }));
    // Seconde bombe à portée de la première, avec une mèche bien plus longue :
    // seule la chaîne peut la faire exploser maintenant.
    state.bombs.push({ x: 3, y: 1, owner: 'x', explodeAt: state.tick + 1000, flame: 2, passThrough: [] });

    state = advance(state, BOMB_FUSE_TICKS);
    expect(state.bombs).toHaveLength(0);
    expect(flameAt(state, 3, 1)).toBe(true);
    expect(flameAt(state, 4, 1)).toBe(true); // flamme de la bombe déclenchée en chaîne
  });

  it('refuse une seconde bombe quand maxBombs est atteint', () => {
    let state = createGame(123, ['a']);
    state = step(state, pressing('a', { bomb: true }));
    state = advance(state, 6, pressing('a', { right: true })); // quitte la case de la bombe
    state = step(state, pressing('a', { bomb: true }));
    expect(state.bombs).toHaveLength(1); // maxBombs = 1 au départ
  });
});

describe('morts et victoire', () => {
  it('un joueur dans la flamme meurt et le survivant gagne', () => {
    let state = createGame(123, ['a', 'b']);
    setTile(state, 2, 1, Tile.Floor);
    setTile(state, 1, 3, Tile.Floor);
    setTile(state, 1, 4, Tile.Floor);
    // b est téléporté à côté du spawn de a, dans le rayon de la bombe (portée 2).
    state.players[1].x = 2 * TILE + TILE / 2;
    state.players[1].y = 1 * TILE + TILE / 2;

    state = step(state, pressing('a', { bomb: true }));
    // a s'enfuit vers le bas hors de portée pendant que la mèche brûle.
    state = advance(state, 16, pressing('a', { down: true }));
    state = advance(state, BOMB_FUSE_TICKS - 16);

    expect(state.players.find((p) => p.id === 'b')!.alive).toBe(false);
    expect(state.players.find((p) => p.id === 'a')!.alive).toBe(true);
    expect(state.phase).toBe('over');
    expect(state.winner).toBe('a');
  });

  it('déclare un match nul si les derniers joueurs meurent au même tick', () => {
    let state = createGame(123, ['a', 'b']);
    setTile(state, 2, 1, Tile.Floor);
    state.players[1].x = 2 * TILE + TILE / 2;
    state.players[1].y = 1 * TILE + TILE / 2;
    state = step(state, pressing('a', { bomb: true }));
    state = advance(state, BOMB_FUSE_TICKS); // a reste sur sa bombe : les deux meurent
    expect(state.players.every((p) => !p.alive)).toBe(true);
    expect(state.phase).toBe('over');
    expect(state.winner).toBeNull();
  });
});

describe('power-ups', () => {
  it("survit à la flamme qui l'a révélé, puis s'applique au ramassage", () => {
    let state = createGame(123, ['a']);
    setTile(state, 2, 1, Tile.Soft);
    setTile(state, 1, 3, Tile.Floor);
    setTile(state, 1, 4, Tile.Floor);

    state = step(state, pressing('a', { bomb: true }));
    state = advance(state, 16, pressing('a', { down: true })); // a s'enfuit hors de portée
    state = advance(state, BOMB_FUSE_TICKS - 16); // explosion : le bloc (2,1) est détruit
    // Le tirage de power-up est aléatoire (30 %) : on en injecte un déterministe,
    // avec le même activeAt que celui posé par destroySoft.
    state.powerups = [{ x: 2, y: 1, kind: 'flame', activeAt: state.tick + FLAME_TICKS + 1 }];

    state = advance(state, FLAME_TICKS + 1);
    expect(state.powerups).toHaveLength(1); // pas brûlé par la flamme qui a révélé le bloc

    const flameBefore = state.players[0].flame;
    state = advance(state, 20, pressing('a', { up: true })); // retour au spawn
    state = advance(state, 8, pressing('a', { right: true })); // marche sur le power-up
    expect(state.powerups).toHaveLength(0);
    expect(state.players[0].flame).toBe(flameBefore + 1);
  });
});

describe('protocole — validation des messages', () => {
  it('rejette le JSON malformé et les types inconnus, normalise les champs', () => {
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('{"type":"hack"}')).toBeNull();
    expect(parseClientMsg('{"type":"create","name":""}')).toBeNull();
    expect(parseClientMsg('{"type":"join","roomCode":"toolong","name":"x"}')).toBeNull();
    expect(parseClientMsg('{"type":"create","name":"  Mael  "}')).toEqual({ type: 'create', name: 'Mael' });
    expect(parseClientMsg('{"type":"join","roomCode":"abcd","name":"x"}')).toEqual({
      type: 'join',
      roomCode: 'ABCD',
      name: 'x',
    });
    expect(parseClientMsg('{"type":"input","keys":{"up":true,"junk":1}}')).toEqual({
      type: 'input',
      keys: { up: true, down: false, left: false, right: false, bomb: false },
    });
  });
});
