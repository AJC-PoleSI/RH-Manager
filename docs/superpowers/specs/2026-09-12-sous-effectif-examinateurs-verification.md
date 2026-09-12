# Candidat seul face à un examinateur — vérification, pas de code à écrire

**Date** : 12/09/2026
**Statut** : vérifié en simulation sur les données de production. **Aucune
modification de code nécessaire.**

## La question posée

« J'ai des candidats inscrits sur des créneaux avec un seul examinateur alors
qu'au même moment j'ai un créneau dispo. Est-ce corrigé ? »

## Réponse

Oui, par `dispatch-reclaim.ts` (livré le 11/09/2026, affiné le 12/09) — mais
dans l'autre sens que celui imaginé : **c'est l'examinateur qui est déplacé vers
le candidat**, pas le candidat vers la salle bien dotée.

Une simulation (`runDispatch({ dryRun: true })`) lancée le 12/09/2026 sur la
base de production donne :

```
[dispatch] 2 examinateur(s) repris sur des créneaux sans candidat
           pour compléter des créneaux réservés.

Romain Messein   15/09 09:30-09:55  salle 217 (vide) → salle 205 (1 candidat)
Amandine Barros  17/09 16:30-16:55  salle 205 (vide) → salle 219 (1 candidat)
```

Créneaux à candidat en sous-effectif : **5 avant simulation, 3 après**.

Le code fonctionne. Les deux cas réparables sont en attente d'un simple
déclenchement du dispatch — il ne se relance qu'à la sauvegarde d'une
disponibilité ou sur action admin, et aucun des deux n'a eu lieu depuis le
12/09 01h55.

## Les 3 cas restants ne sont pas un bug

21/09 à 08h00, 08h30 et 09h00 : un candidat, un examinateur, et les salles
voisines à **zéro** examinateur. Comptage des disponibilités couvrant ces
horaires : **1 examinateur, toutes salles confondues**.

Aucun algorithme ne crée le second. La notification « Créneaux à compléter »
émise par `dispatch-understaffing.ts` est la seule réponse possible : il faut
qu'un membre pose une disponibilité.

## Pourquoi on ne déplace PAS le candidat

L'éligibilité d'un examinateur se calcule sur ses plages de disponibilité. Deux
créneaux **au même horaire** ont donc exactement les mêmes examinateurs
éligibles : si une salle voisine a un jury complet à cet horaire, ses
examinateurs sont par définition disponibles pour la salle du candidat.

**Chaque fois que déplacer le candidat marcherait, déplacer l'examinateur marche
aussi** — sans changer le rendez-vous de personne, sans contrainte de capacité
d'accueil, sans message de changement de salle à envoyer. Vérifié sur les 5 cas
réels : les deux approches règlent exactement les mêmes 2 créneaux.

Déplacer le candidat n'apporterait quelque chose que si l'on acceptait de le
basculer vers un **autre horaire** — une promesse bien plus lourde à casser,
qu'aucun cas réel ne réclame.

## Piège à ne pas retomber dedans

`isLocked()` dans `dispatchService.ts` ne lit **pas** la colonne `is_locked` :
c'est une closure locale qui vaut `status === "closed"` OU « le créneau porte une
affectation manuelle ». La colonne `is_locked` (slot-lock.ts) est lue séparément
par `isSlotLocked()` aux étapes 9b / 9b-bis.

Conséquence : un créneau verrouillé par la publication **reste rebrassable** et
peut donc céder un examinateur. Conclure l'inverse mène à « corriger » un bug
qui n'existe pas.

## Comment revérifier

Simulation en lecture seule, sans rien écrire :

```bash
# POST /api/dispatch/run  avec  { "dryRun": true }  (admin)
# ou, en local, runDispatch({ dryRun: true }) via vite-node
```

La réponse contient `added`, `removed` et `understaffedWithCandidates`.
