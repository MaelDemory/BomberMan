import type { InputState, PlayerId } from '../engine/types';
import { EMPTY_INPUT } from '../engine/types';
import { nextInt, nextRand } from '../engine/prng';
import { GRID_H, GRID_W, Tile, TILE } from './constants';
import type { GameState, PlayerState } from './state';
import { tileAt } from './state';

/*
 * IA des bots — exécutée côté serveur uniquement, en dehors de step() :
 * elle produit un InputState par tick, comme un joueur humain. Rien ici
 * n'entre dans GameState (PRNG du bot indépendant de celui de la sim),
 * le test de déterminisme de la sim n'est donc pas concerné.
 */

export type BotDifficulty = 'easy' | 'medium' | 'hard';

// Cerveau persistant d'un bot entre deux ticks.
export interface BotBrain {
  rng: number;
  path: number[]; // indices de cases à suivre, de la prochaine étape à la cible
  nextRepath: number; // tick de la prochaine replanification
  bombReadyAt: number; // tick à partir duquel une nouvelle pose est autorisée
  wantBomb: boolean; // pose au prochain tick (front montant de la touche)
}

// La difficulté ne change pas les règles, seulement la qualité de jeu :
// cadence de décision, réaction immédiate ou non au danger, style de chasse,
// recharge des bombes et tendance à hésiter. Toutes les difficultés posent
// sur un ennemi à portée (sinon les fins de partie s'enlisent) ; ce qui varie
// est la recherche de l'ennemi : 'no' = jamais (rencontres au hasard),
// 'fallback' = seulement quand plus aucun bloc n'est atteignable,
// 'always' = en permanence (et perce les blocs en direction de l'ennemi).
const TUNING: Record<
  BotDifficulty,
  {
    repath: number;
    reactsToDanger: boolean;
    hunts: 'no' | 'fallback' | 'always';
    bombCooldown: number;
    idleChance: number;
  }
> = {
  easy: { repath: 10, reactsToDanger: false, hunts: 'no', bombCooldown: 60, idleChance: 0.25 },
  medium: { repath: 5, reactsToDanger: true, hunts: 'fallback', bombCooldown: 30, idleChance: 0.05 },
  hard: { repath: 2, reactsToDanger: true, hunts: 'always', bombCooldown: 15, idleChance: 0 },
};

const INF = 1 << 29;

// Parameters
//   seed — graine PRNG propre au bot (uint32)
// What it does
//   Crée le cerveau initial d'un bot (à recréer à chaque nouvelle partie).
// Output
//   BotBrain neuf
export function createBotBrain(seed: number): BotBrain {
  return { rng: seed >>> 0, path: [], nextRepath: 0, bombReadyAt: 0, wantBomb: false };
}

function toIdx(tx: number, ty: number): number {
  return ty * GRID_W + tx;
}

function centerTileIdx(p: PlayerState): number {
  return toIdx(Math.floor(p.x / TILE), Math.floor(p.y / TILE));
}

// Cases couvertes par le souffle d'une bombe posée en (tx, ty) : centre + rayons
// stoppés par les murs, incluant le premier bloc destructible touché.
function blastTiles(state: GameState, tx: number, ty: number, flame: number, out: Set<number>): void {
  out.add(toIdx(tx, ty));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let i = 1; i <= flame; i++) {
      const x = tx + dx * i;
      const y = ty + dy * i;
      const tile = tileAt(state.grid, x, y);
      if (tile === Tile.Wall) break;
      out.add(toIdx(x, y));
      if (tile === Tile.Soft) break;
    }
  }
}

// Flammes actives : mortelles IMMÉDIATEMENT — aucun chemin ne doit les traverser.
function flameSet(state: GameState): Set<number> {
  const flames = new Set<number>();
  for (const f of state.flames) flames.add(toIdx(f.x, f.y));
  return flames;
}

// Cases dangereuses maintenant ou bientôt : flammes actives + souffles futurs
// de toutes les bombes posées (approximation prudente, chaînes incluses de fait).
// Les souffles futurs sont traversables (question de timing), pas les flammes.
function dangerSet(state: GameState): Set<number> {
  const danger = flameSet(state);
  for (const b of state.bombs) blastTiles(state, b.x, b.y, b.flame, danger);
  return danger;
}

// BFS sur les cases praticables depuis `from`. `avoid` (optionnel) exclut des
// cases du parcours — utilisé pour planifier hors danger ; la fuite passe
// avoid=null pour accepter de traverser un couloir de souffle vers la sortie.
function bfs(
  state: GameState,
  from: number,
  avoid: Set<number> | null
): { dist: number[]; prev: number[] } {
  const dist = new Array<number>(GRID_W * GRID_H).fill(INF);
  const prev = new Array<number>(GRID_W * GRID_H).fill(-1);
  const bombAt = new Set(state.bombs.map((b) => toIdx(b.x, b.y)));
  const queue: number[] = [from];
  dist[from] = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const cx = cur % GRID_W;
    const cy = (cur - cx) / GRID_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      const ni = toIdx(nx, ny);
      if (tileAt(state.grid, nx, ny) !== Tile.Floor) continue;
      if (bombAt.has(ni) || dist[ni] !== INF) continue;
      if (avoid && avoid.has(ni)) continue;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return { dist, prev };
}

