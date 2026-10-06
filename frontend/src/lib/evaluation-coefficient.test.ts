// Coefficient choisi d'une épreuve (onglet Réglages → Coefficients,
// 07/10/2026).
//
// Exigence de Felix : AUCUNE régression sur les tours 1 et 2, qui ont de
// vraies notes. Sans coefficient (absent / null / invalide), la moyenne doit
// être STRICTEMENT celle d'avant — vérifié ici contre une copie figée de
// l'ancien algorithme, sur des jeux fixes et des jeux tirés au hasard.
import { describe, expect, it } from "vitest";
import {
  averageOn20ByEpreuve,
  effectiveCoefficient,
  getEpreuveCoefficient,
  parseEpreuveCoefficient,
  type ScoredEvaluation,
} from "./evaluation-criteria";

/**
 * Copie conforme de averageOn20ByEpreuve AVANT l'onglet Coefficients
 * (commit c9c4ee9). Ne pas modifier : c'est la référence de non-régression.
 */
function legacyAverageOn20ByEpreuve(
  items: { epreuveKey: string; obtained: number; maxTotal: number }[],
): number | null {
  const byEpreuve = new Map<string, { ratios: number[]; maxTotal: number }>();
  for (const it of items) {
    const maxTotal = Number(it.maxTotal);
    const obtained = Number(it.obtained);
    if (!Number.isFinite(maxTotal) || maxTotal <= 0) continue;
    if (!Number.isFinite(obtained)) continue;
    const entry = byEpreuve.get(it.epreuveKey) || { ratios: [], maxTotal };
    entry.ratios.push(Math.min(1, Math.max(0, obtained / maxTotal)));
    byEpreuve.set(it.epreuveKey, entry);
  }
  if (byEpreuve.size === 0) return null;
  let weightedSum = 0;
  let totalCoef = 0;
  byEpreuve.forEach(({ ratios, maxTotal }) => {
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const coef = Number.isFinite(maxTotal) && maxTotal > 0 ? maxTotal / 20 : 1;
    weightedSum += avgRatio * coef;
    totalCoef += coef;
  });
  if (totalCoef <= 0) return null;
  return Math.round((weightedSum / totalCoef) * 20 * 10) / 10;
}

/** Jeux représentatifs : barèmes /20, /43 (BG), /18, /81, demi-points. */
const FIXED_SETS: { name: string; items: ScoredEvaluation[] }[] = [
  {
    name: "une épreuve /20",
    items: [{ epreuveKey: "A", obtained: 13.5, maxTotal: 20 }],
  },
  {
    name: "/20 + /43 + /18 + /81",
    items: [
      { epreuveKey: "entretien", obtained: 14, maxTotal: 20 },
      { epreuveKey: "bg", obtained: 31.5, maxTotal: 43 },
      { epreuveKey: "table", obtained: 11, maxTotal: 18 },
      { epreuveKey: "pole", obtained: 57, maxTotal: 81 },
    ],
  },
  {
    name: "binôme sur la même épreuve + épreuve seule",
    items: [
      { epreuveKey: "A", obtained: 30, maxTotal: 43 },
      { epreuveKey: "A", obtained: 35, maxTotal: 43 },
      { epreuveKey: "B", obtained: 9, maxTotal: 18 },
    ],
  },
  {
    name: "notes extrêmes, plafonnées et barème inconnu",
    items: [
      { epreuveKey: "A", obtained: 0, maxTotal: 81 },
      { epreuveKey: "B", obtained: 25, maxTotal: 20 },
      { epreuveKey: "C", obtained: 7, maxTotal: 0 },
      { epreuveKey: "D", obtained: Number.NaN, maxTotal: 18 },
    ],
  },
  { name: "aucune note", items: [] },
];

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSet(seed: number): ScoredEvaluation[] {
  const r = rng(seed);
  const baremes = [20, 43, 18, 81, 5, 40, 60];
  const nbEpreuves = 1 + Math.floor(r() * 6);
  const items: ScoredEvaluation[] = [];
  for (let e = 0; e < nbEpreuves; e++) {
    const maxTotal = baremes[Math.floor(r() * baremes.length)];
    const nbNotes = 1 + Math.floor(r() * 3);
    for (let n = 0; n < nbNotes; n++) {
      // Demi-points, comme la saisie réelle.
      const obtained = Math.round(r() * maxTotal * 2) / 2;
      items.push({ epreuveKey: `E${e}`, obtained, maxTotal });
    }
  }
  return items;
}

describe("parseEpreuveCoefficient", () => {
  it("garde un nombre fini strictement positif, chaîne comprise", () => {
    expect(parseEpreuveCoefficient(2)).toBe(2);
    expect(parseEpreuveCoefficient(0.5)).toBe(0.5);
    expect(parseEpreuveCoefficient("1.5")).toBe(1.5);
  });

  it("rend null (= automatique) pour toute valeur inexploitable", () => {
    for (const v of [null, undefined, "", 0, -1, Number.NaN, Infinity, "abc", true, {}]) {
      expect(parseEpreuveCoefficient(v)).toBeNull();
    }
  });
});

