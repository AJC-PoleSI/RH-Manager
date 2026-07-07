# Refonte création de créneaux (ouvertures de salles) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'admin déclare des ouvertures de salles (salle + date + plage + pause) ; le système découpe en créneaux, recalcule à la modification en protégeant les créneaux occupés.

**Architecture:** Nouvelle table Supabase `room_openings` + colonne `evaluation_slots.opening_id`. Fonctions pures de découpage/diff dans `frontend/src/lib/opening-slicer.ts` (testées vitest). Routes Next.js `/api/openings*`. Nouveau composant `OpeningsManager` dans l'onglet Création ; `CalendarAdminBuilder` passe en lecture seule pour cet onglet. Spec : `docs/superpowers/specs/2026-07-07-creation-creneaux-ouvertures-design.md`.

**Tech Stack:** Next.js App Router, Supabase (`supabaseAdmin`), vitest, Tailwind. Auth via `getTokenFromRequest`/`unauthorized`/`forbidden` de `@/lib/auth`. Anti-chevauchement via `@/lib/slot-conflicts`.

**Conventions du repo à respecter :**
- Tout texte UI/messages en français.
- Les slots en base : colonnes snake_case (`start_time`, `epreuve_id`, `max_candidates`…), `date` stockée comme ISO de `date + "T12:00:00"`, statut initial `"draft"`.
- Migrations Supabase : fichiers à la racine + `MIGRATIONS_A_APPLIQUER.sql`, application MANUELLE par Felix.
- Le repo a un hook d'auto-commit (« auto: save changes ») : si `git commit` dit « nothing to commit », c'est normal, passer à la suite.
- Après les modifs de code, reconstruire le graphe : `$(cat graphify-out/.graphify_python) -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

---

### Task 1 : Migration SQL

**Files:**
- Create: `supabase-migration-room-openings.sql`
- Modify: `MIGRATIONS_A_APPLIQUER.sql` (append)

- [ ] **Step 1 : Écrire le fichier de migration**

Contenu de `supabase-migration-room-openings.sql` :

```sql
-- Migration : ouvertures de salles (refonte création de créneaux)
-- À appliquer manuellement dans Supabase (SQL Editor).

create table if not exists room_openings (
  id uuid primary key default gen_random_uuid(),
  epreuve_id uuid not null references epreuves(id) on delete cascade,
  room text not null,
  date date not null,
  start_time text not null,
  end_time text not null,
  break_start text,
  break_end text,
  created_at timestamptz default now()
);

alter table evaluation_slots
  add column if not exists opening_id uuid references room_openings(id) on delete set null;

create index if not exists idx_room_openings_epreuve on room_openings(epreuve_id);
create index if not exists idx_evaluation_slots_opening on evaluation_slots(opening_id);
```

- [ ] **Step 2 : Ajouter le même SQL à la fin de `MIGRATIONS_A_APPLIQUER.sql`** avec un en-tête `-- ══ 2026-07-07 : room_openings ══`

- [ ] **Step 3 : Commit**

```bash
git add supabase-migration-room-openings.sql MIGRATIONS_A_APPLIQUER.sql
git commit -m "feat(db): migration room_openings + opening_id sur evaluation_slots"
```

---

### Task 2 : Fonctions pures `opening-slicer` (TDD)

**Files:**
- Create: `frontend/src/lib/opening-slicer.ts`
- Test: `frontend/src/lib/opening-slicer.test.ts`

Fonctions **sans aucun import** (pas de `supabaseAdmin` → importable en test comme `dispatch-core.test.ts`).

- [ ] **Step 1 : Écrire les tests (échouent : module absent)**

```ts
// frontend/src/lib/opening-slicer.test.ts
import { describe, it, expect } from "vitest";
import { sliceOpening, diffOpeningSlots } from "./opening-slicer";

const P = { durationMinutes: 30, roulementMinutes: 10 }; // spacing 40

