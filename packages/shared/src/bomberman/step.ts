import type { InputState, PlayerId } from '../engine/types';
import { EMPTY_INPUT } from '../engine/types';
import { nextInt, nextRand } from '../engine/prng';
import {
  BOMB_FUSE_TICKS,
  FLAME_TICKS,
  GRID_W,
  MAX_BOMBS,
  MAX_FLAME,
  MAX_SPEED,
  PLAYER_HALF,
  POWERUP_CHANCE,
  Tile,
  TILE,
} from './constants';
import type { BombState, Dir, GameState, PlayerState, PowerupKind } from './state';
import { tileAt } from './state';

const POWERUP_KINDS: readonly PowerupKind[] = ['bomb', 'flame', 'speed'];
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function centerTileX(p: PlayerState): number {
  return Math.floor(p.x / TILE);
}

function centerTileY(p: PlayerState): number {
  return Math.floor(p.y / TILE);
}

function bombAt(state: GameState, tx: number, ty: number): BombState | undefined {
  return state.bombs.find((b) => b.x === tx && b.y === ty);
}

// Une case bloque un joueur si elle est mur/bloc, ou si elle porte une bombe
// que ce joueur n'est plus autorisé à traverser.
function isSolidFor(state: GameState, id: PlayerId, tx: number, ty: number): boolean {
  if (tileAt(state.grid, tx, ty) !== Tile.Floor) return true;
  const bomb = bombAt(state, tx, ty);
  return bomb !== undefined && !bomb.passThrough.includes(id);
}

// La hitbox (2*PLAYER_HALF de côté, < TILE) couvre au plus 4 cases :
// tester les 4 coins suffit.
function canOccupy(state: GameState, id: PlayerId, px: number, py: number): boolean {
  const minTx = Math.floor((px - PLAYER_HALF) / TILE);
  const maxTx = Math.floor((px + PLAYER_HALF - 1) / TILE);
  const minTy = Math.floor((py - PLAYER_HALF) / TILE);
  const maxTy = Math.floor((py + PLAYER_HALF - 1) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (isSolidFor(state, id, tx, ty)) return false;
    }
  }
  return true;
}

// Avance unité par unité sur un axe (speed ≤ 6 < TILE : pas de tunneling possible).
// Retourne la distance restante non parcourue.
function slide(state: GameState, p: PlayerState, dx: number, dy: number, dist: number): number {
  let left = dist;
  while (left > 0 && canOccupy(state, p.id, p.x + dx, p.y + dy)) {
    p.x += dx;
    p.y += dy;
    left--;
  }
  return left;
}

// Parameters
//   state — état en cours de mutation
//   p — joueur à déplacer
//   input — touches du joueur pour ce tick
// What it does
//   Déplace le joueur sur un seul axe (pas de diagonale, horizontal prioritaire).
//   S'il bute sur un angle alors que la case visée dans son axe est libre,
//   le recale perpendiculairement vers le centre du couloir (aide de coin classique).
// Output
//   Rien ; mute p.x, p.y, p.dir
function movePlayer(state: GameState, p: PlayerState, input: InputState): void {
  let dx = 0;
  let dy = 0;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;
  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (dx !== 0) dy = 0;
  if (dx === 0 && dy === 0) return;

  p.dir = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';

  const remaining = slide(state, p, dx, dy, p.speed);
  if (remaining === 0) return;

  // Aide de coin : la case devant (dans l'axe du mouvement) est-elle libre ?
  const ctx = centerTileX(p);
  const cty = centerTileY(p);
  const aheadTx = ctx + dx;
  const aheadTy = cty + dy;
  if (isSolidFor(state, p.id, aheadTx, aheadTy)) return;

  // Libre mais le joueur est désaligné : recalage vers le centre du couloir.
  if (dx !== 0) {
    const laneCenter = cty * TILE + TILE / 2;
    const nudge = Math.sign(laneCenter - p.y);
    if (nudge !== 0) slide(state, p, 0, nudge, Math.min(remaining, Math.abs(laneCenter - p.y)));
  } else {
    const laneCenter = ctx * TILE + TILE / 2;
    const nudge = Math.sign(laneCenter - p.x);
    if (nudge !== 0) slide(state, p, nudge, 0, Math.min(remaining, Math.abs(laneCenter - p.x)));
  }
}

