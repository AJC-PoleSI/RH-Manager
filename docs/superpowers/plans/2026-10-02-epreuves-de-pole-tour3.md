# Épreuves de pôle du Tour 3 — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Générer automatiquement les créneaux du Tour 3 (épreuves de pôle + Business Game) à partir des dispos saisies une seule fois, ne placer que des membres du pôle sur une épreuve de pôle au dispatch, et relancer les candidats sans vœux.

**Architecture:** Un générateur pur (`lib/tour-generator.ts`) remplace `lib/tour-openings.ts` dans `TourOpeningsPanel` ; il reçoit par épreuve son vivier de membres éligibles et réserve nommément les membres tranche par tranche. Le dispatch (`lib/dispatchService.ts`) charge le pôle des membres et filtre `matchSlotToMembers` ; `compareByTension` sert les créneaux de pôle en premier. La relance des vœux est une fonction pure + une route cron Vercel + un bandeau candidat + un filtre d'annonce.

**Tech Stack:** Next.js App Router (frontend/), Supabase (service role via `supabaseAdmin`), vitest, Resend (+ secours Brevo), cron Vercel.

Spec : `docs/superpowers/specs/2026-10-02-epreuves-de-pole-tour3-design.md`.

Conventions du dépôt à respecter : commentaires en français expliquant le *pourquoi* ; lectures paginées via `fetchAllRows` (plafond 1000 lignes PostgREST) ; tolérance aux colonnes absentes via `isMissingColumnError` (`lib/slot-lock.ts`) ; jamais d'id venant du client pour une ressource candidat ; tests `vitest` à côté des modules purs (`*.test.ts`) ; `cd frontend && npm test` et `npm run typecheck`.

---

## Task 1 : Migrations SQL (fichiers) + case « Respo de pôle »

**Files:**
- Create: `supabase-migration-pole-lead.sql`
- Create: `supabase-migration-wishes-reminder.sql`
- Modify: `MIGRATIONS_A_APPLIQUER.sql` (ajouter les deux blocs en fin de fichier)
- Modify: `frontend/src/app/api/members/route.ts`
- Modify: `frontend/src/app/api/members/[id]/route.ts`
- Modify: `frontend/src/app/(dashboard)/dashboard/evaluations/page.tsx`

- [ ] **Step 1 : fichiers SQL**

`supabase-migration-pole-lead.sql` :
```sql
-- ============================================
-- Migration: « Respo de pôle » sur la fiche membre
-- ============================================
-- Information seulement (aucun effet sur le dispatch) — demandé par Felix
-- le 02/10/2026 « au cas où ».
ALTER TABLE members ADD COLUMN IF NOT EXISTS is_pole_lead BOOLEAN NOT NULL DEFAULT false;
```

`supabase-migration-wishes-reminder.sql` :
```sql
-- ============================================
-- Migration: relance automatique des vœux de pôle
-- ============================================
-- Date du dernier mail de relance envoyé au candidat. Sans cette colonne la
-- route cron REFUSE d'envoyer (elle relancerait tout le monde chaque jour).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS wishes_reminded_at TIMESTAMPTZ;
```

Ajouter les deux `ALTER TABLE` à la fin de `MIGRATIONS_A_APPLIQUER.sql` sous un titre `-- 02/10/2026 — épreuves de pôle T3 / relance des vœux`.

- [ ] **Step 2 : API membres — `isPoleLead`**

Dans `members/route.ts` GET : `selectFields` ajoute `, is_pole_lead` ; en cas d'erreur `isMissingColumnError(error)` (import depuis `@/lib/slot-lock`), relire sans la colonne. Mapping : `isPoleLead: !!m.is_pole_lead`. POST : lire `isPoleLead` du body, insérer `is_pole_lead: !!isPoleLead` (si erreur colonne absente → réinsérer sans). Même chose dans `[id]/route.ts` GET/PUT (`if (isPoleLead !== undefined) updateData.is_pole_lead = !!isPoleLead;` avec repli sans la clé si colonne absente).

- [ ] **Step 3 : UI fiche membre**

`evaluations/page.tsx` : ajouter `isPoleLead: boolean` au type `Member`, aux états `form`/`editForm` (défaut `false`), aux payloads de création/édition, une case à cocher « Respo de pôle » sous le select Pôle (création et édition), et un badge `Respo` (classe `text-[10px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded`) à côté du badge de pôle dans la liste.

- [ ] **Step 4 : `npm run typecheck`** → propre. Commit `feat(membres): case « Respo de pôle »`.

---

## Task 2 : Générateur pur `lib/tour-generator.ts` (TDD)

**Files:**
- Create: `frontend/src/lib/tour-generator.ts`
- Create: `frontend/src/lib/tour-generator.test.ts`

