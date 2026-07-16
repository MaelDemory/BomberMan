// Toutes les grandeurs spatiales sont en unités entières : 1 case = TILE unités.
// Aucun flottant dans l'état du jeu (invariant de déterminisme, cf. ARCHITECTURE.md).

export const GRID_W = 15;
export const GRID_H = 13;
export const TILE = 16;

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

// Demi-côté de la hitbox joueur (boîte de 12 unités pour une case de 16 :
// laisse du jeu pour tourner dans les couloirs).
export const PLAYER_HALF = 6;

export const BASE_SPEED = 3; // unités/tick ≈ 3,75 cases/s
export const MAX_SPEED = 6;
export const BASE_BOMBS = 1;
export const MAX_BOMBS = 6;
export const BASE_FLAME = 2; // portée de flamme en cases
export const MAX_FLAME = 8;

export const BOMB_FUSE_TICKS = 40; // 2 s
export const FLAME_TICKS = 10; // 0,5 s

export const POWERUP_CHANCE = 0.3;

export enum Tile {
  Floor = 0,
  Wall = 1,
  Soft = 2,
}

// Coins de spawn dans l'ordre d'arrivée des joueurs (max 4 par room).
export const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [GRID_W - 2, GRID_H - 2],
  [GRID_W - 2, 1],
  [1, GRID_H - 2],
];

export const MAX_PLAYERS = SPAWNS.length;
