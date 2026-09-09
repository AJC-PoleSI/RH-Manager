# Refonte des créneaux — saisie par bandes horaires

**Date** : 9 septembre 2026
**Branche** : `refonte-creneaux`
**Statut** : spec validée, implémentation à planifier

---

## 1. Le problème

La saisie des disponibilités se fait **case par case**. L'examinateur ouvre la liste
des créneaux publiés et coche `11:30–11:55`, puis `12:20–13:20`, puis `15:50–16:50`…
L'export du 09/09/2026 le mesure :

| | |
|---|---|
| lignes dans `availabilities` | **950** |
| examinateurs concernés | 16 sur 25 |
| record individuel | Mylène Andela Ebela — **114 lignes** sur 10 jours |
| période couverte | 14/09 → 01/10/2026 |

114 cases à cocher, ce n'est pas une saisie, c'est une corvée. Personne ne la fait
correctement jusqu'au bout, et une dispo mal saisie se paie en créneau sous-staffé.

Côté admin, même logique accrétive : `OpeningsManager` (906 lignes) et
`CalendarAdminBuilder` (868 lignes, avec un `window.prompt()` pour choisir la salle)
imposent un formulaire par ouverture. `SLOT_CREATION_AUDIT.md` chiffrait 20 à 40 min
pour 40 créneaux.

## 2. Le principe

Une **grille horaire unique**, amplitude fixe **8h00 → 20h30**, lundi→vendredi,
navigation par flèches de semaine. On y trace des **bandes** au glissement de souris
plutôt que de cocher des cases. Le même composant sert à l'admin (ouvertures de
salles) et à l'examinateur (disponibilités).

Le geste, en trois temps :

1. **Ciblage approximatif** — au `pointerdown`, une étiquette flottante affiche
   l'heure visée (`8h30`). L'utilisateur n'a pas à viser juste.
2. **Glissement** — la bande se dessine en direct ; l'étiquette suit le curseur et
   affiche `8h30 → 17h30 · 9h00`.
3. **Validation visuelle** — au relâchement, la zone balayée devient une bande bleue
   pleine et continue.

Puis, parce que le geste initial est approximatif : **reclic sur la bande** →
poignées de redimensionnement haut/bas, deux champs horaires pour le réglage fin,
et une croix pour supprimer.

## 3. Décisions actées

