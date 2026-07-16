import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * Classement général persistant — un fichier JSON sur disque (volume Fly en
 * prod). Identité = pseudo (pas de comptes) : la clé est le pseudo en
 * minuscules, la casse affichée est la dernière utilisée. Assumé spoofable,
 * documenté dans ARCHITECTURE.md.
 */

export interface ScoreEntry {
  name: string;
  wins: number;
  games: number;
}

export interface Participant {
  id: string;
  name: string;
  bot: boolean;
}

export class ScoreStore {
  private readonly file: string;
  private readonly scores = new Map<string, ScoreEntry>();
  private saving: Promise<void> = Promise.resolve();

  // Parameters
  //   dir — dossier de données (créé si absent)
  // What it does
  //   Charge scores.json de façon synchrone au démarrage du serveur ; fichier
  //   absent ou corrompu ⇒ classement vide (les entrées invalides sont ignorées).
  // Output
  //   ScoreStore prêt à l'emploi
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'scores.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, ScoreEntry>;
      for (const [key, v] of Object.entries(raw)) {
        if (typeof v?.name === 'string' && Number.isFinite(v.wins) && Number.isFinite(v.games)) {
          this.scores.set(key, { name: v.name, wins: v.wins, games: v.games });
        }
      }
    } catch {
      // Premier lancement (fichier absent) ou JSON corrompu : on repart de zéro.
    }
  }

  // Parameters
  //   participants — joueurs de la partie au moment du start (humains et bots)
  //   winnerId — id du vainqueur, ou null (match nul)
  // What it does
  //   Comptabilise une partie terminée : ignorée s'il y a moins de 2 humains
  //   (anti-farming contre bots) ; sinon chaque humain compte une partie jouée
  //   et le vainqueur, s'il est humain, une victoire. Sauvegarde sur disque.
  // Output
  //   None
  recordGame(participants: Participant[], winnerId: string | null): void {
    const humans = participants.filter((p) => !p.bot);
    if (humans.length < 2) return;
    for (const h of humans) {
      const key = h.name.toLowerCase();
      const entry = this.scores.get(key) ?? { name: h.name, wins: 0, games: 0 };
      entry.name = h.name;
      entry.games++;
      if (winnerId !== null && h.id === winnerId) entry.wins++;
      this.scores.set(key, entry);
    }
    this.save();
  }

  // Parameters
  //   n — nombre d'entrées à retourner
  // What it does
  //   Classe par victoires décroissantes, puis parties croissantes (efficacité),
  //   puis pseudo (stabilité).
  // Output
  //   Les n meilleures entrées
  top(n: number): ScoreEntry[] {
    return [...this.scores.values()]
      .sort((a, b) => b.wins - a.wins || a.games - b.games || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  // Parameters
  //   None
  // What it does
  //   Attend la fin des écritures en cours (utile aux tests et à l'arrêt).
  // Output
  //   Promise résolue quand le disque est à jour
  flush(): Promise<void> {
    return this.saving;
  }

  // Écriture atomique (tmp + rename) et sérialisée : les sauvegardes se suivent,
  // un plantage ne peut jamais laisser un scores.json à moitié écrit.
  private save(): void {
    const data = JSON.stringify(Object.fromEntries(this.scores));
    this.saving = this.saving
      .then(async () => {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, data, 'utf8');
        await rename(tmp, this.file);
      })
      .catch((err) => console.error('échec de sauvegarde des scores', err));
  }
}
