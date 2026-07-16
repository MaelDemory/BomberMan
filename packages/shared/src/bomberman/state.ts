import type { PlayerId } from '../engine/types';
import { nextRand } from '../engine/prng';
import {
  BASE_BOMBS,
  BASE_FLAME,
  BASE_SPEED,
  GRID_H,
  GRID_W,
  SPAWNS,
  Tile,
  TILE,
} from './constants';
import { MAPS, type MapDef } from './maps';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type PowerupKind = 'bomb' | 'flame' | 'speed';

export interface PlayerState {
  id: PlayerId;
  x: number; // centre, en unités (1 case = TILE unités)
  y: number;
  dir: Dir;
  alive: boolean;
  speed: number;
  maxBombs: number;
  flame: number;
  bombHeld: boolean; // détection de front montant sur la touche bombe
}

export interface BombState {
  x: number; // en cases
  y: number;
  owner: PlayerId;
  explodeAt: number; // tick d'explosion
  flame: number; // portée figée à la pose
  passThrough: PlayerId[]; // joueurs encore autorisés à traverser (dessus à la pose)
}

export interface FlameState {
  x: number; // en cases
  y: number;
  until: number; // tick de disparition (exclusif)
}

export interface PowerupState {
  x: number; // en cases
  y: number;
  kind: PowerupKind;
  activeAt: number; // ramassable/brûlable seulement à partir de ce tick (le temps que la flamme retombe)
}

export interface GameState {
  tick: number;
  rng: number;
  grid: number[]; // GRID_W * GRID_H, valeurs de l'enum Tile, indexé [y * GRID_W + x]
  players: PlayerState[];
  bombs: BombState[];
  flames: FlameState[];
  powerups: PowerupState[];
  phase: 'running' | 'over';
  winner: PlayerId | null;
}

// Parameters
//   grid — grille du jeu
//   tx, ty — coordonnées de case
// What it does
//   Lit la case (tx, ty) ; tout ce qui est hors grille est traité comme un mur.
// Output
//   Valeur Tile de la case
export function tileAt(grid: number[], tx: number, ty: number): Tile {
  if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return Tile.Wall;
  return grid[ty * GRID_W + tx] as Tile;
}

// Parameters
//   seed — graine PRNG (uint32)
//   playerIds — identifiants des joueurs (2 à 4), dans l'ordre des spawns
//   map — générateur de map (piliers + densité) ; Classique par défaut
// What it does
//   Construit l'état initial : murs en bordure, piliers et densité selon la
//   map, blocs destructibles semés aléatoirement, zones de spawn dégagées
//   (case + voisines orthogonales), joueurs placés au centre de leur coin.
// Output
//   GameState prêt pour le premier step()
export function createGame(seed: number, playerIds: PlayerId[], map: MapDef = MAPS.classic): GameState {
  let rng = seed >>> 0;
  const grid: number[] = new Array(GRID_W * GRID_H).fill(Tile.Floor);

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const border = x === 0 || y === 0 || x === GRID_W - 1 || y === GRID_H - 1;
      if (border || map.isPillar(x, y)) {
        grid[y * GRID_W + x] = Tile.Wall;
      } else {
        const r = nextRand(rng);
        rng = r.state;
        if (r.value < map.softDensity) grid[y * GRID_W + x] = Tile.Soft;
      }
    }
  }

  for (const [sx, sy] of SPAWNS) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const tx = sx + dx;
      const ty = sy + dy;
      if (tileAt(grid, tx, ty) === Tile.Soft) grid[ty * GRID_W + tx] = Tile.Floor;
    }
  }

  const players: PlayerState[] = playerIds.map((id, i) => {
    const [sx, sy] = SPAWNS[i];
    return {
      id,
      x: sx * TILE + TILE / 2,
      y: sy * TILE + TILE / 2,
      dir: 'down',
      alive: true,
      speed: BASE_SPEED,
      maxBombs: BASE_BOMBS,
      flame: BASE_FLAME,
      bombHeld: false,
    };
  });

  return {
    tick: 0,
    rng,
    grid,
    players,
    bombs: [],
    flames: [],
    powerups: [],
    phase: 'running',
    winner: null,
  };
}
