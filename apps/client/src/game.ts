import { Application, Container, Graphics, Text } from 'pixi.js';
import {
  BOMB_FUSE_TICKS,
  EMPTY_INPUT,
  GRID_H,
  GRID_W,
  predictMove,
  TICK_MS,
  TILE,
  Tile,
  type Dir,
  type GameState,
  type InputState,
  type LobbyPlayer,
  type PlayerId,
  type PredictedPos,
} from '@bomber/shared';

const CELL = 40; // pixels par case
const PX = CELL / TILE; // pixels par unité de jeu
// Retard de rendu derrière le dernier snapshot — ne concerne que les AUTRES
// joueurs (le joueur local est prédit) : 1 intervalle de snapshot + marge jitter.
const INTERP_DELAY_MS = 75;
// Réconciliation par rejeu d'inputs : à chaque snapshot, on repart de la
// position autoritaire du serveur et on rejoue les inputs locaux non encore
// acquittés avec la même sim. Dans le cas nominal le rejeu retombe exactement
// sur la position prédite (sim déterministe) : aucune correction visible,
// aucun glissement — et la position affichée est toujours celle que le
// serveur jugera, aux inputs en vol près.
const INPUT_HISTORY_MAX = 64; // ~3 s d'inputs conservés pour le rejeu
const GHOST_BOMB_TTL_MS = 600; // durée de vie max d'une bombe fantôme non confirmée

// Couleurs joueurs par ordre d'arrivée — mêmes valeurs que DESIGN.md,
// partagées avec la liste DOM de la salle d'attente.
export const PLAYER_COLORS = ['#45D4FF', '#FF5D8F', '#7DE84B', '#FFC53D'];

const DIR_VEC: Record<Dir, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export interface GameView {
  start: (players: LobbyPlayer[], selfId: PlayerId) => void;
  pushSnapshot: (state: GameState, ack: number) => void;
  setInput: (keys: InputState) => void;
}

