# Continuité de salle et stabilité des binômes dans le dispatch

**Date** : 2026-09-08
**Statut** : spec validée, prête pour le plan d'implémentation
**Périmètre** : `frontend/src/lib/dispatch-core.ts`, `frontend/src/lib/dispatchService.ts`, `frontend/src/lib/dispatch-core.test.ts`

## Problème

Aujourd'hui, `runDispatch` recompose les jurys de zéro à chaque exécution. Deux
conséquences observées en production :

1. **Les examinateurs changent de salle d'un créneau à l'autre.** L'algorithme
   ne regarde jamais la salle physique : `scoreMember`
   (`dispatch-core.ts:113-126`) ne combine que la charge (`memberLoad`) et la
   pénalité de binôme (`pairHistory`). La colonne `room` n'est même pas
   récupérée par la requête du dispatch (`dispatchService.ts:191`).
2. **Les binômes sont cassés à chaque run.** `pairHistory` est réinitialisée à
   chaque appel de `runDispatch` (`dispatchService.ts:388`) et la pénalité de
   binôme (`PAIR_PENALTY_WEIGHT = 2`) pousse activement vers un brassage
   permanent, sans notion de « ça vient d'être décidé, on n'y touche plus ».

Aggravant : le dispatch se relance **à chaque sauvegarde de disponibilités par
n'importe quel membre** (`frontend/src/app/api/availability/route.ts:203`), et
chaque run efface-et-réécrit tous les créneaux qui ne sont ni gelés (< 24 h) ni
verrouillés (`wipeableSlotIds`, `dispatchService.ts:723-725`). Le brassage est
donc permanent, y compris sur des créneaux déjà publiés.

Coût métier : les examinateurs changent de salle **et** de partenaire à chaque
créneau, ce qui fait perdre du temps entre chaque passage (déplacement,
re-calibrage entre examinateurs qui ne se connaissent pas).

## Objectif

Un examinateur doit rester **dans la même salle, avec le même binôme**, sur des
créneaux qui se suivent — jusqu'à **3 créneaux consécutifs** — puis tourner.
La règle est **souple** : si la seule option viable est de garder le même
groupe au-delà de 3 créneaux, on le garde plutôt que de sous-staffer une salle.

Comportements attendus, validés avec Felix :

- Alice + Bob dans la 235 sur les créneaux 1-2-3 : on ne les interchange pas
  avec Marc + Jules à chaque créneau.
- Au 4ème créneau consécutif, on cherche à recomposer les groupes.
- Si les mêmes personnes reviennent **un autre jour**, on essaie activement de
  former d'autres binômes.
