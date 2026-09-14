/**
 * entretiens-export — mise en forme TEXTE de la liste des entretiens du jour.
 *
 * Sert l'écran « Liste » (/dashboard/entretiens) : on produit
 * un bloc de texte brut, prêt à être collé dans un message (WhatsApp, mail,
 * affichage papier), du type :
 *
 *   Aujourd'hui vendredi 13 septembre 2026
 *
 *   09:00 — Jean Dupont — Salle A
 *   09:30 — Marie Martin — Salle B
 *
 * Aucune dépendance à React ni à Supabase : la fonction est pure, testée dans
 * entretiens-export.test.ts.
 */

export interface EntretienPersonne {
  firstName: string;
  lastName: string;
}

export interface EntretienLigne {
  id: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  room: string;
  epreuve: string;
  tour: number | null;
  candidats: EntretienPersonne[];
  examinateurs: EntretienPersonne[];
}

export interface FormatOptions {
  /** Une ligne par candidat plutôt qu'une ligne par créneau (épreuves de groupe). */
  unLigneParCandidat: boolean;
  /** Ajouter « — Épreuve » en fin de ligne. */
  avecEpreuve: boolean;
  /** Ajouter « — Jury : … » en fin de ligne. */
  avecJury: boolean;
  /** Afficher la plage horaire complète (09:00–09:30) plutôt que l'heure de début. */
  avecHeureFin: boolean;
  /** Écrire « Salle 205 » là où la base ne stocke que « 205 ». */
  prefixerSalle: boolean;
  /** Masquer les créneaux sans aucun candidat inscrit. */
  masquerVides: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  unLigneParCandidat: true,
  avecEpreuve: false,
  avecJury: false,
  avecHeureFin: false,
  prefixerSalle: true,
  masquerVides: true,
};

/**
 * Libellé de salle affichable.
 *
 * Les salles sont saisies telles quelles : tantôt « Salle 1 », tantôt « 205 »
 * ou « 238-240 ». Le préfixe n'est ajouté que s'il manque, pour ne jamais
 * produire « Salle Salle 1 ».
 */
export function libelleSalle(room: string, prefixer: boolean): string {
  const brut = (room || "").trim();
  if (!brut) return "Salle à définir";
  if (!prefixer || /^salles?\b/i.test(brut)) return brut;
  return `Salle ${brut}`;
}

/** « Jean Dupont » — un nom vide ne doit pas produire d'espace parasite. */
export function nomComplet(p: EntretienPersonne): string {
  return [p.firstName, p.lastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * En-tête du bloc : « Aujourd'hui vendredi 13 septembre 2026 » le jour même,
 * sinon « Vendredi 13 septembre 2026 ».
 *
 * `dateStr` et `aujourdHui` sont des "YYYY-MM-DD" LOCAUX (cf. localYmd) : on
 * les compare en texte, jamais via des objets Date, pour ne pas basculer d'un
 * jour selon le fuseau.
 */
export function enTeteJour(dateStr: string, aujourdHui: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  // Midi : à minuit, un décalage de fuseau ferait reculer d'un jour.
  const jour = new Date(y, m - 1, d, 12, 0, 0);
  const libelle = jour.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return dateStr === aujourdHui
    ? `Aujourd'hui ${libelle}`
    : libelle.charAt(0).toUpperCase() + libelle.slice(1);
}

/** Tri chronologique stable : heure, puis salle, puis épreuve. */
export function trierEntretiens(lignes: EntretienLigne[]): EntretienLigne[] {
  return [...lignes].sort(
    (a, b) =>
      a.startTime.localeCompare(b.startTime) ||
      a.room.localeCompare(b.room, "fr", { numeric: true }) ||
      a.epreuve.localeCompare(b.epreuve, "fr"),
  );
}

function suffixes(e: EntretienLigne, opts: FormatOptions): string[] {
  const out: string[] = [];
  if (opts.avecEpreuve && e.epreuve) out.push(e.epreuve);
  if (opts.avecJury) {
    const jury = e.examinateurs.map(nomComplet).filter(Boolean);
    out.push(jury.length ? `Jury : ${jury.join(", ")}` : "Jury : à définir");
  }
  return out;
}

function heure(e: EntretienLigne, opts: FormatOptions): string {
  return opts.avecHeureFin && e.endTime
    ? `${e.startTime}–${e.endTime}`
    : e.startTime;
}

/**
 * Créneaux effectivement listés, dans l'ordre du rendu.
 *
 * Partagé avec l'aperçu tabulaire de la page : l'écran doit montrer
 * EXACTEMENT ce que le bouton « Copier » met dans le presse-papier.
 */
export function entretiensAffiches(
  entretiens: EntretienLigne[],
  opts: FormatOptions,
): EntretienLigne[] {
  const tries = trierEntretiens(entretiens);
  return opts.masquerVides
    ? tries.filter((e) => e.candidats.some((c) => nomComplet(c)))
    : tries;
}

/**
 * Lignes de texte (sans l'en-tête) pour une journée.
 *
 * Un créneau sans candidat reste listé (« (libre) ») quand `masquerVides`
 * est faux : c'est utile pour repérer les trous du planning au collage.
 */
export function lignesTexte(
  entretiens: EntretienLigne[],
  opts: FormatOptions,
): string[] {
  const lignes: string[] = [];

  for (const e of trierEntretiens(entretiens)) {
    const salle = libelleSalle(e.room, opts.prefixerSalle);
    const noms = e.candidats.map(nomComplet).filter(Boolean);

    if (noms.length === 0) {
      if (opts.masquerVides) continue;
      // « (libre) » et pas « — libre — » : le séparateur de colonne est déjà
      // un tiret cadratin, on obtiendrait « — — libre — — ».
      lignes.push(
        [heure(e, opts), "(libre)", salle, ...suffixes(e, opts)].join(" — "),
      );
      continue;
    }

    if (opts.unLigneParCandidat) {
      for (const nom of noms) {
        lignes.push([heure(e, opts), nom, salle, ...suffixes(e, opts)].join(" — "));
      }
    } else {
      lignes.push(
        [heure(e, opts), noms.join(", "), salle, ...suffixes(e, opts)].join(" — "),
      );
    }
  }

  return lignes;
}

/** Bloc complet prêt à copier : en-tête + ligne vide + lignes. */
export function formatEntretiens(
  dateStr: string,
  aujourdHui: string,
  entretiens: EntretienLigne[],
  opts: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): string {
  const lignes = lignesTexte(entretiens, opts);
  const entete = enTeteJour(dateStr, aujourdHui);
  if (lignes.length === 0) {
    return `${entete}\n\nAucun entretien ce jour-là.`;
  }
  return `${entete}\n\n${lignes.join("\n")}`;
}