function playerOverlapsTile(p: PlayerState, tx: number, ty: number): boolean {
  const minX = tx * TILE;
  const minY = ty * TILE;
  return (
    p.x + PLAYER_HALF > minX &&
    p.x - PLAYER_HALF < minX + TILE &&
    p.y + PLAYER_HALF > minY &&
    p.y - PLAYER_HALF < minY + TILE
  );
}

function tryPlaceBomb(state: GameState, p: PlayerState, input: InputState): void {
  const pressed = input.bomb && !p.bombHeld;
  p.bombHeld = input.bomb;
  if (!pressed) return;

  const tx = centerTileX(p);
  const ty = centerTileY(p);
  if (bombAt(state, tx, ty)) return;
  if (tileAt(state.grid, tx, ty) !== Tile.Floor) return;
  const active = state.bombs.filter((b) => b.owner === p.id).length;
  if (active >= p.maxBombs) return;

  state.bombs.push({
    x: tx,
    y: ty,
    owner: p.id,
    explodeAt: state.tick + BOMB_FUSE_TICKS,
    flame: p.flame,
    // Quiconque chevauche la case à la pose peut encore la traverser, jusqu'à en sortir.
    passThrough: state.players.filter((q) => q.alive && playerOverlapsTile(q, tx, ty)).map((q) => q.id),
  });
}

function addFlame(state: GameState, tx: number, ty: number): void {
  state.flames.push({ x: tx, y: ty, until: state.tick + FLAME_TICKS });
}

function destroySoft(state: GameState, tx: number, ty: number): void {
  state.grid[ty * GRID_W + tx] = Tile.Floor;
  const roll = nextRand(state.rng);
  state.rng = roll.state;
  if (roll.value >= POWERUP_CHANCE) return;
  const pick = nextInt(state.rng, POWERUP_KINDS.length);
  state.rng = pick.state;
  // Le power-up n'apparaît qu'une fois la flamme retombée : la flamme qui a
  // détruit le bloc ne le brûle pas (comportement Bomberman classique).
  state.powerups.push({
    x: tx,
    y: ty,
    kind: POWERUP_KINDS[pick.value],
    activeAt: state.tick + FLAME_TICKS + 1,
  });
}

// Parameters
//   state — état en cours de mutation
// What it does
//   Fait exploser toutes les bombes arrivées à terme, avec réaction en chaîne :
//   une flamme qui atteint une autre bombe la déclenche au même tick. La flamme
//   s'arrête sur un mur, détruit un bloc destructible (et s'y arrête), s'arrête
//   sur une bombe atteinte.
// Output
//   Rien ; mute grid, bombs, flames, powerups, rng
function explodeDueBombs(state: GameState): void {
  const queue = state.bombs.filter((b) => state.tick >= b.explodeAt);
  const exploded = new Set<BombState>(queue);

  while (queue.length > 0) {
    const bomb = queue.shift()!;
    addFlame(state, bomb.x, bomb.y);
    for (const [dx, dy] of DIRS) {
      for (let i = 1; i <= bomb.flame; i++) {
        const tx = bomb.x + dx * i;
        const ty = bomb.y + dy * i;
        const tile = tileAt(state.grid, tx, ty);
        if (tile === Tile.Wall) break;
        if (tile === Tile.Soft) {
          addFlame(state, tx, ty);
          destroySoft(state, tx, ty);
          break;
        }
        addFlame(state, tx, ty);
        const other = bombAt(state, tx, ty);
        if (other && !exploded.has(other)) {
          exploded.add(other);
          queue.push(other);
        }
        if (other) break;
      }
    }
  }

  state.bombs = state.bombs.filter((b) => !exploded.has(b));
}

