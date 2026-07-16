import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  createGame,
  EMPTY_INPUT,
  MAX_PLAYERS,
  step,
  TICK_MS,
  type GameState,
  type InputState,
  type LobbyPlayer,
  type PlayerId,
  type ServerMsg,
} from '@bomber/shared';

// Ticks joués après la fin de partie pour laisser les flammes finales
// se consumer à l'écran avant le retour au lobby.
const OVER_EXTRA_TICKS = 60;

// Rattrapage : si un client a plus d'inputs en attente que ça (dérive d'horloge,
// onglet figé puis rafale), on saute directement aux plus récents.
const MAX_INPUT_LEAD = 6;

// File d'inputs d'un joueur : un input par tick CLIENT, consommés un par tick
// serveur ; lastApplied est acquitté dans chaque snapshot pour permettre au
// client de rejouer ses inputs non encore pris en compte.
interface InputFeed {
  keys: InputState; // dernières touches appliquées (réutilisées si la file est vide)
  buffer: Map<number, InputState>;
  lastApplied: number;
}

export type JoinError = 'room_full' | 'game_in_progress';

interface Client {
  id: PlayerId;
  name: string;
  ws: WebSocket;
}

// Une partie et son lobby : machine à états lobby → running → lobby.
// Le serveur est autoritaire — les clients n'envoient que des inputs.
export class Room {
  readonly code: string;
  private readonly onEmpty: () => void;
  private clients: Client[] = [];
  private hostId: PlayerId = '';
  private phase: 'lobby' | 'running' = 'lobby';
  private state: GameState | null = null;
  private feeds = new Map<PlayerId, InputFeed>();
  private timer: NodeJS.Timeout | null = null;
  private overTicksLeft = -1;

  constructor(code: string, onEmpty: () => void) {
    this.code = code;
    this.onEmpty = onEmpty;
  }

  // Parameters
  //   ws — connexion WebSocket du joueur
  //   name — nom déjà validé par parseClientMsg
  // What it does
  //   Ajoute le joueur au lobby (le premier arrivé devient hôte), lui envoie
  //   `joined` et diffuse le nouvel état `lobby` aux autres joueurs.
  // Output
  //   { id } du joueur, ou { error } si la room est pleine ou en partie
  join(ws: WebSocket, name: string): { id: PlayerId } | { error: JoinError } {
    if (this.phase !== 'lobby') return { error: 'game_in_progress' };
    if (this.clients.length >= MAX_PLAYERS) return { error: 'room_full' };
    const id = randomUUID();
    this.clients.push({ id, name, ws });
    if (this.clients.length === 1) this.hostId = id;
    this.send(ws, {
      type: 'joined',
      playerId: id,
      roomCode: this.code,
      players: this.lobbyPlayers(),
      hostId: this.hostId,
    });
    this.broadcast({ type: 'lobby', players: this.lobbyPlayers(), hostId: this.hostId }, id);
    return { id };
  }