describe("sliceOpening", () => {
  it("découpe une plage simple", () => {
    const r = sliceOpening({ startTime: "09:00", endTime: "11:00" }, P);
    expect(r).toEqual([
      { startTime: "09:00", endTime: "09:30" },
      { startTime: "09:40", endTime: "10:10" },
      { startTime: "10:20", endTime: "10:50" },
    ]);
  });

  it("saute la pause et reprend à sa fin", () => {
    const r = sliceOpening(
      { startTime: "09:00", endTime: "17:00", breakStart: "12:00", breakEnd: "13:30" },
      P,
    );
    // aucun créneau ne chevauche 12:00–13:30
    for (const s of r) {
      const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
      expect(toMin(s.endTime) <= 720 || toMin(s.startTime) >= 810).toBe(true);
    }
    // le premier créneau après la pause commence à 13:30
    expect(r.some((s) => s.startTime === "13:30")).toBe(true);
  });

  it("plage trop courte → aucun créneau", () => {
    expect(sliceOpening({ startTime: "09:00", endTime: "09:20" }, P)).toEqual([]);
  });

  it("le dernier créneau finit au plus tard à end_time", () => {
    const r = sliceOpening({ startTime: "09:00", endTime: "10:00" }, P);
    expect(r[r.length - 1].endTime <= "10:00").toBe(true);
  });

  it("est déterministe", () => {
    const o = { startTime: "08:00", endTime: "18:00", breakStart: "12:00", breakEnd: "14:00" };
    expect(sliceOpening(o, P)).toEqual(sliceOpening(o, P));
  });
});

describe("diffOpeningSlots", () => {
  const target = [
    { startTime: "09:00", endTime: "09:30" },
    { startTime: "09:40", endTime: "10:10" },
  ];

  it("conserve les créneaux qui matchent, crée les manquants", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      { id: "a", date: "2026-07-14", start_time: "09:00", end_time: "09:30", occupied: false },
    ]);
    expect(d.keptIds).toEqual(["a"]);
    expect(d.toCreate).toEqual([{ startTime: "09:40", endTime: "10:10" }]);
    expect(d.toDeleteIds).toEqual([]);
    expect(d.conflictIds).toEqual([]);
  });

  it("supprime les libres hors cible, signale les occupés hors cible", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      { id: "libre", date: "2026-07-14", start_time: "16:00", end_time: "16:30", occupied: false },
      { id: "occ", date: "2026-07-14", start_time: "17:00", end_time: "17:30", occupied: true },
    ]);
    expect(d.toDeleteIds).toEqual(["libre"]);
    expect(d.conflictIds).toEqual(["occ"]);
  });

  it("un occupé qui matche la cible est conservé sans doublon de création", () => {
    const d = diffOpeningSlots("2026-07-14", target, [
      { id: "occ", date: "2026-07-14", start_time: "09:00", end_time: "09:30", occupied: true },
    ]);
    expect(d.keptIds).toEqual(["occ"]);
    expect(d.toCreate).toEqual([{ startTime: "09:40", endTime: "10:10" }]);
    expect(d.conflictIds).toEqual([]);
  });

  it("changement de date : tout l'existant est hors cible", () => {
    const d = diffOpeningSlots("2026-07-15", target, [
      { id: "libre", date: "2026-07-14", start_time: "09:00", end_time: "09:30", occupied: false },
      { id: "occ", date: "2026-07-14", start_time: "09:40", end_time: "10:10", occupied: true },
    ]);
    expect(d.toDeleteIds).toEqual(["libre"]);
    expect(d.conflictIds).toEqual(["occ"]);
    expect(d.toCreate).toHaveLength(2);
  });
});
```

- [ ] **Step 2 : Lancer et vérifier l'échec** — `cd frontend && npx vitest run src/lib/opening-slicer.test.ts` → FAIL (module introuvable)

- [ ] **Step 3 : Implémenter**

```ts
// frontend/src/lib/opening-slicer.ts
// Découpage d'une ouverture de salle en créneaux + diff de recalcul.
// Fonctions pures, sans import — testées dans opening-slicer.test.ts.

