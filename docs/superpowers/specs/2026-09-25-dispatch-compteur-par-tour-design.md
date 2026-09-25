# Dispatch : compteur d'équité par tour, réservés comptés double

Date : 25/09/2026 · Validé par Felix dans la conversation du même jour.

## Constat (données réelles, Tour 2 en cours)

- Le compteur d'équité du dispatch (`memberLoad`) était **global à tous les
  tours** : le Tour 2 servait de rattrapage du Tour 1. Romain Messein (68
  créneaux au Tour 1) n'a reçu aucun rendez-vous client au Tour 2 malgré 37 h
  de dispo ; Léo Dakouri (12 au Tour 1) en a reçu 31.
- Le compteur ignorait les réservations : Victoire 13 candidats et Léo 12,
  Romain et Raphaël 0, à créneaux alloués comparables.
- Les anciennes cases de dispo de Mylène (20 min, séparées de 5 min, grille
  décalée de 5 min après un redécoupage des ouvertures) s'affichaient comme des
  plages continues sur sa page (tolérance de 15 min à l'affichage) mais ne
  couvraient aucun créneau pour l'algo : 0 horaire couvert au lieu de 28.
- Bug latent : un examinateur pré-enregistré (étape 8ter) puis retiré en 9b-bis
  gardait un engagement fantôme ; en simulant un roulement de 10 min, 5
  examinateurs étaient retirés de leurs DEUX créneaux voisins au lieu d'un.

## Décisions

1. **Compteur par tour** (`tourKeyOf`) : seuls les créneaux du tour comptent ;
   toutes les épreuves d'un même tour partagent le compteur. Le brassage des
   binômes reste par épreuve.
2. **Un créneau réservé compte double** (`slotLoadWeight` = 1 + 1 s'il a au
   moins un inscrit actif). N'agit que sur les créneaux encore libres : la
   publication verrouille les jurys, rien n'est rebrassé.
3. **Couverture des dispos avec la même tolérance que l'affichage**
   (`MERGE_TOLERANCE_MIN` = 15 min) dans `availabilitiesCoverSlot`.
4. **Libération du pré-enregistrement** quand un examinateur est retiré d'un
   jury ancré (`releasePreRegistration`).
5. **Avertissement avant publication** (non bloquant) :
   `GET /api/epreuves/[id]/availability-coverage` compte les examinateurs
   ayant au moins une dispo sur les jours du tour (du premier au dernier
   créneau de ses épreuves). Sont attendus les membres ayant déjà participé
   (une dispo ou une affectation, tous tours confondus) ; les autres sont
   listés à part, non comptés. Le planning affiche une confirmation nommant les
   absents ; une lecture en échec ne bloque jamais la publication.

## Hors périmètre

- Rééquilibrage périodique des créneaux déjà réservés (simulé : 7 transferts,
  13 créneaux sur 53) — proposé, non retenu pour l'instant.
- Changement du roulement du RDV client (5 → 10 min) : Felix ne le fait pas.

## Vérification

- `dispatch-core.test.ts` (93 tests) et `availability-coverage.test.ts`.
- Dry-run sur la prod : 0 ajout, 0 retrait (les jurys du Tour 2 sont
  verrouillés) ; remplaçants 320 → 322 (Mylène redevient mobilisable).
- Dry-run avec roulement simulé à 10 min : chaque examinateur ne perd plus
  qu'un des deux créneaux ; plus aucun créneau réservé sous son quota.
