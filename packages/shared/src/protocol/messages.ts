import type { InputState, PlayerId } from '../engine/types';
import type { GameState } from '../bomberman/state';

export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 4;

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
}

export type ClientMsg =
  | { type: 'create'; name: string }
  | { type: 'join'; roomCode: string; name: string }
  | { type: 'start' }
  // tick = numéro de tick LOCAL du client (croissant) ; le serveur acquitte le
  // dernier tick consommé dans chaque snapshot, ce qui permet au client de
  // rejouer ses inputs non acquittés (réconciliation exacte, sans glissement).
  | { type: 'input'; tick: number; keys: InputState }
  | { type: 'leave' };

export type ServerMsg =
  | { type: 'joined'; playerId: PlayerId; roomCode: string; players: LobbyPlayer[]; hostId: PlayerId }
  | { type: 'lobby'; players: LobbyPlayer[]; hostId: PlayerId }
  | { type: 'start'; seed: number }
  | { type: 'snapshot'; state: GameState; acks: Record<PlayerId, number> }
  | { type: 'gameover'; winner: PlayerId | null }
  | { type: 'error'; code: 'room_not_found' | 'room_full' | 'game_in_progress' };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim().slice(0, MAX_NAME_LENGTH);
  return name.length > 0 ? name : null;
}

function cleanRoomCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

function cleanKeys(v: unknown): InputState | null {
  if (!isRecord(v)) return null;
  return {
    up: v.up === true,
    down: v.down === true,
    left: v.left === true,
    right: v.right === true,
    bomb: v.bomb === true,
  };
}

// Parameters
//   raw — texte brut reçu sur la WebSocket
// What it does
//   Parse et valide un message client. Tout champ texte est nettoyé (trim,
//   longueur bornée) ; tout message inconnu ou malformé est rejeté — le serveur
//   ne fait jamais confiance au client.
// Output
//   ClientMsg normalisé, ou null si le message est invalide
export function parseClientMsg(raw: string): ClientMsg | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  switch (data.type) {
    case 'create': {
      const name = cleanName(data.name);
      return name ? { type: 'create', name } : null;
    }
    case 'join': {
      const name = cleanName(data.name);
      const roomCode = cleanRoomCode(data.roomCode);
      return name && roomCode ? { type: 'join', roomCode, name } : null;
    }
    case 'start':
      return { type: 'start' };
    case 'input': {
      const keys = cleanKeys(data.keys);
      const tick = typeof data.tick === 'number' && Number.isInteger(data.tick) && data.tick >= 0 ? data.tick : null;
      return keys && tick !== null ? { type: 'input', tick, keys } : null;
    }
    case 'leave':
      return { type: 'leave' };
    default:
      return null;
  }
}
