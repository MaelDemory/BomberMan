# Architecture — Bomberman multijoueur navigateur (monorepo full TypeScript)

## Scope
- Couvert : monorepo TypeScript complet — simulation partagée, serveur autoritaire Node + `ws`, client PixiJS, protocole réseau, build et déploiement Fly.io/Railway.
- Réutilisabilité : le package partagé sépare le générique (boucle, RNG seedé, types réseau) des règles Bomberman, pour accueillir un futur Worms sans refonte.
- Non-goals (v1) : comptes/persistance, matchmaking public, prédiction client, anti-triche avancé, scaling horizontal, mobile natif.

## Current structure
- Projet vierge (`/Users/mael/Documents/bomberman`, seul `.claude/` présent). Pas de dépôt git initialisé.

## Stack
| Layer | Current / proposed choice | Reason | Alternatives rejected |
|---|---|---|---|
| Frontend | Vite + TypeScript + PixiJS (rendu) + DOM (lobby/menus) | Renderer léger (~200 Ko), contrôle total de la boucle, réutilisable pour Worms ; UI hors-jeu en HTML normal | Phaser 4 (framework complet mais abstractions imposées), Canvas 2D natif (viable mais PixiJS donne WebGL/WebGPU gratuit) |
| Backend/API | Node.js 22 + `ws` (WebSocket), serveur autoritaire | Choix validé : minimaliste, zéro magie, ~300 lignes de synchro pour un Bomberman | Colyseus (abstractions structurantes non nécessaires), Go (écarté après audit comparatif) |
| Data/storage | État en mémoire (Map de rooms) | Parties éphémères entre collègues, aucune donnée à persister | Redis/Postgres (inutiles en v1) |
| Infra/deploy | Docker mono-conteneur → Fly.io ou Railway ; le serveur Node sert aussi le client buildé | Un seul service, WSS sur 443 (passe les proxys d'entreprise), ~0-5 €/mois | Vercel/Netlify (pas de WebSocket persistant), VPS (setup manuel superflu) |
| Monorepo tooling | npm workspaces + TypeScript project references | Natif npm, zéro outil supplémentaire pour 3 packages | pnpm/Turborepo/Nx (surdimensionnés à cette échelle) |
| Tests | Vitest (sim + serveur) | Standard de l'écosystème Vite, rapide | Jest (config TS plus lourde) |

## Target structure

```
bomberman/
├── package.json                # workspaces: ["packages/*", "apps/*"], scripts racine
├── tsconfig.base.json          # strict: true, options partagées
├── packages/
│   └── shared/                 # @bomber/shared — importé par client ET serveur
│       └── src/
│           ├── engine/         # GÉNÉRIQUE (réutilisable Worms) : boucle à pas fixe,
│           │                   #   RNG seedé, types de base (Vec2, PlayerId, Tick)
│           ├── bomberman/      # RÈGLES DU JEU : GameState, step(state, inputs),
│           │                   #   grille, bombes, explosions, power-ups, conditions de victoire
│           └── protocol/       # Messages client↔serveur (types + validation)
├── apps/
│   ├── server/                 # Node + ws : rooms, boucle 20 Hz, diffusion snapshots,
│   │   └── src/                #   sert apps/client/dist en statique (même port)
│   └── client/                 # Vite + PixiJS : rendu interpolé, input, lobby DOM
│       └── src/
├── Dockerfile                  # build workspaces → image Node
└── fly.toml
```

Règles de dépendance (strictes) :
- `shared/engine` ne dépend de rien ; `shared/bomberman` dépend d'`engine` ; `shared/protocol` dépend des types de `bomberman`.
- `shared` n'importe **ni** API DOM **ni** API Node — simulation pure, testable, portable.
- `apps/*` importent `shared` ; jamais l'inverse ; `client` et `server` ne s'importent jamais entre eux.

Flux de données :

```mermaid
flowchart TD
  subgraph Client [apps/client — navigateur]
    Input[Clavier] --> WS_C[WebSocket client]
    WS_C --> Interp[Buffer snapshots + interpolation]
    Interp --> Pixi[Rendu PixiJS 60 fps]
    Lobby[Lobby DOM] --> WS_C
  end
  subgraph Server [apps/server — Node, autoritaire]
    WS_S[ws : 1 connexion/joueur] --> Room[Room : boucle 20 Hz]
    Room -->|"step(state, inputs)"| Sim[@bomber/shared]
    Room -->|snapshot 20 Hz| WS_S
  end
  WS_C <-->|"WSS 443 (JSON v1)"| WS_S
  Sim -.->|même code importé| Interp
```

## Contracts
- **Simulation (`@bomber/shared`)** : `step(state: GameState, inputs: Map<PlayerId, Input>): GameState` — fonction pure, déterministe, à pas fixe (tick = 50 ms / 20 Hz). Bomberman est entier par nature (grille) : pas de flottants dans l'état. *Invariant à préserver pour Worms : tout flottant futur passera en virgule fixe.*
- **Protocole (JSON sur WebSocket, v1)** — source de vérité : `packages/shared/src/protocol/messages.ts` :
  - Client → serveur : `{type:"create", name}`, `{type:"join", roomCode, name}`, `{type:"start"}` (hôte uniquement), `{type:"input", keys}` (état des touches, pas d'événements), `{type:"leave"}`.
  - Serveur → client : `{type:"joined", playerId, roomCode, players, hostId}`, `{type:"lobby", players, hostId}`, `{type:"start", seed}`, `{type:"snapshot", state}` (état complet à 20 Hz, tick inclus dans state — suffisant pour un état de quelques Ko ; delta-encoding = optimisation future), `{type:"gameover", winner}`, `{type:"error", code}`.
  - Tout message entrant est validé côté serveur avant usage ; message inconnu ou malformé → ignoré + log.
- **Rooms** : code 4 lettres généré serveur, 2-4 joueurs, démarrage par l'hôte, room détruite quand vide. Serveur = source de vérité unique ; le client n'envoie que des inputs.
- **Client** : rendu à requestAnimationFrame, interpolation entre les 2 derniers snapshots (retard ~100 ms). Pas de prédiction locale en v1.
- **HTTP** : `GET /` sert le client buildé ; `GET /health` pour la plateforme ; upgrade WebSocket sur `/ws`. Un seul port.

## Cost / operations estimate
| Area | Approx cost / complexity | Notes |
|---|---:|---|
| Runtime/hosting | 0-5 €/mois | 1 machine Fly.io/Railway (256-512 Mo), suffisant pour des dizaines de joueurs simultanés |
| Database/storage | 0 € | Tout en mémoire ; un redéploiement coupe les parties en cours (accepté) |
| Third-party APIs | 0 € | Aucune |
| Maintenance | Low | Mono-conteneur, pas de migration, `fly deploy` unique |

Hypothèses : ≤ ~10 rooms simultanées, joueurs en Europe (latence 20-60 ms), pas d'exigence de disponibilité.

## Risks
- **Node mono-thread** : un tick coûteux bloque toutes les rooms. Négligeable pour Bomberman (grille 15×13, ≤ 4 joueurs) ; à resurveiller pour la physique Worms.
- **Pas de prédiction client** : les déplacements ont ~½ RTT + interpolation de latence perçue. Acceptable en Europe ; si ressenti "mou", la prédiction s'ajoute côté client sans changer le protocole (la sim partagée est déjà là — c'est le but de l'architecture).
- **Snapshots complets JSON** : bande passante ~quelques Ko × 20 Hz × joueurs. Trivial en v1 ; delta/binaire seulement si mesure le justifie.
- **Proxy d'entreprise** : WebSocket parfois filtré ; mitigé par WSS sur 443 (défaut Fly/Railway). À tester tôt depuis le réseau Arjo.
- **Réutilisation Worms** : risque de sur-généraliser `engine/` avant d'avoir le second jeu. Règle : `engine/` ne reçoit que ce que Bomberman utilise réellement ; la généralisation se fera à l'arrivée de Worms.
- **URL publique** : le jeu est accessible à quiconque a l'URL + un code de room. Pas de donnée sensible ; accepté.

## Decisions
- **npm workspaces sans Turbo/Nx** — 3 packages ne justifient aucun orchestrateur ; rejeté : pnpm + Turborepo.
- **`ws` maison plutôt que Colyseus** — contrôle total, protocole trivial à cette échelle ; rejeté : Colyseus (validé par l'utilisateur à l'étape stack).
- **PixiJS plutôt que Phaser 4 ou Canvas natif** — renderer sans framework : la boucle et l'état restent à nous (cohérent avec la sim partagée), réutilisable pour Worms ; rejeté : Phaser (scène/physique intégrées redondantes avec notre sim), Canvas natif (aucun gain vs PixiJS).
- **Snapshots complets + inputs, sans prédiction (v1)** — le plus simple qui fonctionne ; la prédiction est une extension client-only prévue par l'architecture ; rejeté : lockstep (fragile aux déconnexions), delta-encoding immédiat (optimisation prématurée).
- **Mono-conteneur servant client + WS** — un déploiement, pas de CORS, même origine ; rejeté : client sur CDN + serveur séparé.
- **État en mémoire sans persistance** — parties de pause-café ; rejeté : Redis.

## Verification plan
- `npm run typecheck` (racine) : project references compilent, frontières de packages respectées.
- Vitest sur `shared/bomberman` : tests unitaires des règles (propagation d'explosion, collisions, morts) + **test de déterminisme** : même seed + même séquence d'inputs rejouée deux fois ⇒ états finaux strictement égaux.
- Vitest sur `apps/server` : cycle create/join/input/snapshot contre un serveur en mémoire ; messages malformés ignorés sans crash.
- Manuel : `npm run dev`, deux navigateurs en local, partie complète (join → bombes → victoire) ; vérifier la fluidité de l'interpolation.
- Déploiement : build Docker local, `GET /health`, puis partie réelle via l'URL publique — dont un test depuis le réseau d'entreprise (WSS/443).
