# Minimum de candidats pour les épreuves de groupe (business game)

**Date** : 2026-09-07
**Statut** : validé par Felix (brainstorming du 2026-09-07)
**Périmètre** : épreuves de groupe (`is_group_epreuve = true`) uniquement — pas de changement pour les épreuves individuelles/communes.

## Contexte

Aujourd'hui, une épreuve de groupe (ex. business game) n'a qu'un **maximum** de candidats par créneau (`group_size` → `evaluation_slots.max_candidates`). Il n'existe aucun minimum : un créneau peut tourner avec un seul candidat inscrit. Le nombre d'examinateurs (`min_evaluators_per_salle` → `evaluation_slots.min_members`) est un réglage complètement indépendant.

Décisions validées pendant le brainstorming :

- **Le nombre minimum d'examinateurs doit toujours être égal au minimum de candidats**, pour **toutes** les épreuves de groupe (pas de nouveau flag par épreuve — le flag `is_group_epreuve` existant suffit à définir le périmètre).
- **Un créneau ne doit recevoir plus d'examinateurs que son minimum que si les autres salles au même horaire (même épreuve, même date+heure) ont elles-mêmes déjà atteint leur minimum.** Sinon, l'ajout doit être refusé avec un message invitant à staffer l'autre salle en priorité.
- **Si l'inscription se termine avec un créneau sous le minimum de candidats**, le système tente de **fusionner automatiquement** ses candidats inscrits vers un autre créneau de la même épreuve ayant de la place, plutôt que de laisser tourner un groupe incomplet. **Si aucun créneau ne peut absorber tout le monde en une fois, le créneau sous-rempli reste tel quel** (pas d'échec bloquant, pas de fusion partielle candidat par candidat — v1 volontairement simple).
- Les examinateurs n'ont de toute façon jamais le choix de la salle (confirmé : la grille de disponibilité `CalendarMemberBuilder.tsx` ne groupe que par jour/heure/épreuve, jamais par salle — rien à changer ici).

## Architecture

Stack réelle : Next.js App Router + Supabase (routes dans `frontend/src/app/api/`).

### 1. Modèle de données

Nouvelles colonnes (migration additive, cf. section Migration) :

```sql
ALTER TABLE epreuves ADD COLUMN IF NOT EXISTS min_candidates INTEGER;
ALTER TABLE evaluation_slots ADD COLUMN IF NOT EXISTS min_candidates INTEGER;
```

`min_candidates` sur `epreuves` n'a de sens que pour une épreuve de groupe (comme `group_size`). Il est propagé vers `evaluation_slots.min_candidates` à la création d'un créneau, exactement comme `max_candidates`/`min_members` le sont déjà.

### 2. Admin — configuration de l'épreuve (`frontend/src/app/(dashboard)/dashboard/settings/page.tsx`)

Le formulaire épreuve (`NewEpreuveForm`) gagne un champ `minCandidates` (string), affiché **uniquement pour `type === "groupe"`**, juste à côté du champ existant « Nombre max de candidats par créneau » (`groupSize`).

Pour une épreuve de groupe, **le champ « Nombre d'examinateurs par créneau » (`minEvaluators`) n'est plus affiché séparément** : il est automatiquement égal à `minCandidates` à la soumission (`handleCreateEpreuve` envoie `minEvaluatorsPerSalle: form.minCandidates` quand `type === "groupe"`, au lieu de `form.minEvaluators`). Pour les autres types, rien ne change : le champ `minEvaluators` reste affiché et indépendant.

`openEditModal` initialise `form.minCandidates` depuis `ep.minCandidates` (nouveau champ renvoyé par `GET /api/epreuves`).

### 3. API épreuves (`frontend/src/app/api/epreuves/route.ts`, `frontend/src/app/api/epreuves/[id]/route.ts`)

- `GET /api/epreuves` : ajoute `minCandidates: e.min_candidates ?? null` à l'objet renvoyé.
- `POST /api/epreuves` : ajoute `min_candidates: body.isGroupEpreuve ? Number(body.minCandidates) || null : null` à `insertData`. Si l'épreuve est de groupe, force aussi `min_evaluators_per_salle = min_candidates` côté serveur (défense en profondeur — ne pas se fier uniquement au front pour synchroniser les deux valeurs) :
  ```ts
  const isGroup = insertData.is_group_epreuve;
  if (isGroup && insertData.min_candidates) {
    insertData.min_evaluators_per_salle = insertData.min_candidates;
  }
  ```
- `PUT /api/epreuves/[id]` : même logique. Ajoute `if (body.minCandidates !== undefined) updateData.min_candidates = Number(body.minCandidates) || null;`, puis si `updateData.is_group_epreuve` (ou l'épreuve existante l'est déjà) et `updateData.min_candidates` défini, aligne aussi `updateData.min_evaluators_per_salle`. **Réutilise le mécanisme de cascade déjà existant** (lignes 226-244 actuelles) : quand `min_candidates` change, répercuter sur `evaluation_slots.min_candidates` des créneaux existants de l'épreuve, exactement comme `group_size`→`max_candidates` et `min_evaluators_per_salle`→`min_members` le font déjà.

### 4. Création de créneaux — propagation de `min_candidates`

Deux chemins de création à mettre à jour, tous deux suivent déjà le même pattern pour `max_candidates`/`min_members` :

- `frontend/src/lib/openings-service.ts::slotInsertRow` — ajoute `min_candidates: epreuve.is_group_epreuve ? epreuve.min_candidates || null : null` à l'objet retourné.
- `frontend/src/app/api/slots/bulk-create/route.ts` — ajoute la même ligne dans l'objet poussé dans `slotsToInsert`.

### 5. Garde-fou sur l'ajout manuel d'examinateur (`frontend/src/app/api/slots/toggle-member/route.ts`)

