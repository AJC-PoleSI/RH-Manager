# Recalcul du dispatch après changement de disponibilité — tolérance au sous-effectif

**Date** : 2026-09-11
**Demandeur** : Felix
**Statut** : conception validée, à planifier

---

## 1. Problème constaté

Des examinateurs ont modifié leurs disponibilités. Le planning n'en a pas tenu
compte : des examinateurs restent affectés à des créneaux qu'ils ne peuvent plus
tenir, et les créneaux libérés n'ont pas été repourvus.

## 2. Diagnostic (base de production, lecture seule, 11/09/2026)

### 2.1 Cause racine — le dispatch ne lit que 1000 lignes

PostgREST plafonne toute lecture non paginée à 1000 lignes. La base contient
**1076 créneaux** et **1189 affectations** :

| Lecture | Réel | Vu par `runDispatch` |
|---|---|---|
| `evaluation_slots` (`dispatchService.ts:207`) | 1076 | 1000 |
| `slot_member_assignments` (`dispatchService.ts:277`) | 1189 | 1000 |

Aucune de ces requêtes ne porte de `.order()` : la tranche de 1000 lignes
retenue est arbitraire et peut changer d'un run à l'autre. **76 créneaux et 189
affectations sont donc invisibles à chaque recalcul.** Un changement de
disponibilité qui porte sur cette zone aveugle n'est jamais appliqué — c'est le
symptôme rapporté.

Les autres lectures du dispatch (`availabilities` : 660 lignes, `candidates` :
77, `deliberations`, `candidate_wishes`, `candidate_evaluations`) sont
actuellement sous le seuil, mais tomberont dans le même piège en grandissant.

### 2.2 Aucune trace d'exécution

