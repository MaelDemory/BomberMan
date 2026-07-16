# Bomberman multijoueur — guide agent

Bomberman navigateur temps réel, monorepo full TypeScript. Contrat d'architecture : `ARCHITECTURE.md` (protocole, invariants, risques). Design UI : `DESIGN.md`.

## Structure
- `packages/shared` — simulation déterministe (`engine/` générique, `bomberman/` règles, `protocol/` messages). **Invariants : aucun import DOM/Node, aucun flottant dans l'état, PRNG dans l'état.** Prévu pour être réutilisé par un futur jeu type Worms.
- `apps/server` — serveur autoritaire Node + `ws`, boucle 20 Hz par room, sert aussi le client buildé (un seul port).
- `apps/client` — Vite + PixiJS (rendu interpolé ~100 ms) + lobby DOM natif.

## Commandes vérifiées
- `npm run dev` — serveur (8080) + client Vite (5173, proxy /ws) ensemble
- `npm run typecheck` / `npm test` — obligatoires avant de conclure toute modification
- `npm run build` puis `npm start` — build prod local
- `docker build -t bomberman .` — image de prod (ne pas supprimer `.dockerignore` : sans lui, `COPY . .` écrase le node_modules Linux par celui de macOS)
- Déploiement : `fly deploy` (config `fly.toml`, région cdg, auto-stop)

## Règles spécifiques
- Toute évolution du protocole passe par `packages/shared/src/protocol/messages.ts` (source de vérité) + mise à jour de la section Contracts d'ARCHITECTURE.md.
- Toute règle de jeu modifiée doit garder le test de déterminisme vert (`packages/shared/test/determinism.test.ts`).
- Le serveur ne fait jamais confiance au client : tout message entrant passe par `parseClientMsg`.
