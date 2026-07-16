import { Container, Text, type Graphics } from 'pixi.js';
import { GRID_W, Tile, TILE, tileAt, type GameState, type PlayerId } from '@bomber/shared';

/*
 * Effets de ramassage de bonus (style « C » validé sur maquette) :
 * - commun : squash du joueur + texte flottant « +1 … ! » + bump HUD (lobby.ts)
 * - bombe : gobée puis stock réel affiché en éventail au-dessus de la tête
 * - portée : croix de portée — le pattern d'explosion aux NOUVELLES dimensions
 *   flashe au sol, pulse sur les cases gagnées (info tactique, y compris quand
 *   un adversaire ramasse)
 * - vitesse : chevrons + images fantômes derrière le joueur
 * Purement visuel : rien ici ne touche la sim ni le protocole.
 * prefers-reduced-motion ⇒ simple halo statique coloré, sans particules.
 */

const INK = 0x17223f;
const RED = 0xef3f36;
const SPARK = 0xffd23f;
const COBALT = 0x2f5bf0;
const CREAM = 0xfdf8ef;

type Kind = 'bomb' | 'flame' | 'speed';

const KIND_COLOR: Record<Kind, number> = { bomb: INK, flame: RED, speed: COBALT };
const KIND_LABEL: Record<Kind, string> = {
  bomb: '+1 BOMBE !',
  flame: '+1 PORTÉE !',
  speed: '+1 VITESSE !',
};

interface CrossTile {
  tx: number;
  ty: number;
  ring: number; // distance au centre (échelonne l'apparition)
  gained: boolean; // case gagnée par le bonus (pulse)
}

interface Effect {
  kind: Kind | 'squash' | 'halo';
  playerId: PlayerId;
  start: number;
  color: number;
  count: number; // bombe : stock à afficher
  tiles: CrossTile[]; // portée : croix figée à la case du ramassage
}

export interface RenderedPos {
  x: number; // pixels canvas
  y: number;
  dx: number; // direction de déplacement (pour les fantômes de vitesse)
  dy: number;
}

export interface PickupEffects {
  onSnapshot: (prev: GameState | undefined, next: GameState) => void;
  drawUnder: (now: number) => void;
  drawOver: (positions: Map<PlayerId, RenderedPos>, now: number) => void;
  squashOf: (id: PlayerId) => { sx: number; sy: number };
  reset: () => void;
}

// Léger overshoot amorti, même courbe que la maquette validée.
function springScale(p: number): number {
  if (p >= 1) return 1;
  return 1 + Math.sin(p * Math.PI * 2.2) * 0.18 * (1 - p);
}

// Croix d'explosion aux dimensions données, arrêtée par les murs comme la
// vraie (version visuelle locale : la sim reste seule juge des explosions).
function crossTiles(state: GameState, ctx: number, cty: number, flame: number): CrossTile[] {
  const tiles: CrossTile[] = [{ tx: ctx, ty: cty, ring: 0, gained: false }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let i = 1; i <= flame; i++) {
      const tx = ctx + dx * i;
      const ty = cty + dy * i;
      const tile = tileAt(state.grid, tx, ty);
      if (tile === Tile.Wall) break;
      tiles.push({ tx, ty, ring: i, gained: i === flame });
      if (tile === Tile.Soft) break;
    }
  }
  return tiles;
}

