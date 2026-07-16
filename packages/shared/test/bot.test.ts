import { describe, expect, it } from 'vitest';
import type { BotDifficulty, GameState, InputState, PlayerId } from '../src/index';
import {
  BOMB_FUSE_TICKS,
  computeBotInput,
  createBotBrain,
  createGame,
  FLAME_TICKS,
  GRID_W,
  step,
  Tile,
  TILE,
} from '../src/index';

// Fait tourner une partie où `bot` est piloté par l'IA et les autres sont inertes.
function runBot(state: GameState, botId: PlayerId, difficulty: BotDifficulty, ticks: number, seed = 42) {
  const brain = createBotBrain(seed);
  let bombsPlaced = 0;
  for (let i = 0; i < ticks; i++) {
    const keys = computeBotInput(state, botId, difficulty, brain);
    const before = state.bombs.length;
    state = step(state, { [botId]: keys } as Record<PlayerId, InputState>);
    if (state.bombs.length > before) bombsPlaced++;
    if (state.phase === 'over') break;
  }
  return { state, bombsPlaced };
}

function bot(state: GameState, id: PlayerId) {
  return state.players.find((p) => p.id === id)!;
}

describe('IA des bots', () => {
  it('détruit des blocs et survit à ses propres bombes (moyen, 600 ticks)', () => {
    const initial = createGame(7, ['bot']);
    const softBefore = initial.grid.filter((t) => t === Tile.Soft).length;

    const { state, bombsPlaced } = runBot(initial, 'bot', 'medium', 600);

    const softAfter = state.grid.filter((t) => t === Tile.Soft).length;
    expect(bombsPlaced).toBeGreaterThan(0);
    expect(softAfter).toBeLessThan(softBefore); // des blocs ont été détruits
    expect(bot(state, 'bot').alive).toBe(true); // sans jamais se suicider
  });

  it("s'échappe d'une bombe posée sous ses pieds par un tiers", () => {
    let state = createGame(7, ['bot', 'x']);
    // Ouvre une issue : sans elle, la zone de spawn (3 cases) est entièrement
    // couverte par le souffle et le scénario serait insoluble.
    state.grid[3 * GRID_W + 1] = Tile.Floor;
    state.grid[4 * GRID_W + 1] = Tile.Floor;
    // Bombe piégée sur la case du bot, portée 2, mèche complète.
    state.bombs.push({
      x: 1,
      y: 1,
      owner: 'x',
      explodeAt: state.tick + BOMB_FUSE_TICKS,
      flame: 2,
      passThrough: ['bot'],
    });

    const { state: after } = runBot(state, 'bot', 'medium', BOMB_FUSE_TICKS + FLAME_TICKS + 2);
    expect(bot(after, 'bot').alive).toBe(true);
  });

  it("ne pose jamais de bombe sans case de repli (cul-de-sac)", () => {
    const state = createGame(7, ['bot']);
    // Enferme le bot : (1,1) avec murs partout sauf un bloc destructible à droite.
    // Poser détruirait le bloc mais le souffle couvrirait tout le cul-de-sac.
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] === Tile.Soft) state.grid[i] = Tile.Floor;
    }
    state.grid[1 * GRID_W + 2] = Tile.Soft; // seul voisin non-mur de (1,1)
    state.grid[2 * GRID_W + 1] = Tile.Wall; // bouche la sortie du bas
    state.players[0].x = 1 * TILE + TILE / 2;
    state.players[0].y = 1 * TILE + TILE / 2;

    const { state: after, bombsPlaced } = runBot(state, 'bot', 'hard', 100);
    expect(bombsPlaced).toBe(0);
    expect(bot(after, 'bot').alive).toBe(true);
  });

  it('un bot difficile élimine un joueur immobile', () => {
    // Le joueur 'cible' reste immobile sur son spawn à l'autre bout de la
    // carte ; le bot difficile doit percer un tunnel de blocs jusqu'à lui et
    // le tuer en moins d'une minute de jeu (~50 s constatées, marge incluse).
    const initial = createGame(7, ['cible', 'bot']);
    const { state } = runBot(initial, 'bot', 'hard', 1200);
    expect(bot(state, 'cible').alive).toBe(false);
    expect(state.winner).toBe('bot');
  });

  it('protocole : addBot/removeBot validés', async () => {
    const { parseClientMsg } = await import('../src/index');
    expect(parseClientMsg('{"type":"addBot","difficulty":"hard"}')).toEqual({ type: 'addBot', difficulty: 'hard' });
    expect(parseClientMsg('{"type":"addBot","difficulty":"impossible"}')).toBeNull();
    expect(parseClientMsg('{"type":"removeBot","botId":"bot-1"}')).toEqual({ type: 'removeBot', botId: 'bot-1' });
    expect(parseClientMsg('{"type":"removeBot","botId":""}')).toBeNull();
  });
});