- [ ] **Step 1 : tests (écrits d'abord)**

```ts
import { describe, it, expect } from "vitest";
import { generateTourSlots, chargeParPersonne } from "./tour-generator";

const win = (memberId: string, startMin: number, endMin: number) => ({ memberId, startMin, endMin });
const ep = (o: Partial<Parameters<typeof generateTourSlots>[0]["epreuves"][number]> & { epreuveId: string }) => ({
  name: o.epreuveId, isGroupEpreuve: false, evaluatorsPerRoom: 2, slotSpanMin: 30,
  targetSlots: 10, eligibleMembers: [] as string[], ...o,
});

describe("chargeParPersonne", () => {
  it("places de jury à pourvoir ÷ membres éligibles", () => {
    expect(chargeParPersonne({ remaining: 40, evaluatorsPerRoom: 2, eligibleCount: 4 })).toBe(20);
  });
  it("sans membre éligible → infini (sert à alerter, jamais à générer)", () => {
    expect(chargeParPersonne({ remaining: 1, evaluatorsPerRoom: 2, eligibleCount: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("generateTourSlots", () => {
  it("une épreuve de pôle ne consomme que les membres de son pôle", () => {
    const r = generateTourSlots({
      rooms: ["205", "217"],
      days: [{ dayIndex: 0, windows: [win("devco1", 540, 660), win("devco2", 540, 660), win("mkt1", 540, 660)], busy: [], roomsTaken: [] }],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["devco1", "devco2"], targetSlots: 4 })],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    expect(r.bandsByEpreuve.devco[0]).toMatchObject({ laneId: "205", startMin: 540, endMin: 660 });
    expect(r.remainingByEpreuve.devco).toBe(0);
  });

  it("un membre n'est jamais compté deux fois au même horaire", () => {
    // Tom (Dev Co) est le seul Dev Co dispo avec Léa ; le Business Game
    // (tout le monde) ne doit pas réutiliser Tom et Léa sur la même tranche.
    const r = generateTourSlots({
      rooms: ["205", "217", "219"],
      days: [{ dayIndex: 0, windows: [win("tom", 540, 600), win("lea", 540, 600), win("a", 540, 600), win("b", 540, 600), win("c", 540, 600)], busy: [], roomsTaken: [] }],
      epreuves: [
        ep({ epreuveId: "devco", eligibleMembers: ["tom", "lea"], targetSlots: 2 }),
        ep({ epreuveId: "bg", isGroupEpreuve: true, evaluatorsPerRoom: 4, slotSpanMin: 60, eligibleMembers: ["tom", "lea", "a", "b", "c"], targetSlots: 1 }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    // Il ne reste que a, b, c (3 < 4) : pas de Business Game possible.
    expect(r.bandsByEpreuve.bg).toHaveLength(0);
    expect(r.reasonByEpreuve.bg).toBe("no_members");
  });

  it("priorité à la charge par personne la plus forte, recalculée", () => {
    // SI : 1 créneau à produire pour 2 membres (charge 1) ; Dev Co : 6
    // créneaux pour 2 membres (charge 6). Un seul membre commun « x »
    // dispo avec « y » (Dev Co) et « z » (SI) : Dev Co doit être servie.
    const r = generateTourSlots({
      rooms: ["205"],
      days: [{ dayIndex: 0, windows: [win("x", 540, 570), win("y", 540, 570), win("z", 540, 570)], busy: [], roomsTaken: [] }],
      epreuves: [
        ep({ epreuveId: "si", eligibleMembers: ["x", "z"], targetSlots: 1 }),
        ep({ epreuveId: "devco", eligibleMembers: ["x", "y"], targetSlots: 6 }),
      ],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(1);
    expect(r.bandsByEpreuve.si).toHaveLength(0);
  });

  it("une salle déjà prise (créneau existant) n'est pas réutilisée", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [{ dayIndex: 0, windows: [win("a", 540, 600), win("b", 540, 600)], busy: [], roomsTaken: [{ room: "205", startMin: 540, endMin: 600 }] }],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b"], targetSlots: 2 })],
    });
    expect(r.bandsByEpreuve.devco).toHaveLength(0);
    expect(r.reasonByEpreuve.devco).toBe("no_rooms");
  });

  it("un membre déjà affecté ailleurs (busy) n'est pas réservé", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [{ dayIndex: 0, windows: [win("a", 540, 600), win("b", 540, 600)], busy: [{ memberId: "a", startMin: 540, endMin: 570 }], roomsTaken: [] }],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b"], targetSlots: 2 })],
    });
    // 9h00–9h30 : a occupé → rien ; 9h30–10h00 : a et b libres → 1 créneau.
    expect(r.bandsByEpreuve.devco).toEqual([expect.objectContaining({ startMin: 570, endMin: 600 })]);
  });

  it("s'arrête net quand la cible est atteinte", () => {
    const r = generateTourSlots({
      rooms: ["205", "217"],
      days: [{ dayIndex: 0, windows: [win("a", 540, 780), win("b", 540, 780), win("c", 540, 780), win("d", 540, 780)], busy: [], roomsTaken: [] }],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b", "c", "d"], targetSlots: 3 })],
    });
    const produced = r.bandsByEpreuve.devco.reduce((s, b) => s + Math.floor((b.endMin - b.startMin) / 30), 0);
    expect(produced).toBe(3);
    expect(r.remainingByEpreuve.devco).toBe(0);
  });

  it("respecte la période de l'épreuve (jours et heures de journée)", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [
        { dayIndex: 0, windows: [win("a", 540, 600), win("b", 540, 600)], busy: [], roomsTaken: [] },
        { dayIndex: 1, windows: [win("a", 540, 600), win("b", 540, 600)], busy: [], roomsTaken: [] },
      ],
      epreuves: [ep({ epreuveId: "devco", eligibleMembers: ["a", "b"], targetSlots: 4, dayIndexes: [1], dayStartMin: 570, dayEndMin: 600 })],
    });
    expect(r.bandsByEpreuve.devco).toEqual([expect.objectContaining({ dayIndex: 1, startMin: 570, endMin: 600 })]);
  });

  it("épreuve sans aucun membre éligible → alerte, rien de généré", () => {
    const r = generateTourSlots({
      rooms: ["205"],
      days: [{ dayIndex: 0, windows: [win("a", 540, 600)], busy: [], roomsTaken: [] }],
      epreuves: [ep({ epreuveId: "treso", eligibleMembers: [], targetSlots: 2 })],
    });
    expect(r.bandsByEpreuve.treso).toHaveLength(0);
    expect(r.reasonByEpreuve.treso).toBe("no_eligible");
  });
});
```

- [ ] **Step 2 : `cd frontend && npx vitest run src/lib/tour-generator.test.ts`** → échoue (module absent).

- [ ] **Step 3 : implémentation**

```ts
/**
 * tour-generator — crée les créneaux d'un TOUR entier (épreuves de pôle +
 * épreuves communes à tous comme le Business Game) à partir des dispos
 * saisies UNE SEULE FOIS par les membres.
 *
 * Succède à tour-openings.ts (priorité groupe > individuel, pool global) :
 * ici chaque épreuve a SON vivier de membres éligibles (épreuve de pôle =
 * les membres du pôle, sinon tout le monde) et les membres sont réservés
 * NOMMÉMENT tranche par tranche — c'est ce qui empêche de compter Tom (Dev
 * Co) à la fois pour Dev Co et pour le Business Game à 14h.
 *
 * Priorité entre épreuves = CHARGE PAR PERSONNE (places de jury encore à
 * pourvoir ÷ membres éligibles), recalculée à chaque tranche. Décision de
 * Felix (02/10/2026) : « la priorité doit se faire par le nombre de
 * personnes nécessaires et le nombre de candidats à faire passer ».
 *
 * Fonction pure, jamais d'écriture : l'appelant affiche un récapitulatif
 * et n'enregistre qu'après relecture. Spec :
 * docs/superpowers/specs/2026-10-02-epreuves-de-pole-tour3-design.md
 */
import { CAPACITY_STEP_MIN, type AvailabilityWindow } from "./room-capacity";
import { GRID_START_MIN, GRID_END_MIN, type Band } from "./time-bands";

export interface GeneratorEpreuve {
  epreuveId: string;
  name: string;
  isGroupEpreuve: boolean;
  /** Examinateurs requis par créneau. */
  evaluatorsPerRoom: number;
  /** Durée d'un créneau + roulement. */
  slotSpanMin: number;
  /** Créneaux qu'il reste à produire (cible − déjà existants). */
  targetSlots: number;
  /** Membres qui PEUVENT tenir cette épreuve (pôle, ou tout le monde). */
  eligibleMembers: string[];
  /** Jours autorisés (index dans `days`) ; null/absent = tous. */
  dayIndexes?: number[] | null;
  /** Heures de journée de l'épreuve, en minutes ; défaut = grille. */
  dayStartMin?: number | null;
  dayEndMin?: number | null;
}

export interface BusyInterval { memberId: string; startMin: number; endMin: number }
export interface RoomInterval { room: string; startMin: number; endMin: number }

export interface GeneratorDay {
  dayIndex: number;
  windows: AvailabilityWindow[];
  /** Affectations déjà en base ce jour-là (toutes épreuves, tous tours). */
  busy: BusyInterval[];
  /** Créneaux déjà existants ce jour-là : la salle est prise. */
  roomsTaken: RoomInterval[];
}

export interface GeneratorInput {
  days: GeneratorDay[];
  epreuves: GeneratorEpreuve[];
  /** Liste COMMUNE des salles, dans l'ordre de préférence. */
  rooms: string[];
}

export type ShortfallReason = "ok" | "no_eligible" | "no_members" | "no_rooms" | "no_days";

export interface GeneratorResult {
  bandsByEpreuve: Record<string, Band[]>;
  remainingByEpreuve: Record<string, number>;
  /** Cause dominante du manque, pour le récapitulatif. */
  reasonByEpreuve: Record<string, ShortfallReason>;
}

export function chargeParPersonne(o: { remaining: number; evaluatorsPerRoom: number; eligibleCount: number }): number {
  if (o.eligibleCount <= 0) return Number.POSITIVE_INFINITY;
  return (Math.max(0, o.remaining) * Math.max(1, o.evaluatorsPerRoom)) / o.eligibleCount;
}

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

let seq = 0;
const nextId = () => `gen-${Date.now().toString(36)}-${seq++}`;

export function generateTourSlots(input: GeneratorInput): GeneratorResult {
  const step = CAPACITY_STEP_MIN;
  const bandsByEpreuve: Record<string, Band[]> = {};
  const remaining: Record<string, number> = {};
  const reason: Record<string, ShortfallReason> = {};
  // Compteur de réservations par membre sur toute la génération (étalement).
  const reservations = new Map<string, number>();

  for (const e of input.epreuves) {
    bandsByEpreuve[e.epreuveId] = [];
    remaining[e.epreuveId] = Math.max(0, e.targetSlots);
    reason[e.epreuveId] = e.eligibleMembers.length === 0 && e.targetSlots > 0 ? "no_eligible" : "ok";
  }

  const keyOf = (epreuveId: string, room: string) => `${epreuveId}|${room}`;
  const openSince = new Map<string, number>();
  // Qui tenait cette (épreuve, salle) à la tranche précédente — continuité.
  const crewOf = new Map<string, string[]>();

  const closeBand = (e: GeneratorEpreuve, room: string, dayIndex: number, endMin: number) => {
    const k = keyOf(e.epreuveId, room);
    const start = openSince.get(k);
    if (start === undefined) return;
    openSince.delete(k);
    crewOf.delete(k);
    const slots = Math.floor((endMin - start) / e.slotSpanMin);
    if (slots <= 0) return;
    bandsByEpreuve[e.epreuveId].push({ id: nextId(), dayIndex, laneId: room, startMin: start, endMin });
    remaining[e.epreuveId] = Math.max(0, remaining[e.epreuveId] - slots);
  };

  /** Créneaux que produirait l'épreuve si on fermait ses plages maintenant. */
  const projected = (e: GeneratorEpreuve, atMin: number): number => {
    const closed = Math.max(0, e.targetSlots) - remaining[e.epreuveId];
    let open = 0;
    for (const room of input.rooms) {
      const start = openSince.get(keyOf(e.epreuveId, room));
      if (start !== undefined) open += Math.floor((atMin - start) / e.slotSpanMin);
    }
    return closed + open;
  };
  const effectiveRemaining = (e: GeneratorEpreuve, atMin: number) =>
    Math.max(0, Math.max(0, e.targetSlots) - projected(e, atMin));

  const allSettled = () => input.epreuves.every((e) => remaining[e.epreuveId] <= 0);

  const noteReason = (e: GeneratorEpreuve, r: ShortfallReason) => {
    // La première cause rencontrée domine, sauf « ok » qui n'écrase rien.
    if (reason[e.epreuveId] === "ok" || reason[e.epreuveId] === "no_days") reason[e.epreuveId] = r;
  };

  for (const day of input.days) {
    if (allSettled()) break;
    openSince.clear();
    crewOf.clear();

    for (let t = GRID_START_MIN; t + step <= GRID_END_MIN; t += step) {
      const trancheEnd = t + step;

      // Membres libres sur TOUTE la tranche : dispo couvrante, pas d'affectation existante.
      const free = new Set<string>();
      for (const w of day.windows) {
        if (w.startMin <= t && w.endMin >= trancheEnd) free.add(w.memberId);
      }
      for (const b of day.busy) {
        if (overlaps(b.startMin, b.endMin, t, trancheEnd)) free.delete(b.memberId);
      }

      // Salles prises par l'existant sur cette tranche.
      const roomTaken = new Set<string>();
      for (const r of day.roomsTaken) {
        if (overlaps(r.startMin, r.endMin, t, trancheEnd)) roomTaken.add(r.room);
      }
      const renewed = new Set<string>(); // (épreuve|salle) reconduites cette tranche

      // Ordre : charge par personne la plus forte d'abord, recalculée ici.
      const order = input.epreuves
        .filter((e) => effectiveRemaining(e, t) > 0 && e.eligibleMembers.length > 0)
        .map((e) => ({
          e,
          charge: chargeParPersonne({
            remaining: effectiveRemaining(e, t),
            evaluatorsPerRoom: e.evaluatorsPerRoom,
            eligibleCount: e.eligibleMembers.length,
          }),
        }))
        .sort((a, b) => {
          if (a.charge !== b.charge) return b.charge - a.charge;
          if (a.e.eligibleMembers.length !== b.e.eligibleMembers.length) return a.e.eligibleMembers.length - b.e.eligibleMembers.length;
          return 0;
        })
        .map((x) => x.e);

      for (const e of order) {
        const inDays = !e.dayIndexes || e.dayIndexes.includes(day.dayIndex);
        const dayStart = e.dayStartMin ?? GRID_START_MIN;
        const dayEnd = e.dayEndMin ?? GRID_END_MIN;
        if (!inDays || t < dayStart || trancheEnd > dayEnd) {
          noteReason(e, "no_days");
          continue;
        }
        const eligibleSet = new Set(e.eligibleMembers);
        const candidates = () => Array.from(free).filter((m) => eligibleSet.has(m));

        while (effectiveRemaining(e, t) > 0) {
          const pool = candidates();
          if (pool.length < e.evaluatorsPerRoom) {
            if (pool.length < e.evaluatorsPerRoom) noteReason(e, "no_members");
            break;
          }
          // Salle : d'abord celle déjà ouverte pour cette épreuve (continuité), sinon la première libre.
          let room: string | null = null;
          for (const r of input.rooms) {
            if (roomTaken.has(r)) continue;
            if (openSince.has(keyOf(e.epreuveId, r)) && !renewed.has(keyOf(e.epreuveId, r))) { room = r; break; }
          }
          if (!room) room = input.rooms.find((r) => !roomTaken.has(r)) ?? null;
          if (!room) { noteReason(e, "no_rooms"); break; }

          const k = keyOf(e.epreuveId, room);
          const previous = crewOf.get(k) ?? [];
          // Continuité d'abord (un créneau à cheval sur deux tranches garde
          // les mêmes personnes), puis les moins sollicités.
          pool.sort((a, b) => {
            const pa = previous.includes(a) ? 0 : 1;
            const pb = previous.includes(b) ? 0 : 1;
            if (pa !== pb) return pa - pb;
            return (reservations.get(a) ?? 0) - (reservations.get(b) ?? 0);
          });
          const crew = pool.slice(0, e.evaluatorsPerRoom);
          for (const m of crew) { free.delete(m); reservations.set(m, (reservations.get(m) ?? 0) + 1); }
          roomTaken.add(room);
          renewed.add(k);
          crewOf.set(k, crew);
          if (!openSince.has(k)) openSince.set(k, t);
        }
      }

      // Plages non reconduites → fermées (salle reprise, effectif manquant…).
      for (const e of input.epreuves) {
        for (const room of input.rooms) {
          const k = keyOf(e.epreuveId, room);
          if (openSince.has(k) && !renewed.has(k)) closeBand(e, room, day.dayIndex, t);
        }
      }
      // Contrôle exact : cible atteinte avec les plages ouvertes → on ferme
      // MAINTENANT pour ne pas retenir des membres inutilement.
      for (const e of input.epreuves) {
        if (remaining[e.epreuveId] <= 0) continue;
        if (projected(e, trancheEnd) >= Math.max(0, e.targetSlots)) {
          for (const room of input.rooms) closeBand(e, room, day.dayIndex, trancheEnd);
        }
      }
    }

    for (const e of input.epreuves) {
      for (const room of input.rooms) closeBand(e, room, day.dayIndex, GRID_END_MIN);
    }
  }

  for (const e of input.epreuves) {
    if (remaining[e.epreuveId] <= 0) reason[e.epreuveId] = "ok";
  }
  return { bandsByEpreuve, remainingByEpreuve: remaining, reasonByEpreuve: reason };
}
```

- [ ] **Step 4 : tests verts** (`npx vitest run src/lib/tour-generator.test.ts`). Ajuster l'implémentation jusqu'au vert, pas les tests (sauf si un test est faux).

- [ ] **Step 5 : Commit** `feat(planning): générateur de créneaux par tour avec viviers par pôle`.

---

## Task 3 : API `GET /api/tours/[tour]/generation-inputs`

**Files:**
- Create: `frontend/src/app/api/tours/[tour]/generation-inputs/route.ts`
- Create: `frontend/src/lib/generation-inputs.ts` (pur) + `generation-inputs.test.ts`

- [ ] **Step 1 : fonction pure `expectedCandidatesFor`** dans `lib/generation-inputs.ts` + tests :

```ts
import { samePole } from "./auth-poles";

export interface DelibRow { candidate_id: string; tour1_status?: string | null; tour2_status?: string | null; tour3_status?: string | null }
export interface WishRow { candidate_id: string; pole: string | null }

/** Candidats attendus sur une épreuve : admis au tour précédent (tour 1 = tous), non refusés, et, pour une épreuve de pôle, ayant un vœu pour ce pôle. */
export function expectedCandidatesFor(o: {
  tour: number; isPoleTest: boolean; pole: string | null;
  candidateIds: string[]; deliberations: DelibRow[]; wishes: WishRow[];
}): string[] {
  const delib = new Map(o.deliberations.map((d) => [d.candidate_id, d]));
  const refused = (d?: DelibRow) => [d?.tour1_status, d?.tour2_status, d?.tour3_status].includes("refused");
  const wishedBy = new Map<string, string[]>();
  for (const w of o.wishes) {
    if (!w.pole) continue;
    const list = wishedBy.get(w.candidate_id) ?? [];
    list.push(w.pole);
    wishedBy.set(w.candidate_id, list);
  }
  return o.candidateIds.filter((id) => {
    const d = delib.get(id);
    if (refused(d)) return false;
    if (o.tour >= 2) {
      const prev = (d as any)?.[`tour${o.tour - 1}_status`];
      if (prev !== "accepted") return false;
    }
    if (o.isPoleTest && o.pole) {
      return (wishedBy.get(id) ?? []).some((p) => samePole(p, o.pole));
    }
    return true;
  });
}
```

Tests : tour 1 → tous sauf refusés ; tour 3 pôle « Développement commercial » → admis T2 avec vœu (accents/casse ignorés) ; refusé exclu ; sans vœu exclu.

- [ ] **Step 2 : la route** (admin) : `?start=YYYY-MM-DD&end=YYYY-MM-DD` (bornes des jours chargés). Lit (toutes lectures `fetchAllRows`) :
  - épreuves du tour (`epreuves.tour = N`, `type <> 'commune'`), colonnes `id, name, is_group_epreuve, is_pole_test, pole, duration_minutes, roulement_minutes, min_evaluators_per_salle, group_size, min_candidates, date_debut, date_fin, heure_debut_journee, heure_fin_journee` ;
  - `tour_settings` du tour ; `candidates(id)` ; `deliberations` ; `candidate_wishes(candidate_id, pole)` ; `members(id, first_name, last_name, email, pole)` hors super-admin ;
  - créneaux existants dans [start,end] : `evaluation_slots(id, epreuve_id, date, start_time, end_time, room, status)` avec `status <> 'cancelled'` ; affectations `slot_member_assignments(member_id, slot:evaluation_slots(date,start_time,end_time))` ; `system_settings.rooms` via `lib/rooms-db.ts` (fonction existante de lecture de la liste).
  - Par épreuve : `expectedCandidates` (pôle : `expectedCandidatesFor` ; sinon `tour_settings.candidats_attendus ?? expectedCandidatesFor` sans pôle), `existingSlots` (count des créneaux de l'épreuve, toutes dates), `eligibleMemberIds` (pôle : `samePole` ; sinon tous), `poleKnown` (un membre au moins a ce pôle).
  - Réponse : `{ tour, margePct, rooms, members:[{id,name,pole}], epreuves:[…], busy:[{memberId,date,startTime,endTime}], roomsTaken:[{room,date,startTime,endTime}] }`.
  - SECURITY : admin only ; la route révèle l'effectif par pôle.

- [ ] **Step 3 : typecheck + commit** `feat(api): entrées de génération d'un tour (attendus, viviers, réservations)`.

---

## Task 4 : `TourOpeningsPanel` → « Générer le Tour N »

**Files:**
- Modify: `frontend/src/components/planning/TourOpeningsPanel.tsx`
- Modify: `frontend/src/app/(dashboard)/dashboard/planning/page.tsx:3085-3120`

- [ ] **Step 1 : affichage** : le panneau s'affiche si `memeTour.length >= 2` **ou** si une épreuve du tour est de pôle (`isPoleTest`). Passer `isPoleTest`, `pole`, `dateFin` dans les props d'épreuve. Titre « Générer le Tour N ».

- [ ] **Step 2 : période** : deux champs date `du … au …` préremplis avec min(`dateDebut`) / max(`dateFin`) des épreuves (sinon semaine courante → +4 jours). `days` = tous les jours ouvrés (lun–ven) de la période. Remplace la navigation par semaine.

- [ ] **Step 3 : chargement** à l'ouverture : `GET /api/tours/${tour}/generation-inputs?start&end` + `GET /availability/all?start&end` (dispos fusionnées comme aujourd'hui avec `mergeIntervals(…, MERGE_TOLERANCE_MIN)`). Construire `GeneratorInput` : par épreuve `targetSlots = max(0, estimateSlotsNeeded({candidatsAttendus: expectedCandidates, margePct, isGroupEpreuve, groupSize, minCandidates}).min − existingSlots)`, `eligibleMembers`, `dayIndexes` (jours de la période de l'épreuve), `dayStartMin/EndMin` (`heure_debut_journee/fin`), `busy`/`roomsTaken` convertis en minutes par jour.

- [ ] **Step 4 : bouton « Générer »** → `generateTourSlots` → récapitulatif : tableau par épreuve `Cible · Existants · Proposés · Manque · Cause` (libellés : `no_eligible` → « aucun membre du pôle », `no_members` → « pas assez de membres disponibles », `no_rooms` → « pas de salle libre », `no_days` → « période épuisée ») + détail des bandes (existant). Épreuve `!poleKnown` → ligne en alerte « pôle inconnu : {pole} — pôles connus : … ».

- [ ] **Step 5 : « Enregistrer »** inchangé (`POST /openings` par bande, puis `POST /dispatch/run` global).

- [ ] **Step 6 : typecheck + commit** `feat(planning): bouton « Générer le Tour N » (épreuves de pôle, viviers, réservations nommées)`.

---

## Task 5 : Dispatch — éligibilité par pôle et pôle d'abord

**Files:**
- Modify: `frontend/src/lib/dispatch-core.ts` (`SlotDemand`, `compareByTension`)
- Modify: `frontend/src/lib/dispatch-core.test.ts`
- Modify: `frontend/src/lib/dispatchService.ts`

- [ ] **Step 1 : test `compareByTension`** : deux créneaux non ancrés, l'un `isPoleTest: true` (individuel), l'autre groupe avec gros déficit → le créneau de pôle passe devant. Ancré bat pôle.

- [ ] **Step 2 : `SlotDemand.isPoleTest?: boolean`** ; dans `compareByTension`, juste après le test `isAnchored` :
```ts
  const pa = a.isPoleTest ? 1 : 0;
  const pb = b.isPoleTest ? 1 : 0;
  if (pa !== pb) return pb - pa; // épreuve de pôle d'abord : seuls les membres du pôle peuvent la tenir
```

- [ ] **Step 3 : `dispatchService.ts`**
  1. Après l'étape 2 (dispos), charger `members(id, pole)` via `fetchAllRows` → `poleOfMember: Map<string, string|null>`.
  2. `matchSlotToMembers` : si `slot.epreuve?.is_pole_test && slot.epreuve.pole`, ne garder que `samePole(poleOfMember.get(memberId), slot.epreuve.pole)` (import `samePole` depuis `@/lib/auth-poles`). Commentaire : le pôle est une règle d'ÉLIGIBILITÉ, pas une préférence — le placement manuel (admin, `is_manual`) reste possible et ancre le créneau (9b).
  3. `demandOf` : ajouter `isPoleTest: !!slot.epreuve?.is_pole_test`.
  4. 9b-bis : avant le test de dispo, si créneau de pôle et membre hors pôle et pas d'affectation manuelle sur ce (créneau, membre) → `removedMembers.push({… reason: "hors pôle"})`, `releasePreRegistration`, `return`. Repérer comment `is_manual` est indexé (grep `manualSlotIds` / `is_manual`) et construire si besoin `manualPairs: Set<"slotId:memberId">` à l'étape 3.
  5. 9f : motif `"hors pôle"` quand le membre retiré n'est pas du pôle du créneau.
  6. 8ter : ne pré-enregistrer un membre hors pôle que s'il est manuel (sinon il sera retiré en 9b-bis).

- [ ] **Step 4 : `npm test` + typecheck.** Commit `feat(dispatch): épreuves de pôle — seuls les membres du pôle, servies en premier`.

---

## Task 6 : Relance des vœux — fonction pure + filtre d'annonce

**Files:**
- Create: `frontend/src/lib/wishes-reminder.ts` + `wishes-reminder.test.ts`
- Modify: `frontend/src/lib/announcements.ts` + `announcements.test.ts`

- [ ] **Step 1 : tests `selectCandidatesToRemind`** : relancé si admis T1, en lice, email vérifié, sans vœu, jamais relancé ou relancé il y a ≥ 3 jours ; exclu si vœu, refusé, non admis T1, email non vérifié, relancé il y a 1 jour, vœux verrouillés, Tour 2 `termine`.

- [ ] **Step 2 : implémentation**
```ts
export const WISHES_REMINDER_INTERVAL_DAYS = 3;
export const WISHES_REMINDER_SUBJECT = "Vos choix de pôles — pensez à les remplir";
/** Le gabarit d'email ajoute déjà « Bonjour {prénom}, » en tête. */
export const WISHES_REMINDER_BODY =
  "N'oubliez pas de remplir vos choix de pôles sur votre espace candidat. " +
  "Ils ne sont pas définitifs : ils sont indicatifs et nous permettent de savoir " +
  "approximativement ce que vous souhaiteriez. Ils seront pris en compte.\n\n" +
  "Merci,\nChristine Lamaille";

export interface ReminderCandidate { id: string; email: string | null; first_name: string | null; email_verified?: boolean | null; wishes_locked_at?: string | null; wishes_reminded_at?: string | null }
export interface ReminderDelib { candidate_id: string; tour1_status?: string | null; tour2_status?: string | null; tour3_status?: string | null }

export function needsWishes(c: ReminderCandidate, d: ReminderDelib | undefined, hasWishes: boolean, tour2Status: string | null | undefined): boolean {
  if (hasWishes) return false;
  if (c.wishes_locked_at) return false;
  if (tour2Status === "termine") return false;
  if (!d || d.tour1_status !== "accepted") return false;
  if ([d.tour1_status, d.tour2_status, d.tour3_status].includes("refused")) return false;
  return true;
}

export function selectCandidatesToRemind(o: { candidates: ReminderCandidate[]; deliberations: ReminderDelib[]; wishCandidateIds: Iterable<string>; tour2Status: string | null | undefined; now?: Date }): ReminderCandidate[] {
  const now = o.now ?? new Date();
  const delib = new Map(o.deliberations.map((d) => [d.candidate_id, d]));
  const withWishes = new Set(o.wishCandidateIds);
  const minMs = WISHES_REMINDER_INTERVAL_DAYS * 24 * 3600 * 1000;
  return o.candidates.filter((c) => {
    if (!c.email || c.email_verified === false) return false;
    if (!needsWishes(c, delib.get(c.id), withWishes.has(c.id), o.tour2Status)) return false;
    if (c.wishes_reminded_at && now.getTime() - new Date(c.wishes_reminded_at).getTime() < minMs) return false;
    return true;
  });
}
```

- [ ] **Step 3 : filtre `no_wishes`** dans `announcements.ts` : ajouter `"no_wishes"` au type et `{ value: "no_wishes", label: "Vœux de pôle non remplis (admis T1, en lice)" }` ; `candidateMatchesFilter(filter, delib, extra?: { hasWishes?: boolean })` → `case "no_wishes": return statuses[0] === "accepted" && !statuses.includes("refused") && !extra?.hasWishes;`. Test.

- [ ] **Step 4 : commit** `feat(relance): sélection des candidats sans vœux + filtre d'annonce`.

---

## Task 7 : Relance des vœux — base, routes, cron, bandeau, bouton

**Files:**
- Create: `frontend/src/lib/announcements-db.ts` (déplacer `emailsSentToday`, `isMissingTable`, `migrationRequired` depuis `app/api/announcements/route.ts`)
- Create: `frontend/src/lib/wishes-reminder-db.ts` (`runWishesReminder({ dryRun })`)
- Create: `frontend/src/app/api/cron/wishes-reminder/route.ts`
- Create: `frontend/src/app/api/admin/wishes-reminder/route.ts`
- Create: `frontend/src/app/api/wishes/status/route.ts`
- Create: `frontend/src/components/candidates/WishesNudge.tsx`
- Create: `frontend/src/components/announcements/WishesReminderCard.tsx`
- Modify: `frontend/src/app/api/announcements/route.ts` (filtre `no_wishes` → lire `candidate_wishes.candidate_id` quand le filtre est `no_wishes`)
- Modify: `frontend/src/app/candidates/dashboard/page.tsx` (monter `<WishesNudge />` sous `<PhotoNudge />`)
- Modify: `frontend/src/app/(dashboard)/dashboard/messages/page.tsx` (monter `<WishesReminderCard />`)
- Modify: `frontend/vercel.json` (cron `/api/cron/wishes-reminder` à `0 8 * * *`)

- [ ] **Step 1 : `runWishesReminder`** : lit (paginé) `candidates(id, email, first_name, email_verified, wishes_locked_at, wishes_reminded_at)` — si `wishes_reminded_at` absent (`isMissingColumnError`) → retourne `{ migrationPending: true }` et N'ENVOIE RIEN ; `deliberations` ; `candidate_wishes(candidate_id)` ; `tours` (`getToursByNumber()[2]?.status`). `selectCandidatesToRemind`. Quota : `remaining = EMAIL_DAILY_CAP − (emailsSentToday() ?? 0)`, tronquer la liste à `remaining`. `dryRun` → `{ total, toSend, remaining }`. Sinon : `sendAnnouncementEmails(recipients, WISHES_REMINDER_SUBJECT, WISHES_REMINDER_BODY)` ; pour chaque envoyé : `update candidates set wishes_reminded_at = now()` + insert `candidate_notifications` `{ candidate_id, type: "voeux_rappel", title: WISHES_REMINDER_SUBJECT, body: WISHES_REMINDER_BODY, link: "/candidates/wishes" }` ; insert une ligne `announcements` (`title`, `body`, `target_candidates: true`, `candidate_filter: "no_wishes"`, `candidates_count`, `email_requested: true`, `email_sent`, `email_failed`, `created_by_name: "Relance automatique"`) pour que le quota du jour la compte.

- [ ] **Step 2 : routes**
  - `GET /api/cron/wishes-reminder` : `force-dynamic` ; `const secret = process.env.CRON_SECRET; if (!secret) return 503 { error: "CRON_SECRET non configuré" }` ; `if (req.headers.get("authorization") !== \`Bearer ${secret}\`) return 401` ; `runWishesReminder({ dryRun: false })`.
  - `POST /api/admin/wishes-reminder` : admin JWT ; body `{ dryRun?: boolean }` ; même fonction.
  - `GET /api/wishes/status` : `payload.role === "candidate"` sinon 403 ; `candidateId = payload.id` (jamais du client) ; `needsWishes(...)` avec les lignes du candidat ; répond `{ needsWishes }`.

- [ ] **Step 3 : `WishesNudge`** (calqué sur `PhotoNudge`, lien `/candidates/wishes`, texte « Vos choix de pôles sont attendus » / « Indicatifs, pas définitifs — ils nous aident à préparer le Tour 3. »). Icône `ListChecks` de lucide.

- [ ] **Step 4 : `WishesReminderCard`** (page Annonces) : au montage `POST /api/admin/wishes-reminder {dryRun:true}` → « N candidats sans vœux (M envoyables aujourd'hui) » ; bouton « Envoyer la relance maintenant » avec `confirm()` ; affiche le résultat. Mention « Envoi automatique chaque matin à 8h ».

- [ ] **Step 5 : `vercel.json`** : ajouter `{ "path": "/api/cron/wishes-reminder", "schedule": "0 8 * * *" }`.

- [ ] **Step 6 : typecheck, `npm test`, commit** `feat(relance): relance automatique des vœux (cron, bandeau, bouton)`.

---

## Task 8 : Vérifications, migrations prod, mémoire

- [ ] **Step 1 :** `cd frontend && npm test && npm run typecheck && npm run lint` propres.
- [ ] **Step 2 :** simulation à blanc (script dans le scratchpad, lecture seule sur la prod) : vraies dispos + vrais vœux, faux Tour 3 (Dev Co, SI, Business Game) → récap par épreuve.
- [ ] **Step 3 :** appliquer les deux migrations en prod (MCP Supabase `apply_migration`), vérifier les colonnes.
- [ ] **Step 4 :** `CRON_SECRET` sur Vercel (production) ; redéploiement.
- [ ] **Step 5 :** vérification navigateur : panneau de génération, fiche membre, bandeau candidat, carte de relance.
- [ ] **Step 6 :** `dryRun` de la relance en prod ; envoi réel UNIQUEMENT sur feu vert explicite de Felix.
- [ ] **Step 7 :** mémoire + graphify (`$(cat graphify-out/.graphify_python) -c "..."`).
