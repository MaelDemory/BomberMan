import type { InputState } from '@bomber/shared';

// event.code désigne la touche PHYSIQUE : ZQSD sur AZERTY et WASD sur QWERTY
// produisent les mêmes codes KeyW/KeyA/KeyS/KeyD — les deux dispositions
// fonctionnent donc sans détection de clavier.
const KEY_BY_CODE: Record<string, keyof InputState> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'bomb',
};

export interface InputTracker {
  get: () => InputState;
  stop: () => void;
}

// Parameters
//   onChange — appelé avec une copie de l'état à chaque changement de touche
// What it does
//   Suit flèches + ZQSD/WASD + espace via event.code et neutralise le
//   défilement de la page. Quand la fenêtre perd le focus, toutes les touches
//   sont relâchées pour éviter les touches fantômes (keyup jamais reçu).
// Output
//   InputTracker { get, stop } — état courant et désabonnement des écouteurs
export function trackInput(onChange: (keys: InputState) => void): InputTracker {
  const state: InputState = { up: false, down: false, left: false, right: false, bomb: false };

  const set = (key: keyof InputState, value: boolean): void => {
    if (state[key] === value) return;
    state[key] = value;
    onChange({ ...state });
  };

  const onKey = (down: boolean) => (ev: KeyboardEvent) => {
    const key = KEY_BY_CODE[ev.code];
    if (!key) return;
    ev.preventDefault();
    if (!ev.repeat) set(key, down);
  };
  const onDown = onKey(true);
  const onUp = onKey(false);
  const onBlur = (): void => {
    for (const k of Object.keys(state) as (keyof InputState)[]) state[k] = false;
    onChange({ ...state });
  };

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);

  return {
    get: () => ({ ...state }),
    stop: () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
