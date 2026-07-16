import {
  ROOM_CODE_LENGTH,
  type BotDifficulty,
  type GameState,
  type LobbyPlayer,
  type PlayerId,
} from '@bomber/shared';
import { PLAYER_COLORS } from './game';

export interface LobbyCallbacks {
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onStart: () => void;
  onAddBot: (difficulty: BotDifficulty) => void;
  onRemoveBot: (botId: PlayerId) => void;
}

const DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
};

const ERROR_TEXT: Record<string, string> = {
  room_not_found: 'Partie introuvable — vérifie le code.',
  room_full: 'Cette partie est pleine (4 joueurs max).',
  game_in_progress: 'Cette partie a déjà commencé.',
  bad_code: `Le code doit faire ${ROOM_CODE_LENGTH} lettres.`,
  connection_lost: 'Connexion perdue — recharge la page.',
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let toastTimer = 0;
let goTimer = 0;
// Joueurs déjà affichés dans la salle : seuls les nouveaux « tombent » (.player-drop).
let knownPlayerIds = new Set<PlayerId>();

// Parameters
//   cb — callbacks déclenchés par les actions utilisateur (créer, rejoindre, lancer)
// What it does
//   Branche les écouteurs des écrans DOM : soumission du formulaire d'accueil
//   (créer), bouton/touche Entrée pour rejoindre avec un code 4 lettres validé
//   localement, et bouton Lancer de la salle d'attente.
// Output
//   void
export function initLobby(cb: LobbyCallbacks): void {
  const name = el<HTMLInputElement>('input-name');
  const code = el<HTMLInputElement>('input-code');

  el<HTMLFormElement>('form-home').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = name.value.trim();
    if (n) cb.onCreate(n);
    else name.focus();
  });

  const join = (): void => {
    const n = name.value.trim();
    const c = code.value.trim().toUpperCase();
    if (!n) {
      name.focus();
      return;
    }
    if (!new RegExp(`^[A-Z]{${ROOM_CODE_LENGTH}}$`).test(c)) {
      showError('bad_code');
      code.focus();
      return;
    }
    cb.onJoin(c, n);
  };
  el('btn-join').addEventListener('click', join);
  code.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      join();
    }
  });

  el('btn-start').addEventListener('click', () => cb.onStart());
  el('btn-add-bot').addEventListener('click', () => {
    cb.onAddBot(el<HTMLSelectElement>('bot-difficulty').value as BotDifficulty);
  });
  onRemoveBot = cb.onRemoveBot;
}

// Mémorisé à l'init pour que renderRoom puisse câbler les croix de retrait.
let onRemoveBot: (botId: PlayerId) => void = () => {};

// Parameters
//   name — écran à afficher : 'home', 'room' ou 'game'
// What it does
//   Affiche l'écran demandé et masque les deux autres.
// Output
//   void
export function showScreen(name: 'home' | 'room' | 'game'): void {
  for (const s of ['home', 'room', 'game'] as const) el(`screen-${s}`).hidden = s !== name;
}

// Parameters
//   code — code 4 lettres de la room
//   players — joueurs présents, dans l'ordre d'arrivée (= ordre des couleurs)
//   hostId — identifiant de l'hôte
//   selfId — identifiant du joueur local
// What it does
//   Met à jour la salle d'attente : code partageable bien visible, liste des
//   joueurs avec leur pastille couleur et badges hôte/toi, bouton Lancer
//   visible pour l'hôte seul et désactivé sous 2 joueurs.
// Output
//   void
export function renderRoom(code: string, players: LobbyPlayer[], hostId: PlayerId, selfId: PlayerId): void {
  el('room-code').textContent = code;

  const isHost = selfId === hostId;
  const list = el('player-list');
  list.textContent = '';
  players.forEach((p, i) => {
    const li = document.createElement('li');
    if (!knownPlayerIds.has(p.id)) li.classList.add('player-drop');
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = PLAYER_COLORS[i % PLAYER_COLORS.length];
    const label = document.createElement('span');
    label.className = 'player-name';
    label.textContent = p.name;
    li.append(swatch, label);
    if (p.bot && p.difficulty) li.append(makeBadge(`bot · ${DIFFICULTY_LABEL[p.difficulty]}`));
    if (p.id === hostId) li.append(makeBadge('hôte'));
    if (p.id === selfId) li.append(makeBadge('toi'));
    if (p.bot && isHost) {
      const kick = document.createElement('button');
      kick.className = 'kick';
      kick.textContent = '×';
      kick.setAttribute('aria-label', `Retirer le bot ${p.name}`);
      kick.addEventListener('click', () => onRemoveBot(p.id));
      li.append(kick);
    }
    list.append(li);
  });
  knownPlayerIds = new Set(players.map((p) => p.id));

  const canStart = players.length >= 2;
  const startBtn = el<HTMLButtonElement>('btn-start');
  startBtn.hidden = !isHost;
  startBtn.disabled = !canStart;
  el('start-hint').hidden = !isHost || canStart;
  el('wait-hint').hidden = isHost;
  el('bot-controls').hidden = !isHost;
  el<HTMLButtonElement>('btn-add-bot').disabled = players.length >= 4;
}

function makeBadge(text: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = text;
  return badge;
}

// Parameters
//   code — code d'erreur serveur ou local (room_not_found, connection_lost, …)
// What it does
//   Affiche le message français correspondant dans le toast (role="alert")
//   puis le masque après 4 secondes — sauf connection_lost, qui reste affiché :
//   sans WebSocket l'app est inerte et l'utilisateur doit recharger la page.
// Output
//   void
export function showError(code: string): void {
  const toast = el('toast');
  toast.textContent = ERROR_TEXT[code] ?? 'Erreur inattendue.';
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (code === 'connection_lost') return;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

// Parameters
//   (aucun)
// What it does
//   Affiche le flash « GO ! » plein écran au début de partie puis le masque
//   après ~650 ms. Purement décoratif : pointer-events none et aria-hidden,
//   il ne retarde ni ne masque jamais les inputs — la partie tourne dessous.
// Output
//   void
export function showGoFlash(): void {
  const flash = el('go-flash');
  flash.hidden = false; // display none → grid : l'animation CSS redémarre
  clearTimeout(goTimer);
  goTimer = window.setTimeout(() => {
    flash.hidden = true;
  }, 650);
}

// Parameters
//   text — texte de fin ("X gagne !" ou "Match nul")
// What it does
//   Affiche l'overlay de fin de partie par-dessus le canvas.
// Output
//   void
export function showGameOver(text: string): void {
  el('end-title').textContent = text;
  el('overlay-end').hidden = false;
}

// Parameters
//   (aucun)
// What it does
//   Masque l'overlay de fin de partie (retour automatique en salle d'attente).
// Output
//   void
export function hideGameOver(): void {
  el('overlay-end').hidden = true;
}

// Parameters
//   state — dernier snapshot serveur
//   selfId — identifiant du joueur local
// What it does
//   Met à jour le HUD : nombre de joueurs vivants et stats du joueur local
//   (bombes simultanées, portée de flamme, vitesse).
// Output
//   void
export function updateHud(state: GameState, selfId: PlayerId): void {
  const alive = state.players.filter((p) => p.alive).length;
  el('hud-alive').textContent = `Vivants ${alive}/${state.players.length}`;
  const me = state.players.find((p) => p.id === selfId);
  el('hud-stats').textContent = me ? `Bombes ${me.maxBombs} · Portée ${me.flame} · Vitesse ${me.speed}` : '';
}