describe("effectiveCoefficient", () => {
  it("sans coefficient choisi : exactement getEpreuveCoefficient", () => {
    for (const maxTotal of [20, 43, 18, 81, 5, 0, -3, Number.NaN]) {
      expect(effectiveCoefficient(null, maxTotal)).toBe(getEpreuveCoefficient(maxTotal));
      expect(effectiveCoefficient(undefined, maxTotal)).toBe(getEpreuveCoefficient(maxTotal));
    }
  });

  it("coefficient choisi valide : il remplace le barème ÷ 20", () => {
    expect(effectiveCoefficient(3, 43)).toBe(3);
    expect(effectiveCoefficient(0.5, 20)).toBe(0.5);
  });

  it("coefficient 0, négatif ou NaN : ignoré", () => {
    expect(effectiveCoefficient(0, 43)).toBe(43 / 20);
    expect(effectiveCoefficient(-2, 18)).toBe(18 / 20);
    expect(effectiveCoefficient(Number.NaN, 81)).toBe(81 / 20);
  });
});

describe("averageOn20ByEpreuve — non-régression sans coefficient", () => {
  it.each(FIXED_SETS)("$name : identique à l'ancien calcul", ({ items }) => {
    expect(averageOn20ByEpreuve(items)).toBe(legacyAverageOn20ByEpreuve(items));
  });

  it("valeurs attendues figées sur les jeux fixes", () => {
    // 14/20, 31,5/43, 11/18, 57/81 pondérés 1 ; 2,15 ; 0,9 ; 4,05 :
    // (0,7 + 1,575 + 0,55 + 2,85) / 8,1 × 20 = 14,01 → 14.
    expect(averageOn20ByEpreuve(FIXED_SETS[1].items)).toBe(14);
    expect(averageOn20ByEpreuve(FIXED_SETS[2].items)).toBe(13.6);
  });

  it("coef null / 0 / négatif / NaN explicites : identique à l'ancien calcul", () => {
    for (const coef of [null, undefined, 0, -1, Number.NaN]) {
      const items = FIXED_SETS[1].items.map((it) => ({ ...it, coef }));
      expect(averageOn20ByEpreuve(items)).toBe(
        legacyAverageOn20ByEpreuve(FIXED_SETS[1].items),
      );
    }
  });

  it("500 jeux aléatoires (barèmes /20, /43, /18, /81…) : identiques", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const items = randomSet(seed);
      expect(averageOn20ByEpreuve(items)).toBe(legacyAverageOn20ByEpreuve(items));
    }
  });
});

describe("averageOn20ByEpreuve — avec coefficient choisi", () => {
  it("pondère l'épreuve par le coefficient choisi au lieu du barème", () => {
    // A /43 à 100 % (auto : 2,15), B /20 à 0 % (auto : 1).
    // Automatique : 2,15 / 3,15 × 20 = 13,7.
    // A forcé à 1 : (1×1 + 1×0) / 2 × 20 = 10.
    const auto = [
      { epreuveKey: "A", obtained: 43, maxTotal: 43 },
      { epreuveKey: "B", obtained: 0, maxTotal: 20 },
    ];
    expect(averageOn20ByEpreuve(auto)).toBe(13.7);
    expect(
      averageOn20ByEpreuve([{ ...auto[0], coef: 1 }, auto[1]]),
    ).toBe(10);
    // A forcé à 3 : 3 / 4 × 20 = 15.
    expect(
      averageOn20ByEpreuve([{ ...auto[0], coef: 3 }, auto[1]]),
    ).toBe(15);
  });

  it("mélange coefficient choisi et automatique", () => {
    // A /18 à 50 % coef 2 ; B /81 à 100 % auto (4,05) ; C /20 à 25 % coef 0,5.
    // (2×0,5 + 4,05×1 + 0,5×0,25) / (2 + 4,05 + 0,5) × 20 = 15,8.
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 9, maxTotal: 18, coef: 2 },
        { epreuveKey: "B", obtained: 81, maxTotal: 81 },
        { epreuveKey: "C", obtained: 5, maxTotal: 20, coef: 0.5 },
      ]),
    ).toBe(15.8);
  });

  it("le coefficient ne change pas la moyenne d'une épreuve seule", () => {
    expect(
      averageOn20ByEpreuve([{ epreuveKey: "A", obtained: 12, maxTotal: 18, coef: 4 }]),
    ).toBe(averageOn20ByEpreuve([{ epreuveKey: "A", obtained: 12, maxTotal: 18 }]));
  });

  it("prend le premier coefficient valide parmi les notes de l'épreuve", () => {
    // Deux examinateurs sur A : le premier sans coef, le second coef 1.
    expect(
      averageOn20ByEpreuve([
        { epreuveKey: "A", obtained: 43, maxTotal: 43, coef: null },
        { epreuveKey: "A", obtained: 43, maxTotal: 43, coef: 1 },
        { epreuveKey: "B", obtained: 0, maxTotal: 20 },
      ]),
    ).toBe(10);
  });

  it("coefficient 0, négatif ou NaN : ignoré (retour au barème ÷ 20)", () => {
    const base = [
      { epreuveKey: "A", obtained: 43, maxTotal: 43 },
      { epreuveKey: "B", obtained: 0, maxTotal: 20 },
    ];
    for (const coef of [0, -2, Number.NaN]) {
      expect(averageOn20ByEpreuve([{ ...base[0], coef }, base[1]])).toBe(13.7);
    }
  });
});