function buildPath(prev: number[], from: number, target: number): number[] {
  const path: number[] = [];
  for (let cur = target; cur !== from && cur !== -1; cur = prev[cur]) path.unshift(cur);
  return path;
}

// La pose est sûre s'il reste une case hors danger actuel ET hors souffle de
// la bombe qu'on s'apprête à poser, atteignable sans traverser de flamme et
// assez proche pour y arriver avant la fin de la mèche (6 cases ≈ 32 ticks).
function canEscapeAfterBomb(state: GameState, me: PlayerState, myIdx: number, danger: Set<number>): boolean {
  const future = new Set(danger);
  blastTiles(state, myIdx % GRID_W, Math.floor(myIdx / GRID_W), me.flame, future);
  const { dist } = bfs(state, myIdx, flameSet(state));
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] !== INF && dist[i] <= 6 && !future.has(i)) return true;
  }
  return false;
}

function nearestByDist(dist: number[], accept: (i: number) => boolean): number {
  let best = -1;
  let bestDist = INF;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < bestDist && accept(i)) {
      best = i;
      bestDist = dist[i];
    }
  }
  return best;
}

function adjacentToSoft(state: GameState, i: number): boolean {
  const x = i % GRID_W;
  const y = (i - x) / GRID_W;
  return (
    tileAt(state.grid, x + 1, y) === Tile.Soft ||
    tileAt(state.grid, x - 1, y) === Tile.Soft ||
    tileAt(state.grid, x, y + 1) === Tile.Soft ||
    tileAt(state.grid, x, y - 1) === Tile.Soft
  );
}

// Choisit l'objectif courant et remplit brain.path / brain.wantBomb.
function plan(
  state: GameState,
  me: PlayerState,
  myIdx: number,
  danger: Set<number>,
  difficulty: BotDifficulty,
  brain: BotBrain
): void {
  const cfg = TUNING[difficulty];

  // 1. Fuir : chemin le plus court vers une case sûre. Traverser un souffle
  // futur est permis (question de timing), jamais une flamme active.
  if (danger.has(myIdx)) {
    const { dist, prev } = bfs(state, myIdx, flameSet(state));
    const safe = nearestByDist(dist, (i) => !danger.has(i));
    brain.path = safe !== -1 ? buildPath(prev, myIdx, safe) : [];
    return;
  }

  // 2. Hésitation (surtout facile) : un cycle sans bouger.
  const idle = nextRand(brain.rng);
  brain.rng = idle.state;
  if (idle.value < cfg.idleChance) {
    brain.path = [];
    return;
  }

  const { dist, prev } = bfs(state, myIdx, danger);

  // 3. Poser ici ? (adjacent à un bloc, ou ennemi à portée — toutes difficultés)
  const enemies = state.players.filter((p) => p.alive && p.id !== me.id);
  if (state.tick >= brain.bombReadyAt) {
    const myBlast = new Set<number>();
    blastTiles(state, myIdx % GRID_W, Math.floor(myIdx / GRID_W), me.flame, myBlast);
    const enemyInBlast = enemies.some((p) => myBlast.has(centerTileIdx(p)));
    if (adjacentToSoft(state, myIdx) || enemyInBlast) {
      if (canEscapeAfterBomb(state, me, myIdx, danger)) {
        brain.wantBomb = true;
        brain.bombReadyAt = state.tick + cfg.bombCooldown;
      }
      // Posté au bon endroit mais sortie pas encore sûre : attendre ici plutôt
      // que d'osciller vers un autre poste (la zone se dégage quand les bombes
      // voisines explosent).
      brain.path = [];
      return;
    }
  }

  // 4. Power-up actif atteignable hors danger.
  const powerup = nearestByDist(dist, (i) =>
    state.powerups.some((u) => u.activeAt <= state.tick && toIdx(u.x, u.y) === i)
  );
  if (powerup !== -1 && dist[powerup] <= 12) {
    brain.path = buildPath(prev, myIdx, powerup);
    return;
  }

  // 5. Chasse permanente (difficile uniquement).
  if (cfg.hunts === 'always' && enemies.length > 0) {
    const enemyIdx = nearestByDist(dist, (i) => enemies.some((p) => centerTileIdx(p) === i));
    if (enemyIdx !== -1) {
      brain.path = buildPath(prev, myIdx, enemyIdx);
      return;
    }
  }

  // 6. Aller se poster contre un bloc destructible : les chasseurs percent
  // vers l'ennemi (bloc qui rapproche le plus), les autres prennent le plus proche.
  let nearSoft = -1;
  if (cfg.hunts === 'always' && enemies.length > 0) {
    let bestScore = INF;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] === INF || !adjacentToSoft(state, i)) continue;
      const x = i % GRID_W;
      const y = (i - x) / GRID_W;
      let toEnemy = INF;
      for (const p of enemies) {
        const e = centerTileIdx(p);
        const ex = e % GRID_W;
        toEnemy = Math.min(toEnemy, Math.abs(ex - x) + Math.abs((e - ex) / GRID_W - y));
      }
      const score = toEnemy * 4 + dist[i];
      if (score < bestScore) {
        bestScore = score;
        nearSoft = i;
      }
    }
  } else {
    nearSoft = nearestByDist(dist, (i) => adjacentToSoft(state, i));
  }
  if (nearSoft !== -1 && nearSoft !== myIdx) {
    brain.path = buildPath(prev, myIdx, nearSoft);
    return;
  }

  // 6 bis. Chasse en repli (moyen) : plus aucun bloc atteignable ⇒ marcher
  // vers l'ennemi le plus proche — les fins de partie ne s'enlisent pas.
  if (cfg.hunts === 'fallback' && enemies.length > 0) {
    const enemyIdx = nearestByDist(dist, (i) => enemies.some((p) => centerTileIdx(p) === i));
    if (enemyIdx !== -1) {
      brain.path = buildPath(prev, myIdx, enemyIdx);
      return;
    }
  }

  // 7. Errance : une case atteignable au hasard (grille dégagée en fin de partie).
  const reachable: number[] = [];
  for (let i = 0; i < dist.length; i++) if (dist[i] !== INF && dist[i] > 0 && dist[i] <= 8) reachable.push(i);
  if (reachable.length > 0) {
    const pick = nextInt(brain.rng, reachable.length);
    brain.rng = pick.state;
    brain.path = buildPath(prev, myIdx, reachable[pick.value]);
  } else {
    brain.path = [];
  }
}