export interface PredictedPos {
  x: number;
  y: number;
  dir: Dir;
}

// Parameters
//   state — état de référence (non modifié) : grille et bombes pour les collisions
//   playerId — joueur à déplacer
//   pos — position/orientation de départ (celle prédite, pas celle du snapshot)
//   input — touches du tick
// What it does
//   Calcule le déplacement d'un seul joueur pour un tick avec exactement la même
//   logique que step() (glissement, aide de coin, bombes traversables), sans rien
//   d'autre : pas de bombe posée, pas de mort. Sert à la prédiction côté client ;
//   le serveur reste autoritaire.
// Output
//   Nouvelle position/orientation, ou null si le joueur est absent ou mort
export function predictMove(
  state: GameState,
  playerId: PlayerId,
  pos: PredictedPos,
  input: InputState
): PredictedPos | null {
  const src = state.players.find((q) => q.id === playerId);
  if (!src || !src.alive) return null;
  const p: PlayerState = { ...src, x: pos.x, y: pos.y, dir: pos.dir };
  movePlayer(state, p, input);
  return { x: p.x, y: p.y, dir: p.dir };
}

// Parameters
//   prev — état du tick précédent (non modifié)
//   inputs — état des touches par joueur ; joueurs absents = touches relâchées
// What it does
//   Avance la simulation d'un tick à pas fixe : déplacements, poses de bombes,
//   explosions et chaînes, extinction des flammes, morts, ramassage de power-ups,
//   condition de victoire. Entièrement déterministe (PRNG dans l'état, entiers only).
// Output
//   Le nouvel état ; prev reste intact
export function step(prev: GameState, inputs: Record<PlayerId, InputState>): GameState {
  const state = structuredClone(prev);
  state.tick++;
  if (state.phase === 'over') {
    // La partie est finie mais l'explosion finale doit se consumer à l'écran.
    state.flames = state.flames.filter((f) => f.until > state.tick);
    return state;
  }

  for (const p of state.players) {
    if (!p.alive) continue;
    const input = inputs[p.id] ?? EMPTY_INPUT;
    movePlayer(state, p, input);
    tryPlaceBomb(state, p, input);
  }

  // Fin du droit de passage dès que le joueur ne chevauche plus la bombe.
  for (const bomb of state.bombs) {
    bomb.passThrough = bomb.passThrough.filter((id) => {
      const p = state.players.find((q) => q.id === id);
      return p !== undefined && p.alive && playerOverlapsTile(p, bomb.x, bomb.y);
    });
  }

  explodeDueBombs(state);
  state.flames = state.flames.filter((f) => f.until > state.tick);

  const flameTiles = new Set(state.flames.map((f) => `${f.x},${f.y}`));
  for (const p of state.players) {
    if (p.alive && flameTiles.has(`${centerTileX(p)},${centerTileY(p)}`)) p.alive = false;
  }
  state.powerups = state.powerups.filter(
    (u) => u.activeAt > state.tick || !flameTiles.has(`${u.x},${u.y}`)
  );

  for (const p of state.players) {
    if (!p.alive) continue;
    const tx = centerTileX(p);
    const ty = centerTileY(p);
    const idx = state.powerups.findIndex((u) => u.x === tx && u.y === ty && u.activeAt <= state.tick);
    if (idx === -1) continue;
    const kind = state.powerups[idx].kind;
    state.powerups.splice(idx, 1);
    if (kind === 'bomb') p.maxBombs = Math.min(MAX_BOMBS, p.maxBombs + 1);
    else if (kind === 'flame') p.flame = Math.min(MAX_FLAME, p.flame + 1);
    else p.speed = Math.min(MAX_SPEED, p.speed + 1);
  }

  if (state.players.length > 1) {
    const alive = state.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      state.phase = 'over';
      state.winner = alive.length === 1 ? alive[0].id : null;
    }
  }

  return state;
}
