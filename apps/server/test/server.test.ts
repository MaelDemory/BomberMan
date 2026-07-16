import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer } from '../src/server';

let servers: Server[] = [];
let clients: TestClient[] = [];

async function startServer(): Promise<number> {
  // dataDir jetable : les tests ne doivent jamais écrire de scores dans le repo.
  const server = createGameServer({ dataDir: mkdtempSync(path.join(tmpdir(), 'bomber-test-')) });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as AddressInfo).port;
}

// Client WebSocket de test : file les messages reçus et permet de les
// attendre un par un dans l'ordre d'arrivée.
class TestClient {
  readonly ws: WebSocket;
  private queue: any[] = [];
  private waiters: Array<(msg: any) => void> = [];

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    clients.push(this);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(String(data));
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.queue.push(msg);
    });
  }

  ready(): Promise<void> {
    return new Promise((resolve) => this.ws.once('open', resolve));
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  next(timeoutMs = 2000): Promise<any> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout en attente d\'un message serveur')),
        timeoutMs,
      );
      this.waiters.push((msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  pendingCount(): number {
    return this.queue.length;
  }
}

async function connect(port: number): Promise<TestClient> {
  const client = new TestClient(port);
  await client.ready();
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Crée une room avec un hôte et un invité, messages de lobby déjà consommés.
async function createPair(port: number): Promise<{ host: TestClient; guest: TestClient; code: string }> {
  const host = await connect(port);
  host.send({ type: 'create', name: 'alice' });
  const joined = await host.next();
  const guest = await connect(port);
  guest.send({ type: 'join', roomCode: joined.roomCode, name: 'bob' });
  await guest.next(); // joined
  await host.next(); // lobby
  return { host, guest, code: joined.roomCode };
}

afterEach(async () => {
  for (const c of clients) c.ws.terminate();
  clients = [];
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  servers = [];
});

describe('serveur de jeu', () => {
  it('create renvoie joined avec un code de 4 lettres', async () => {
    const port = await startServer();
    const host = await connect(port);
    host.send({ type: 'create', name: 'alice' });
    const msg = await host.next();
    expect(msg.type).toBe('joined');
    expect(msg.roomCode).toMatch(/^[A-Z]{4}$/);
    expect(msg.players).toHaveLength(1);
    expect(msg.hostId).toBe(msg.playerId);
  });

  it('join diffuse l\'état lobby aux deux joueurs', async () => {
    const port = await startServer();
    const host = await connect(port);
    host.send({ type: 'create', name: 'alice' });
    const created = await host.next();

    const guest = await connect(port);
    guest.send({ type: 'join', roomCode: created.roomCode, name: 'bob' });
    const joined = await guest.next();
    expect(joined.type).toBe('joined');
    expect(joined.players.map((p: any) => p.name)).toEqual(['alice', 'bob']);
    expect(joined.hostId).toBe(created.playerId);

    const lobby = await host.next();
    expect(lobby.type).toBe('lobby');
    expect(lobby.players).toHaveLength(2);
  });

  it('start par l\'hôte envoie start puis des snapshots au tick croissant', async () => {
    const port = await startServer();
    const { host, guest } = await createPair(port);

    host.send({ type: 'start' });
    const startHost = await host.next();
    const startGuest = await guest.next();
    expect(startHost.type).toBe('start');
    expect(typeof startHost.seed).toBe('number');
    expect(startGuest.type).toBe('start');

    const ticks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const snap = await host.next();
      expect(snap.type).toBe('snapshot');
      ticks.push(snap.state.tick);
    }
    expect(ticks[1]).toBeGreaterThan(ticks[0]);
    expect(ticks[2]).toBeGreaterThan(ticks[1]);

    const guestSnap = await guest.next();
    expect(guestSnap.type).toBe('snapshot');
  });

  it('start par un non-hôte est ignoré', async () => {
    const port = await startServer();
    const { host, guest } = await createPair(port);

    guest.send({ type: 'start' });
    await sleep(300);
    expect(host.pendingCount()).toBe(0);
    expect(guest.pendingCount()).toBe(0);
  });

  it('partie solo : addBot par l\'hôte puis start à 1 humain + 1 bot', async () => {
    const port = await startServer();
    const host = await connect(port);
    host.send({ type: 'create', name: 'alice' });
    await host.next(); // joined

    host.send({ type: 'addBot', difficulty: 'easy' });
    const lobby = await host.next();
    expect(lobby.type).toBe('lobby');
    expect(lobby.players).toHaveLength(2);
    expect(lobby.players[1]).toMatchObject({ name: 'Bim', bot: true, difficulty: 'easy' });

    host.send({ type: 'start' });
    const start = await host.next();
    expect(start.type).toBe('start');
    const snap = await host.next();
    expect(snap.type).toBe('snapshot');
    expect(snap.state.players).toHaveLength(2);
    // Le bot est bien un joueur de la sim ; les acks ne concernent que les humains.
    expect(Object.keys(snap.acks)).toHaveLength(1);
  });

  it('setMap par l\'hôte diffuse la map, ignoré pour un non-hôte', async () => {
    const port = await startServer();
    const { host, guest } = await createPair(port);

    host.send({ type: 'setMap', map: 'tunnels' });
    const lobbyHost = await host.next();
    const lobbyGuest = await guest.next();
    expect(lobbyHost.map).toBe('tunnels');
    expect(lobbyGuest.map).toBe('tunnels');

    guest.send({ type: 'setMap', map: 'chaos' });
    await sleep(300);
    expect(host.pendingCount()).toBe(0);
  });

  it('addBot par un non-hôte est ignoré', async () => {
    const port = await startServer();
    const { host, guest } = await createPair(port);
    guest.send({ type: 'addBot', difficulty: 'hard' });
    await sleep(300);
    expect(host.pendingCount()).toBe(0);
    expect(guest.pendingCount()).toBe(0);
  });

  it('removeBot retire le bot et le start reste bloqué seul', async () => {
    const port = await startServer();
    const host = await connect(port);
    host.send({ type: 'create', name: 'alice' });
    await host.next(); // joined
    host.send({ type: 'addBot', difficulty: 'hard' });
    const lobby = await host.next();
    const botId = lobby.players[1].id;

    host.send({ type: 'removeBot', botId });
    const after = await host.next();
    expect(after.players).toHaveLength(1);

    host.send({ type: 'start' }); // seul : ignoré
    await sleep(300);
    expect(host.pendingCount()).toBe(0);
  });

  it('un lien d\'invitation /ABCD sert la même réponse que /', async () => {
    // En CI le client n'est pas buildé (404 des deux côtés) ; en local les
    // deux servent index.html — dans tous les cas le comportement est aligné.
    const port = await startServer();
    const [home, invite, tooLong] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/`),
      fetch(`http://127.0.0.1:${port}/ABCD`),
      fetch(`http://127.0.0.1:${port}/ABCDE`),
    ]);
    expect(invite.status).toBe(home.status);
    if (home.status === 200) {
      expect(await invite.text()).toBe(await home.text());
    }
    expect(tooLong.status).toBe(404);
  });

  it('GET /scores répond un classement JSON (vide au départ)', async () => {
    const port = await startServer();
    const res = await fetch(`http://127.0.0.1:${port}/scores`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual([]);
  });

  it('les messages malformés sont ignorés sans fermer la connexion', async () => {
    const port = await startServer();
    const client = await connect(port);

    client.send('garbage');
    client.send(JSON.stringify({ type: 'teleport', x: 1 }));
    client.send(JSON.stringify({ type: 'join' })); // champs manquants
    await sleep(200);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
    expect(client.pendingCount()).toBe(0);

    // La connexion reste pleinement fonctionnelle après les messages invalides.
    client.send({ type: 'create', name: 'carol' });
    const msg = await client.next();
    expect(msg.type).toBe('joined');
  });
});
