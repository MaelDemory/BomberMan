import type { ClientMsg, LobbyPlayer, PlayerId, ServerMsg } from '@bomber/shared';
import { connect } from './net';
import { createGameView, type GameView } from './game';
import { trackInput, type InputTracker } from './input';
import {
  hideGameOver,
  initLobby,
  renderRoom,
  showError,
  showGameOver,
  showScreen,
  updateHud,
} from './lobby';

const INPUT_RESEND_MS = 100;

let send: (msg: ClientMsg) => void = () => {};
let view: GameView;
let selfId: PlayerId = '';
let roomCode = '';
let players: LobbyPlayer[] = [];
let hostId: PlayerId = '';
let playing = false;
let input: InputTracker | null = null;
let resendTimer = 0;

function startPlaying(): void {
  playing = true;
  // Envoi de l'état des touches à chaque changement + réémission périodique
  // (le serveur applique le dernier état connu ; la réémission couvre les
  // messages perdus ou un serveur redémarré en dev).
  input = trackInput((keys) => send({ type: 'input', keys }));
  resendTimer = window.setInterval(() => {
    if (input) send({ type: 'input', keys: input.get() });
  }, INPUT_RESEND_MS);
}

function stopPlaying(): void {
  playing = false;
  input?.stop();
  input = null;
  clearInterval(resendTimer);
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
      startPlaying();
      break;
    case 'snapshot':
      view.pushSnapshot(msg.state);
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
  });
  view = await createGameView(el('canvas-wrap'));
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
