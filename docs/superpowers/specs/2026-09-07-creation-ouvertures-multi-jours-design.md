# Création d'ouvertures sur plusieurs jours

**Date** : 2026-09-07
**Statut** : validé par Felix (brainstorming du 2026-09-07)
**Périmètre** : admin — création d'ouvertures uniquement (`OpeningsManager.tsx` + `POST /api/openings`)

## Contexte

La création d'une ouverture de salle (voir [2026-07-07-creation-creneaux-ouvertures-design.md](2026-07-07-creation-creneaux-ouvertures-design.md)) se fait aujourd'hui **un jour à la fois** dans la ligne d'ajout du tableau `OpeningsManager`. Quand la même salle/plage horaire/pause se répète sur plusieurs jours consécutifs (ex. la salle A, 9h–17h, tous les jours du 14 au 22), l'admin doit remplir le formulaire une fois par jour.

Il existe déjà une fonctionnalité de **duplication a posteriori** (« 📋 Dupliquer une journée… ») qui copie les ouvertures d'un jour déjà créé vers d'autres jours. Ça ne couvre pas le besoin exprimé : créer directement sur une plage de dates **dès la première saisie**, sans passer par un jour source puis une duplication.

Décision validée pendant le brainstorming :

- Case à cocher **« Plusieurs jours »** directement dans la ligne d'ajout existante — pas de nouvelle modale.
- Cochée : le champ date unique devient **date début + date fin**, avec une rangée de puces (une par jour ouvré de la plage) toutes cochées par défaut et décochables individuellement.
- Seuls les **jours ouvrés (Lun–Ven)** de la plage sont proposés — jamais les weekends (cohérent avec `weekdaysInRange` déjà utilisé pour la duplication).
- La modale « Dupliquer une journée… » n'est pas modifiée. `PUT /api/openings/[id]` (édition) reste mono-jour.

## UI (`OpeningsManager.tsx`)

État du formulaire (`OpeningForm`) étendu :

```ts
interface OpeningForm {
  room: string;
  date: string;        // date unique, OU date de début si multiDay
  dateEnd: string;      // nouveau — utilisé seulement si multiDay
  multiDay: boolean;    // nouveau
  excludedDates: Set<string>; // nouveau — jours ouvrés décochés dans la plage
  startTime: string;
  endTime: string;
  breakStart: string;
  breakEnd: string;
}
```

