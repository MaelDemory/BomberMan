import { randomInt } from 'node:crypto';
import { ROOM_CODE_LENGTH } from '@bomber/shared';
import { Room, type GameEndHandler } from './room';

// Alphabet sans I ni O pour éviter les confusions à la lecture d'un code.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const rooms = new Map<string, Room>();

function generateCode(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

// Parameters
//   onGameEnd — notifié à chaque fin de partie (enregistrement des scores)
// What it does
//   Crée une room avec un code unique de 4 lettres et l'enregistre ; la room
//   se retire elle-même du registre quand son dernier joueur part.
// Output
//   La Room créée
export function createRoom(onGameEnd: GameEndHandler): Room {
  const code = generateCode();
  const room = new Room(code, () => rooms.delete(code), onGameEnd);
  rooms.set(code, room);
  return room;
}

// Parameters
//   code — code de room normalisé par parseClientMsg (4 lettres majuscules)
// What it does
//   Recherche une room active dans le registre en mémoire.
// Output
//   La Room, ou undefined si aucune ne correspond
export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}
