import { describe, it, expect } from "vitest";
import {
  DEFAULT_FORMAT_OPTIONS,
  enTeteJour,
  entretiensAffiches,
  formatEntretiens,
  libelleSalle,
  lignesTexte,
  nomComplet,
  trierEntretiens,
  type EntretienLigne,
} from "./entretiens-export";

const base = (over: Partial<EntretienLigne> = {}): EntretienLigne => ({
  id: "s1",
  startTime: "09:00",
  endTime: "09:30",
  room: "Salle A",
  epreuve: "Entretien individuel",
  tour: 2,
  candidats: [{ firstName: "Jean", lastName: "Dupont" }],
  examinateurs: [{ firstName: "Paul", lastName: "Martin" }],
  ...over,
});

describe("nomComplet", () => {
  it("assemble prénom + nom", () => {
    expect(nomComplet({ firstName: "Jean", lastName: "Dupont" })).toBe(
      "Jean Dupont",
    );
  });

  it("ne laisse pas d'espace parasite quand une partie manque", () => {
    expect(nomComplet({ firstName: "", lastName: "Dupont" })).toBe("Dupont");
    expect(nomComplet({ firstName: "Jean", lastName: "  " })).toBe("Jean");
  });
});

describe("enTeteJour", () => {
  it("préfixe « Aujourd'hui » le jour même", () => {
    expect(enTeteJour("2026-09-13", "2026-09-13")).toBe(
      "Aujourd'hui dimanche 13 septembre 2026",
    );
  });

  it("met une majuscule au jour de la semaine sinon", () => {
    expect(enTeteJour("2026-09-14", "2026-09-13")).toBe(
      "Lundi 14 septembre 2026",
    );
  });

  it("ne bascule pas d'un jour selon le fuseau (date construite à midi)", () => {
    // Un 1er du mois est le cas le plus exposé à un décalage négatif.
    expect(enTeteJour("2026-03-01", "2026-03-01")).toContain("1 mars 2026");
  });
});

