# DESIGN.md

Direction « Kablam! » — remplace intégralement l'ancienne identité sombre « Bomber Break ».

## Product context
- Product: Kablam! — party game Bomberman multijoueur dans le navigateur (rooms privées à code, 2-4 joueurs)
- Audience: grand public, joueurs occasionnels sur desktop, sessions courtes entre amis
- Primary job: rejoindre une partie en moins de 15 secondes (pseudo → code → jeu) et lire l'action sans effort
- Brand personality: joyeux, physique, direct, pop, généreux

## Design principles
- Héritage Bomberman assumé — couleurs franches, formes rondes, ton enjoué ; jamais sombre ni corporate.
- Profondeur physique — les surfaces reposent sur des ombres portées dures (aucun flou) ; un bouton pressé s'enfonce réellement (feedback à l'appui, pas au relâchement).
- Rebonds justifiés — l'overshoot élastique est réservé aux arrivées (écrans, jetons joueurs, flash GO !) ; les simples fondus n'ont pas de rebond.
- Lisibilité de jeu avant tout — chaque entité du canvas (mur, bloc, bombe, flamme, power-up, joueur) a une silhouette et une couleur non ambiguës sur le damier crème.
- Self-contained strict — aucune requête externe : polices système (`ui-rounded`), formes dessinées par code (PIXI.Graphics), SVG inline.

## Visual identity
- Signature element: la « pression physique » — ombre dure `0 4px 0` qui s'écrase à l'appui (`translateY(3px)` + `0 1px 0`), et le logo KABLAM! incliné à -2° avec « ! » jaune.
- Style direction: toy design pop — fond cobalt uni, cartes crème posées dessus, rouge bombe pour l'action primaire, jaune étincelle pour le secondaire, typographie display arrondie très grasse.
- Anti-patterns to avoid: ombres floues/glassmorphism, gradients violet/rose génériques, monospace « hacker », copy « pause-café / collègues », cartes imbriquées (card > panel > card), rebond sur des fondus, texte basse-contraste (jaune sur crème, blanc sur jaune).

## Tokens
| Token | Value | Usage |
|---|---|---|
| Color / cobalt | `#2F5BF0` | fond de page, ring du joueur local (canvas), icône power-up vitesse |
| Color / cobalt-deep | `#2447C9` | dégradé bas de page, murs indestructibles (canvas) |
| Color / cream | `#FDF8EF` | cartes, code de room, lignes joueurs, sol du canvas |
| Color / cream-shade | `#F4EAD9` | case sombre du damier, badges, fonds neutres sur crème |
| Color / ink | `#17223F` | texte sur crème/jaune, corps des bombes, contours canvas, text-shadow dur |
| Color / muted | `#5B6478` | labels, hints et texte secondaire sur crème |
| Color / on-cobalt-muted | `#C9D6FF` | hints et texte secondaire sur cobalt |
| Color / bomb-red | `#EF3F36` | bouton primaire, flammes (canvas), bordure toast |
| Color / bomb-red-press | `#B02A23` | ombre dure du bouton primaire |
| Color / spark | `#FFD23F` | bouton secondaire, « ! » du logo, mèche/étincelle des bombes, focus ring sur cobalt |
| Color / spark-press | `#C9A021` | ombre dure du bouton secondaire |
| Color / player-1 | `#00A9C0` | joueur 1 (turquoise) — DOM et canvas via `PLAYER_COLORS` |
| Color / player-2 | `#F0509B` | joueur 2 (rose) |
| Color / player-3 | `#3DB94E` | joueur 3 (vert) |
| Color / player-4 | `#8353E2` | joueur 4 (violet) |
| Type / display | `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", sans-serif` | logo, boutons, code de room, HUD, titres — graisses 700-800, tracking -0.02/-0.03em sur les gros titres |
| Type / body | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | formulaires, hints, messages |
| Shadow / hard | `0 6px 0 rgb(23 34 63 / 0.35)` | cartes et canvas posés sur le cobalt — jamais de blur |
| Motion / spring | `cubic-bezier(0.34, 1.56, 0.64, 1)` ~300ms | arrivées d'écrans, jetons joueurs, flash GO ! |
| Space / rhythm | échelle 4px (4/8/12/16/24/32/48) | padding, gaps |

Les quatre couleurs joueurs évitent volontairement le rouge (bombes/flammes), le jaune (étincelles), l'orange (blocs) et le cobalt (murs) pour rester non ambiguës sur le terrain.

Couleurs de jeu (canvas, dessinées par code) : sol damier `#FDF8EF`/`#F4EAD9` ; mur cobalt-deep `#2447C9` à face supérieure claire `#5378F0` et base `#1A339E` ; bloc destructible carton `#E8933C` (rainures `#C0722A`, rehaut `#F6B563`) ; bombe encre `#17223F` à mèche `#FFD23F` virant `#EF3F36` en fin de compte ; flamme `#EF3F36` à cœur `#FFD23F` ; power-up sur pastille `#FFFDF7` à contour encre et ombre dure, icône bombe = encre, flamme = rouge, vitesse = cobalt ; joueur mort grisé `#9AA0AE`.