Dans la branche `shouldAdd`, **uniquement si l'épreuve du créneau est de groupe** (`targetEpreuve.is_group_epreuve`) : si le créneau ciblé a déjà atteint son `min_members`, vérifier les autres créneaux de la même épreuve à la même `date` + `start_time` (salles différentes). S'il en existe au moins un dont le nombre d'examinateurs actuel est encore sous son propre `min_members`, refuser l'ajout avec un message listant les salles à staffer en priorité (409, code `SIBLING_SLOTS_UNDERSTAFFED`). Sinon (toutes les salles du même horaire sont déjà à leur minimum), l'ajout est autorisé normalement — comportement actuel inchangé pour tout le reste (retrait, épreuves non-groupe, etc.).

Le dispatch automatique (`dispatchService.ts`) n'a **rien à changer** : il ne dépasse déjà jamais `min_members` par créneau (confirmé par audit du code) — le seul chemin créant un surplus est cet ajout manuel.

### 6. Fusion automatique des créneaux sous le minimum à la clôture des inscriptions

Nouvelle route `POST /api/slots/merge-undersized` (admin uniquement), body `{ epreuveId }` :

1. Si l'épreuve n'est pas de groupe ou n'a pas de `min_candidates` défini → no-op, réponse `{ merged: 0 }`.
2. Charge tous les créneaux `status = "published"` de l'épreuve avec leurs inscriptions actives (`filterActiveEnrollments`) et leur capacité effective (`effectiveMaxCandidates`, réutilisé de `frontend/src/lib/enrollment.ts`).
3. Pour chaque créneau dont le nombre d'inscrits actifs est `> 0` et `< min_candidates` (« sous-rempli ») : cherche, parmi les **autres** créneaux publiés de la même épreuve, un créneau dont la capacité restante (`effectiveMax - inscrits actifs`) est `>=` le nombre d'inscrits du créneau sous-rempli. Le premier trouvé (le plus proche dans le temps, à défaut le premier de la liste) devient la cible.
4. Si une cible est trouvée : déplace **toutes** les inscriptions actives du créneau source vers la cible (`UPDATE slot_enrollments SET slot_id = <cible> WHERE slot_id = <source> AND status actif`), notifie chaque candidat déplacé (même mécanique `private_messages` que les notifications existantes, message précisant la nouvelle date/heure/salle), puis **supprime les affectations d'examinateurs du créneau source** (`DELETE FROM slot_member_assignments WHERE slot_id = <source>` — ils n'ont plus de candidats à évaluer ; l'admin peut les redispatcher ailleurs si besoin).
5. Si aucune cible ne peut absorber tout le monde : ne rien faire pour ce créneau (reste sous le minimum, sera fermé tel quel par la suite — comportement volontairement accepté, pas d'échec bloquant).
6. Réponse : `{ merged: number, movedCandidates: number, notifiedCandidates: number }`.

**Intégration** : `handleFermerInscriptions` dans `frontend/src/app/(dashboard)/dashboard/planning/page.tsx` appelle `POST /api/slots/merge-undersized` **avant** son appel existant à `PUT /api/slots/status/bulk` (qui ferme tous les créneaux `published` de l'épreuve). Le toast final mentionne aussi le nombre de créneaux fusionnés s'il y en a.

## Gestion des erreurs

- `toggle-member` : refus 409 explicite avec la liste des salles sous-staffées, pas de message générique.
- `merge-undersized` : jamais bloquant — un créneau qui ne peut pas être fusionné reste simplement en l'état, aucune exception remontée au flux de fermeture des inscriptions.
- Les notifications aux candidats déplacés suivent le pattern déjà utilisé ailleurs (`private_messages`, best-effort, un échec d'envoi n'annule pas le déplacement déjà effectué).

## Hors périmètre (explicite)

- Épreuves individuelles/communes : aucun changement.
- Algorithme de dispatch (`dispatchService.ts`) : inchangé, il ne crée déjà jamais de surplus.
- Fusion partielle (répartir les candidats d'un seul créneau sous-rempli sur plusieurs cibles) : refusée en v1, trop complexe pour le gain.
- Redispatch automatique des examinateurs libérés par la fusion : l'admin relance le dispatch manuellement si besoin.
- Statut `evaluation_slots.status` (transition vers "full") : ne dépend toujours que de `max_candidates`, pas de `min_candidates` — aucun changement dans `enroll/route.ts`.

## Migration Supabase

Section 9 ajoutée à `MIGRATIONS_A_APPLIQUER.sql` + nouveau fichier `supabase-migration-min-candidates.sql` (colonnes additives, idempotentes, aucun risque). **Ne s'applique pas automatiquement** — à signaler à Felix.

## Tests

Pas de suite de tests existante sur ces routes (cf. `CLAUDE.md`). Vérification manuelle à la clôture des inscriptions d'une épreuve de groupe :

1. Créer une épreuve de groupe avec `min_candidates = 4`, `group_size = 6` → vérifier que le formulaire n'affiche plus de champ examinateurs séparé et que l'épreuve créée a `min_evaluators_per_salle = 4`.
2. Créer 2 créneaux au même horaire (salles différentes), 0 examinateur sur aucun → ajouter un examinateur sur le créneau A jusqu'à 4 (son minimum) → tenter un 5e sur A alors que B est à 0 → doit être refusé.
3. Compléter B à son minimum (4) → réessayer un 5e examinateur sur A → doit être accepté.
4. Inscrire 2 candidats sur un créneau (min 4), un autre créneau de la même épreuve ayant 5 places libres → cliquer « Fermer les inscriptions » → vérifier que les 2 candidats sont déplacés, notifiés, et que le créneau source est fermé sans examinateur.