// Parameters
//   parent — élément DOM qui reçoit le canvas PixiJS
//   sendInput — envoie un input daté (tick client) au serveur
// What it does
//   Crée l'application PixiJS et la boucle de rendu : les snapshots serveur
//   sont bufferisés, le rendu à requestAnimationFrame se place ~100 ms dans
//   le passé et interpole (lerp) les positions joueurs entre les deux
//   snapshots encadrants ; grille, bombes, flammes et power-ups sont discrets
//   et rendus sans interpolation. Tout est dessiné par code (Graphics).
// Output
//   GameView { start, pushSnapshot }
export async function createGameView(
  parent: HTMLElement,
  sendInput: (tick: number, keys: InputState) => void
): Promise<GameView> {
  const app = new Application();
  await app.init({ width: GRID_W * CELL, height: GRID_H * CELL, background: '#12141B', antialias: true });
  app.canvas.setAttribute('role', 'img');
  app.canvas.setAttribute('aria-label', 'Aire de jeu Bomberman');
  parent.appendChild(app.canvas);

  const gfx = new Graphics();
  const labelLayer = new Container();
  app.stage.addChild(gfx, labelLayer);

  let snaps: GameState[] = [];
  let selfId: PlayerId = '';
  const labels = new Map<PlayerId, Text>();
  const colorIndex = new Map<PlayerId, number>();

  // Prédiction locale : le joueur local est simulé immédiatement avec la même
  // logique de mouvement que le serveur (predictMove), puis réconcilié en
  // douceur avec chaque snapshot. Les autres joueurs restent interpolés.
  let localKeys: InputState = EMPTY_INPUT;
  let predicted: PredictedPos | null = null;
  let prevPredicted: PredictedPos | null = null; // pas de prédiction précédent, pour lisser le rendu entre deux pas de 50 ms
  let predictAccum = 0;
  let localTick = 0; // numérote les inputs envoyés ; le serveur acquitte le dernier consommé
  let history: { tick: number; keys: InputState }[] = [];
  let ghosts: { tx: number; ty: number; until: number }[] = [];
  // Décalage lissé entre l'horloge locale et le temps serveur (tick × TICK_MS) :
  // interpoler sur le temps serveur plutôt que sur l'heure d'arrivée des
  // snapshots rend la gigue réseau invisible (vitesse constante à l'écran).
  let clockOffset: number | null = null;

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
      let x = (pa.x + (pb.x - pa.x) * alpha) * PX;
      let y = (pa.y + (pb.y - pa.y) * alpha) * PX;
      let dir = cur.dir;
      const local = pa.id === selfId && cur.alive ? localRenderPos() : null;
      if (local) {
        x = local.x * PX;
        y = local.y * PX;
        dir = local.dir;
      }
      const bodyAlpha = cur.alive ? 1 : 0.35;
      const color = cur.alive ? colorOf(pa.id) : '#5A6170';

      if (pa.id === selfId && cur.alive) {
        gfx.circle(x, y, 17).stroke({ width: 2, color: '#EDEEF2', alpha: 0.7 });
      }
      gfx.circle(x, y, 14).fill({ color, alpha: bodyAlpha }).stroke({ width: 2, color: '#0C0E13', alpha: bodyAlpha });
      const [dx, dy] = DIR_VEC[dir];
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

  // Avance la prédiction locale à pas fixe (TICK_MS, comme le serveur) puis
  // la réconcilie avec la position serveur du snapshot le plus récent.
  function predictLocal(deltaMS: number): void {
    const latest = snaps[snaps.length - 1];
    const me = latest.players.find((p) => p.id === selfId);
    if (!me || !me.alive || latest.phase === 'over') {
      predicted = null;
      return;
    }
    if (!predicted) predicted = { x: me.x, y: me.y, dir: me.dir };
    if (!prevPredicted) prevPredicted = predicted;

    predictAccum = Math.min(predictAccum + deltaMS, TICK_MS * 4); // borne anti-rattrapage après un onglet en veille
    while (predictAccum >= TICK_MS) {
      predictAccum -= TICK_MS;
      localTick++;
      history.push({ tick: localTick, keys: localKeys });
      if (history.length > INPUT_HISTORY_MAX) history.shift();
      sendInput(localTick, localKeys);
      prevPredicted = predicted;
      predicted = predictMove(latest, selfId, predicted, localKeys) ?? predicted;
    }
  }

  // Position de rendu du joueur local : interpolation entre les deux derniers
  // pas de prédiction (sinon le rendu 60+ fps n'affiche que du 20 Hz : saccades).
  function localRenderPos(): PredictedPos | null {
    if (!predicted || !prevPredicted) return predicted;
    const f = Math.min(predictAccum / TICK_MS, 1);
    return {
      x: prevPredicted.x + (predicted.x - prevPredicted.x) * f,
      y: prevPredicted.y + (predicted.y - prevPredicted.y) * f,
      dir: predicted.dir,
    };
  }

  // Bombes fantômes : affichées dès l'appui, retirées quand la vraie bombe
  // apparaît dans l'état rendu (ou à expiration si le serveur a refusé).
  function drawGhosts(disc: GameState, now: number): void {
    ghosts = ghosts.filter((g) => g.until > now && !disc.bombs.some((b) => b.x === g.tx && b.y === g.ty));
    for (const g of ghosts) {
      const cx = g.tx * CELL + CELL / 2;
      const cy = g.ty * CELL + CELL / 2;
      gfx.circle(cx, cy, 13).fill('#10131A').stroke({ width: 2.5, color: '#FFB300' });
      gfx.circle(cx - 4, cy - 4, 2.8).fill('#3A4256');
      gfx.circle(cx + 6, cy - 10, 3).fill('#FFD23F');
    }
  }

  app.ticker.add(() => {
    if (snaps.length === 0 || clockOffset === null) return;
    // Tick serveur (fractionnaire) à rendre : temps serveur estimé − retard d'interpolation.
    const targetTick = (performance.now() - clockOffset - INTERP_DELAY_MS) / TICK_MS;
    while (snaps.length > 2 && snaps[1].tick <= targetTick) snaps.shift();
    const a = snaps[0];
    const b = snaps[1] ?? a;
    const span = b.tick - a.tick;
    const alpha = span > 0 ? Math.min(Math.max((targetTick - a.tick) / span, 0), 1) : 1;
    const disc = alpha >= 1 ? b : a;

    predictLocal(app.ticker.deltaMS);

    gfx.clear();
    drawTiles(disc);
    drawItems(disc, performance.now());
    drawGhosts(disc, performance.now());
    drawPlayers(a, b, alpha);
  });

  return {
    start: (players, self) => {
      snaps = [];
      gfx.clear(); // sinon la dernière frame de la partie précédente reste affichée
      selfId = self;
      localKeys = EMPTY_INPUT;
      predicted = null;
      prevPredicted = null;
      predictAccum = 0;
      localTick = 0;
      history = [];
      ghosts = [];
      clockOffset = null;
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
    pushSnapshot: (state, ack) => {
      // Estimation lissée (EMA) du décalage horloge locale ↔ temps serveur :
      // absorbe la gigue d'arrivée au lieu de la répercuter sur le rendu.
      const raw = performance.now() - state.tick * TICK_MS;
      clockOffset = clockOffset === null ? raw : clockOffset + (raw - clockOffset) * 0.1;
      snaps.push(state);
      if (snaps.length > 30) snaps.shift();

      // Rebase : position autoritaire + rejeu des inputs non acquittés.
      // Sim déterministe ⇒ résultat identique à la prédiction dans le cas
      // nominal (aucun saut) ; en cas de divergence réelle (bombe adverse sur
      // le chemin), l'écart est réappliqué d'un coup, lissé par localRenderPos.
      if (!predicted) return;
      const me = state.players.find((p) => p.id === selfId);
      if (!me || !me.alive) return;
      history = history.filter((h) => h.tick > ack);
      let pos: PredictedPos = { x: me.x, y: me.y, dir: me.dir };
      for (const h of history) pos = predictMove(state, selfId, pos, h.keys) ?? pos;
      predicted = pos;
    },
    setInput: (keys) => {
      const bombPressed = keys.bomb && !localKeys.bomb;
      localKeys = keys;
      if (!bombPressed || !predicted || snaps.length === 0) return;
      // Bombe fantôme uniquement si le serveur l'acceptera selon l'état connu
      // (case libre, pas de bombe, quota non atteint) — sinon rien.
      const latest = snaps[snaps.length - 1];
      const me = latest.players.find((p) => p.id === selfId);
      if (!me || !me.alive) return;
      const tx = Math.floor(predicted.x / TILE);
      const ty = Math.floor(predicted.y / TILE);
      const refused =
        latest.grid[ty * GRID_W + tx] !== Tile.Floor ||
        latest.bombs.some((bb) => bb.x === tx && bb.y === ty) ||
        latest.bombs.filter((bb) => bb.owner === selfId).length >= me.maxBombs;
      if (!refused) ghosts.push({ tx, ty, until: performance.now() + GHOST_BOMB_TTL_MS });
    },
  };
}