- Si Bob n'est plus disponible au créneau suivant mais Alice l'est : **Alice
  reste dans sa salle** et Claire la rejoint (on ne casse pas la position
  d'Alice sous prétexte que son binôme a sauté).

## Principe retenu

Deux bonus de continuité ajoutés au score existant. Le score reste « plus bas =
meilleur candidat » ; un bonus est donc une valeur **soustraite**.

### Bonus 1 — chaîne de salle

Si le membre était affecté au **créneau précédent de la même salle, le même
jour**, et que son streak dans cette salle est `< 3`, il reçoit un bonus fort
pour être repris sur ce créneau.

C'est le mécanisme central. Il est défini **au niveau de l'individu**, pas du
binôme : le binôme reste ensemble parce que ses deux membres ont chacun,
indépendamment, un bonus pour rester sur place. C'est exactement ce qui produit
le comportement voulu quand un seul des deux devient indisponible — l'autre
garde son bonus et reste en place.

### Bonus 2 — ancrage inter-run

Si le membre était déjà affecté à **ce créneau précis** dans l'état en base
avant que le run l'efface (`currentBySlot`, `dispatchService.ts:282-285`), il
reçoit un petit bonus de départage.

Rôle : supprimer le brassage gratuit. Quand un membre sauvegarde ses dispos et
que rien de structurel ne change, le résultat doit rester identique au run
précédent. Ce bonus est volontairement faible — il départage à situation égale,
il ne doit pas figer une répartition devenue mauvaise.

### La rotation après 3 créneaux ne demande aucun code dédié

Au 4ème créneau consécutif, le bonus de chaîne disparaît. À ce moment-là,
`pairHistory` a enregistré 3 co-affectations pour Alice+Bob, soit une pénalité
de 6 (`3 × PAIR_PENALTY_WEIGHT`). Le mécanisme de brassage **déjà en place** les
sépare donc de lui-même.

Même logique pour « un autre jour, on essaie de changer le groupe » : la chaîne
est indexée par (jour, salle), elle repart donc à zéro le lendemain, tandis que
`pairHistory` — accumulée sur toute l'épreuve pendant le run — pousse vers une
autre combinaison.

Autrement dit : **on n'écrit pas de logique de rotation, on coupe le bonus et
l'existant reprend la main.**

### La borne de 3 est aussi le garde-fou d'équité

Un bonus de continuité fort déséquilibre par construction la charge : un membre
« campé » dans une salle accumule des créneaux pendant que d'autres attendent.
C'est le plafond de 3 qui borne ce déséquilibre — passé ce seuil, `memberLoad`
redevient le critère dominant et fait tourner la personne.

## Ordre de traitement des créneaux

**C'est le point délicat de l'implémentation.**

Les créneaux sont aujourd'hui servis dans l'ordre de **tension**
(`compareByTension`, `dispatch-core.ts:199-218`), pas dans l'ordre
chronologique. Cet ordre est du métier : il arbitre le cas « un examinateur a
coché deux épreuves qui se chevauchent » en servant d'abord l'épreuve dont le
déficit de candidats est le plus grand. **Il ne doit pas être modifié.**

Or, pour savoir qui était sur le créneau précédent d'une salle, il faut que ce
créneau ait déjà été décidé.

**Solution : tirer les prédécesseurs en avant.** Après le tri par tension, une
passe de réordonnancement garantit qu'un créneau n'est servi qu'après le
créneau qui le précède dans sa salle, lorsque celui-ci fait partie du lot. Les
chaînes d'une salle étant strictement chronologiques, aucun cycle n'est
possible. L'ordre relatif de tension est préservé partout ailleurs, donc
l'arbitrage entre épreuves concurrentes reste intact.

Implémentation : émission en profondeur d'abord (DFS) sur le prédécesseur de
chaque créneau, en parcourant la liste dans l'ordre de tension.

## Créneaux gelés et verrouillés

Un créneau gelé (< 24 h, `isFrozen`) ou verrouillé (clôturé ou jury composé à la
main, `isLocked`) n'est pas recalculé — ce comportement ne change pas. Mais son
jury **alimente la chaîne** : il sert d'ancre pour le créneau suivant de la
salle et compte dans le streak.

Sans cela, une chaîne démarrée hier soir serait ignorée ce matin, et un jury
épinglé manuellement par l'admin n'aurait aucun effet de continuité sur la suite
de la journée.

Note : ces créneaux ne sont aujourd'hui pas préchargés dans `pairHistory` (seul
`memberLoad` l'est, `dispatchService.ts:389-396`). Cette spec **ne corrige pas**
ce point — c'est un écart connu, indépendant, à traiter à part.

## Décisions de conception

| Question | Décision | Raison |
|---|---|---|
| Clé de la chaîne | `(date, room)`, **toutes épreuves confondues** | Rester sur place est un gain de temps physique, même si deux épreuves différentes s'enchaînent dans la même salle. |
| Créneaux non contigus dans le temps | La chaîne **n'est pas cassée** par une pause | Tant que c'est le créneau suivant de cette salle ce jour-là, la personne ne se déplace pas. |
| Membre absent d'un créneau de la chaîne | Streak remis à 0 | Il a quitté la salle ; il n'y a plus de continuité à préserver. |
| Plafond | Constante `ROOM_STREAK_MAX = 3` dans `dispatch-core.ts` | Cohérent avec `FREEZE_HOURS` et `PAIR_PENALTY_WEIGHT`, déjà des constantes de module. Pas de configuration par épreuve tant que le besoin n'est pas avéré. |
| Salle vide / `room` absente | Aucun bonus de chaîne | Sans identité de salle, il n'y a pas de continuité physique à défendre. |

## Modifications de code

### `dispatch-core.ts` (logique pure, testable)

- Nouvelles constantes : `ROOM_STREAK_MAX = 3`, `ROOM_CONTINUITY_BONUS`,
  `SLOT_ANCHOR_BONUS`.
- Nouvelle fonction pure de calcul du streak d'un membre dans une salle, à
  partir de la liste chronologique des créneaux de cette salle ce jour-là et des
  affectations connues. Le parcours est borné par `ROOM_STREAK_MAX` (coût
  constant).
- `scoreMember` étendue avec les deux bonus. La signature actuelle
  (`memberId, alreadyPicked, memberLoad, pairHistory`) est utilisée à **quatre
  endroits** dans `dispatchService.ts` (lignes 602, 637-638, 669-670) : les
  appels des remplaçants (9d) et du complément de créneau verrouillé (9b)
  doivent recevoir le même traitement que l'allocation principale, sinon un
  remplaçant serait proposé sans tenir compte de la continuité.
- Nouvelle fonction pure de réordonnancement « prédécesseurs d'abord ».

### `dispatchService.ts` (I/O et orchestration)

- Ajouter `room` au `select` de la requête créneaux (ligne 191) et au type
  `SlotInfo` (ligne 49). **La colonne existe déjà** en base (`evaluation_slots.room`,
  utilisée par la gestion des ouvertures de salles) — aucune migration.
- Construire, avant la boucle d'allocation, l'index des créneaux par
  `(date, room)` triés chronologiquement.
- Appliquer le réordonnancement « prédécesseurs d'abord » sur `orderedSlots`
  (ligne 575).
- Passer les informations de continuité aux appels de `scoreMember`.

### Aucune migration Supabase

Tout se déduit de données déjà en base et déjà chargées par le run. C'est un
critère de conception explicite : ce projet a déjà trois migrations en attente
d'application manuelle, cette feature ne doit pas en ajouter une quatrième.

## Tests

Fichier existant : `frontend/src/lib/dispatch-core.test.ts` (vitest).

Les fonctions ajoutées étant pures, elles sont testables unitairement sans
Supabase. Cas à couvrir :

1. Streak qui s'incrémente sur des créneaux consécutifs de la même salle.
2. Bonus coupé au 4ème créneau consécutif → le groupe est recomposé.
3. Un membre du binôme indisponible → l'autre reste dans sa salle, un tiers le
   rejoint.
4. Jour suivant → streak à zéro et binôme différent formé.
5. Chaîne amorcée par un créneau gelé ou verrouillé.
6. Créneau sans `room` → aucun bonus, comportement d'origine.
7. Réordonnancement : un créneau n'est jamais émis avant son prédécesseur de
   salle, et l'ordre de tension est préservé entre créneaux sans lien de
   chaîne.

## Non-objectifs

- **Ne corrige pas** l'équité globale entre épreuves (`memberLoad` reste
  recalculée par épreuve) — écart connu, indépendant.
- **Ne persiste pas** `pairHistory` entre deux runs.
- **N'ajoute pas** d'affichage admin de l'équipe en cours dans une salle. Si ce
  besoin apparaît, il justifiera la table dédiée écartée pendant la conception.
- **Ne change pas** le déclenchement du dispatch ni le périmètre des créneaux
  effacés-réécrits (`wipeableSlotIds`).
