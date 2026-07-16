export type PlayerId = string;

// État des touches d'un joueur pour un tick. Le client envoie cet état brut,
// le serveur l'applique tel quel : aucune commande dérivée côté client.
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  bomb: boolean;
}

export const EMPTY_INPUT: InputState = {
  up: false,
  down: false,
  left: false,
  right: false,
  bomb: false,
};
