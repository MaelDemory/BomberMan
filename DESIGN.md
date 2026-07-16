# DESIGN.md

## Product context
- Product: Bomber Break — Bomberman multijoueur navigateur (rooms privées à code, 2-4 joueurs)
- Audience: collègues en pause, desktop d'entreprise, sessions de 3-5 minutes
- Primary job: rejoindre une partie en moins de 15 secondes (pseudo → code → jeu) et lire l'action du jeu sans effort
- Brand personality: arcade, précis, sombre, joueur, sobre

## Design principles
- Lisibilité de jeu avant tout — chaque entité (mur, bloc, bombe, flamme, power-up, joueur) a une silhouette et une couleur non ambiguës.
- Zéro friction hors-jeu — les écrans DOM (accueil, salle d'attente) tiennent dans une seule colonne, une seule action principale par écran.
- Self-contained — aucune requête externe : polices système, formes dessinées par code (PIXI.Graphics), SVG inline.
- L'amber est un signal — la couleur accent (fusible) est réservée aux actions primaires et aux éléments "chauds" (code de room, bombes) ; jamais décorative.

## Visual identity
- Signature element: la "mèche" — trait pointillé amber animé (underline du logo, motif du code de room) qui évoque le fusible d'une bombe.
- Style direction: arcade rétro moderne — fond quasi-noir bleuté, typographie monospace capitale à fort letter-spacing pour les titres/codes, surfaces plates à bordure fine (pas de glassmorphism, pas de gradient décoratif).
- Anti-patterns to avoid: gradients violet/rose génériques, cartes imbriquées (card > panel > card), emoji comme icônes, texte basse-contraste sur surfaces sombres, métadonnées redondantes dans la liste des joueurs.

## Tokens
| Token | Value | Usage |
|---|---|---|
| Color / background | `#0F1116` | fond de page |
| Color / surface | `#171A22` | panneaux, lignes de liste |
| Color / surface-raised | `#1E222D` | overlay de fin, états désactivés |
| Color / border | `#2A2F3C` | bordures 1px des surfaces et champs |
| Color / text | `#EDEEF2` | texte principal (AA sur bg et surfaces) |
| Color / text-muted | `#9AA3B2` | hints, labels, HUD secondaire |
| Color / accent | `#FFB300` | boutons primaires, code de room, mèche, focus ring |
| Color / accent-ink | `#1A1206` | texte sur fond accent |
| Color / danger | `#FF9C9C` sur `#2A1215` | toasts d'erreur |
| Color / player-1 | `#45D4FF` | joueur 1 (cyan) — DOM et Pixi |
| Color / player-2 | `#FF5D8F` | joueur 2 (rose) |
| Color / player-3 | `#7DE84B` | joueur 3 (vert) |
| Color / player-4 | `#FFC53D` | joueur 4 (or) |
| Type / display | `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace` | logo, code de room, HUD, pseudos in-game — capitales + letter-spacing |
| Type / body | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | formulaires, hints, messages |
| Space / rhythm | échelle 4px (4/8/12/16/24/32/48) | padding, gaps |

Couleurs de jeu (canvas, dessinées par code) : sol damier `#161922`/`#181C26`, mur `#333B4D` (arête claire `#414B61`), bloc destructible `#8A5A33` (caisse), flamme `#FF7A45` cœur `#FFD23F`, corps de bombe `#10131A` contour amber → rouge `#FF5D5D` en fin de mèche.

## Components
| Component | Rule | Reuse path |
|---|---|---|
| Button | `.btn` + `.btn-primary` (fond accent, texte accent-ink) ou `.btn-secondary` (bordure, fond transparent). Désactivé : fond surface-raised + texte muted + bordure — jamais accent délavé. Hover/active/focus-visible obligatoires. | `apps/client/src/style.css` |
| Panel | Un seul niveau : fond surface, bordure 1px border, radius 12px. Pas de panneau dans un panneau. | `apps/client/src/style.css` |
| Player row | Ligne de liste plate : pastille couleur 14px + pseudo + badges pill (`hôte`, `toi`) uniquement quand l'information n'est pas déduite du contexte. | `apps/client/src/lobby.ts` |
| Toast | Fixe en haut, fond danger, disparaît après 4 s, `role="alert"`. | `apps/client/src/lobby.ts` |
| HUD | Une ligne monospace au-dessus du canvas : vivants à gauche, stats locales à droite. Pas de panneau. | `apps/client/src/lobby.ts` |

## Layout rules
- Breakpoints: mobile-first ; colonne unique max 380px (accueil/salle), canvas `min(600px, 100%)` ; ajustements < 480px (padding, letter-spacing du code).
- Hero/section sizing: pas de hero — le shell est centré verticalement avec padding 48px, le canvas garde son ratio 15:13 (`width:100%; height:auto`).
- Grid/alignment: tout aligné sur la colonne centrale ; le HUD partage exactement la largeur du canvas.

## Interaction and motion
- Hover/focus/active states: hover = variation de fond/bordure ; active = translateY(1px) ; focus = `:focus-visible` outline 2px accent offset 2px sur tout élément interactif.
- Motion: DOM — uniquement la mèche animée (dash-offset, 1.2s linear) et transitions ≤ 150ms ; canvas — pulsation des bombes accélérant à l'approche de `explodeAt` (information de gameplay, pas décorative).
- `prefers-reduced-motion: reduce` : mèche figée, transitions coupées. La pulsation des bombes est conservée (signal de danger) mais son amplitude reste faible (≤ 12%).

## Accessibility
- Contrast target: WCAG AA minimum — texte `#EDEEF2` et muted `#9AA3B2` passent sur bg/surface ; texte de bouton primaire `#1A1206` sur `#FFB300`.
- Keyboard/focus: parcours complet au clavier (pseudo → créer / code → rejoindre → lancer) ; Entrée dans le champ code déclenche Rejoindre ; focus ring visible partout.
- Semantics: `<form>` pour l'accueil, `<button>` réels, labels associés aux champs, toast en `role="alert"`, SVG décoratif en `aria-hidden`.

## Page overrides
- `screen-game` — fond du canvas légèrement plus clair que la page (`#12141B`) pour détacher l'aire de jeu ; les pseudos in-game reprennent la couleur du joueur.

## Maintenance notes
- Last updated: 2026-07-16
- Update when: nouveau token, nouvel écran, changement de palette joueurs, ou règle de rendu canvas réutilisable (formes power-ups, etc.).