  // Parameters
  //   playerId — joueur demandant le démarrage
  // What it does
  //   Démarre la partie si le demandeur est l'hôte, que la room est en lobby
  //   et qu'il y a au moins 2 joueurs : seed aléatoire (crypto), broadcast
  //   `start`, puis boucle de simulation à TICK_MS. Sinon ne fait rien.
  // Output
  //   None
  start(playerId: PlayerId): void {
    if (playerId !== this.hostId || this.phase !== 'lobby' || this.clients.length < 2) return;
    const seed = randomBytes(4).readUInt32BE(0);
    this.state = createGame(seed, this.clients.map((c) => c.id));
    this.feeds = new Map(
      this.clients.map((c) => [c.id, { keys: EMPTY_INPUT, buffer: new Map(), lastApplied: -1 }])
    );
    this.phase = 'running';
    this.overTicksLeft = -1;
    this.broadcast({ type: 'start', seed });
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  // Parameters
  //   playerId — joueur émetteur
  //   tick — numéro de tick client de cet input (croissant)
  //   keys — état des touches validé par parseClientMsg
  // What it does
  //   Range l'input dans la file du joueur, indexé par tick client. La file est
  //   bornée : seuls les inputs les plus récents sont conservés.
  // Output
  //   None
  setInput(playerId: PlayerId, tick: number, keys: InputState): void {
    const feed = this.feeds.get(playerId);
    if (!feed || tick <= feed.lastApplied) return;
    feed.buffer.set(tick, keys);
    if (feed.buffer.size > 32) {
      const ticks = [...feed.buffer.keys()].sort((a, b) => a - b);
      for (const t of ticks.slice(0, ticks.length - 16)) feed.buffer.delete(t);
    }
  }

  // Avance la file d'un joueur d'un tick client : consomme le plus ancien input
  // en attente (ou saute aux plus récents si le retard dépasse MAX_INPUT_LEAD) ;
  // file vide ⇒ les dernières touches connues restent appliquées.
  private consumeFeed(feed: InputFeed): void {
    const pending = [...feed.buffer.keys()].filter((t) => t > feed.lastApplied).sort((a, b) => a - b);
    if (pending.length === 0) return;
    const next = pending.length > MAX_INPUT_LEAD ? pending[pending.length - MAX_INPUT_LEAD] : pending[0];
    feed.keys = feed.buffer.get(next)!;
    feed.lastApplied = next;
    for (const t of pending) if (t <= next) feed.buffer.delete(t);
  }

  // Parameters
  //   playerId — joueur qui part (message leave ou déconnexion)
  // What it does
  //   Retire le joueur : en lobby il disparaît de la liste, en partie son
  //   personnage est marqué mort dans l'état courant. Réattribue l'hôte si
  //   besoin. Room vide ⇒ arrêt de la boucle et retrait du registre.
  // Output
  //   None
  leave(playerId: PlayerId): void {
    const idx = this.clients.findIndex((c) => c.id === playerId);
    if (idx === -1) return;
    this.clients.splice(idx, 1);
    this.feeds.delete(playerId);
    if (this.state) {
      const player = this.state.players.find((p) => p.id === playerId);
      if (player) player.alive = false;
    }
    if (this.clients.length === 0) {
      this.stopLoop();
      this.onEmpty();
      return;
    }
    if (this.hostId === playerId) this.hostId = this.clients[0].id;
    if (this.phase === 'lobby') {
      this.broadcast({ type: 'lobby', players: this.lobbyPlayers(), hostId: this.hostId });
    }
  }

  private tick(): void {
    // Une exception ici remonterait hors du setInterval et tuerait le process
    // entier (toutes les rooms) : on sacrifie la partie, pas le serveur.
    try {
      if (!this.state) return;
      const inputs: Record<PlayerId, InputState> = {};
      const acks: Record<PlayerId, number> = {};
      for (const [id, feed] of this.feeds) {
        this.consumeFeed(feed);
        inputs[id] = feed.keys;
        acks[id] = feed.lastApplied;
      }
      this.state = step(this.state, inputs);
      this.broadcast({ type: 'snapshot', state: this.state, acks });
      if (this.state.phase !== 'over') return;
      if (this.overTicksLeft === -1) {
        this.overTicksLeft = OVER_EXTRA_TICKS;
        this.broadcast({ type: 'gameover', winner: this.state.winner });
      } else if (--this.overTicksLeft <= 0) {
        this.backToLobby();
      }
    } catch (err) {
      console.error(`room ${this.code}: erreur dans la boucle de jeu, retour au lobby`, err);
      this.backToLobby();
    }
  }

  private backToLobby(): void {
    this.stopLoop();
    this.phase = 'lobby';
    this.state = null;
    this.feeds = new Map();
    this.overTicksLeft = -1;
    this.broadcast({ type: 'lobby', players: this.lobbyPlayers(), hostId: this.hostId });
  }

  private stopLoop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.clients.map((c) => ({ id: c.id, name: c.name }));
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg, exceptId?: PlayerId): void {
    const raw = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.id !== exceptId && c.ws.readyState === WebSocket.OPEN) c.ws.send(raw);
    }
  }
}
