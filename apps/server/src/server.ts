import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { parseClientMsg, type PlayerId, type ServerMsg } from '@bomber/shared';
import type { Room } from './room';
import { createRoom, getRoom } from './rooms';
import { ScoreStore } from './scores';

type ErrorCode = Extract<ServerMsg, { type: 'error' }>['code'];

const HEARTBEAT_MS = 30_000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function clientDistDir(): string {
  // __dirname en bundle CJS (dist/), import.meta.url en dev ESM (src/) ;
  // les deux dossiers sont au même niveau sous apps/server, donc le même
  // chemin relatif mène à apps/client/dist.
  const here =
    typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../client/dist');
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  try {
    const dist = clientDistDir();
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const filePath = path.resolve(dist, rel);
    if (!filePath.startsWith(dist + path.sep)) {
      notFound(res);
      return;
    }
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch {
    // Fichier absent, dossier client pas encore buildé, chemin invalide : 404.
    notFound(res);
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse, scores: ScoreStore): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }
  if (req.method !== 'GET') {
    notFound(res);
    return;
  }
  if (url.pathname === '/scores') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(scores.top(20)));
    return;
  }
  // Lien d'invitation : /ABCD (code de room, 4 lettres) sert l'app — le client
  // lit le code dans l'URL et préremplit le formulaire de connexion.
  if (/^\/[A-Za-z]{4}$/.test(url.pathname)) {
    void serveStatic('/', res);
    return;
  }
  void serveStatic(url.pathname, res);
}

function sendError(ws: WebSocket, code: ErrorCode): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', code } satisfies ServerMsg));
  }
}

// Parameters
//   opts.dataDir — dossier des données persistantes (défaut : $DATA_DIR ou ./data)
// What it does
//   Construit le serveur HTTP du jeu : /health, /scores (classement général),
//   fichiers statiques du client buildé, upgrade WebSocket sur /ws uniquement,
//   dispatch des messages clients validés par parseClientMsg vers les rooms,
//   et heartbeat ping/pong (terminate après HEARTBEAT_MS sans pong).
//   Ne se met pas en écoute.
// Output
//   http.Server prêt pour listen() ; close() arrête aussi le heartbeat
export function createGameServer(opts: { dataDir?: string } = {}): Server {
  const scores = new ScoreStore(opts.dataDir ?? process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
  const server = createServer((req, res) => handleRequest(req, res, scores));
  // maxPayload : le plus gros message client légitime (input) fait < 200 octets.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  const alive = new Map<WebSocket, boolean>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let playerId: PlayerId | null = null;
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    ws.on('message', (data) => {
      try {
        const msg = parseClientMsg(String(data));
        if (!msg) {
          console.warn('message client ignoré (malformé ou inconnu)');
          return;
        }
        switch (msg.type) {
          case 'create': {
            if (room) return;
            const created = createRoom((participants, winnerId) => scores.recordGame(participants, winnerId));
            const result = created.join(ws, msg.name);
            if ('id' in result) {
              room = created;
              playerId = result.id;
            }
            break;
          }
          case 'join': {
            if (room) return;
            const target = getRoom(msg.roomCode);
            if (!target) {
              sendError(ws, 'room_not_found');
              return;
            }
            const result = target.join(ws, msg.name);
            if ('error' in result) {
              sendError(ws, result.error);
              return;
            }
            room = target;
            playerId = result.id;
            break;
          }
          case 'start':
            if (room && playerId) room.start(playerId);
            break;
          case 'input':
            if (room && playerId) room.setInput(playerId, msg.tick, msg.keys);
            break;
          case 'addBot':
            if (room && playerId) room.addBot(playerId, msg.difficulty);
            break;
          case 'removeBot':
            if (room && playerId) room.removeBot(playerId, msg.botId);
            break;
          case 'setMap':
            if (room && playerId) room.setMap(playerId, msg.map);
            break;
          case 'leave':
            if (room && playerId) room.leave(playerId);
            room = null;
            playerId = null;
            break;
        }
      } catch (err) {
        console.error('erreur de traitement d\'un message client', err);
      }
    });

    ws.on('close', () => {
      alive.delete(ws);
      if (room && playerId) room.leave(playerId);
      room = null;
      playerId = null;
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  server.on('close', () => {
    clearInterval(heartbeat);
    wss.close();
  });

  return server;
}