export interface OpeningTimes {
  startTime: string; // "HH:MM"
  endTime: string;
  breakStart?: string | null;
  breakEnd?: string | null;
}

export interface SliceParams {
  durationMinutes: number;
  roulementMinutes: number;
}

export interface SlotTime {
  startTime: string;
  endTime: string;
}

export interface ExistingSlot {
  id: string;
  date: string; // "YYYY-MM-DD" ou ISO
  start_time: string;
  end_time: string;
  occupied: boolean;
}

export interface OpeningDiff {
  toCreate: SlotTime[];
  toDeleteIds: string[];
  keptIds: string[];
  conflictIds: string[];
}

function t2m(t: string): number {
  const [h, m] = String(t).slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function m2t(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/**
 * Découpe une plage en créneaux de `durationMinutes`, espacés de
 * durée + roulement (début à début). Un créneau qui chevauche la pause
 * est décalé au premier horaire après la pause. Le dernier créneau
 * finit au plus tard à endTime. Déterministe.
 */
export function sliceOpening(o: OpeningTimes, p: SliceParams): SlotTime[] {
  const dur = p.durationMinutes;
  const spacing = dur + p.roulementMinutes;
  if (dur <= 0 || spacing <= 0) return [];
  const end = t2m(o.endTime);
  const bs = o.breakStart ? t2m(o.breakStart) : null;
  const be = o.breakEnd ? t2m(o.breakEnd) : null;
  const hasBreak = bs !== null && be !== null && be > bs;

  const out: SlotTime[] = [];
  let cur = t2m(o.startTime);
  while (cur + dur <= end) {
    if (hasBreak && cur < (be as number) && (bs as number) < cur + dur) {
      cur = be as number; // saute la pause
      continue;
    }
    out.push({ startTime: m2t(cur), endTime: m2t(cur + dur) });
    cur += spacing;
  }
  return out;
}

const slotKey = (d: string, s: string, e: string) =>
  `${String(d).split("T")[0]}|${String(s).slice(0, 5)}|${String(e).slice(0, 5)}`;

/**
 * Diff entre le découpage cible (nouvelle ouverture) et les créneaux
 * existants liés à l'ouverture. Règles (spec §3) :
 * libre+match → kept · libre hors cible → delete · occupé+match → kept ·
 * occupé hors cible → conflict (jamais supprimé) · cible sans créneau → create.
 */
export function diffOpeningSlots(
  targetDate: string,
  target: SlotTime[],
  existing: ExistingSlot[],
): OpeningDiff {
  const targetKeys = new Set(target.map((t) => slotKey(targetDate, t.startTime, t.endTime)));
  const covered = new Set<string>();
  const toDeleteIds: string[] = [];
  const keptIds: string[] = [];
  const conflictIds: string[] = [];

  for (const s of existing) {
    const k = slotKey(s.date, s.start_time, s.end_time);
    if (targetKeys.has(k)) {
      covered.add(k);
      keptIds.push(s.id);
    } else if (s.occupied) {
      conflictIds.push(s.id);
    } else {
      toDeleteIds.push(s.id);
    }
  }

  const toCreate = target.filter(
    (t) => !covered.has(slotKey(targetDate, t.startTime, t.endTime)),
  );
  return { toCreate, toDeleteIds, keptIds, conflictIds };
}
```

- [ ] **Step 4 : Vérifier que les tests passent** — `npx vitest run src/lib/opening-slicer.test.ts` → PASS (10 tests)

- [ ] **Step 5 : Commit** — `git add frontend/src/lib/opening-slicer.* && git commit -m "feat: découpage et diff des ouvertures de salles (fonctions pures)"`

---

### Task 3 : Service partagé `openings-service`

**Files:**
- Create: `frontend/src/lib/openings-service.ts`

Helpers Supabase partagés par les 3 routes (POST/PUT/DELETE/duplicate). Pas de test unitaire (I/O Supabase) — couvert par la vérification manuelle.

- [ ] **Step 1 : Implémenter**

```ts
// frontend/src/lib/openings-service.ts
import { supabaseAdmin } from "@/lib/supabase";
import {
  fetchDayIntervals,
  findConflict,
  timeToMinutes,
  minutesToTime,
} from "@/lib/slot-conflicts";
import { sliceOpening, SlotTime, ExistingSlot } from "@/lib/opening-slicer";

export interface OpeningRow {
  id: string;
  epreuve_id: string;
  room: string;
  date: string; // YYYY-MM-DD
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}

export function sliceParamsFromEpreuve(epreuve: any) {
  return {
    durationMinutes: epreuve.duration_minutes || 30,
    roulementMinutes: epreuve.roulement_minutes ?? 10,
  };
}

export function sliceOpeningRow(o: {
  start_time: string;
  end_time: string;
  break_start?: string | null;
  break_end?: string | null;
}, epreuve: any): SlotTime[] {
  return sliceOpening(
    {
      startTime: o.start_time,
      endTime: o.end_time,
      breakStart: o.break_start,
      breakEnd: o.break_end,
    },
    sliceParamsFromEpreuve(epreuve),
  );
}

/** Ligne d'insertion evaluation_slots pour un horaire découpé (mêmes défauts que bulk-create). */
export function slotInsertRow(t: SlotTime, dateStr: string, epreuve: any, openingId: string) {
  return {
    date: new Date(dateStr + "T12:00:00").toISOString(),
    start_time: t.startTime,
    end_time: t.endTime,
    duration_minutes: epreuve.duration_minutes || 30,
    label: null,
    max_candidates: epreuve.is_group_epreuve ? epreuve.group_size || 1 : 1,
    min_members: epreuve.min_evaluators_per_salle ?? 2,
    simultaneous_slots: 1,
    epreuve_id: epreuve.id,
    tour: epreuve.tour || 1,
    room: epreuve.__room as string, // renseigné par l'appelant via withRoom()
    status: "draft",
    opening_id: openingId,
  };
}

/**
 * Vérifie qu'une ouverture (salle + date + plage) ne chevauche aucun
 * créneau existant de la même salle ce jour-là (toutes épreuves),
 * en ignorant les créneaux `excludeSlotIds` (ceux de l'ouverture modifiée).
 * Retourne un message d'erreur français, ou null si OK.
 */
export async function checkOpeningOverlap(
  dateStr: string,
  room: string,
  startTime: string,
  endTime: string,
  excludeSlotIds: string[] = [],
): Promise<string | null> {
  const intervals = await fetchDayIntervals(dateStr);
  const exclude = new Set(excludeSlotIds);
  for (const [, list] of Array.from(intervals.entries())) {
    intervals.set(
      "",
      list.filter(() => true),
    );
  }
  // filtre les créneaux exclus
  const filtered = new Map<string, ReturnType<typeof Array.prototype.slice>>();
  for (const [key, list] of Array.from(intervals.entries())) {
    filtered.set(key, list.filter((it: any) => !it.slotId || !exclude.has(it.slotId)) as any);
  }
  const overlap = findConflict(
    filtered as any,
    room,
    timeToMinutes(startTime),
    timeToMinutes(endTime),
  );
  if (overlap) {
    return `Chevauchement : la salle « ${overlap.room} » a déjà un créneau ${minutesToTime(overlap.startMin)}–${minutesToTime(overlap.endMin)} le ${dateStr}.`;
  }
  return null;
}

/** Charge les créneaux d'une ouverture avec leur occupation. */
export async function fetchOpeningSlots(openingId: string): Promise<
  (ExistingSlot & { raw: any })[]
> {
  const { data } = await supabaseAdmin
    .from("evaluation_slots")
    .select(
      `id, date, start_time, end_time, room, status,
       members:slot_member_assignments(id),
       enrollments:slot_enrollments(id, status, candidate_id)`,
    )
    .eq("opening_id", openingId);

  return ((data as any[]) || []).map((s) => ({
    id: s.id,
    date: String(s.date).split("T")[0],
    start_time: String(s.start_time).slice(0, 5),
    end_time: String(s.end_time).slice(0, 5),
    occupied: isSlotOccupied(s),
    raw: s,
  }));
}

export function isSlotOccupied(s: any): boolean {
  const activeEnrollments = (s.enrollments || []).filter(
    (e: any) => !e.status || e.status === "active",
  );
  return (s.members || []).length > 0 || activeEnrollments.length > 0;
}

/** Notifie les candidats inscrits de créneaux supprimés (même mécanique que le reset). */
export async function notifySlotDeletion(slots: any[]): Promise<number> {
  const rows: any[] = [];
  for (const s of slots) {
    const enrollments = (s.enrollments || []).filter(
      (e: any) => (!e.status || e.status === "active") && e.candidate_id,
    );
    if (enrollments.length === 0) continue;
    const dateStr = s.date
      ? new Date(s.date).toLocaleDateString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })
      : "";
    const startTime = String(s.start_time || "").substring(0, 5);
    for (const e of enrollments) {
      rows.push({
        sender_id: null,
        sender_role: "admin",
        sender_name: "Système",
        recipient_id: e.candidate_id,
        recipient_role: "candidate",
        message: `⚠️ Votre créneau du ${dateStr} à ${startTime} (salle ${s.room || "—"}) a été annulé par l'administration. Merci de vous réinscrire à un autre créneau disponible.`,
      });
    }
  }
  if (rows.length > 0) {
    try {
      await supabaseAdmin.from("private_messages").insert(rows);
    } catch (e) {
      console.error("Notification suppression créneaux échec:", e);
    }
  }
  return rows.length;
}

