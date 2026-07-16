/*
 * Générateurs de maps : chaque map définit ses piliers intérieurs et sa
 * densité de blocs destructibles. La bordure, le semis aléatoire des blocs
 * (PRNG de la sim) et le dégagement des spawns restent gérés par createGame.
 * Purement serveur à l'exécution (le client reçoit la grille en snapshot),
 * mais défini dans shared : testable et proche des règles.
 */

export type MapId = 'classic' | 'open' | 'tunnels' | 'chaos';
export type MapChoice = MapId | 'random';

export interface MapDef {
  id: MapId;
  label: string;
  softDensity: number;
  // Piliers intérieurs (la bordure est ajoutée par createGame).
  isPillar: (x: number, y: number) => boolean;
}

export const MAPS: Record<MapId, MapDef> = {
  classic: {
    id: 'classic',
    label: 'Classique',
    softDensity: 0.7,
    isPillar: (x, y) => x % 2 === 0 && y % 2 === 0,
  },
  open: {
    id: 'open',
    label: 'Arène ouverte',
    softDensity: 0.5,
    isPillar: (x, y) => x % 4 === 0 && y % 4 === 0,
  },
  tunnels: {
    id: 'tunnels',
    label: 'Couloirs',
    softDensity: 0.6,
    // Piliers classiques + deux murailles horizontales (y = 4 et 8) percées de
    // trois portes (x = 3, 7, 11) : trois bandes reliées par des goulets.
    // Les murailles suivent des rangées de piliers : à l'intérieur des bandes
    // la géométrie reste classique, l'esquive perpendiculaire existe toujours
    // (garanti par le test « piège structurel »).
    isPillar: (x, y) => (x % 2 === 0 && y % 2 === 0) || ((y === 4 || y === 8) && x % 4 !== 3),
  },
  chaos: {
    id: 'chaos',
    label: 'Chaos',
    softDensity: 0.85,
    isPillar: (x, y) => x % 2 === 0 && y % 2 === 0,
  },
};

export const MAP_IDS: readonly MapId[] = ['classic', 'open', 'tunnels', 'chaos'];
