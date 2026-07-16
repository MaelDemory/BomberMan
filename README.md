# Kablam! 💥

Le party game qui explose, gratuit dans ton navigateur. Un Bomberman multijoueur en ligne : 2 à 4 joueurs, un code de partie à partager, trois minutes de match.

**Jouer : https://bomberman-mael.fly.dev**

Crée une partie, partage le code 4 lettres, tes adversaires le saisissent pour rejoindre, l'hôte lance. Déplacement : flèches ou ZQSD/WASD · Bombe : espace.

Un projet perso open source de [Maël Demory](https://github.com/MaelDemory).

## Stack

Monorepo full TypeScript (npm workspaces) :

| Dossier | Rôle |
|---|---|
| `packages/shared` | Simulation déterministe (règles du jeu, PRNG seedé) + protocole réseau — importée par le client **et** le serveur |
| `apps/server` | Serveur autoritaire Node + `ws` : rooms, boucle de jeu 20 Hz, sert aussi le client buildé |
| `apps/client` | Vite + PixiJS : rendu interpolé, lobby en DOM natif |

Les choix d'architecture (serveur autoritaire, snapshots 20 Hz, état en mémoire, invariants de déterminisme) sont documentés dans [ARCHITECTURE.md](ARCHITECTURE.md), le design UI dans [DESIGN.md](DESIGN.md).

## Développement

```bash
npm install
npm run dev        # serveur :8080 + client Vite :5173 (proxy /ws)
```

Ouvre http://localhost:5173 dans deux onglets pour tester une partie.

```bash
npm run typecheck  # 3 workspaces, strict
npm test           # règles du jeu, déterminisme, intégration WebSocket
npm run build      # client (Vite) + serveur (bundle esbuild autonome)
```

## Déploiement

Chaque push sur `main` déclenche la GitHub Action [`deploy.yml`](.github/workflows/deploy.yml) : typecheck + tests, puis `flyctl deploy` vers Fly.io. Déploiement manuel possible avec `flyctl deploy`.

⚠️ L'état des parties vit en mémoire : un déploiement coupe les parties en cours.

## À venir

Le package `packages/shared/src/engine` est prévu pour être réutilisé par un second jeu type Worms (même serveur autoritaire, même déterminisme).