// Parameters
//   gfx — Graphics partagé de la scène (dessin immédiat, dans l'ordre d'appel)
//   textLayer — calque des textes (au-dessus du terrain)
//   cell — taille d'une case en pixels
// What it does
//   Crée le moteur d'effets de ramassage : détection par diff de snapshots
//   (stats qui augmentent), rendu en deux passes (croix au sol sous les
//   joueurs, reste au-dessus), squash exposé au rendu des joueurs.
// Output
//   PickupEffects { onSnapshot, drawUnder, drawOver, squashOf, reset }
export function createPickupEffects(gfx: Graphics, textLayer: Container, cell: number): PickupEffects {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let effects: Effect[] = [];
  const texts = new Map<Effect, Text>();

  function spawn(kind: Kind, player: GameState['players'][number], state: GameState): void {
    const now = performance.now();
    if (reduced) {
      effects.push({ kind: 'halo', playerId: player.id, start: now, color: KIND_COLOR[kind], count: 0, tiles: [] });
      return;
    }
    effects.push({ kind: 'squash', playerId: player.id, start: now, color: 0, count: 0, tiles: [] });
    const tiles =
      kind === 'flame'
        ? crossTiles(state, Math.floor(player.x / TILE), Math.floor(player.y / TILE), player.flame)
        : [];
    const fx: Effect = {
      kind,
      playerId: player.id,
      start: now,
      color: KIND_COLOR[kind],
      count: Math.min(player.maxBombs, 6),
      tiles,
    };
    effects.push(fx);

    const label = new Text({
      text: KIND_LABEL[kind],
      style: {
        fontFamily: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
        fontSize: 15,
        fontWeight: '800',
        fill: KIND_COLOR[kind],
        stroke: { color: CREAM, width: 4 },
      },
    });
    label.anchor.set(0.5, 1);
    textLayer.addChild(label);
    texts.set(fx, label);
  }

  function drawMiniBomb(x: number, y: number, s: number, alpha: number): void {
    gfx.circle(x, y, 9 * s).fill({ color: INK, alpha });
    gfx
      .moveTo(x + 5 * s, y - 8 * s)
      .quadraticCurveTo(x + 11 * s, y - 14 * s, x + 14 * s, y - 12 * s)
      .stroke({ width: 2, color: SPARK, alpha });
    gfx.circle(x + 14 * s, y - 12 * s, 2.2 * s).fill({ color: SPARK, alpha });
  }

  return {
    onSnapshot: (prev, next) => {
      if (!prev) return;
      for (const p of next.players) {
        const q = prev.players.find((o) => o.id === p.id);
        if (!q || !p.alive) continue;
        if (p.maxBombs > q.maxBombs) spawn('bomb', p, next);
        if (p.flame > q.flame) spawn('flame', p, next);
        if (p.speed > q.speed) spawn('speed', p, next);
      }
    },

    // Croix de portée : fantôme AU SOL, sous les joueurs.
    drawUnder: (now) => {
      for (const e of effects) {
        if (e.kind !== 'flame') continue;
        const q = (now - e.start) / 650;
        if (q >= 1) continue;
        for (const t of e.tiles) {
          const appear = t.ring * 0.09;
          if (q < appear) continue;
          const lq = Math.min((q - appear) / 0.25, 1);
          const cx = t.tx * cell;
          const cy = t.ty * cell;
          const inset = 4 + (1 - lq) * 10;
          const fade = 1 - q * q;
          gfx
            .roundRect(cx + inset, cy + inset, cell - inset * 2, cell - inset * 2, 6)
            .fill({ color: RED, alpha: (t.gained ? 0.7 : 0.4) * fade });
          const core = inset + 7;
          gfx
            .roundRect(cx + core, cy + core, cell - core * 2, cell - core * 2, 5)
            .fill({ color: SPARK, alpha: (t.gained ? 0.7 : 0.4) * fade });
          if (t.gained) {
            gfx
              .roundRect(cx + 2, cy + 2, cell - 4, cell - 4, 8)
              .stroke({ width: 2.5, color: SPARK, alpha: Math.max(0, 0.9 - q) });
          }
        }
      }
    },

    // Éventail de bombes, fantômes/chevrons de vitesse, textes, halos.
    drawOver: (positions, now) => {
      for (const e of effects) {
        const pos = positions.get(e.playerId);
        if (!pos) continue;
        const p = (now - e.start) / 1000;

        if (e.kind === 'bomb' && p < 1) {
          if (p < 0.3) {
            // gobée : la bombe plonge dans le joueur depuis le dessus
            const s = p / 0.3;
            drawMiniBomb(pos.x, pos.y - 30 * (1 - s * s), 1 - s * 0.6, 1);
          } else {
            for (let i = 0; i < e.count; i++) {
              const appear = 0.32 + i * 0.1;
              if (p < appear) continue;
              const lq = Math.min((p - appear) / 0.12, 1);
              const isNew = i === e.count - 1;
              const spread = (i - (e.count - 1) / 2) * 0.55;
              const bx = pos.x + Math.sin(spread) * 34;
              const by = pos.y - 34 - Math.cos(spread) * 6;
              const pop = isNew ? springScale(lq) : 1;
              const fade = p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
              drawMiniBomb(bx, by, 0.75 * pop * (0.5 + lq * 0.5), fade);
            }
          }
        }

        if (e.kind === 'speed' && p < 0.8) {
          const fade = 1 - p / 0.8;
          // images fantômes derrière le joueur (dans son sillage réel)
          for (let i = 1; i <= 3; i++) {
            gfx
              .circle(pos.x - pos.dx * i * 9, pos.y - pos.dy * i * 9, 14)
              .fill({ color: COBALT, alpha: 0.14 * fade * (4 - i) * 0.5 });
          }
          // chevrons qui filent vers l'arrière
          for (let i = 0; i < 3; i++) {
            const cp = (p * 2 + i * 0.18) % 1;
            const d = 20 + cp * 46;
            const cx = pos.x - pos.dx * d;
            const cy = pos.y - pos.dy * d;
            const ox = pos.dx * 8;
            const oy = pos.dy * 8;
            gfx
              .moveTo(cx + ox - oy, cy + oy + ox)
              .lineTo(cx, cy)
              .lineTo(cx + ox + oy, cy + oy - ox)
              .stroke({ width: 3, color: COBALT, alpha: (1 - cp) * fade, cap: 'round' });
          }
        }

        if (e.kind === 'halo' && p < 0.3) {
          gfx.circle(pos.x, pos.y, 24).fill({ color: e.color, alpha: 0.35 * (1 - p / 0.3) });
        }

        const label = texts.get(e);
        if (label) {
          const q = p / 0.9;
          if (q >= 1) {
            label.destroy();
            texts.delete(e);
          } else {
            label.visible = true;
            label.position.set(pos.x, pos.y - 34 - q * 26);
            label.alpha = q < 0.15 ? q / 0.15 : 1 - (q - 0.15) / 0.85;
          }
        }
      }
      effects = effects.filter((e) => {
        if (now - e.start < 1200) return true;
        const label = texts.get(e);
        if (label) {
          label.destroy();
          texts.delete(e);
        }
        return false;
      });
    },

    squashOf: (id) => {
      for (const e of effects) {
        if (e.kind !== 'squash' || e.playerId !== id) continue;
        const p = (performance.now() - e.start) / 300;
        if (p >= 1) continue;
        const sy = p < 0.25 ? 1 - p * 0.8 : springScale((p - 0.25) / 0.75);
        return { sx: 2 - sy, sy };
      }
      return { sx: 1, sy: 1 };
    },

    reset: () => {
      for (const label of texts.values()) label.destroy();
      texts.clear();
      effects = [];
    },
  };
}
