import { GRID_H, GRID_W } from './constants';

/*
 * Mort subite : à partir de SUDDEN_DEATH_START_TICK, un mur indestructible
 * tombe toutes les SUDDEN_DEATH_INTERVAL ticks, en spirale horaire depuis le
 * coin haut-gauche jusqu'au centre. Tout est déterministe (aucun PRNG) :
 * l'ordre ne dépend que des dimensions de la grille, le client peut donc
 * prédire et afficher les prochaines cases qui tombent.
 */

export const SUDDEN_DEATH_START_TICK = 1800; // 90 s à 20 Hz
export const SUDDEN_DEATH_INTERVAL = 10; // un mur toutes les 0,5 s

function buildSpiral(): ReadonlyArray<readonly [number, number]> {
  const order: [number, number][] = [];
  let x1 = 1;
  let y1 = 1;
  let x2 = GRID_W - 2;
  let y2 = GRID_H - 2;
  while (x1 <= x2 && y1 <= y2) {
    for (let x = x1; x <= x2; x++) order.push([x, y1]);
    for (let y = y1 + 1; y <= y2; y++) order.push([x2, y]);
    if (y2 > y1) for (let x = x2 - 1; x >= x1; x--) order.push([x, y2]);
    if (x2 > x1) for (let y = y2 - 1; y > y1; y--) order.push([x1, y]);
    x1++;
    y1++;
    x2--;
    y2--;
  }
  return order;
}

// Ordre de chute des murs, couvre toute la zone intérieure (les cases déjà
// murées — piliers — sont des tours « à vide » : le rythme reste régulier).
export const SUDDEN_DEATH_ORDER = buildSpiral();

// Parameters
//   tick — tick courant de la sim
// What it does
//   Donne l'index du prochain mur à tomber (0 avant le début de la mort
//   subite), pour afficher les avertissements côté client et faire fuir les
//   bots des prochaines cases condamnées.
// Output
//   Index dans SUDDEN_DEATH_ORDER (peut dépasser la fin du tableau)
export function suddenDeathNextIndex(tick: number): number {
  if (tick < SUDDEN_DEATH_START_TICK) return 0;
  return Math.floor((tick - SUDDEN_DEATH_START_TICK) / SUDDEN_DEATH_INTERVAL) + 1;
}