- Case à cocher « 📅 Plusieurs jours » ajoutée dans la cellule Date de `renderFormRow`. Cochée → affiche un second input `date` (fin) juste après le premier, avec `min = date début`.
- Sous la ligne du tableau (ou dans une cellule dédiée qui s'étend), une liste de puces calculée par une fonction pure `weekdaysBetween(start, end): string[]` (même logique que `weekdaysInRange` déjà présent dans le fichier — à généraliser en fonction plutôt que `useMemo` local à `dateMin/dateMax`, puisqu'elle doit maintenant aussi s'appliquer à `date`/`dateEnd` du formulaire). Chaque puce affiche le jour (ex. « Lun 14 »), cliquable pour toggle son exclusion dans `excludedDates`. Toutes cochées par défaut (`excludedDates` vide au départ).
- Liste finale des dates à créer : `weekdaysBetween(form.date, form.dateEnd).filter(d => !form.excludedDates.has(d))`. Si `multiDay` est décoché, la liste est simplement `[form.date]`.
- Aperçu : `previewCount(f)` (créneaux par jour, logique existante inchangée) × nombre de jours sélectionnés. Libellé : `→ 8 créneaux/jour × 5 jours = 40 créneaux` (au singulier si un seul jour : garde le libellé actuel `→ N créneaux`).
- Validation du bouton `+ Ajouter` : en plus des règles existantes (salle, horaires valides, `count > 0`), si `multiDay` : `dateEnd >= date` ET au moins un jour sélectionné (liste finale non vide).
- À la soumission, `handleAdd` envoie `dates: string[]` (la liste finale calculée ci-dessus) au lieu de `date: string`.
- Après création, reset du formulaire à `EMPTY_FORM` en conservant `date` comme aujourd'hui (`{ ...EMPTY_FORM, date: prev.date }}`) ; `multiDay`, `dateEnd`, `excludedDates` repartent à leur valeur initiale (false / "" / vide).

## API (`POST /api/openings`)

Changement de contrat : le body attend désormais **`dates: string[]`** (non vide) au lieu de `date: string`. Un seul appelant existe (`OpeningsManager.tsx`), donc pas de rétrocompatibilité à maintenir — un seul chemin de code, pas de branchement single/multi.

Nouvelle fonction partagée dans `frontend/src/lib/openings-service.ts` :

```ts
async function createOpeningWithSlots(
  epreuveId: string,
  epreuve: any,
  input: { room: string; date: string; start_time: string; end_time: string; break_start: string | null; break_end: string | null }
): Promise<
  | { ok: true; opening: OpeningRow; slotsCreated: number }
  | { ok: false; error: string }
>
```

Elle contient exactement la logique aujourd'hui inline dans la route (vérif chevauchement via `checkOpeningOverlap`, insert `room_openings`, découpe via `sliceOpeningRow`, insert `evaluation_slots`, compensation — suppression de l'ouverture — si l'insert des créneaux échoue). C'est la même séquence que celle dupliquée dans `POST /api/openings/duplicate` ; ce refactor **n'y touche pas** (hors périmètre), il ne fait qu'extraire un helper pour le nouveau chemin multi-jours. Un refactor de `/openings/duplicate` pour réutiliser ce même helper serait cohérent mais n'est pas demandé — à ne pas faire ici.

`POST /api/openings` devient :

1. Valider `epreuveId` + `Array.isArray(dates) && dates.length > 0`.
2. Valider chaque `date` du tableau avec `validateOpeningInput` (room/horaires communs à toutes ; on réutilise le format déjà validé, pas besoin de le revalider par date sauf le champ `date` lui-même).
3. Charger l'épreuve une seule fois.
4. Pour chaque date (dans l'ordre du tableau) : appeler `createOpeningWithSlots`. Si `ok: false` (chevauchement), l'ajouter aux `warnings` et continuer les dates suivantes — **ne pas faire échouer tout le lot** pour un conflit sur un seul jour (même philosophie que `/openings/duplicate`).
5. Réponse : `{ openings_created: number, slots_created: number, warnings: string[] }` (si `dates.length === 1` et pas de warning, reste compatible avec le toast actuel `slots_created` déjà utilisé côté front).

Le toast front (`handleAdd`) doit être adapté : succès simple si `warnings.length === 0` (`"Ouverture(s) créée(s) — N créneau(x) générés ✅"`), sinon un toast `info` mentionnant aussi le nombre de jours ignorés.

## Gestion des erreurs

- Aucune date valide au final (0 créées, toutes en conflit) → toast d'erreur listant les conflits (pas de succès partiel trompeur).
- Un chevauchement sur un jour précis de la plage ignore ce jour et le signale, les autres jours de la plage sont créés normalement (cohérent avec `/openings/duplicate`).
- Les validations de format (salle vide, horaires invalides, pause hors plage) sont toujours vérifiées **avant** de boucler sur les dates — erreur 400 unique, pas de tentative de création.

## Hors périmètre (explicite)

- Modification de `PUT /api/openings/[id]` (édition) — reste mono-jour.
- Modification de `POST /api/openings/duplicate` — reste tel quel, même si sa logique interne pourrait à terme réutiliser `createOpeningWithSlots`.
- Inclusion des weekends dans la plage, ou personnalisation des jours proposés au-delà de Lun–Ven — non demandé.
- Récurrence hebdomadaire au-delà d'une seule plage de dates (ex. « tous les lundis pendant 2 mois ») — hors sujet, la demande porte sur une plage continue.

## Tests

Frontend (vitest) :

- `weekdaysBetween(start, end)` : plage sur une semaine complète, plage incluant un weekend (doit les exclure), plage d'un seul jour, `end < start` (liste vide).
- Calcul du nombre de créneaux total (aperçu) avec jours exclus.

Backend : pas de suite de tests existante sur ces routes (cf. `CLAUDE.md`) — vérification manuelle :

1. Créer une ouverture multi-jours (ex. 5 jours ouvrés) → vérifier 5 lignes `room_openings` et le bon total de créneaux dans le tableau.
2. Décocher un jour dans la plage avant de valider → vérifier qu'il n'est pas créé.
3. Créer une plage qui chevauche une ouverture existante sur un seul des jours → vérifier que ce jour est ignoré (warning) et que les autres sont bien créés.
4. Vérifier que la modale « Dupliquer une journée… » et l'édition d'une ouverture existante fonctionnent toujours sans régression.

## Risques

- Aucune migration Supabase nécessaire (aucun changement de schéma).
- Risque principal : régression sur le chemin mono-jour existant si le refactor `dates: string[]` introduit un bug pour `dates.length === 1` — à couvrir en priorité dans la vérification manuelle.
