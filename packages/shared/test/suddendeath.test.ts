import { describe, expect, it } from 'vitest';
import type { GameState, InputState, PlayerId } from '../src/index';
import {
  createGame,
  GRID_W,
  MAP_IDS,
  MAPS,
  parseClientMsg,
  SPAWNS,
  step,
  SUDDEN_DEATH_INTERVAL,
  SUDDEN_DEATH_ORDER,
  SUDDEN_DEATH_START_TICK,
  Tile,
} from '../src/index';

const IDLE: Record<PlayerId, InputState> = {};

describe('mort subite', () => {
  it('le premier mur tombe au tick prévu et écrase bloc, bombe, bonus et joueur', () => {
    let state = createGame(1, ['a', 'b']);
    // Le joueur a est sur (1,1) — première case de la spirale — avec une bombe
    // piégée et un bonus posés dessus.
    state.tick = SUDDEN_DEATH_START_TICK - 1;
    state.bombs.push({ x: 1, y: 1, owner: 'b', explodeAt: state.tick + 500, flame: 2, passThrough: ['a'] });
    state.powerups.push({ x: 1, y: 1, kind: 'speed', activeAt: 0 });

    state = step(state, IDLE);

    expect(SUDDEN_DEATH_ORDER[0]).toEqual([1, 1]);
    expect(state.grid[1 * GRID_W + 1]).toBe(Tile.Wall);
    expect(state.bombs).toHaveLength(0);
    expect(state.powerups).toHaveLength(0);
    expect(state.players[0].alive).toBe(false);
    expect(state.phase).toBe('over'); // b est seul survivant
    expect(state.winner).toBe('b');
  });

  it('les murs tombent au rythme SUDDEN_DEATH_INTERVAL', () => {
    let state = createGame(1, ['a', 'b']);
    // Écarte les joueurs de la spirale de départ pour observer plusieurs chutes.
    state.players[0].x = 7 * 16 + 8;
    state.players[0].y = 5 * 16 + 8;
    state.players[1].x = 7 * 16 + 8;
    state.players[1].y = 7 * 16 + 8;
    state.tick = SUDDEN_DEATH_START_TICK - 1;

    for (let i = 0; i < SUDDEN_DEATH_INTERVAL * 3; i++) state = step(state, IDLE);
    for (let k = 0; k < 3; k++) {
      const [tx, ty] = SUDDEN_DEATH_ORDER[k];
      expect(state.grid[ty * GRID_W + tx]).toBe(Tile.Wall);
    }
    const [nx, ny] = SUDDEN_DEATH_ORDER[4];
    expect(state.grid[ny * GRID_W + nx]).not.toBe(Tile.Wall);
  });

  it('force la fin de partie : deux joueurs immobiles ⇒ over', () => {
    let state = createGame(9, ['a', 'b']);
    const limit = SUDDEN_DEATH_START_TICK + SUDDEN_DEATH_ORDER.length * SUDDEN_DEATH_INTERVAL + 10;
    while (state.phase === 'running' && state.tick < limit) state = step(state, IDLE);
    expect(state.phase).toBe('over');
  });
});

describe('maps', () => {
  it('chaque map garde les spawns dégagés et connectés entre eux', () => {
    for (const id of MAP_IDS) {
      const state: GameState = createGame(5, ['a', 'b', 'c', 'd'], MAPS[id]);
      // BFS sur les cases non-mur (les blocs destructibles sont franchissables à terme).
      const visited = new Set<number>();
      const queue = [SPAWNS[0][1] * GRID_W + SPAWNS[0][0]];
      visited.add(queue[0]);
      while (queue.length) {
        const cur = queue.shift()!;
        const cx = cur % GRID_W;
        const cy = (cur - cx) / GRID_W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = (cy + dy) * GRID_W + (cx + dx);
          if (visited.has(ni) || state.grid[ni] === Tile.Wall) continue;
          visited.add(ni);
          queue.push(ni);
        }
      }
      for (const [sx, sy] of SPAWNS) {
        expect(state.grid[sy * GRID_W + sx], `${id} spawn (${sx},${sy})`).toBe(Tile.Floor);
        expect(visited.has(sy * GRID_W + sx), `${id} connectivité (${sx},${sy})`).toBe(true);
      }
    }
  });

  it("aucune map n'a de piège structurel : bomber un bloc voisin laisse toujours une esquive", () => {
    // Scénario du bug « Couloirs » : je pose une bombe (portée 2) contre un
    // bloc destructible voisin — le bloc me barre la fuite dans sa direction.
    // Pour chaque case sol et chaque voisin « bloqué », une case refuge hors
    // souffle doit rester atteignable en ≤ 4 pas. Murs seuls + le bloc visé :
    // les configurations multi-blocs relèvent de l'aléa accepté du jeu.
    const RANGE = 2;
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (const id of MAP_IDS) {
      const grid = createGame(5, ['a', 'b'], MAPS[id]).grid.map((t) => (t === Tile.Soft ? Tile.Floor : t));
      const isWall = (x: number, y: number): boolean =>
        x < 0 || y < 0 || x >= GRID_W || grid[y * GRID_W + x] === Tile.Wall;

      for (let y = 1; y < 12; y++) {
        for (let x = 1; x < GRID_W - 1; x++) {
          if (isWall(x, y)) continue;
          for (const [bx, by] of DIRS) {
            if (isWall(x + bx, y + by)) continue; // pas de bloc possible sur un mur
            const blockedIdx = (y + by) * GRID_W + (x + bx);
            const solid = (cx: number, cy: number): boolean =>
              isWall(cx, cy) || cy * GRID_W + cx === blockedIdx;

            const blast = new Set<number>([y * GRID_W + x]);
            for (const [dx, dy] of DIRS) {
              for (let i = 1; i <= RANGE; i++) {
                if (isWall(x + dx * i, y + dy * i)) break;
                blast.add((y + dy * i) * GRID_W + (x + dx * i));
                if ((y + dy * i) * GRID_W + (x + dx * i) === blockedIdx) break; // le bloc absorbe
              }
            }

            const dist = new Map<number, number>([[y * GRID_W + x, 0]]);
            const queue = [y * GRID_W + x];
            let safe = false;
            while (queue.length && !safe) {
              const cur = queue.shift()!;
              const d = dist.get(cur)!;
              if (d >= 4) continue;
              const cx = cur % GRID_W;
              const cy = (cur - cx) / GRID_W;
              for (const [dx, dy] of DIRS) {
                const ni = (cy + dy) * GRID_W + (cx + dx);
                if (solid(cx + dx, cy + dy) || dist.has(ni)) continue;
                dist.set(ni, d + 1);
                if (!blast.has(ni)) safe = true;
                queue.push(ni);
              }
            }
            expect(safe, `${id} : piège en (${x},${y}) en bombant vers (${x + bx},${y + by})`).toBe(true);
          }
        }
      }
    }
  });

  it('les maps produisent des grilles différentes à seed égale', () => {
    const classic = createGame(5, ['a', 'b']);
    for (const id of MAP_IDS.filter((m) => m !== 'classic')) {
      expect(createGame(5, ['a', 'b'], MAPS[id]).grid).not.toEqual(classic.grid);
    }
  });

  it('protocole : setMap validé', () => {
    expect(parseClientMsg('{"type":"setMap","map":"tunnels"}')).toEqual({ type: 'setMap', map: 'tunnels' });
    expect(parseClientMsg('{"type":"setMap","map":"random"}')).toEqual({ type: 'setMap', map: 'random' });
    expect(parseClientMsg('{"type":"setMap","map":"lune"}')).toBeNull();
  });
});
