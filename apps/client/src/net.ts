import type { ClientMsg, ServerMsg } from '@bomber/shared';

export interface Net {
  send: (msg: ClientMsg) => void;
  close: () => void;
}

// Parameters
//   onMsg — appelé pour chaque message serveur décodé
//   onClose — appelé quand la connexion se ferme (perte réseau incluse)
// What it does
//   Ouvre la WebSocket sur la même origine (/ws — proxifié par Vite en dev,
//   servi par le serveur Node en prod, aucune URL codée en dur) et décode
//   les messages JSON entrants ; tout message illisible est ignoré.
// Output
//   Net { send, close } pour émettre des ClientMsg typés
export function connect(onMsg: (msg: ServerMsg) => void, onClose: () => void): Net {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('message', (ev) => {
    let data: unknown;
    try {
      data = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (typeof data === 'object' && data !== null && 'type' in data) {
      onMsg(data as ServerMsg);
    }
  });
  ws.addEventListener('close', onClose);

  return {
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => ws.close(),
  };
}
