import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScoreStore, type Participant } from '../src/scores';

const human = (id: string, name: string): Participant => ({ id, name, bot: false });
const bot = (id: string): Participant => ({ id, name: 'Bim', bot: true });

function freshDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'bomber-scores-'));
}

describe('ScoreStore', () => {
  it('compte parties et victoires pour les humains, à partir de 2 humains', () => {
    const store = new ScoreStore(freshDir());
    store.recordGame([human('a', 'Alice'), human('b', 'Bob'), bot('x')], 'a');
    store.recordGame([human('a', 'Alice'), human('b', 'Bob')], 'b');
    store.recordGame([human('a', 'Alice'), human('b', 'Bob')], null); // nul

    const top = store.top(10);
    expect(top).toEqual([
      { name: 'Alice', wins: 1, games: 3 },
      { name: 'Bob', wins: 1, games: 3 },
    ]);
  });

  it('ignore les parties à moins de 2 humains (anti-farming contre bots)', () => {
    const store = new ScoreStore(freshDir());
    store.recordGame([human('a', 'Alice'), bot('x'), bot('y')], 'a');
    expect(store.top(10)).toEqual([]);
  });

  it("une victoire de bot compte la partie mais ne crédite personne", () => {
    const store = new ScoreStore(freshDir());
    store.recordGame([human('a', 'Alice'), human('b', 'Bob'), bot('x')], 'x');
    expect(store.top(10)).toEqual([
      { name: 'Alice', wins: 0, games: 1 },
      { name: 'Bob', wins: 0, games: 1 },
    ]);
  });

  it('identité insensible à la casse, dernière casse affichée', () => {
    const store = new ScoreStore(freshDir());
    store.recordGame([human('a', 'alice'), human('b', 'Bob')], 'a');
    store.recordGame([human('a2', 'ALICE'), human('b', 'Bob')], 'a2');
    const top = store.top(10);
    expect(top[0]).toEqual({ name: 'ALICE', wins: 2, games: 2 });
  });

  it('persiste sur disque et survit à un rechargement', async () => {
    const dir = freshDir();
    const store = new ScoreStore(dir);
    store.recordGame([human('a', 'Alice'), human('b', 'Bob')], 'a');
    await store.flush();

    const reloaded = new ScoreStore(dir);
    expect(reloaded.top(10)).toEqual([
      { name: 'Alice', wins: 1, games: 1 },
      { name: 'Bob', wins: 0, games: 1 },
    ]);
  });
});