## Components
| Component | Rule | Reuse path |
|---|---|---|
| Button | `.btn` + `.btn-primary` (rouge, texte blanc, ombre `0 4px 0 #B02A23`) ou `.btn-secondary` (jaune, texte encre, ombre `0 4px 0 #C9A021`). `:active` = `translateY(3px)` + ombre `0 1px 0` (transition ~120ms, feedback à l'appui). Désactivé : crème ombré plat, sans ombre ni transform — un bouton « posé au sol » ne peut pas s'enfoncer. | `apps/client/src/style.css` |
| Card / panel | Un seul niveau : fond cream, radius 20px, ombre dure, texte encre. Pas de panneau dans un panneau. | `apps/client/src/style.css` |
| Player row | Ligne crème à ombre dure courte (`0 3px 0`) : pastille ronde 18px bordée encre + pseudo + badges pill (`hôte`, `toi`) seulement quand l'info n'est pas déduite du contexte. Nouvelle arrivée = classe `.player-drop` (chute avec overshoot). | `apps/client/src/lobby.ts` |
| Toast | Fixe en haut, carte crème à bordure rouge et ombre dure, texte encre, `role="alert"`, disparaît après 4 s sauf `connection_lost` (persistant). | `apps/client/src/lobby.ts` |
| HUD | Une ligne display au-dessus du canvas : vivants à gauche (blanc), stats locales à droite (on-cobalt-muted). Pas de panneau. | `apps/client/src/lobby.ts` |
| GO ! flash | Plein écran ~600ms au début de partie : `pointer-events: none`, `aria-hidden`, disparition automatique — ne retarde ni ne masque jamais les inputs. | `apps/client/src/lobby.ts` |

## Layout rules
- Breakpoints: mobile-first ; colonne unique max 380px (accueil/salle), canvas `min(600px, 100%)` ; ajustements < 480px (padding, taille/letter-spacing du code).
- Hero/section sizing: pas de hero — le shell est centré avec padding 48px, le canvas garde son ratio 15:13 (`width:100%; height:auto`).
- Grid/alignment: tout aligné sur la colonne centrale ; le HUD partage exactement la largeur du canvas.

## Interaction and motion
- Hover: éclaircissement du fond (rouge/jaune) ; active: enfoncement physique (voir Button) ; focus: `:focus-visible` 3px jaune sur cobalt, encre sur crème.
- Arrivées d'écrans et overlay de fin : `screen-in` ~300ms spring (translateY + scale léger, overshoot). Jetons joueurs : `token-drop` spring à chaque nouvelle arrivée uniquement.
- Canvas : pulsation des bombes accélérant à l'approche de `explodeAt` (information de gameplay, pas décorative).
- Screen shake : jitter sinusoïdal de toute la scène à chaque explosion (amplitude 3-7 px selon l'ampleur, décroissance 260 ms) — coupé en reduced-motion.
- Mort subite : les 3 prochaines cases condamnées pulsent en encre semi-transparente (alpha 0.2-0.32) ; compte à rebours dans le HUD à partir de 30 s, puis « ☠ Mort subite ! ». En reduced-motion l'assombrissement devient statique (l'information reste, le clignotement part).
- Ramassage de bonus (style « C » validé sur maquette, `effects.ts`) : commun = squash du joueur (écrasé → rebond spring 300ms) + texte flottant « +1 … ! » (display 800, contour crème, couleur du bonus) + bump `hud-bump` de la stat dans le HUD. Signatures : **bombe** = gobée puis stock réel en éventail au-dessus de la tête (la nouvelle claque en dernier) ; **portée** = croix de portée — le pattern d'explosion aux nouvelles dimensions flashe au sol case par case (arrêté par les murs comme le vrai), pulse jaune sur les cases gagnées ; **vitesse** = chevrons cobalt + images fantômes dans le sillage (0,8s). Effets visibles sur tous les joueurs (info tactique), < 1s, jamais bloquants.
- `prefers-reduced-motion: reduce` : toutes les arrivées deviennent des fondus courts (~150ms) sans translation ni rebond, le flash GO ! devient un fondu, les transitions de boutons sont coupées (l'enfoncement instantané reste : c'est du feedback direct). La pulsation des bombes est conservée (signal de danger) avec amplitude faible (≤ 12 %). Les effets de ramassage sont remplacés par un bref halo statique de la couleur du bonus (300ms, sans particules ni squash) et le bump HUD est coupé.

## Accessibility
- Contrast target: WCAG AA — encre `#17223F` sur crème et sur jaune ; blanc sur cobalt ; blanc sur rouge réservé aux gros textes display 800 (boutons, flash) ; hints `#C9D6FF` sur cobalt et `#5B6478` sur crème passent AA.
- Keyboard/focus: parcours complet au clavier (pseudo → créer / code → rejoindre → lancer) ; Entrée dans le champ code déclenche Rejoindre ; focus ring visible partout, y compris sur fond cobalt (jaune 3px).
- Semantics: `<form>` pour l'accueil, `<button>` réels, labels associés aux champs, toast en `role="alert"`, SVG décoratif et flash GO ! en `aria-hidden`.

## Page overrides
- `screen-game` — le canvas est une « carte » crème (fond `#FDF8EF`, radius 16px, ombre dure) posée sur le cobalt ; les pseudos in-game reprennent la couleur du joueur avec un contour encre pour rester lisibles sur le damier clair.
- `screen-home` — signature en pied : « Un jeu open source par Maël Demory » avec lien vers le dépôt GitHub (`target="_blank" rel="noopener"`).

## Maintenance notes
- Last updated: 2026-07-16
- Update when: nouveau token, nouvel écran, changement de palette joueurs (`PLAYER_COLORS` dans `apps/client/src/game.ts` doit rester aligné), ou règle de rendu canvas réutilisable.