| Sujet | Décision |
|---|---|
| Amplitude | **8h00 → 20h30** (les données réelles vont jusqu'à 20h20 : 30 dispos et 21 créneaux) |
| Fenêtre | Semaine **lun→ven**, navigation par flèches (aligné sur la page dispos actuelle) |
| Aimantation | **15 min au glissement**, **5 min à l'édition fine** |
| Bandes multiples | Oui — 8h–10h *et* 12h–14h le même jour |
| Ouvertures de salles | Restent **rattachées à une épreuve** (`room_openings.epreuve_id` inchangé) |
| Dispos examinateur | **Globales** — `availabilities.epreuve_id = NULL`. L'algo tranche. |
| Côté candidat | **Aucun changement.** L'auto-inscription reste telle quelle. |
| Estimation | Nombre de **créneaux nécessaires**, depuis `candidats_attendus` + `marge_pct` |
| Reprise des 950 dispos | Conversion automatique en bandes, **validée par chaque membre** |

### Pourquoi les dispos deviennent globales

Aujourd'hui `availabilities.epreuve_id` sert à arbitrer deux épreuves simultanées.
Avec des bandes, cette dimension disparaît : l'examinateur déclare qu'il est *là*,
et le dispatch décide de l'épreuve.

**Le code encaisse déjà ce cas.** `availabilityMatchesSlot()` (lib/dispatch-core.ts)
traite un `epreuve_id` nul comme une dispo purement horaire et retombe sur le
matching par chevauchement — le comportement historique, explicitement conservé pour
les données antérieures. `compareByTension()` arbitre déjà entre épreuves
concurrentes en privilégiant celle qui risque de ne pas faire passer tous ses
candidats.

**Conséquence : l'algorithme de dispatch n'est pas réécrit.** On change ce qui
l'alimente, pas ses règles.

## 4. Architecture

### 4.1 `lib/time-bands.ts` — fonctions pures

Aucun import, entièrement testable. C'est là que vit toute la logique délicate.

```
minutesToHHMM / hhmmToMinutes
snap(minutes, pas)              → aimantation 15 ou 5 min
normalizeBands(bands)           → trie, fusionne les bandes qui se touchent
                                  ou se chevauchent, supprime les bandes nulles
clampToGrid(band)               → borne à [08:00, 20:30]
bandsFromRows(rows) / rowsFromBands(bands, ctx)
mergeContiguous(rows, tolerance) → conversion des données historiques
```

`normalizeBands` est appelée après chaque geste : deux bandes qui se rejoignent
après un redimensionnement n'en font plus qu'une, sans que l'utilisateur ait à y
penser.

### 4.2 `components/planning/TimeBandGrid.tsx` — le composant

Contrat : reçoit `bands[]`, renvoie `bands[]`. Ne connaît ni salle, ni épreuve, ni
API. ~350 lignes.

```tsx
<TimeBandGrid
  days={Date[]}                  // 5 jours
  lanes={Lane[]}                 // 1 piste (examinateur) ou N salles (admin)
  bands={Band[]}                 // { dayIndex, laneId, startMin, endMin }
  overlays={Overlay[]}           // blocs en lecture seule (affectations)
  onChange={(bands) => void}
  readOnly={boolean}
/>
```

**Fluidité — les choix qui comptent :**

- Pointer Events natifs + `setPointerCapture` — pas de librairie de drag, le geste
  ne décroche pas si la souris sort de la colonne.
- Pendant le glissement, **aucun `setState` par pixel** : la bande fantôme et
  l'étiquette sont pilotées par `transform` sur un `ref`, dans un
  `requestAnimationFrame`. React ne re-render qu'au `pointerup`.
- `touch-action: none` sur les colonnes pour que le geste marche au doigt sans que
  la page défile.
- `Escape` pendant le geste = annulation.

### 4.3 `components/planning/RoomOpeningsGrid.tsx` — admin

Sélecteur d'épreuve en tête. Chaque jour est subdivisé en **une piste par salle**.

**La liste des salles** est le premier geste de l'admin : un champ au-dessus de la
grille où il saisit les salles dont il dispose, stocké dans `system_settings`
(clé `rooms`, liste séparée par des virgules). Elle est pré-remplie avec les salles
déjà utilisées cette saison — 205, 217, 219, 235, 238-240, 242-244 — extraites des
`room_openings` existantes. Retirer une salle de la liste ne supprime pas ses
ouvertures : la piste reste affichée tant qu'elle porte des bandes.

Tracer une bande crée une `room_opening`.

**Les pauses deviennent implicites.** Aujourd'hui une ouverture porte
`break_start` / `break_end` pour trouer une plage continue. Avec des bandes
multiples, une pause de midi n'est plus qu'un espace entre deux bandes : deux
ouvertures au lieu d'une ouverture trouée. Les deux colonnes restent en base pour
les ouvertures historiques mais ne sont plus alimentées ; `sliceOpening()` continue
de les honorer quand elles sont présentes.

Le découpage en créneaux réutilise `sliceOpening()` (lib/opening-slicer.ts), qui
existe et est déjà testé. Les API `/api/openings` (GET/POST), `/api/openings/[id]`
et `/api/openings/duplicate` sont conservées.

Sous la grille, un compteur permanent :

> **Entretien individuel** — 100 candidats attendus, marge +25% → **125 créneaux nécessaires**
> Tes ouvertures produisent **96 créneaux** → ⚠️ il en manque **29**.

### 4.4 `components/planning/MemberAvailabilityGrid.tsx` — examinateur

Une seule piste par jour. L'examinateur trace ses bandes de dispo (bleu plein).

**Par-dessus, ses affectations en lecture seule** : les créneaux sur lesquels le
dispatch l'a placé, dans la couleur de leur épreuve, avec le nom de la salle. Il
voit d'un coup d'œil ce qu'il a déclaré *et* ce qui en est sorti. Source :
`GET /api/slots/my-slots`, qui existe déjà.

`MemberDashboardCalendar` (tableau de bord) reste inchangé.

### 4.5 `lib/slot-estimator.ts` — l'estimation

Deux champs nouveaux sur l'épreuve : `candidats_attendus`, `marge_pct` (défaut 25).

| type | formule | exemple (100 candidats, +25%) |
|---|---|---|
| individuelle | `ceil(C × (1 + marge))` | **125 créneaux** |
| groupe | de `ceil(C / group_size)` à `ceil(C × (1+marge) / min_candidates)` | **17 à 32 créneaux** |

`group_size` est le maximum par groupe, `min_candidates` le minimum — ce sont les
colonnes existantes de `epreuves` (Business Game : 6 et 4).

La marge existe parce que **les candidats s'inscrivent eux-mêmes** : avec exactement
autant de créneaux que de candidats, les derniers inscrits n'ont plus aucun créneau
compatible avec leurs disponibilités. La marge, c'est du choix, pas du gaspillage.

Fonction pure, testée.

## 5. Schéma

Migrations à appliquer **à la main dans Supabase** (règle projet), ajoutées à
`MIGRATIONS_A_APPLIQUER.sql` et à `supabase-migration-creneaux-bandes.sql` :

```sql
ALTER TABLE public.epreuves
  ADD COLUMN IF NOT EXISTS candidats_attendus INTEGER,
  ADD COLUMN IF NOT EXISTS marge_pct INTEGER DEFAULT 25;

-- Marque les dispos issues de la conversion automatique : tant que le membre
-- n'a pas rouvert sa grille, on sait que la bande a été déduite, pas déclarée.
ALTER TABLE public.availabilities
  ADD COLUMN IF NOT EXISTS confirmed_by_member BOOLEAN NOT NULL DEFAULT true;
```

Aucune autre table ne bouge. `room_openings`, `evaluation_slots`,
`slot_member_assignments`, `slot_enrollments` sont inchangées.

## 6. Reprise des 950 dispos existantes

Fusion des cases contiguës par membre et par jour, **tolérance 15 min**
(deux cases séparées de moins d'un quart d'heure appartiennent à la même présence).

Simulation exécutée sur les données réelles :

```
tolérance  0 min → 709 bandes
tolérance 10 min → 180 bandes
tolérance 15 min → 177 bandes   ← retenu
tolérance 30 min → 161 bandes
```

**950 lignes deviennent 177 bandes.** Mylène passe de 114 lignes à 21 bandes :

```
14/09 :  9 cases → 08:00-09:55, 18:10-20:20
16/09 : 15 cases → 08:00-14:30
30/09 : 17 cases → 08:00-10:00, 12:35-13:20, 15:55-20:00
```

C'est ce qu'un humain aurait tracé.

**Garde-fous :**

- Les lignes converties portent `confirmed_by_member = false`. La grille affiche un
  bandeau « tes disponibilités ont été converties, vérifie-les » jusqu'au premier
  enregistrement.
- La fusion ne peut qu'**élargir** une dispo. La tolérance de 15 min borne cet
  élargissement à un quart d'heure — inférieur à la plus courte épreuve (20 min),
  donc la conversion ne peut pas à elle seule créer un créneau attribuable.
- **Le dispatch n'est pas relancé automatiquement.** Les 857 affectations existantes
  restent en place ; elles ne bougeront qu'au prochain run décidé par l'admin.
- Rollback : `~/Desktop/RH-backup-dispos-2026-09-09/restauration-dispos.sql`
  (INSERT … ON CONFLICT DO NOTHING sur les 6 tables de planning).

## 7. Ce qui disparaît

**Après validation en local, pas avant.**

| fichier | lignes | motif |
|---|---|---|
| `components/calendar/CalendarMemberBuilder.tsx` | 570 | la saisie case par case |
| `components/calendar/OpeningsManager.tsx` | 906 | le formulaire d'ouverture |
| `components/calendar/CalendarAdminBuilder.tsx` | 868 | `window.prompt()` + génération rapide |
| `app/(dashboard)/dashboard/planning/page.tsx` | 121 Ko | dégraissé de ce qui part avec les composants ci-dessus |

À vérifier avant suppression (probablement morts) : `/api/slots/bulk-create`,
`/api/slots/generate`, `/api/slots/merge-undersized`.

Méthode : construire à côté, valider en local, **puis** couper. Une passe de
`grep` sur chaque symbole avant chaque suppression.

## 8. Tests

**Unitaires (vitest, existant côté frontend) :**

- `time-bands.test.ts` — aimantation, fusion de bandes qui se touchent, bornage à
  la grille, bandes inversées (glissement vers le haut), fusion des données
  historiques aux quatre tolérances.
- `slot-estimator.test.ts` — individuelle, groupe, marge à 0, `candidats_attendus`
  non renseigné.
- La conversion des 950 dispos est rejouée sur le dump réel et comparée aux
  177 bandes attendues.

**Manuel en local :** grille admin (tracer, éditer, supprimer, compteur), grille
examinateur (bandes multiples, affectations visibles), un run de dispatch complet
sur une copie des données.

## 9. Hors périmètre

- Toute évolution côté candidat.
- Les règles du dispatch (`ROOM_STREAK_MAX`, `PAIR_PENALTY_WEIGHT`,
  `ROOM_CONTINUITY_BONUS`, `FREEZE_HOURS`, arbitrage par tension) — inchangées.
- Les ouvertures de salles génériques non rattachées à une épreuve — écartées.
- La détection de double-réservation physique d'une salle entre deux épreuves.
  L'export du 09/09 ne montre **aucune collision** aujourd'hui, l'admin la maintient
  à la main. À reconsidérer si le cas se présente.

## 10. Contexte d'exécution

- Travail sur la branche **`refonte-creneaux`**. Le hook `PostToolUse` de
  `.claude/settings.local.json` fait `git add -A && git commit && git push` à chaque
  écriture ; sans upstream sur cette branche, le `push` échoue silencieusement et
  **rien ne part en production**. `main` reste intact.
- Les migrations SQL ne s'appliquent pas toutes seules : elles vont dans
  `MIGRATIONS_A_APPLIQUER.sql` et Felix les passe à la main dans Supabase.
