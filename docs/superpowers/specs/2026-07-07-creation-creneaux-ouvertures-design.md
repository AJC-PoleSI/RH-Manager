# Refonte de la création de créneaux — Ouvertures de salles

**Date** : 2026-07-07
**Statut** : validé par Felix (brainstorming du 2026-07-07)
**Périmètre** : admin (refonte), examinateurs (retouche légère), candidats (aucun changement)

## Contexte

La création de créneaux admin est laborieuse : clic-par-clic sur un calendrier FullCalendar (avec `window.prompt` pour choisir la salle) ou panel « Génération rapide » dense qu'il faut re-paramétrer à chaque fois. Le modèle mental de l'admin n'est pas « des créneaux individuels » mais « des salles réservées sur des plages horaires ».

Le flux métier reste inchangé : **1. l'admin déclare les salles/créneaux → 2. les examinateurs s'inscrivent → 3. les candidats choisissent leur créneau.**

Décisions validées pendant le brainstorming :

- L'admin déclare des **ouvertures de salles** (salle + date précise + plage horaire), le système découpe automatiquement en créneaux (durée épreuve + roulement).
- Déclaration **par date précise** (pas de récurrence) — les horaires peuvent varier selon le jour.
- Chaque ouverture peut avoir une **pause optionnelle** (ex. déjeuner 12:00–13:30) que le découpage saute.
- Les corrections se font **au niveau de l'ouverture** ; le système recalcule les créneaux. Le calendrier devient une vue de contrôle en lecture seule.
- Recalcul avec **protection des créneaux occupés** (voir règles ci-dessous).
- Côté examinateurs : uniquement des raccourcis de sélection dans la grille de dispos. Côté candidats : rien.

## Architecture

Stack réelle : Next.js App Router + Supabase (les routes vivent dans `frontend/src/app/api/` ; le dossier `src/` Express/Prisma est un vestige, ne pas y toucher).

### 1. Modèle de données

Nouvelle table `room_openings` :

```sql
create table room_openings (
  id uuid primary key default gen_random_uuid(),
  epreuve_id uuid not null references epreuves(id) on delete cascade,
  room text not null,
  date date not null,
  start_time text not null,          -- "HH:MM"
  end_time text not null,            -- "HH:MM"
  break_start text,                  -- "HH:MM", nullable
  break_end text,                    -- "HH:MM", nullable
  created_at timestamptz default now()
);

alter table evaluation_slots add column opening_id uuid references room_openings(id) on delete set null;
```

