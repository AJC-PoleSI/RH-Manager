# Reprise d'examinateurs sur les créneaux verrouillés sans candidat

**Date** : 12/09/2026
**Statut** : validé par Felix

## Le problème

Un candidat passe son entretien face à un seul examinateur pendant que la salle
d'à côté, au même horaire, garde deux examinateurs pour personne.

Cas mesuré en production le 12/09/2026, jeudi 17/09 à 16h30 :

```
16:30-16:55  salle 219   1/2 examinateur   1 candidat   verrou: inscription
16:30-16:55  salle 205   2/2 examinateurs  0 candidat   verrou: publication
16:30-16:55  salle 217   2/2 examinateurs  0 candidat   verrou: publication
```

Les 11 autres examinateurs disponibles à cet horaire sont tous affectés
ailleurs (business game salle 235, jury de 6). La seule ressource mobilisable
est celle qui dort dans les salles 205 et 217.

## La cause

`dispatch-reclaim.ts` sait déjà déplacer un examinateur d'un créneau sans
candidat vers un créneau où quelqu'un attend. Mais son filtre donneur exige
`wipeable`, et `dispatchService.ts` exclut du `wipeable` tout créneau verrouillé.

Or la publication du planning verrouille **tous** les créneaux publiés de
l'épreuve (`publish-pending/route.ts`). Après publication, le `reclaim` ne voit
donc plus aucun donneur : il ne fait plus rien, définitivement.

## La règle retenue

> Un créneau verrouillé **sans aucun candidat inscrit** peut céder un
> examinateur à un créneau où un candidat attend.

Le verrou protège trois choses distinctes, qui ne se valent pas :

| `locked_reason` | Protège | Donneur autorisé ? |
|---|---|---|
| `inscription` | un rendez-vous pris | Non — exclu de fait (un donneur a 0 candidat) |
| `publication` | le planning annoncé | **Oui** — une salle vide n'a été promise à personne |
| `manuel` | une décision explicite de l'admin | **Non** — intouchable |

Le reste du `reclaim` est inchangé : donneur à 0 candidat, receveur à candidat,
créneaux au même horaire (ou dont le roulement de salle empêchait déjà
l'éligibilité), et le donneur peut tomber sous son quota — un rendez-vous pris
passe avant une salle vide.

## Pourquoi ne PAS déplacer le candidat

La demande initiale était de basculer le candidat vers la salle à jury complet
et de l'avertir du changement de salle. Écarté, pour une raison structurelle et
non par prudence :

l'éligibilité d'un examinateur se calcule sur ses plages de disponibilité. Deux
créneaux **au même horaire** ont donc exactement les mêmes examinateurs
éligibles. Si une salle voisine a un jury complet à cet horaire, ses
examinateurs sont par définition disponibles pour la salle du candidat.

**Chaque fois que déplacer le candidat marcherait, déplacer l'examinateur marche
aussi** — sans changer le rendez-vous de personne, sans contrainte de capacité,
sans message à envoyer. Vérifié sur les 5 créneaux en sous-effectif de la base
au 12/09/2026 : les deux approches règlent exactement les mêmes 2 cas.

Déplacer le candidat n'apporterait quelque chose que si l'on acceptait de le
basculer vers un **autre horaire** — une promesse bien plus lourde à casser, et
qu'aucun cas réel ne réclame aujourd'hui.

## Le retrait ciblé

`applyAssignments` supprime les affectations par créneau entier
(`DELETE WHERE slot_id IN (créneaux réécrits)`) puis insère. Un donneur
verrouillé n'appartient pas à cette liste : sa ligne survivrait à l'écriture et
l'examinateur se retrouverait **sur deux salles au même moment** — le risque
déjà documenté dans `dispatch-reclaim.ts`.

On ajoute donc une liste de retraits ciblés `(slot_id, member_id)`, appliqués
**avant** l'écriture principale.

L'ordre est un choix de sécurité : si l'écriture échoue derrière, il manque un
examinateur à une salle **sans candidat** — sans gravité, et le run suivant la
recomplète via l'étape 9b. L'ordre inverse laisserait quelqu'un affecté à deux
salles simultanément, exactement ce qu'on cherche à éviter.

Pas de migration SQL : un `DELETE` ordinaire, en amont de la RPC atomique comme
du repli non atomique.

## Fichiers touchés

- `frontend/src/lib/dispatch-reclaim.ts` — le filtre donneur passe de `wipeable`
  à `canDonate` (logique pure)
- `frontend/src/lib/dispatchService.ts` — calcule `canDonate`, construit la liste
  des retraits ciblés pour les donneurs non réécrits
- `frontend/src/lib/dispatch-io.ts` — `applyAssignments` applique les retraits
  ciblés en premier
- les trois fichiers `.test.ts` correspondants

## Notifications

Inchangées. L'examinateur déplacé reçoit déjà le bon motif (« déplacé vers la
salle X — candidat inscrit, jury incomplet »). **Aucun candidat n'est notifié,
parce qu'aucun candidat ne bouge.**

## Effet attendu en production

- 17/09 16h30 salle 219 → 2/2, examinateur repris sur la 205 ou la 217
- 15/09 09h30 salle 205 → 2/2, examinateur repris sur la 217
- deux salles vides tombent à 1/2 et sortent de la liste de réservation à ces
  horaires ; elles y reviennent dès qu'une disponibilité est posée
- 21/09 (3 créneaux) inchangés : un seul examinateur est disponible ces
  matins-là, aucun algorithme ne peut créer le second. La notification
  « Créneaux à compléter » reste la seule réponse.
