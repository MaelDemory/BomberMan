import type { ClientMsg, LobbyPlayer, PlayerId, ServerMsg } from '@bomber/shared';
import { connect } from './net';
import { createGameView, type GameView } from './game';
import { trackInput, type InputTracker } from './input';
import {
  hideGameOver,
  initLobby,
  renderLeaderboard,
  renderRoom,
  showError,
  showGameOver,
  showGoFlash,
  showScreen,
  updateHud,
} from './lobby';

// Parameters
//   (aucun)
// What it does
//   Charge le classement général (GET /scores) et le rend sur l'accueil.
//   Toute erreur réseau laisse simplement le tableau vide.
// Output
//   Promise<void>
async function loadScores(): Promise<void> {
  try {
    const res = await fetch('/scores');
    if (res.ok) renderLeaderboard(await res.json());
  } catch {
    // Hors ligne ou serveur froid : le classement reste vide, sans bruit.
  }
}

let send: (msg: ClientMsg) => void = () => {};
let view: GameView;
let selfId: PlayerId = '';
let roomCode = '';
let players: LobbyPlayer[] = [];
let hostId: PlayerId = '';
let playing = false;
let input: InputTracker | null = null;

function startPlaying(): void {
  playing = true;
  // Les touches alimentent la prédiction locale ; c'est la boucle de prédiction
  // (dans la vue) qui envoie un input daté par tick au serveur.
  input = trackInput((keys) => view.setInput(keys));
}

function stopPlaying(): void {
  playing = false;
  input?.stop();
  input = null;
}

function handleMsg(msg: ServerMsg): void {
  switch (msg.type) {
    case 'joined':
      selfId = msg.playerId;
      roomCode = msg.roomCode;
      players = msg.players;
      hostId = msg.hostId;
      renderRoom(roomCode, players, hostId, selfId);
      showScreen('room');
      break;
    case 'lobby':
      players = msg.players;
      hostId = msg.hostId;
      renderRoom(roomCode, players, hostId, selfId);
      if (!playing) {
        // Retour automatique en salle d'attente (notamment après un gameover).
        hideGameOver();
        showScreen('room');
      }
      break;
    case 'start':
      hideGameOver();
      view.start(players, selfId);
      showScreen('game');
      showGoFlash(); // décoratif et non bloquant : la partie a déjà démarré côté serveur
      startPlaying();
      break;
    case 'snapshot':
      view.pushSnapshot(msg.state, msg.acks[selfId] ?? -1);
      updateHud(msg.state, selfId);
      break;
    case 'gameover': {
      stopPlaying();
      if (msg.winner === null) {
        showGameOver('Match nul');
      } else {
        const winner = players.find((p) => p.id === msg.winner);
        showGameOver(`${winner?.name ?? 'Un joueur'} gagne !`);
      }
      break;
    }
    case 'error':
      showError(msg.code);
      break;
  }
}

// Parameters
//   (aucun)
// What it does
//   Point d'entrée : branche les écrans DOM, crée la vue PixiJS puis ouvre la
//   WebSocket ; les messages serveur pilotent ensuite toute la navigation.
// Output
//   Promise<void>
async function main(): Promise<void> {
  initLobby({
    onCreate: (name) => send({ type: 'create', name }),
    onJoin: (code, name) => send({ type: 'join', roomCode: code, name }),
    onStart: () => send({ type: 'start' }),
    onAddBot: (difficulty) => send({ type: 'addBot', difficulty }),
    onRemoveBot: (botId) => send({ type: 'removeBot', botId }),
  });
  void loadScores();
  view = await createGameView(el('canvas-wrap'), (tick, keys) => send({ type: 'input', tick, keys }));
  const net = connect(handleMsg, () => {
    stopPlaying();
    showError('connection_lost');
  });
  send = net.send;
}

function el(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

void main();