- `opening_id` **nullable** : les créneaux existants (et d'éventuels créneaux hérités) restent valides sans ouverture parente.
- Le SQL est livré dans `supabase-migration-room-openings.sql` **et** ajouté à `MIGRATIONS_A_APPLIQUER.sql`. Felix l'applique manuellement dans Supabase (règle du projet — aucune migration automatique).

### 2. Découpage (fonction pure)

Fichier : `frontend/src/lib/opening-slicer.ts`. Signature :

```ts
sliceOpening(opening, epreuve): { startTime: string; endTime: string }[]
```

Règles :

- Pas de créneau = `durée épreuve` minutes ; espacement = `durée + roulement` minutes (mêmes champs épreuve qu'aujourd'hui : `duration_minutes`, `roulement_minutes`).
- Premier créneau à `start_time`. Un créneau doit finir (durée épreuve) au plus tard à `end_time`.
- Si un créneau chevauche `[break_start, break_end)`, il est décalé pour commencer à `break_end` ; le découpage continue après.
- Déterministe : deux appels avec les mêmes entrées produisent la même liste. C'est la base du recalcul par diff.

Les créneaux créés héritent de l'épreuve comme le fait le bulk-create actuel : `max_candidates` (groupSize si épreuve de groupe, sinon 1), `min_members` (`min_evaluators_per_salle`), `tour`, statut initial `open`. Le workflow de publication existant (publish aux examinateurs, visibilité candidats, dispatch) ne change pas.

### 3. Recalcul avec protection (diff)

Définition « occupé » : le créneau a ≥ 1 ligne `slot_member_assignments` **ou** ≥ 1 ligne `slot_enrollments` non annulée.

À la modification d'une ouverture (PUT), on compare l'ensemble cible (nouveau découpage) aux créneaux existants liés à l'ouverture (`opening_id`), en matchant sur `(start_time, end_time)` :

| Créneau existant | Dans la cible ? | Action |
|---|---|---|
| Libre | oui | conservé |
| Libre | non | supprimé |
| Occupé | oui | intact (jamais touché) |
| Occupé | non | **conservé + signalé en conflit** dans la réponse |
| (aucun) | horaire cible sans créneau | créé |

La réponse du PUT contient `{ created, deleted, kept, conflicts: [...] }`. Les conflits sont résolus manuellement par l'admin dans l'UI : « Garder » (ne rien faire) ou « Supprimer quand même » → suppression + notification des inscrits via `private_messages` (même mécanique que le reset actuel).

### 4. API (routes Next.js, admin uniquement)

Toutes les routes vérifient `getTokenFromRequest` + `payload.isAdmin` (cf. règle IDOR du projet : aucun id client n'est cru sur parole).

- `GET /api/openings?epreuveId=` — liste les ouvertures d'une épreuve, avec pour chacune le décompte de créneaux (total / occupés / conflits).
- `POST /api/openings` — valide, insère l'ouverture puis ses créneaux découpés. Validation : plage cohérente (`start < end`, pause incluse dans la plage), et **rejet si chevauchement avec une autre ouverture de la même salle à la même date** (toutes épreuves confondues — une salle physique ne peut pas servir deux fois). Réutiliser/étendre `frontend/src/lib/slot-conflicts.ts`.
- `PUT /api/openings/[id]` — applique le diff de la section 3.
- `DELETE /api/openings/[id]` — supprime les créneaux libres liés. S'il reste des occupés : réponse 409 avec la liste ; `DELETE ...?force=true` supprime tout + notifie les inscrits. L'ouverture n'est supprimée que quand plus aucun créneau ne la référence (ou en force).
- `POST /api/openings/duplicate` — body `{ epreuveId, sourceDate, targetDates[] }` : copie toutes les ouvertures de `sourceDate` vers chaque date cible (créneaux générés dans la foulée). Les copies qui créeraient un chevauchement de salle sont ignorées et remontées en avertissement.

Les routes slots existantes (`/api/slots/*`) ne changent pas — publish, dispatch, reset, enroll, toggle-member continuent de fonctionner. Le reset d'épreuve supprime aussi les ouvertures de l'épreuve (sinon elles regénéreraient des créneaux fantômes).

### 5. UI Admin (`frontend/src/app/(dashboard)/dashboard/planning/page.tsx` + nouveau composant)

Nouveau composant `OpeningsManager` affiché dans l'onglet « 🛠️ Création » (maquette validée) :

- **Tableau des ouvertures** : colonnes Salle · Date · Horaires · Pause · Créneaux (avec 🔒 occupés) · actions Modifier/Supprimer. Ligne d'ajout inline en bas avec badge « → N créneaux » calculé en direct via `sliceOpening` côté client (aperçu avant création).
- **Bandeau résumé** : nombre de créneaux générés, capacité totale candidats (Σ `max_candidates`), nombre de créneaux occupés. (Le ratio vs candidats attendus du tour est un bonus si le compte est déjà disponible via l'API candidates, sinon omis.)
- **Bouton « Dupliquer une journée »** : petite modale source → dates cibles, appelle `/api/openings/duplicate`.
- **Conflits** : les créneaux occupés hors plage apparaissent en ⚠️ dans le tableau avec les deux actions (garder / supprimer + notifier).
- **CalendarAdminBuilder passe en lecture seule** pour l'onglet création : suppression du clic-pour-créer, du `window.prompt`, du drag & drop et du panel « Génération rapide ». Il reste la vue de contrôle (semaine, couleurs par salle, 🔒 sur les occupés). Les onglets « Planning Évaluateurs » et « Suivi Candidats » ne changent pas.
- Les créneaux hérités sans `opening_id` restent visibles dans la vue de contrôle et gérables via le reset existant.

### 6. Examinateurs (retouche légère, `CalendarMemberBuilder.tsx`)

Uniquement : case « ✓ tout » en tête de chaque colonne (cocher/décocher toute la journée) et en tête de chaque ligne (même horaire sur tous les jours). Aucune autre modification du composant ni du flux de sauvegarde.

### 7. Candidats

Aucun changement de code.

## Gestion des erreurs

- Validation serveur systématique des ouvertures (formats HH:MM, plage ≥ durée d'un créneau, pause dans la plage) → 400 avec message français explicite.
- Chevauchement de salle → 409 avec le détail de l'ouverture en conflit.
- Création ouverture + créneaux : si l'insertion des créneaux échoue après celle de l'ouverture, supprimer l'ouverture (compensation) pour ne pas laisser d'ouverture vide.
- Suppression avec occupés sans `force` → 409 + liste, jamais de suppression silencieuse d'inscriptions.
- Toute suppression de créneau occupé (force/conflit) notifie les inscrits via `private_messages` (réutilisation du code du reset).

## Tests

Frontend (vitest, existant dans le projet) :

- `opening-slicer` : découpage simple, avec pause, plage trop courte (0 créneau), pause en bord de plage, déterminisme.
- Diff de recalcul (fonction pure séparée) : réduction de plage avec occupés → conflits corrects ; extension de plage → seuls les nouveaux créés ; pause ajoutée → libres sous la pause supprimés, occupés signalés.
- Validation de chevauchement d'ouvertures.

Vérification manuelle de bout en bout : créer 2 ouvertures → vérifier les créneaux dans la vue de contrôle → publier → inscrire un examinateur → réduire la plage → vérifier protection + conflit.

## Hors périmètre (explicite)

- Récurrence d'ouvertures (« tous les lundis ») — refusée au brainstorming, déclaration par date.
- Refonte de la grille examinateurs au-delà des raccourcis « tout cocher ».
- Tout changement côté candidats.
- Templates de génération / assistant wizard (l'audit `SLOT_CREATION_AUDIT.md` les listait ; le modèle ouvertures les rend en grande partie inutiles).

## Risques

- **Migration manuelle** : rien ne marche tant que Felix n'a pas appliqué le SQL dans Supabase → le signaler clairement à la livraison.
- **Cohabitation créneaux hérités / ouvertures** : gérée par `opening_id` nullable ; le reset reste la porte de sortie.
- **Dispatch auto** : il tourne sur les créneaux, pas sur les ouvertures — aucun couplage nouveau, mais vérifier après recalcul qu'aucun créneau supprimé ne laisse d'assignation orpheline (les suppressions passent par la même cascade que le reset : assignments → enrollments → slot).
