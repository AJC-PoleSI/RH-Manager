# Changer la salle d'un créneau et prévenir les deux côtés

**Date** : 2026-09-12
**Demandeur** : Felix
**Statut** : implémenté

---

## 1. Besoin

> « Permettre à l'admin de changer une salle et en avertir à la fois les
> candidats et mes examinateurs, parce que parfois c'est incohérent. Dans le
> même onglet que celui pour ajouter ou retirer des examinateurs. »

Une salle peut se révéler incohérente après coup : deux épreuves programmées
au même endroit, salle finalement indisponible, erreur de saisie à l'ouverture.
Jusqu'ici la seule façon de corriger était de repasser par l'ouverture de salle
(qui recalcule tous ses créneaux) ou de supprimer/recréer le créneau.

## 2. Où

La modale de détail d'un créneau (clic sur un créneau du calendrier admin,
`dashboard/planning`) — celle qui porte déjà le « + » d'ajout d'examinateur et
la croix de retrait. La ligne **Salle** y porte désormais un bouton
« ✏️ Changer ».

## 3. Comportement

### 3.1 Choix de la salle

Liste déroulante : salles utilisées **ce jour-là** d'abord, puis les autres
salles connues du planning, puis « Autre salle… » (saisie libre — une salle peut
n'avoir encore jamais servi).

Les salles qui portent déjà un créneau **sur cet horaire** sont marquées
« occupée » et non sélectionnables : le serveur les refuserait de toute façon
(anti-chevauchement, `slot-conflicts.ts`), autant le dire avant le clic.
Logique et tests : `lib/room-choices.ts`.

Effet de bord utile : si la salle **du créneau lui-même** apparaît occupée,
c'est qu'un autre créneau s'y superpose — l'incohérence est visible à l'écran.

### 3.2 Avertissement des deux côtés

Le changement n'est jamais silencieux par défaut. `PUT /api/slots/[id]` prévient :

| Destinataire | Canal |
|---|---|
| Candidats inscrits | message privé (messagerie) + email `sendRoomChangeEmail` |
| Examinateurs affectés | notification in-app (cloche) + email `sendRoomChangeEmail` |

Prévenir les seuls candidats laisserait le jury dans l'ancienne salle — c'est le
point de la demande. Le gabarit d'email prend un `role` pour s'adresser
correctement à l'un ou à l'autre.

La case « Prévenir… » peut être décochée (`notify: false`) pour corriger une
coquille sur un créneau que personne n'a encore vu. Elle disparaît quand le
créneau n'a ni candidat ni examinateur.

L'email n'est envoyé que pour un changement de **salle à horaire constant** :
son gabarit affirme « la date et l'heure restent identiques ». Un déplacement
d'horaire reste couvert par le message privé et la notification.

### 3.3 Garde-fous

- **Chevauchement** : 409 avec le créneau fautif, message affiché tel quel.
- **Créneau figé** (`is_locked`) : 409 `creneau_fige`. L'admin est interrogé
  (`window.confirm` avec le motif du verrou) et peut forcer — c'est une
  question, pas une erreur.

### 3.4 Rattachement à l'ouverture

Un créneau déplacé est rattaché à l'ouverture (`room_openings`) de la salle
d'arrivée si elle couvre son horaire, sinon détaché (`opening_id = null`).

Sans cela il resterait lié à l'ouverture de son **ancienne** salle : le tableau
des ouvertures mentirait, et la prochaine modification de cette ouverture le
ramènerait silencieusement dans la salle d'origine (« mettre à jour la salle des
créneaux conservés », `PUT /api/openings/[id]`).

## 4. Bug corrigé au passage

La notification des candidats sur modification de créneau filtrait les
inscriptions sur `!status || status === "active"`. Le statut par défaut du
schéma est `enrolled` : **ces candidats-là n'étaient jamais prévenus** d'un
changement d'horaire ou de salle. Remplacé par `filterActiveEnrollments`
(`lib/enrollment.ts`), la règle commune à tout le projet.

## 5. Migration

Aucune. Tables et colonnes utilisées (`notifications`, `private_messages`,
`evaluation_slots.opening_id`, `is_locked`) existent déjà.
