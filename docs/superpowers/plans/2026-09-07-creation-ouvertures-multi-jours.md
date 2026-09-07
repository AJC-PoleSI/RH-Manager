# Création d'ouvertures sur plusieurs jours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à l'admin de créer une ouverture de salle (même salle/horaires/pause) sur une plage de dates en une seule saisie dans `OpeningsManager`, au lieu de répéter le formulaire un jour à la fois.

**Architecture:** Le formulaire d'ajout affiche deux champs date (« du » / « au ») ; quand la plage dépasse un jour, des puces permettent d'exclure des jours ouvrés précis. À la soumission, le front envoie `dates: string[]` à `POST /api/openings`, qui boucle sur chaque date via un helper serveur partagé (`createOpeningWithSlots`) et remonte les conflits par jour sans faire échouer tout le lot.

**Tech Stack:** Next.js App Router (routes `frontend/src/app/api/`), Supabase (`supabaseAdmin`), React (composant client `OpeningsManager.tsx`), Vitest pour les fonctions pures.

**Spec de référence :** `docs/superpowers/specs/2026-09-07-creation-ouvertures-multi-jours-design.md`

**Note sur les commits :** ce dépôt a un hook qui auto-commit les changements de fichiers en tâche de fond (« auto: save changes »). Si une étape `git commit` explicite renvoie `nothing to commit, working tree clean`, c'est normal — le hook a déjà pris le changement. Ce n'est pas un échec de l'étape.

---

### Task 1: Fonctions pures `weekdaysBetween`, `openingDateCandidates`, `resolveOpeningDates`

**Files:**
- Modify: `frontend/src/lib/opening-slicer.ts`
- Modify: `frontend/src/lib/opening-slicer.test.ts`