`allocation_history` est **vide (0 ligne)**. L'étape 13 du dispatch écrit
`version: Date.now()` (≈ 1,78 × 10¹²) dans une colonne `INTEGER` (max
2 147 483 647) : l'insert échoue systématiquement en `22003 numeric out of
range`, dans un `try/catch` silencieux. Il n'existe donc aucun moyen de savoir
si un recalcul a tourné, quand, et ce qu'il a fait.

### 2.3 Effets de bord constatés

- **648 créneaux en sous-effectif**, dont **488 à zéro examinateur**.
- **12 affectations orphelines** (examinateur affecté sans disponibilité
  correspondante) : Amandine Barros ×9, Laure Belliard ×2, Arthur Robin ×1.
- **8 créneaux avec candidat inscrit ET sous-effectif**, tous rétrogradés en
  statut `open` (donc sortis de la liste de réservation) :

  | Date | Heure | Salle | Examinateurs | Candidats |
  |---|---|---|---|---|
  | 16/09 | 15:30 | 205 | 0/2 | 1 |
  | 16/09 | 19:30 | 219 | 0/2 | 1 |
  | 17/09 | 19:30 | 205 | 0/2 | 1 |
  | 17/09 | 14:00 | 217 | 1/2 | 1 |
  | 17/09 | 19:30 | 217 | 1/2 | 1 |
  | 17/09 | 19:30 | 219 | 0/2 | 1 |
  | 21/09 | 19:30 | 219 | 0/2 | 1 |
  | 21/09 | 19:30 | 217 | 0/2 | 1 |

### 2.4 Ce qui n'est PAS en cause

- **Le gel des 24h** : le premier créneau est le 14/09, aucun n'était imminent.
- **L'épinglage manuel** (`is_manual`) : 0 créneau épinglé en base.
- **Les colonnes de migration** : `availabilities.epreuve_id`,
  `slot_member_assignments.is_manual` et `slot_availability_requests.source`
  sont bien présentes en production.
- **La destruction de créneaux** : le dispatch ne supprime jamais un créneau ni
  une inscription candidat. Seule la suppression d'une ouverture de salle le
  fait (`openings-service.ts:190`), et elle est déclenchée exclusivement par
  l'admin.

### 2.5 Point annexe découvert

`POST /api/slots/toggle-member` (ajout) crée une affectation **sans créer la
disponibilité correspondante**. Un examinateur qui s'inscrit lui-même sur un
créneau depuis le planning est donc invisible pour le dispatch, qui l'efface au
run suivant. C'est probablement l'origine d'une partie des 12 affectations
orphelines. Corrigé ici parce que la règle d'ancrage (§3.2) s'appuie sur la
disponibilité déclarée pour décider qui retirer.

### 2.6 Point annexe — écriture non atomique

La RPC `replace_slot_assignments` (migration `supabase-migration-dispatch-atomic.sql`)
n'est pas déployée en production : le dispatch retombe sur un
`delete` + `insert` non transactionnel. Un échec d'insert laisse des créneaux
sans jury.

---

## 3. Conception

### 3.1 Réparer le recalcul

**Pagination.** Un helper `fetchAllRows(buildQuery)` parcourt les résultats par
tranches de 1000 (`.range(from, from + 999)`) jusqu'à obtenir une page
incomplète. Il s'applique à **toutes** les lectures de `runDispatch` :
`evaluation_slots`, `availabilities`, `slot_member_assignments`, `candidates`,
`deliberations`, `candidate_wishes`, `candidate_evaluations` — y compris sur les
chemins de repli (colonne `epreuve_id` ou `is_manual` absente).

Chaque requête paginée porte un `.order("id")` pour garantir un parcours
déterministe et sans doublon ni oubli entre deux pages.

**Journal réparé.** `allocation_history.version` passe en `BIGINT` (migration
manuelle). Chaque run laisse une ligne horodatée avec ses statistiques, ce qui
rend le recalcul vérifiable a posteriori.

**Écriture atomique.** La migration `supabase-migration-dispatch-atomic.sql` est
reportée dans `MIGRATIONS_A_APPLIQUER.sql` pour application manuelle.

**Échec visible.** `PUT /api/availability` continue d'avaler l'erreur de
dispatch (la sauvegarde de la disponibilité, elle, a réussi et ne doit pas être
annulée), mais crée désormais une notification pour les comptes admin :
« le recalcul automatique a échoué après la sauvegarde de X ».

### 3.2 Créneau avec candidats inscrits = jury ancré

Un créneau porte une **inscription active** si au moins une ligne de
`slot_enrollments` a `status` nul ou `'active'` (seule valeur présente en base
aujourd'hui : `active`, 77 lignes).

Nouveau traitement, entre le cas « verrouillé » (9b) et le cas « ouvert » (9c) :

- Les examinateurs déjà affectés **qui ont toujours une disponibilité
  correspondante** sont conservés tels quels — aucun rebrassage d'équité, aucun
  déplacement.
- Les examinateurs **sans disponibilité correspondante** sont retirés et
  notifiés (motif : « vous n'êtes plus disponible sur ce créneau »).
- Les places restantes sont complétées depuis le vivier disponible, avec le
  scoring habituel (équité, brassage, continuité de salle).

C'est le seul cas où le dispatch retire quelqu'un d'un créneau à candidats : il
n'y a pas de retrait « pour équité » sur ces créneaux.

Les créneaux `closed` et les créneaux épinglés (`is_manual`) gardent leur
traitement actuel — complétés seulement, jamais vidés. Les créneaux gelés
(< 24h) restent intouchés.

### 3.3 Tolérance au sous-effectif

Un créneau est **en sous-effectif** quand son nombre d'examinateurs affectés est
inférieur à `min_members`.

Nouvelle règle de statut (étape 11 du dispatch) :

| Situation | Statut | Conséquence |
|---|---|---|
| Effectif complet | `published` / `ready` (règle actuelle) | inscriptible |
| Sous-effectif, **≥ 1 examinateur**, **avec** candidat inscrit | conserve `published` / `ready` | reste inscriptible, badge rouge « 1/2 examinateur » |
| Sous-effectif, **0 examinateur**, **avec** candidat inscrit | `open` | fermé aux nouvelles inscriptions ; le candidat déjà inscrit conserve son créneau et le voit toujours (`slots/available` inclut déjà les créneaux où le candidat est inscrit, quel que soit le statut) ; badge « CRITIQUE » |
| Sous-effectif, **sans** candidat inscrit | `open` (règle actuelle) | retourne au pool, invisible aux candidats |

**Aucune colonne de base n'est ajoutée** pour le badge : l'état « sous-effectif »
se déduit de `assignments.length < min_members`, une donnée déjà chargée par les
pages admin et examinateur. Un drapeau persisté se désynchroniserait.

Affichage :
- Page planning admin : badge rouge « 1/2 examinateur » ou « 0/2 — CRITIQUE » sur
  la vignette du créneau, plus un bandeau en tête de page « X créneaux en
  sous-effectif, dont Y avec candidats inscrits ».
- Page examinateur (« mes créneaux ») : même badge sur les créneaux concernés.

### 3.4 Alerte à tous les examinateurs

Le dispatch tourne à **chaque** sauvegarde de disponibilité : une notification
inconditionnelle serait ingérable (648 créneaux en sous-effectif aujourd'hui).
On notifie donc uniquement sur **bascule**, et uniquement pour les créneaux
**avec candidat inscrit**.

Un créneau bascule quand il était à l'effectif complet **avant** le run et se
retrouve en sous-effectif **après**. La comparaison se fait entre `currentBySlot`
(état lu en base au début du run) et les affectations décidées — aucune colonne
de suivi n'est nécessaire, et un créneau déjà en sous-effectif au run précédent
ne renotifie pas.

Deux notifications groupées maximum par run, envoyées à **tous les membres** via
`notifyMembers` :

1. **Sous-effectif** — `type: "slot_understaffed"`
   Titre : « Créneaux à compléter ».
   Corps : « 3 créneaux n'ont plus assez d'examinateurs et ont des candidats
   inscrits : mar. 16/09 15h30 salle 205, … ». Au-delà de 5 créneaux, les cinq
   premiers sont listés puis « … et N autres ».
   Lien : `/dashboard/availability`.

2. **Critique** — `type: "slot_no_examiner"`, notification distincte
   Titre : « ⚠️ CRITIQUE — créneau avec candidat et aucun examinateur ».
   Même format de corps, même lien. Séparée pour ne pas se noyer dans le lot.

Les comptes admin reçoivent ces notifications comme les autres, en plus du
bandeau permanent de la page planning (§3.3).

### 3.5 Recalcul manuel avec aperçu

`runDispatch` accepte une option `dryRun` : tout est calculé, **rien n'est
écrit** (ni affectations, ni remplaçants, ni liste d'attente, ni statuts, ni
notifications, ni journal). Le résultat expose, en plus des compteurs actuels :

- `added` : `{ slot_id, member_id }[]` — affectations qui seraient créées
- `removed` : `{ slot_id, member_id, reason }[]` — affectations qui seraient
  supprimées
- `understaffedWithCandidates` : `{ slot_id, assigned, needed, candidates }[]`
- `wouldNotify` : nombre de membres qui recevraient une notification

`POST /api/dispatch/run` accepte `{ dryRun?: boolean }`. Le mode `dryRun` est
réservé aux admins (`payload.isAdmin`) ; le mode réel garde la règle actuelle
(membres uniquement, candidats interdits).

Page planning admin : bouton **« Recalculer tout maintenant »** →
appel `dryRun` → modale récapitulative (compteurs + listes déroulantes des
retraits et ajouts, groupés par créneau) → bouton **« Appliquer »** qui relance
le même appel sans `dryRun`, puis rafraîchit la page et affiche le compte rendu
réel.

### 3.6 Correctif annexe — auto-inscription d'un examinateur

`POST /api/slots/toggle-member` (action `add`) crée, en plus de l'affectation,
la ligne `availabilities` correspondante (`member_id`, `date`, `start_time`,
`end_time`, `epreuve_id` du créneau) si elle n'existe pas déjà. S'inscrire
soi-même sur un créneau *est* une déclaration de disponibilité. Symétriquement,
l'action `remove` déclenchée par le membre lui-même supprime la disponibilité
exactement superposée au créneau, si elle existe.

Sans ce correctif, la règle d'ancrage (§3.2) retirerait au run suivant tout
examinateur inscrit de sa propre initiative.

---

## 4. Découpage des modules

| Module | Responsabilité | Dépend de |
|---|---|---|
| `lib/supabase-paging.ts` (nouveau) | `fetchAllRows()` : pagination générique par tranches de 1000 | client Supabase injecté |
| `lib/dispatch-core.ts` | ajout de `hasActiveEnrollments()` et `understaffedTransition()` — fonctions pures, testées | — |
| `lib/dispatchService.ts` | branche « jury ancré », règle de statut, collecte des bascules, mode `dryRun` | core + paging + io |
| `lib/dispatch-notifications.ts` (nouveau) | composition des deux notifications groupées (texte, regroupement, troncature à 5) — fonction pure | — |
| `app/api/dispatch/run/route.ts` | passe `dryRun`, restreint le mode aperçu aux admins | dispatchService |
| `app/api/availability/route.ts` | notifie les admins quand le dispatch échoue | dispatchService + notifications |
| `app/api/slots/toggle-member/route.ts` | synchronise la disponibilité à l'auto-inscription | — |
| `components/planning/*` | badges sous-effectif, bandeau admin, modale d'aperçu | API |

Chaque fonction pure ajoutée (`hasActiveEnrollments`, `understaffedTransition`,
composition des notifications, `fetchAllRows` avec client mocké) est couverte par
un test vitest, comme le reste de `dispatch-core` et `dispatch-io`.

---

## 5. Migration SQL (application manuelle par Felix)

Ajoutées à `MIGRATIONS_A_APPLIQUER.sql` :

1. `ALTER TABLE allocation_history ALTER COLUMN version TYPE BIGINT;`
2. La fonction `replace_slot_assignments` de
   `supabase-migration-dispatch-atomic.sql`, jamais appliquée en production.

Aucune autre modification de schéma. Le code fonctionne sans ces migrations
(replis déjà en place), elles ne font qu'améliorer traçabilité et atomicité.

---

## 6. Gestion des erreurs

- Une lecture paginée qui échoue en cours de route **interrompt le dispatch**
  (`throw`) : mieux vaut ne rien changer que recalculer sur une vue partielle —
  c'est précisément le bug d'origine.
- L'envoi des notifications reste *fail-soft* (log + poursuite) : une
  notification perdue ne doit pas annuler un recalcul correct.
- L'écriture du journal reste *fail-soft*, mais l'erreur est désormais loguée
  explicitement avec son code.
- Le mode `dryRun` ne peut rien écrire par construction : les appels d'écriture
  sont sautés en amont, pas neutralisés côté base.

---

## 7. Mise en production

1. Code corrigé, testé, déployé.
2. Application des deux migrations SQL par Felix.
3. Lancement du **mode aperçu** sur la production ; Felix valide le récapitulatif
   (qui est retiré, qui est ajouté, quels créneaux restent en sous-effectif).
4. Application du recalcul réel après validation explicite.

---

## 8. Hors périmètre

- Le gel des 24h reste inchangé (`FREEZE_HOURS = 24`) : il n'est pas en cause.
- Aucune modification de l'arbitrage entre épreuves simultanées, de la
  continuité de salle, ni du calcul d'équité.
- Aucun envoi d'email : les notifications restent in-app.
- Aucun changement du comportement de suppression d'ouvertures de salle.