// Un seul axe à la fois : la sim n'a pas de diagonale et gère l'aide de coin.
function steer(me: PlayerState, targetIdx: number): InputState {
  const tx = targetIdx % GRID_W;
  const ty = (targetIdx - tx) / GRID_W;
  const dx = tx * TILE + TILE / 2 - me.x;
  const dy = ty * TILE + TILE / 2 - me.y;
  const keys = { ...EMPTY_INPUT };
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    if (dx < 0) keys.left = true;
    else keys.right = true;
  } else if (dy !== 0) {
    if (dy < 0) keys.up = true;
    else keys.down = true;
  }
  return keys;
}

// Parameters
//   state — état courant de la partie (non modifié)
//   botId — identifiant du joueur piloté par l'IA
//   difficulty — easy | medium | hard
//   brain — cerveau persistant du bot (muté : rng, chemin, cooldowns)
// What it does
//   Calcule les touches du bot pour ce tick : fuite des souffles, ramassage de
//   power-ups, destruction de blocs, chasse au joueur (difficile), pose de
//   bombe seulement si une case de repli existe. La difficulté module la
//   cadence de décision, la réaction au danger et la recharge des bombes.
// Output
//   InputState à passer tel quel à step() pour ce joueur
export function computeBotInput(
  state: GameState,
  botId: PlayerId,
  difficulty: BotDifficulty,
  brain: BotBrain
): InputState {
  const me = state.players.find((p) => p.id === botId);
  if (!me || !me.alive || state.phase !== 'running') return EMPTY_INPUT;

  const cfg = TUNING[difficulty];
  const myIdx = centerTileIdx(me);

  // Tick de pose : le bot n'appuie QUE sur la touche bombe, sans bouger —
  // step() déplace avant de poser, bouger ce tick déposerait la bombe sur la
  // case d'arrivée et pourrait couper le chemin de fuite planifié. La fuite
  // se planifie au tick suivant, quand la bombe existe dans state.bombs.
  if (brain.wantBomb) {
    brain.wantBomb = false;
    brain.nextRepath = 0;
    brain.path = [];
    return { ...EMPTY_INPUT, bomb: true };
  }

  const danger = dangerSet(state);
  const dangerNow = danger.has(myIdx) && cfg.reactsToDanger;
  const bombOnNextStep =
    brain.path.length > 0 && state.bombs.some((b) => toIdx(b.x, b.y) === brain.path[0]);
  if (dangerNow || bombOnNextStep || state.tick >= brain.nextRepath) {
    plan(state, me, myIdx, danger, difficulty, brain);
    brain.nextRepath = state.tick + cfg.repath;
  }

  while (brain.path.length > 0 && brain.path[0] === myIdx) brain.path.shift();
  if (brain.path.length === 0) return EMPTY_INPUT;
  return steer(me, brain.path[0]);
}