- [ ] **Step 1: Écrire les tests (ils vont échouer — les fonctions n'existent pas encore)**

Ajouter à la fin de `frontend/src/lib/opening-slicer.test.ts` :

```ts
describe("weekdaysBetween", () => {
  it("liste les jours ouvrés d'une semaine complète", () => {
    // 2026-09-07 = lundi ... 2026-09-13 = dimanche
    expect(weekdaysBetween("2026-09-07", "2026-09-13")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });

  it("exclut les weekends dans une plage qui les traverse", () => {
    // 2026-09-11 = vendredi, 2026-09-14 = lundi
    expect(weekdaysBetween("2026-09-11", "2026-09-14")).toEqual([
      "2026-09-11",
      "2026-09-14",
    ]);
  });

  it("plage d'un seul jour ouvré", () => {
    expect(weekdaysBetween("2026-09-07", "2026-09-07")).toEqual([
      "2026-09-07",
    ]);
  });

  it("plage d'un seul jour tombant un weekend → vide", () => {
    // 2026-09-12 = samedi
    expect(weekdaysBetween("2026-09-12", "2026-09-12")).toEqual([]);
  });

  it("end < start → vide", () => {
    expect(weekdaysBetween("2026-09-10", "2026-09-07")).toEqual([]);
  });

  it("dates vides → vide", () => {
    expect(weekdaysBetween("", "2026-09-07")).toEqual([]);
    expect(weekdaysBetween("2026-09-07", "")).toEqual([]);
  });
});

describe("openingDateCandidates", () => {
  it("un seul jour si dateEnd vide", () => {
    expect(openingDateCandidates("2026-09-12", "")).toEqual(["2026-09-12"]);
  });

  it("un seul jour (weekend inclus) si dateEnd <= date", () => {
    // 2026-09-12 = samedi : autorisé car c'est un jour unique, pas une plage
    expect(openingDateCandidates("2026-09-12", "2026-09-12")).toEqual([
      "2026-09-12",
    ]);
    expect(openingDateCandidates("2026-09-12", "2026-09-10")).toEqual([
      "2026-09-12",
    ]);
  });

  it("jours ouvrés de la plage si dateEnd > date", () => {
    expect(openingDateCandidates("2026-09-07", "2026-09-11")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });
});

describe("resolveOpeningDates", () => {
  it("retire les dates exclues", () => {
    const excluded = new Set(["2026-09-09"]);
    expect(resolveOpeningDates("2026-09-07", "2026-09-11", excluded)).toEqual(
      ["2026-09-07", "2026-09-08", "2026-09-10", "2026-09-11"],
    );
  });

  it("aucune exclusion → identique aux candidats", () => {
    expect(
      resolveOpeningDates("2026-09-07", "2026-09-11", new Set()),
    ).toEqual(openingDateCandidates("2026-09-07", "2026-09-11"));
  });

  it("toutes exclues → vide", () => {
    expect(
      resolveOpeningDates("2026-09-07", "2026-09-07", new Set(["2026-09-07"])),
    ).toEqual([]);
  });
});
```

Mettre à jour l'import en haut du fichier de test :

```ts
import { describe, it, expect } from "vitest";
import {
  sliceOpening,
  diffOpeningSlots,
  weekdaysBetween,
  openingDateCandidates,
  resolveOpeningDates,
} from "./opening-slicer";
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npm run test -- src/lib/opening-slicer.test.ts`
Expected: FAIL — `weekdaysBetween is not a function` (ou erreur d'import équivalente).

- [ ] **Step 3: Implémenter les trois fonctions**

Ajouter à la fin de `frontend/src/lib/opening-slicer.ts` :

```ts
/**
 * Liste des jours ouvrés (Lun–Ven) entre deux dates "YYYY-MM-DD" incluses.
 * Retourne [] si une date est vide/invalide ou si end < start.
 */
export function weekdaysBetween(start: string, end: string): string[] {
  if (!start || !end) return [];
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s)
    return [];
  const out: string[] = [];
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      out.push(
        `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
      );
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Dates candidates pour une ouverture (avant exclusions manuelles) :
 * un seul jour (weekend inclus) si `dateEnd` est vide ou <= `date` —
 * comportement identique à une création mono-jour ; sinon les jours
 * ouvrés de la plage [date, dateEnd].
 */
export function openingDateCandidates(
  date: string,
  dateEnd: string,
): string[] {
  if (!date) return [];
  if (!dateEnd || dateEnd <= date) return [date];
  return weekdaysBetween(date, dateEnd);
}

/** Dates candidates moins celles explicitement exclues par l'utilisateur. */
export function resolveOpeningDates(
  date: string,
  dateEnd: string,
  excluded: Set<string>,
): string[] {
  return openingDateCandidates(date, dateEnd).filter((d) => !excluded.has(d));
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npm run test -- src/lib/opening-slicer.test.ts`
Expected: PASS — 19 tests passed (10 existants + 6 `weekdaysBetween` + 3 `openingDateCandidates` + 3 `resolveOpeningDates` = 22 en réalité, le nombre exact importe peu, juste 0 échec).

- [ ] **Step 5: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/lib/opening-slicer.ts frontend/src/lib/opening-slicer.test.ts && git commit -m "$(cat <<'EOF'
feat: fonctions pures pour la résolution de dates d'ouverture multi-jours

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Réutiliser `weekdaysBetween` pour `weekdaysInRange` (refactor sans changement de comportement)

**Files:**
- Modify: `frontend/src/components/calendar/OpeningsManager.tsx`

- [ ] **Step 1: Mettre à jour l'import**

Dans `frontend/src/components/calendar/OpeningsManager.tsx`, ligne 10, remplacer :

```ts
import { sliceOpening } from "@/lib/opening-slicer";
```

par :

```ts
import { sliceOpening, weekdaysBetween } from "@/lib/opening-slicer";
```

- [ ] **Step 2: Remplacer le calcul local par un appel à la fonction partagée**

Remplacer (lignes 340-356) :

```ts
  // Jours ouvrés de la période de l'épreuve (cibles de duplication)
  const weekdaysInRange = useMemo(() => {
    if (!dateMin || !dateMax) return [] as string[];
    const out: string[] = [];
    const cur = new Date(dateMin + "T12:00:00");
    const end = new Date(dateMax + "T12:00:00");
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        out.push(
          `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
        );
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [dateMin, dateMax]);
```

par :

```ts
  // Jours ouvrés de la période de l'épreuve (cibles de duplication)
  const weekdaysInRange = useMemo(
    () => weekdaysBetween(dateMin, dateMax),
    [dateMin, dateMax],
  );
```

- [ ] **Step 3: Vérifier qu'il n'y a pas de régression TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: aucune nouvelle erreur liée à `OpeningsManager.tsx` (des erreurs préexistantes ailleurs dans le projet, s'il y en a, ne sont pas de notre ressort).

- [ ] **Step 4: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/components/calendar/OpeningsManager.tsx && git commit -m "$(cat <<'EOF'
refactor: réutilise weekdaysBetween pour les cibles de duplication

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Extraire `createOpeningWithSlots` dans `openings-service.ts`

**Files:**
- Modify: `frontend/src/lib/openings-service.ts`

- [ ] **Step 1: Ajouter la fonction partagée**

Ajouter à la fin de `frontend/src/lib/openings-service.ts` :

```ts
export type CreateOpeningResult =
  | { ok: true; opening: OpeningRow; slotsCreated: number }
  | { ok: false; error: string };

/**
 * Crée une ouverture (salle + date + plage horaire) et ses créneaux
 * découpés, après vérification de chevauchement de salle. Compense
 * (supprime l'ouverture) si l'insertion des créneaux échoue, pour ne
 * jamais laisser une ouverture sans créneaux.
 *
 * Ne valide PAS le format des champs (room/horaires) ni que la plage est
 * assez longue pour au moins un créneau — c'est à l'appelant de le faire
 * une seule fois en amont quand ces champs sont partagés par plusieurs
 * dates (cf. POST /api/openings).
 */
export async function createOpeningWithSlots(
  epreuveId: string,
  epreuve: any,
  input: {
    room: string;
    date: string;
    start_time: string;
    end_time: string;
    break_start: string | null;
    break_end: string | null;
  },
): Promise<CreateOpeningResult> {
  const overlapError = await checkOpeningOverlap(
    input.date,
    input.room,
    input.start_time,
    input.end_time,
  );
  if (overlapError) {
    return { ok: false, error: overlapError };
  }

  const { data: opening, error: insertErr } = await supabaseAdmin
    .from("room_openings")
    .insert({ epreuve_id: epreuveId, ...input })
    .select("*")
    .single();
  if (insertErr) throw insertErr;

  const target = sliceOpeningRow(input, epreuve);
  const rows = target.map((t) =>
    slotInsertRow(t, input.date, input.room, epreuve, opening.id),
  );

  const { error: slotsErr } = await supabaseAdmin
    .from("evaluation_slots")
    .insert(rows);
  if (slotsErr) {
    await supabaseAdmin.from("room_openings").delete().eq("id", opening.id);
    throw slotsErr;
  }

  return { ok: true, opening, slotsCreated: rows.length };
}
```

- [ ] **Step 2: Vérifier qu'il n'y a pas d'erreur TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: aucune nouvelle erreur liée à `openings-service.ts`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/lib/openings-service.ts && git commit -m "$(cat <<'EOF'
refactor: extrait createOpeningWithSlots en helper partagé

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `POST /api/openings` accepte `dates: string[]`

**Files:**
- Modify: `frontend/src/app/api/openings/route.ts`

- [ ] **Step 1: Remplacer les imports**

Remplacer (lignes 1-11) :

```ts
import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import { diffOpeningSlots } from "@/lib/opening-slicer";
import {
  sliceOpeningRow,
  slotInsertRow,
  checkOpeningOverlap,
  isSlotOccupied,
  validateOpeningInput,
} from "@/lib/openings-service";
```

par :

```ts
import { supabaseAdmin } from "@/lib/supabase";
import { getTokenFromRequest, unauthorized, forbidden } from "@/lib/auth";
import { NextRequest } from "next/server";
import { diffOpeningSlots } from "@/lib/opening-slicer";
import {
  sliceOpeningRow,
  isSlotOccupied,
  validateOpeningInput,
  createOpeningWithSlots,
} from "@/lib/openings-service";
```

(Le `GET` handler plus bas dans le fichier n'est pas touché : il utilise toujours `sliceOpeningRow`, `diffOpeningSlots`, `isSlotOccupied`.)

- [ ] **Step 2: Remplacer le handler POST**

Remplacer tout le bloc `POST` (de `// POST /api/openings — admin...` jusqu'à l'accolade fermante du `catch`, lignes 89-179) par :

```ts
// POST /api/openings — admin : crée une ou plusieurs ouvertures (une par
// date de `dates`, mêmes salle/horaires/pause) ET leurs créneaux découpés.
// Un chevauchement sur une date précise n'annule pas les autres : cette
// date est ignorée et remontée dans `warnings`, comme pour /duplicate.
export async function POST(req: NextRequest) {
  const payload = getTokenFromRequest(req);
  if (!payload) return unauthorized();
  if (!payload.isAdmin) return forbidden();

  try {
    const body = await req.json();
    const { epreuveId, room, dates, startTime, endTime, breakStart, breakEnd } =
      body;

    if (!epreuveId) {
      return Response.json({ error: "epreuveId requis" }, { status: 400 });
    }
    if (!Array.isArray(dates) || dates.length === 0) {
      return Response.json(
        { error: "dates requis (tableau non vide)" },
        { status: 400 },
      );
    }
    for (const d of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
        return Response.json(
          { error: `Date invalide dans la plage : "${d}" (format AAAA-MM-JJ).` },
          { status: 400 },
        );
      }
    }

    const roomTrimmed = String(room || "").trim();
    const breakStartVal = breakStart || null;
    const breakEndVal = breakEnd || null;

    // Valide le format commun à toutes les dates (salle, horaires, pause) une
    // seule fois — ces champs sont partagés par toute la plage.
    const validationError = validateOpeningInput({
      room: roomTrimmed,
      date: dates[0],
      start_time: startTime,
      end_time: endTime,
      break_start: breakStartVal,
      break_end: breakEndVal,
    });
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const { data: epreuve, error: epErr } = await supabaseAdmin
      .from("epreuves")
      .select("*")
      .eq("id", epreuveId)
      .single();
    if (epErr || !epreuve) {
      return Response.json({ error: "Épreuve introuvable" }, { status: 404 });
    }

    const target = sliceOpeningRow(
      {
        start_time: startTime,
        end_time: endTime,
        break_start: breakStartVal,
        break_end: breakEndVal,
      },
      epreuve,
    );
    if (target.length === 0) {
      const dur = epreuve.duration_minutes || 30;
      const roul = epreuve.roulement_minutes ?? 10;
      return Response.json(
        {
          error: `La plage est trop courte pour un seul créneau (durée ${dur} min + roulement ${roul} min).`,
        },
        { status: 400 },
      );
    }

    let openingsCreated = 0;
    let slotsCreated = 0;
    const warnings: string[] = [];

    for (const date of dates as string[]) {
      const result = await createOpeningWithSlots(epreuveId, epreuve, {
        room: roomTrimmed,
        date,
        start_time: startTime,
        end_time: endTime,
        break_start: breakStartVal,
        break_end: breakEndVal,
      });
      if (!result.ok) {
        warnings.push(`${date} : ${result.error}`);
        continue;
      }
      openingsCreated++;
      slotsCreated += result.slotsCreated;
    }

    if (openingsCreated === 0) {
      return Response.json(
        {
          error: "Aucune ouverture créée — toutes les dates sont en conflit.",
          warnings,
        },
        { status: 409 },
      );
    }

    return Response.json(
      { openings_created: openingsCreated, slots_created: slotsCreated, warnings },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create opening error:", error);
    return Response.json(
      {
        error: "Échec de création de l'ouverture",
        details: (error as any)?.message || String(error),
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Vérifier qu'il n'y a pas d'erreur TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: aucune nouvelle erreur liée à `app/api/openings/route.ts`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/app/api/openings/route.ts && git commit -m "$(cat <<'EOF'
feat: POST /api/openings accepte un tableau de dates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: État du formulaire — `dateEnd` et `excludedDates`

**Files:**
- Modify: `frontend/src/components/calendar/OpeningsManager.tsx`

- [ ] **Step 1: Mettre à jour l'import des fonctions pures**

Remplacer (après le Task 2, l'import est déjà `import { sliceOpening, weekdaysBetween } from "@/lib/opening-slicer";`) par :

```ts
import {
  sliceOpening,
  weekdaysBetween,
  openingDateCandidates,
  resolveOpeningDates,
} from "@/lib/opening-slicer";
```

- [ ] **Step 2: Étendre `OpeningForm` et `EMPTY_FORM`**

Remplacer (lignes 38-54) :

```ts
interface OpeningForm {
  room: string;
  date: string;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
}

const EMPTY_FORM: OpeningForm = {
  room: "",
  date: "",
  startTime: "09:00",
  endTime: "17:00",
  breakStart: "",
  breakEnd: "",
};
```

par :

```ts
interface OpeningForm {
  room: string;
  date: string;
  dateEnd: string;
  excludedDates: Set<string>;
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
}

const EMPTY_FORM: OpeningForm = {
  room: "",
  date: "",
  dateEnd: "",
  excludedDates: new Set(),
  startTime: "09:00",
  endTime: "17:00",
  breakStart: "",
  breakEnd: "",
};
```

- [ ] **Step 3: Vérifier qu'il n'y a pas d'erreur TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: **de nouvelles erreurs apparaissent** dans `renderFormRow` (les usages de `f` ne connaissent pas encore `dateEnd`/`excludedDates` dans le JSX, et `startEdit`/`setForm` ne les initialisent pas) — c'est attendu, elles seront résolues aux Tasks 6 et 7. Vérifier seulement qu'il n'y a **aucune** erreur ailleurs (fichiers hors `OpeningsManager.tsx`).

- [ ] **Step 4: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/components/calendar/OpeningsManager.tsx && git commit -m "$(cat <<'EOF'
feat: étend OpeningForm avec dateEnd et excludedDates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `renderFormRow` — deux champs date + puces d'exclusion

**Files:**
- Modify: `frontend/src/components/calendar/OpeningsManager.tsx`

- [ ] **Step 1: Remplacer `renderFormRow` et ses deux sites d'appel**

Remplacer toute la fonction `renderFormRow` (lignes 377-461) :

```ts
  const renderFormRow = (
    f: OpeningForm,
    setF: (f: OpeningForm) => void,
    onSubmit: () => void,
    onCancel?: () => void,
  ) => {
    const count = previewCount(f);
    const valid =
      f.room.trim() && f.date && f.startTime < f.endTime && count > 0;
    return (
      <tr className="bg-blue-50/40">
        <td className="px-3 py-2">
          <input
            type="text"
            value={f.room}
            onChange={(e) => setF({ ...f, room: e.target.value })}
            placeholder="Salle"
            className="w-24 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="date"
            value={f.date}
            min={dateMin || undefined}
            max={dateMax || undefined}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <input
            type="time"
            value={f.startTime}
            onChange={(e) => setF({ ...f, startTime: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
          <span className="mx-1 text-gray-400">–</span>
          <input
            type="time"
            value={f.endTime}
            onChange={(e) => setF({ ...f, endTime: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <input
            type="time"
            value={f.breakStart}
            onChange={(e) => setF({ ...f, breakStart: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            title="Début de pause (optionnel)"
          />
          <span className="mx-1 text-gray-400">–</span>
          <input
            type="time"
            value={f.breakEnd}
            onChange={(e) => setF({ ...f, breakEnd: e.target.value })}
            className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            title="Fin de pause (optionnel)"
          />
        </td>
        <td className="px-3 py-2 text-sm font-medium text-blue-700 whitespace-nowrap">
          → {count} créneau{count > 1 ? "x" : ""}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button
            onClick={onSubmit}
            disabled={busy || !valid}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {onCancel ? "✓ Enregistrer" : "+ Ajouter"}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="ml-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          )}
        </td>
      </tr>
    );
  };
```

par :

```ts
  const renderFormRow = (
    f: OpeningForm,
    setF: (f: OpeningForm) => void,
    onSubmit: () => void,
    onCancel?: () => void,
    allowRange = false,
  ) => {
    const perDayCount = previewCount(f);
    const candidates = allowRange
      ? openingDateCandidates(f.date, f.dateEnd)
      : [f.date];
    const finalDates = allowRange
      ? resolveOpeningDates(f.date, f.dateEnd, f.excludedDates)
      : [f.date];
    const isRange = allowRange && candidates.length > 1;
    const total = perDayCount * finalDates.length;
    const valid =
      f.room.trim() &&
      f.date &&
      f.startTime < f.endTime &&
      perDayCount > 0 &&
      finalDates.length > 0;
    return (
      <Fragment>
        <tr className="bg-blue-50/40">
          <td className="px-3 py-2">
            <input
              type="text"
              value={f.room}
              onChange={(e) => setF({ ...f, room: e.target.value })}
              placeholder="Salle"
              className="w-24 border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </td>
          <td className="px-3 py-2 whitespace-nowrap">
            <input
              type="date"
              value={f.date}
              min={dateMin || undefined}
              max={dateMax || undefined}
              onChange={(e) =>
                setF({ ...f, date: e.target.value, excludedDates: new Set() })
              }
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              title="Date de début"
            />
            {allowRange && (
              <>
                <span className="mx-1 text-gray-400">→</span>
                <input
                  type="date"
                  value={f.dateEnd}
                  min={f.date || dateMin || undefined}
                  max={dateMax || undefined}
                  onChange={(e) =>
                    setF({
                      ...f,
                      dateEnd: e.target.value,
                      excludedDates: new Set(),
                    })
                  }
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
                  title="Date de fin (optionnel — plusieurs jours)"
                />
              </>
            )}
          </td>
          <td className="px-3 py-2 whitespace-nowrap">
            <input
              type="time"
              value={f.startTime}
              onChange={(e) => setF({ ...f, startTime: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            />
            <span className="mx-1 text-gray-400">–</span>
            <input
              type="time"
              value={f.endTime}
              onChange={(e) => setF({ ...f, endTime: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            />
          </td>
          <td className="px-3 py-2 whitespace-nowrap">
            <input
              type="time"
              value={f.breakStart}
              onChange={(e) => setF({ ...f, breakStart: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              title="Début de pause (optionnel)"
            />
            <span className="mx-1 text-gray-400">–</span>
            <input
              type="time"
              value={f.breakEnd}
              onChange={(e) => setF({ ...f, breakEnd: e.target.value })}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
              title="Fin de pause (optionnel)"
            />
          </td>
          <td className="px-3 py-2 text-sm font-medium text-blue-700 whitespace-nowrap">
            {isRange
              ? `→ ${perDayCount} créneau${perDayCount > 1 ? "x" : ""}/jour × ${finalDates.length} jour${finalDates.length > 1 ? "s" : ""} = ${total} créneaux`
              : `→ ${perDayCount} créneau${perDayCount > 1 ? "x" : ""}`}
          </td>
          <td className="px-3 py-2 text-right whitespace-nowrap">
            <button
              onClick={onSubmit}
              disabled={busy || !valid}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {onCancel ? "✓ Enregistrer" : "+ Ajouter"}
            </button>
            {onCancel && (
              <button
                onClick={onCancel}
                className="ml-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            )}
          </td>
        </tr>
        {isRange && (
          <tr className="bg-blue-50/40">
            <td colSpan={6} className="px-3 pb-2.5 pt-0">
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((d) => {
                  const selected = !f.excludedDates.has(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        const next = new Set(f.excludedDates);
                        if (selected) next.add(d);
                        else next.delete(d);
                        setF({ ...f, excludedDates: next });
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors capitalize ${
                        selected
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-400 border-gray-300 line-through hover:border-blue-400"
                      }`}
                    >
                      {fmtDate(d)}
                    </button>
                  );
                })}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };
```

- [ ] **Step 2: Activer `allowRange` uniquement sur la ligne d'ajout**

Remplacer (ligne 634-635) :

```ts
                {editingId === null &&
                  renderFormRow(form, setForm, handleAdd)}
```

par :

```ts
                {editingId === null &&
                  renderFormRow(form, setForm, handleAdd, undefined, true)}
```

(La ligne d'édition, `renderFormRow(editForm, setEditForm, handleSaveEdit, () => setEditingId(null))`, n'est pas modifiée : `allowRange` reste `false` par défaut, donc l'édition demeure mono-jour comme spécifié.)

- [ ] **Step 3: Vérifier qu'il n'y a pas d'erreur TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: aucune erreur restante dans `OpeningsManager.tsx` (celles du Task 5 sont résolues).

- [ ] **Step 4: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/components/calendar/OpeningsManager.tsx && git commit -m "$(cat <<'EOF'
feat: ligne d'ajout d'ouverture avec plage de dates et puces d'exclusion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `handleAdd` envoie `dates` et affiche les avertissements

**Files:**
- Modify: `frontend/src/components/calendar/OpeningsManager.tsx`

- [ ] **Step 1: Remplacer `handleAdd`**

Remplacer (lignes 159-182) :

```ts
  const handleAdd = async () => {
    setBusy(true);
    try {
      const res = await api.post("/openings", {
        epreuveId: selectedEpreuveId,
        room: form.room,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || null,
        breakEnd: form.breakEnd || null,
      });
      toast(
        `Ouverture créée — ${res.data?.slots_created || 0} créneau(x) générés ✅`,
        "success",
      );
      setForm((prev) => ({ ...EMPTY_FORM, date: prev.date }));
      refreshAll();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Erreur lors de la création", "error");
    } finally {
      setBusy(false);
    }
  };
```

par :

```ts
  const handleAdd = async () => {
    const dates = resolveOpeningDates(form.date, form.dateEnd, form.excludedDates);
    if (dates.length === 0) return;
    setBusy(true);
    try {
      const res = await api.post("/openings", {
        epreuveId: selectedEpreuveId,
        room: form.room,
        dates,
        startTime: form.startTime,
        endTime: form.endTime,
        breakStart: form.breakStart || null,
        breakEnd: form.breakEnd || null,
      });
      const openingsCreated = res.data?.openings_created ?? 1;
      const slotsCreated = res.data?.slots_created || 0;
      const warnings: string[] = res.data?.warnings || [];
      if (warnings.length === 0) {
        toast(
          `${openingsCreated > 1 ? `${openingsCreated} ouvertures créées` : "Ouverture créée"} — ${slotsCreated} créneau(x) générés ✅`,
          "success",
        );
      } else {
        toast(
          `${openingsCreated} ouverture(s) créée(s), ${slotsCreated} créneau(x) générés · ${warnings.length} jour(s) ignoré(s) (conflit)`,
          "info",
        );
      }
      setForm((prev) => ({ ...EMPTY_FORM, date: prev.date }));
      refreshAll();
    } catch (e: any) {
      toast(e?.response?.data?.error || "Erreur lors de la création", "error");
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 2: Vérifier qu'il n'y a pas d'erreur TypeScript**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 3: Lancer toute la suite de tests frontend pour vérifier l'absence de régression**

Run: `cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npm run test`
Expected: PASS — tous les tests passent (y compris ceux ajoutés au Task 1).

- [ ] **Step 4: Commit**

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti" && git add frontend/src/components/calendar/OpeningsManager.tsx && git commit -m "$(cat <<'EOF'
feat: handleAdd envoie la plage de dates résolue et affiche les conflits

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Vérification manuelle de bout en bout

**Files:** aucun (vérification uniquement)

- [ ] **Step 1: Démarrer le backend et le frontend**

Run (deux terminaux, ou utiliser l'outil de preview du navigateur) :

```bash
cd "/Users/felixpitz/Desktop/RH Manager Anti/frontend" && npm run dev -- -p 3001
```

Se connecter en admin, aller sur la page Planning, onglet Création, choisir une épreuve non-commune.

- [ ] **Step 2: Créer une ouverture mono-jour (non-régression)**

Remplir salle + date (sans toucher au second champ date) + horaires → vérifier que l'aperçu affiche `→ N créneaux` (sans "jour(s)"), qu'aucune puce n'apparaît, et que la création fonctionne comme avant.

- [ ] **Step 3: Créer une ouverture multi-jours**

Remplir salle + date début + date fin (ex. un lundi → le vendredi suivant) + horaires → vérifier que les puces des 5 jours ouvrés apparaissent, cochées, et que l'aperçu affiche `→ N créneaux/jour × 5 jours = Total créneaux`. Cliquer « + Ajouter » → vérifier le toast (`X ouvertures créées`) et que les 5 ouvertures apparaissent dans le tableau avec le bon total.

- [ ] **Step 4: Décocher un jour avant de valider**

Refaire une création multi-jours, décocher une puce → vérifier que l'aperçu se met à jour (jour en moins) et que ce jour n'est pas créé après validation.

- [ ] **Step 5: Chevauchement sur un seul jour de la plage**

Créer une ouverture multi-jours qui inclut un jour où une ouverture existe déjà pour la même salle (chevauchement d'horaires) → vérifier le toast `info` mentionnant le nombre de jours ignorés, et que les autres jours de la plage sont bien créés.

- [ ] **Step 6: Non-régression sur la duplication et l'édition**

Vérifier que le bouton « 📋 Dupliquer une journée… » fonctionne toujours (liste des jours ouvrés cible identique à avant), et que « ✏️ Modifier » sur une ouverture existante affiche bien un seul champ date (pas de plage, pas de puces).

- [ ] **Step 7: Rapporter les captures d'écran/preuves à l'utilisateur**

Utiliser l'outil Browser (`mcp__Claude_Browser__*`) pour capturer une capture d'écran de l'état final (ligne d'ajout en plage + puces) et la partager.
