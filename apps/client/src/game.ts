import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  BOMB_FUSE_TICKS,
  GRID_H,
  GRID_W,
  TILE,
  Tile,
  type Dir,
  type GameState,
  type LobbyPlayer,
  type PlayerId,
} from '@bomber/shared';

const CELL = 40; // pixels par case
const PX = CELL / TILE; // pixels par unité de jeu
const INTERP_DELAY_MS = 100; // retard de rendu derrière le dernier snapshot

// Couleurs joueurs par ordre d'arrivée — mêmes valeurs que DESIGN.md,
// partagées avec la liste DOM de la salle d'attente.
export const PLAYER_COLORS = ['#45D4FF', '#FF5D8F', '#7DE84B', '#FFC53D'];

const DIR_VEC: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

interface Snap {
  at: number; // performance.now() à la réception
  state: GameState;
}

export interface GameView {
  start: (players: LobbyPlayer[], selfId: PlayerId) => void;
  pushSnapshot: (state: GameState) => void;
}

// Parameters
//   parent — élément DOM qui reçoit le canvas PixiJS
// What it does
//   Crée l'application PixiJS et la boucle de rendu : les snapshots serveur
//   sont bufferisés, le rendu à requestAnimationFrame se place ~100 ms dans
//   le passé et interpole (lerp) les positions joueurs entre les deux
//   snapshots encadrants ; grille, bombes, flammes et power-ups sont discrets
//   et rendus sans interpolation. Tout est dessiné par code (Graphics).
// Output
//   GameView { start, pushSnapshot }
export async function createGameView(parent: HTMLElement): Promise<GameView> {
  const app = new Application();
  await app.init({ width: GRID_W * CELL, height: GRID_H * CELL, background: '#12141B', antialias: true });
  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Aire de jeu Bomberman');
  parent.appendChild(app.canvas);

  const gfx = new Graphics();
  const labelLayer = new Container();
  app.stage.addChild(gfx, labelLayer);

  let snaps: Snap[] = [];
  let selfId: PlayerId = '';
  const labels = new Map<PlayerId, Text>();
  const colorIndex = new Map<PlayerId, number>();

  const colorOf = (id: PlayerId): string => PLAYER_COLORS[(colorIndex.get(id) ?? 0) % PLAYER_COLORS.length];

  function drawTiles(state: GameState): void {
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const px = x * CELL;
        const py = y * CELL;
        const tile = state.grid[y * GRID_W + x];
        if (tile === Tile.Wall) {
          gfx.rect(px, py, CELL, CELL).fill('#333B4D');
          gfx.rect(px, py, CELL, 4).fill('#414B61');
          gfx.rect(px, py + CELL - 4, CELL, 4).fill('#262D3C');
        } else if (tile === Tile.Soft) {
          gfx.rect(px, py, CELL, CELL).fill('#161922');
          gfx.roundRect(px + 3, py + 3, CELL - 6, CELL - 6, 4).fill('#8A5A33');
          gfx.rect(px + 3, py + CELL / 2 - 1, CELL - 6, 2).fill('#6E4526');
          gfx.rect(px + CELL / 2 - 1, py + 3, 2, CELL - 6).fill('#6E4526');
        } else {
          gfx.rect(px, py, CELL, CELL).fill((x + y) % 2 === 0 ? '#161922' : '#181C26');
        }
      }
    }
  }

  function drawItems(state: GameState, now: number): void {
    for (const pu of state.powerups) {
      if (pu.activeAt > state.tick) continue;
      const cx = pu.x * CELL + CELL / 2;
      const cy = pu.y * CELL + CELL / 2;
      const col = pu.kind === 'bomb' ? '#FFC53D' : pu.kind === 'flame' ? '#FF7A45' : '#45D4FF';
      gfx.roundRect(cx - 13, cy - 13, 26, 26, 7).fill('#0C0E13').stroke({ width: 2, color: col });
      if (pu.kind === 'bomb') {
        gfx.circle(cx, cy, 7).fill(col);
      } else if (pu.kind === 'flame') {
        gfx.poly([cx, cy - 9, cx + 8, cy, cx, cy + 9, cx - 8, cy]).fill(col);
      } else {
        gfx.poly([cx - 8, cy - 7, cx - 1, cy, cx - 8, cy + 7]).fill(col);
        gfx.poly([cx + 1, cy - 7, cx + 8, cy, cx + 1, cy + 7]).fill(col);
      }
    }
    for (const bomb of state.bombs) {
      const cx = bomb.x * CELL + CELL / 2;
      const cy = bomb.y * CELL + CELL / 2;
      // Pulsation accélérant à l'approche de explodeAt (signal de danger).
      const urgency = 1 - Math.min(Math.max(bomb.explodeAt - state.tick, 0) / BOMB_FUSE_TICKS, 1);
      const period = 320 - 240 * urgency;
      const r = 13 * (1 + 0.12 * Math.sin((now / period) * Math.PI * 2));
      gfx.circle(cx, cy, r).fill('#10131A').stroke({ width: 2.5, color: urgency > 0.7 ? '#FF5D5D' : '#FFB300' });
      gfx.circle(cx - r * 0.3, cy - r * 0.3, r * 0.22).fill('#3A4256');
      gfx.circle(cx + r * 0.45, cy - r * 0.8, 3).fill('#FFD23F');
    }
    for (const f of state.flames) {
      const px = f.x * CELL;
      const py = f.y * CELL;
      gfx.roundRect(px + 2, py + 2, CELL - 4, CELL - 4, 6).fill('#FF7A45');
      gfx.roundRect(px + 9, py + 9, CELL - 18, CELL - 18, 5).fill('#FFD23F');
    }
  }

  function drawPlayers(a: GameState, b: GameState, alpha: number): void {
    const byIdB = new Map(b.players.map((p) => [p.id, p]));
    const seen = new Set<PlayerId>();
    for (const pa of a.players) {
      const pb = byIdB.get(pa.id) ?? pa;
      const cur = alpha >= 1 ? pb : pa;
      const x = (pa.x + (pb.x - pa.x) * alpha) * PX;
      const y = (pa.y + (pb.y - pa.y) * alpha) * PX;
      const bodyAlpha = cur.alive ? 1 : 0.35;
      const color = cur.alive ? colorOf(pa.id) : '#5A6170';

      if (pa.id === selfId && cur.alive) {
        gfx.circle(x, y, 17).stroke({ width: 2, color: '#EDEEF2', alpha: 0.7 });
      }
      gfx.circle(x, y, 14).fill({ color, alpha: bodyAlpha }).stroke({ width: 2, color: '#0C0E13', alpha: bodyAlpha });
      const [dx, dy] = DIR_VEC[cur.dir];
      gfx.circle(x + dx * 5 - dy * 4, y + dy * 5 + dx * 4, 2.5).fill({ color: '#10131A', alpha: bodyAlpha });
      gfx.circle(x + dx * 5 + dy * 4, y + dy * 5 - dx * 4, 2.5).fill({ color: '#10131A', alpha: bodyAlpha });

      const label = labels.get(pa.id);
      if (label) {
        seen.add(pa.id);
        label.visible = true;
        label.alpha = cur.alive ? 1 : 0.35;
        label.position.set(x, y - 18);
      }
    }
    for (const [id, label] of labels) if (!seen.has(id)) label.visible = false;
  }

  app.ticker.add(() => {
    if (snaps.length === 0) return;
    const target = performance.now() - INTERP_DELAY_MS;
    while (snaps.length > 2 && snaps[1].at <= target) snaps.shift();
    const a = snaps[0];
    const b = snaps[1] ?? a;
    const span = b.at - a.at;
    const alpha = span > 0 ? Math.min(Math.max((target - a.at) / span, 0), 1) : 1;
    const disc = alpha >= 1 ? b.state : a.state;

    gfx.clear();
    drawTiles(disc);
    drawItems(disc, performance.now());
    drawPlayers(a.state, b.state, alpha);
  });

  return {
    start: (players, self) => {
      snaps = [];
      gfx.clear(); // sinon la dernière frame de la partie précédente reste affichée
      selfId = self;
      for (const label of labels.values()) label.destroy();
      labels.clear();
      labelLayer.removeChildren();
      colorIndex.clear();
      players.forEach((p, i) => {
        colorIndex.set(p.id, i);
        const label = new Text({
          text: p.name,
          style: {
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            fontSize: 12,
            fontWeight: '700',
            fill: PLAYER_COLORS[i % PLAYER_COLORS.length],
          },
        });
        label.anchor.set(0.5, 1);
        labels.set(p.id, label);
        labelLayer.addChild(label);
      });
    },
    pushSnapshot: (state) => {
      snaps.push({ at: performance.now(), state });
      if (snaps.length > 30) snaps.shift();
    },
  };
}