/** Supprime des créneaux par ids (cascade assignments/enrollments comme le reset). */
export async function deleteSlotsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseAdmin.from("slot_enrollments").delete().in("slot_id", ids);
  await supabaseAdmin.from("slot_member_assignments").delete().in("slot_id", ids);
  try {
    await supabaseAdmin.from("slot_availability_requests").delete().in("slot_id", ids);
  } catch {
    // table may not exist
  }
  await supabaseAdmin.from("evaluation_slots").delete().in("id", ids);
}
```

**Note d'implémentation** : simplifier `checkOpeningOverlap` à l'exécution — le double filtrage ci-dessus est verbeux ; une seule Map filtrée suffit :

```ts
export async function checkOpeningOverlap(
  dateStr: string,
  room: string,
  startTime: string,
  endTime: string,
  excludeSlotIds: string[] = [],
): Promise<string | null> {
  const intervals = await fetchDayIntervals(dateStr);
  const exclude = new Set(excludeSlotIds);
  for (const [key, list] of Array.from(intervals.entries())) {
    intervals.set(key, list.filter((it) => !it.slotId || !exclude.has(it.slotId)));
  }
  const overlap = findConflict(intervals, room, timeToMinutes(startTime), timeToMinutes(endTime));
  return overlap
    ? `Chevauchement : la salle « ${overlap.room} » a déjà un créneau ${minutesToTime(overlap.startMin)}–${minutesToTime(overlap.endMin)} le ${dateStr}.`
    : null;
}
```

Et `slotInsertRow` : passer `room` en paramètre explicite plutôt que `epreuve.__room` :

```ts
export function slotInsertRow(t: SlotTime, dateStr: string, room: string, epreuve: any, openingId: string) { ... room, ... }
```

- [ ] **Step 2 : Vérifier la compilation** — `cd frontend && npx tsc --noEmit` (ou `npm run build` si rapide) → aucune erreur sur les nouveaux fichiers

- [ ] **Step 3 : Commit** — `git commit -am "feat: service partagé ouvertures (overlap, occupation, notifications)"`

---

### Task 4 : Routes API `/api/openings*`

**Files:**
- Create: `frontend/src/app/api/openings/route.ts` (GET + POST)
- Create: `frontend/src/app/api/openings/[id]/route.ts` (PUT + DELETE)
- Create: `frontend/src/app/api/openings/duplicate/route.ts` (POST)
- Modify: `frontend/src/app/api/slots/reset/route.ts` (supprimer aussi les ouvertures de l'épreuve)

Toutes : `getTokenFromRequest` → `unauthorized()` si absent, `forbidden()` si `!payload.isAdmin`. `export const dynamic = "force-dynamic";`

- [ ] **Step 1 : `route.ts` (GET + POST)**

GET `/api/openings?epreuveId=` : liste les ouvertures triées `(date, room)`, chacune avec `slots_total`, `slots_occupied`, `conflicts` (ids des occupés hors découpage courant — recalcul à la volée via `sliceOpeningRow` + `diffOpeningSlots`).

POST : body `{ epreuveId, room, date, startTime, endTime, breakStart?, breakEnd? }`.
Validations (400, messages français) : champs requis ; formats `HH:MM` (`/^\d{2}:\d{2}$/`) ; `startTime < endTime` ; si pause : `breakStart < breakEnd` et pause incluse dans la plage ; découpage non vide (sinon « La plage est trop courte pour un seul créneau (durée + roulement = X min) »). Chevauchement salle (409) via `checkOpeningOverlap`. Puis : insert ouverture → insert créneaux (`slotInsertRow` pour chaque `SlotTime`) → si l'insert créneaux échoue, **supprimer l'ouverture** (compensation) et renvoyer 500. Réponse 201 `{ opening, slots_created }`.

- [ ] **Step 2 : `[id]/route.ts` (PUT + DELETE)**

PUT : body = mêmes champs que POST (partiels autorisés, fusion avec l'existant). Validations identiques. Ensuite :
1. `fetchOpeningSlots(id)` → existants avec occupation.
2. `target = sliceOpeningRow(nouvelleOuverture, epreuve)` ; `diff = diffOpeningSlots(newDate, target, existants)`.
3. Chevauchement salle : `checkOpeningOverlap(newDate, newRoom, newStart, newEnd, existants.map(s => s.id))` → 409 si conflit.
4. `deleteSlotsByIds(diff.toDeleteIds)` (libres → pas de notification), insert des `diff.toCreate` (avec `slotInsertRow`), update de la ligne `room_openings`.
5. Réponse : `{ opening, created: diff.toCreate.length, deleted: diff.toDeleteIds.length, kept: diff.keptIds.length, conflicts: [créneaux occupés hors plage : id, date, start_time, end_time, room] }`.

DELETE : `fetchOpeningSlots(id)` ; partition libres/occupés.
- Occupés présents et pas `?force=true` → **409** `{ error: "Des créneaux de cette ouverture ont des inscrits", occupied: [...] }`.
- Sinon : si force, `notifySlotDeletion(occupés.raw)` puis `deleteSlotsByIds(tous)` ; sinon `deleteSlotsByIds(libres)`. Puis delete `room_openings` (uniquement si plus aucun créneau lié — en force c'est le cas ; sans occupés aussi). Réponse `{ deleted_slots, notified_candidates }`.

- [ ] **Step 3 : `duplicate/route.ts` (POST)**

Body `{ epreuveId, sourceDate, targetDates: string[] }`. Charge les ouvertures `(epreuve_id, date=sourceDate)`. Pour chaque date cible × ouverture : `checkOpeningOverlap` → si conflit, pousser un avertissement `« B12 le 2026-07-16 : ignorée (chevauchement) »` et continuer ; sinon créer (même logique que POST). Réponse `{ created_openings, created_slots, warnings: string[] }`.

- [ ] **Step 4 : Modifier le reset** — dans `frontend/src/app/api/slots/reset/route.ts`, après la suppression des créneaux, si `epreuveId` fourni :

```ts
// Supprimer aussi les ouvertures de l'épreuve (sinon elles regénéreraient
// des créneaux fantômes au prochain recalcul)
await supabaseAdmin.from("room_openings").delete().eq("epreuve_id", epreuveId);
```

(Wrappé en try/catch silencieux tant que la migration n'est pas appliquée.)

- [ ] **Step 5 : Compilation** — `npx tsc --noEmit` → OK

- [ ] **Step 6 : Commit** — `git commit -am "feat: routes API ouvertures (CRUD + duplicate + reset)"`

---

### Task 5 : Composant `OpeningsManager`

**Files:**
- Create: `frontend/src/components/calendar/OpeningsManager.tsx`

Client component, props `{ selectedEpreuveId: string; epreuve: any; toast: (msg: string, type?: any) => void; onUpdate: () => void }`. Reprend la maquette validée :

- [ ] **Step 1 : Implémenter le composant**

Structure (tout en français, Tailwind cohérent avec la page planning) :

1. **Bandeau résumé** (3 tuiles) : total créneaux générés (somme `slots_total`), capacité totale candidats (`slots_total × max_candidates` dérivé de l'épreuve), créneaux occupés (somme `slots_occupied`). Si ≥1 conflit : 4e tuile rouge « X conflits à résoudre ».
2. **Tableau des ouvertures** : Salle (badge coloré, réutiliser la palette `ROOM_PALETTE` de CalendarAdminBuilder — copier les 6 couleurs, ne pas importer le composant) · Date (`toLocaleDateString fr-FR`) · Horaires · Pause (— si aucune) · Créneaux (`9 (dont 2 occupés 🔒)`) · Actions ✏️/🗑.
   - ✏️ passe la ligne en mode édition inline (mêmes inputs que la ligne d'ajout, boutons ✓/✕). Sauvegarde → `PUT /openings/{id}` ; si `conflicts` non vide dans la réponse → toast warning « X créneau(x) occupé(s) hors de la nouvelle plage — à résoudre dans le tableau ».
   - 🗑 → `DELETE /openings/{id}` ; sur 409 → `window.confirm` listant les occupés (« Supprimer quand même ? Les inscrits seront notifiés ») → si oui, `DELETE ...?force=true`.
3. **Ligne d'ajout inline** : inputs salle (text), date (type=date, bornée par `epreuve.date_debut/date_fin` via min/max), début/fin (type=time), pause début/fin (type=time, optionnels). Badge live « → N créneaux » calculé côté client avec `sliceOpening` importé de `@/lib/opening-slicer` (aperçu avant création, spec §5). Bouton « + Ajouter » → `POST /openings`.
4. **Conflits** : sous le tableau, si l'un des openings a `conflicts`, liste rouge ⚠️ par créneau (date, horaire, salle) avec boutons « Garder » (retire juste la ligne de l'affichage local) et « Supprimer (notifier) » → `DELETE /api/slots/{slotId}` existant puis refetch.
5. **Bouton « 📋 Dupliquer une journée »** : mini-modale (select date source parmi les dates ayant des ouvertures, multi-select dates cibles = jours ouvrés de la période de l'épreuve) → `POST /openings/duplicate`, toast avec compte + warnings.
6. `fetchOpenings` au montage et après chaque mutation ; chaque mutation appelle aussi `onUpdate()` (rafraîchit calendrier + vue globale).
7. Si l'API `GET /openings` renvoie une erreur 500 contenant `room_openings` (migration pas appliquée) : afficher un encart orange « ⚠️ Migration Supabase requise : appliquer `supabase-migration-room-openings.sql` (voir MIGRATIONS_A_APPLIQUER.sql) ».

- [ ] **Step 2 : Compilation** — `npx tsc --noEmit` → OK

- [ ] **Step 3 : Commit** — `git commit -am "feat: composant OpeningsManager (tableau des ouvertures)"`

---

### Task 6 : Câblage page planning + calendrier en lecture seule

**Files:**
- Modify: `frontend/src/app/(dashboard)/dashboard/planning/page.tsx`
- Modify: `frontend/src/components/calendar/CalendarAdminBuilder.tsx`

- [ ] **Step 1 : `CalendarAdminBuilder` : prop `readOnly`**

Ajouter `readOnly?: boolean` (défaut `false`) aux props. Quand `readOnly` :
- `editable={false}`, `eventStartEditable={false}` sur FullCalendar ;
- `handleDateClick` : return immédiat (plus de création au clic, donc plus de `window.prompt`) ;
- `handleEventDrop` : `info.revert()` ;
- `handleEventClick` : ne pas ouvrir la modale d'édition, ne pas supprimer ;
- bouton « ⚡ Génération rapide » et panel bulk masqués ;
- bouton ✕ de suppression masqué dans `renderEventContent` ;
- texte d'instructions remplacé par « 👁️ Vue de contrôle — les créneaux sont gérés via le tableau des ouvertures ci-dessus » ;
- ajouter 🔒 dans le rendu des événements dont `members.length > 0 || enrollments.length > 0`.

- [ ] **Step 2 : Page planning**

Dans l'onglet `creation` : rendre `<OpeningsManager selectedEpreuveId epreuve toast onUpdate={...} />` **au-dessus** de `<CalendarAdminBuilder ... readOnly={activeTab === "creation"} />`. Import statique d'`OpeningsManager` (léger), `CalendarAdminBuilder` reste en dynamic import. Ne rien changer d'autre (workflow publish/dispatch/reset, onglets évaluateurs/candidats, vue globale).

- [ ] **Step 3 : Vérification navigateur** (serveur dev + preview) : l'onglet Création montre le tableau, le calendrier n'accepte plus ni clic-création ni drag ; créer une ouverture → créneaux visibles dans le calendrier.

- [ ] **Step 4 : Commit** — `git commit -am "feat: onglet Création piloté par les ouvertures, calendrier en vue de contrôle"`

---

### Task 7 : Raccourcis « tout cocher » grille examinateurs

**Files:**
- Modify: `frontend/src/components/calendar/CalendarMemberBuilder.tsx`

- [ ] **Step 1 : Implémenter**

- En-tête de chaque colonne (date) : sous le libellé, bouton « ✓ jour » → toggle : si tous les blocs de la date sont sélectionnés, tout désélectionner ; sinon tout sélectionner (en respectant la logique existante `toggleBlock`/`selectedBlocks`, clés `date|start|end|epreuveId` depuis `blocksMap`).
- Première cellule de chaque ligne (horaire) : petit bouton « ✓ » à côté de l'heure → même toggle sur tous les blocs de cet horaire, toutes dates.
- Aucun autre changement (sauvegarde, retraits, avertissements intacts).

- [ ] **Step 2 : Compilation + coup d'œil navigateur** — `npx tsc --noEmit` puis vérifier le toggle en preview.

- [ ] **Step 3 : Commit** — `git commit -am "feat: raccourcis tout cocher (jour/horaire) grille dispos examinateurs"`

---

### Task 8 : Finalisation

- [ ] **Step 1 : Suite de tests complète** — `cd frontend && npm run test` → tous les tests passent (dont dispatch-core/dispatch-io existants).
- [ ] **Step 2 : Build** — `cd frontend && npm run build` → OK (ou a minima `npx tsc --noEmit` si le build est trop long).
- [ ] **Step 3 : Graphify** — `cd <racine> && $(cat graphify-out/.graphify_python) -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
- [ ] **Step 4 : Commit final + message à Felix** — rappeler explicitement : **la migration `supabase-migration-room-openings.sql` doit être appliquée manuellement dans Supabase avant que l'onglet Création fonctionne** (l'encart orange le rappelle dans l'UI).