describe("trierEntretiens", () => {
  it("trie par heure, puis salle en ordre naturel", () => {
    const lignes = [
      base({ id: "a", startTime: "10:00", room: "Salle 2" }),
      base({ id: "b", startTime: "09:00", room: "Salle 10" }),
      base({ id: "c", startTime: "09:00", room: "Salle 2" }),
    ];
    expect(trierEntretiens(lignes).map((l) => l.id)).toEqual(["c", "b", "a"]);
  });

  it("ne modifie pas le tableau d'origine", () => {
    const lignes = [
      base({ id: "a", startTime: "10:00" }),
      base({ id: "b", startTime: "09:00" }),
    ];
    trierEntretiens(lignes);
    expect(lignes.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("lignesTexte", () => {
  it("produit heure — personne — salle", () => {
    expect(lignesTexte([base()], DEFAULT_FORMAT_OPTIONS)).toEqual([
      "09:00 — Jean Dupont — Salle A",
    ]);
  });

  it("éclate une épreuve de groupe en une ligne par candidat", () => {
    const groupe = base({
      candidats: [
        { firstName: "Jean", lastName: "Dupont" },
        { firstName: "Marie", lastName: "Martin" },
      ],
    });
    expect(lignesTexte([groupe], DEFAULT_FORMAT_OPTIONS)).toEqual([
      "09:00 — Jean Dupont — Salle A",
      "09:00 — Marie Martin — Salle A",
    ]);
  });

  it("regroupe les candidats sur une ligne si demandé", () => {
    const groupe = base({
      candidats: [
        { firstName: "Jean", lastName: "Dupont" },
        { firstName: "Marie", lastName: "Martin" },
      ],
    });
    expect(
      lignesTexte([groupe], {
        ...DEFAULT_FORMAT_OPTIONS,
        unLigneParCandidat: false,
      }),
    ).toEqual(["09:00 — Jean Dupont, Marie Martin — Salle A"]);
  });

  it("masque par défaut les créneaux sans candidat", () => {
    expect(
      lignesTexte([base({ candidats: [] })], DEFAULT_FORMAT_OPTIONS),
    ).toEqual([]);
  });

  it("marque les créneaux libres quand on ne les masque pas", () => {
    expect(
      lignesTexte([base({ candidats: [] })], {
        ...DEFAULT_FORMAT_OPTIONS,
        masquerVides: false,
      }),
    ).toEqual(["09:00 — (libre) — Salle A"]);
  });

  it("ajoute épreuve, jury et heure de fin à la demande", () => {
    expect(
      lignesTexte([base()], {
        ...DEFAULT_FORMAT_OPTIONS,
        avecEpreuve: true,
        avecJury: true,
        avecHeureFin: true,
      }),
    ).toEqual([
      "09:00–09:30 — Jean Dupont — Salle A — Entretien individuel — Jury : Paul Martin",
    ]);
  });

  it("signale un jury manquant plutôt que de laisser un blanc", () => {
    expect(
      lignesTexte([base({ examinateurs: [] })], {
        ...DEFAULT_FORMAT_OPTIONS,
        avecJury: true,
      }),
    ).toEqual(["09:00 — Jean Dupont — Salle A — Jury : à définir"]);
  });

  it("remplace une salle vide par un libellé explicite", () => {
    expect(lignesTexte([base({ room: "  " })], DEFAULT_FORMAT_OPTIONS)).toEqual(
      ["09:00 — Jean Dupont — Salle à définir"],
    );
  });

  it("préfixe les salles nues (« 205 ») sans doubler « Salle »", () => {
    expect(lignesTexte([base({ room: "205" })], DEFAULT_FORMAT_OPTIONS)).toEqual(
      ["09:00 — Jean Dupont — Salle 205"],
    );
    expect(
      lignesTexte([base({ room: "205" })], {
        ...DEFAULT_FORMAT_OPTIONS,
        prefixerSalle: false,
      }),
    ).toEqual(["09:00 — Jean Dupont — 205"]);
  });
});

describe("libelleSalle", () => {
  it("préfixe une salle nue", () => {
    expect(libelleSalle("205", true)).toBe("Salle 205");
    expect(libelleSalle("238-240", true)).toBe("Salle 238-240");
  });

  it("ne double jamais le mot « Salle »", () => {
    expect(libelleSalle("Salle A", true)).toBe("Salle A");
    expect(libelleSalle("salle 12", true)).toBe("salle 12");
    expect(libelleSalle("Salles 1-2", true)).toBe("Salles 1-2");
  });

  it("ne confond pas un nom qui commence par « Salle… »", () => {
    expect(libelleSalle("Sallenave", true)).toBe("Salle Sallenave");
  });

  it("laisse la salle brute si le préfixe est désactivé", () => {
    expect(libelleSalle("205", false)).toBe("205");
  });

  it("annonce une salle manquante", () => {
    expect(libelleSalle("  ", true)).toBe("Salle à définir");
  });
});

describe("entretiensAffiches", () => {
  it("renvoie exactement les créneaux que le texte listera", () => {
    const avec = base({ id: "avec" });
    const sans = base({ id: "sans", startTime: "08:00", candidats: [] });
    expect(
      entretiensAffiches([avec, sans], DEFAULT_FORMAT_OPTIONS).map((e) => e.id),
    ).toEqual(["avec"]);
    expect(
      entretiensAffiches([avec, sans], {
        ...DEFAULT_FORMAT_OPTIONS,
        masquerVides: false,
      }).map((e) => e.id),
    ).toEqual(["sans", "avec"]);
  });
});

describe("formatEntretiens", () => {
  it("assemble en-tête + lignes", () => {
    expect(formatEntretiens("2026-09-13", "2026-09-13", [base()])).toBe(
      "Aujourd'hui dimanche 13 septembre 2026\n\n09:00 — Jean Dupont — Salle A",
    );
  });

  it("le dit quand la journée est vide", () => {
    expect(formatEntretiens("2026-09-14", "2026-09-13", [])).toBe(
      "Lundi 14 septembre 2026\n\nAucun entretien ce jour-là.",
    );
  });
});
