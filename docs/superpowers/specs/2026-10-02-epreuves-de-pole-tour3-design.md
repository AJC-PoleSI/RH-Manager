# Épreuves de pôle du Tour 3 — génération des créneaux, dispatch par pôle, relance des vœux

Date : 2026-10-02 · Validé avec Felix en séance.

## 1. Contexte et objectif

Au Tour 3, chaque candidat passe une épreuve pour **chacun des pôles qu'il a
choisis** (au plus 3, vœux du Tour 2, indicatifs mais engageants), devant des
membres de ce pôle, puis fait son choix définitif. En plus, le Business Game
du Tour 3 concerne tous les admis.

RH Manager doit :

1. estimer combien de créneaux ouvrir par pôle, à partir des vœux du Tour 2 ;
2. **créer ces créneaux automatiquement** (bouton « Générer le Tour 3 »), aux
   horaires où les membres du pôle sont disponibles, en arbitrant entre les
   épreuves de pôle et le Business Game sans jamais compter un membre deux
   fois au même horaire ;
3. ne placer que des membres du pôle sur une épreuve de pôle au dispatch ;
4. relancer les candidats qui n'ont pas rempli leurs vœux.

Les candidats, eux, continuent à faire ce qu'ils font déjà : voir les
épreuves de leurs pôles, s'inscrire, recevoir une convocation.

### État réel au 02/10/2026

- Tour 2 `en_cours`, Tour 3 `a_venir` (une seule épreuve : Business Game T3,
  groupe, 50 min + 10 de roulement).
- 62 candidats en lice ; **23 seulement ont rempli leurs vœux** (22 avec
  3 pôles). Répartition Dev Co 19, Audit 16, Trésorerie 11, RH 10,
  Marketing 8, SI 4.
- Membres par pôle : Audit 6, Dev Co 4, Trésorerie 3, RH 3, SI 3,
  Marketing 3 ; 3 membres du Bureau (VP, Président, SG) sans pôle métier.
- Les dispos des membres se saisissent **une seule fois**, sans choix
  d'épreuve (grille à bandes, `availabilities` sans `epreuve_id` à la
  saisie). Ce sont les salles ouvertes et le dispatch qui décident.

## 2. Ce qui existe déjà et que l'on garde

| Besoin | Déjà en place |
|---|---|
| Épreuve rattachée à un pôle | `epreuves.is_pole_test` + `epreuves.pole`, saisi dans Paramètres (champ « Pôle ») |
| Un candidat ne voit que les épreuves de ses pôles | `GET /api/epreuves`, `GET /api/slots/available`, `POST /api/slots/enroll` |
| Un membre ne voit que les épreuves de son pôle | `GET /api/epreuves` (membre non-admin) ; `toggle-member` refuse un membre hors pôle (admin bypass) |
| Estimation par pôle | `GET /api/tour3/obligations` (admis T2 × vœux T2 ; affichée dans Paramètres et Délibérations). **Inchangée** : elle devient juste une fois la délibération T2 saisie, c'est le choix de Felix. |
| Vœux par tour | `candidate_wishes.tour` (2 = provisoires, 3 = définitifs, verrou `wishes_locked_at`) |
| Salles communes | `system_settings.rooms`, `room_openings` par épreuve, anti-collision dans `lib/tour-openings.ts` |
| Génération multi-épreuves d'un tour | `TourOpeningsPanel` + `lib/tour-openings.ts` (priorité groupe > individuel, pool d'examinateurs global) |
| Dispatch | `lib/dispatchService.ts` + `lib/dispatch-core.ts` (demande par épreuve déjà filtrée par pôle pour les candidats, verrous, compteur par tour) |

## 3. Décisions prises

- **Une épreuve par pôle.** Un pôle qui en voudrait deux crée deux épreuves
  avec le même pôle ; rien de spécial à coder.
- **Pas de priorité « respo de pôle » dans l'algo.** La case « Respo de pôle »
  est ajoutée à la fiche membre **pour information seulement**.
- **Les salles sont partagées** entre toutes les épreuves (liste commune),
  comme aujourd'hui. Pas de liste de salles par pôle.
- **Création des créneaux sur un bouton**, avec récapitulatif à relire avant
  enregistrement. Jamais en continu.
- **Relancer un créneau existant ne supprime jamais rien** : le bouton ajoute
  ce qui manque.
- **Priorité entre épreuves = charge par personne** (cf. § 5.3), recalculée
  au fil de la génération.
- **Au dispatch, le pôle d'un membre passe avant les autres épreuves** quand
  il est disponible pour les deux au même horaire.
- **Relance des vœux** : automatique chaque matin + bandeau sur l'espace
  candidat + filtre « Vœux non remplis » dans Annonces pour une relance
  manuelle. Premier envoi déclenché par Claude après déploiement, sur feu
  vert explicite de Felix.

### Hors périmètre (refusé ou reporté par Felix)

- Limiter le choix définitif du Tour 3 aux pôles choisis au Tour 2 (refusé).
- Priorité ou plafond pour les respos de pôle.
- Placement automatique des membres du Bureau sur une épreuve de pôle : ils
  n'ont pas de pôle métier, donc uniquement à la main (`toggle-member`,
  admin, pose `is_manual`).
- Rééquilibrage automatique des charges (cf. mémoire : Felix l'applique à la
  main).

## 4. Fiche membre : « Respo de pôle »

- Migration manuelle (à ajouter dans `MIGRATIONS_A_APPLIQUER.sql` et dans
  un fichier `supabase-migration-pole-lead.sql`) :
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS is_pole_lead BOOLEAN NOT NULL DEFAULT false;`
- `GET/POST /api/members`, `GET/PUT /api/members/[id]` exposent `isPoleLead`.
  Lecture tolérante : si la colonne manque, `isPoleLead: false` (même
  motif `isMissingColumnError` que le reste du code).
- Page Évaluations → formulaire membre (création et édition) : case à cocher
  « Respo de pôle ». Badge « Respo » à côté du pôle dans la liste.
- Aucun effet sur le dispatch ni sur la génération.

## 5. Bouton « Générer le Tour 3 »

### 5.1 Où

Planning → onglet Création. Remplace l'actuel `TourOpeningsPanel`
(« Générer pour tout le tour »), qui est **généralisé** : il s'affiche dès
qu'un tour compte au moins une épreuve de pôle **ou** au moins deux épreuves
à créneaux, et sait traiter les deux cas. Le libellé devient « Générer le
Tour N ».

### 5.2 Entrées

Pour chaque épreuve du tour qui a besoin de créneaux (individuelle ou groupe,
pas « commune ») :

| Donnée | Source |
|---|---|
| Candidats attendus | Épreuve de pôle : **admis au tour précédent** (`deliberations.tour{N-1}_status = accepted`, hors éliminés) **ayant un vœu pour ce pôle** (tout tour confondu, comme `getCandidateWishedPoles`). Business Game : `tour_settings.candidats_attendus` si renseigné, sinon le nombre d'admis au tour précédent. |
| Marge | `tour_settings.marge_pct` (défaut 25 %) |
| Cible de créneaux | `estimateSlotsNeeded` (existant) → `min` ; moins les créneaux déjà produits par les ouvertures existantes de l'épreuve |
| Examinateurs par créneau | `epreuves.min_evaluators_per_salle` |
| Durée d'un créneau | `duration_minutes + roulement_minutes` |
| Période | `date_debut` → `date_fin`, `heure_debut_journee` → `heure_fin_journee` de l'épreuve ; à défaut la semaine affichée et la grille 8h–20h30 |
| **Membres éligibles** | Épreuve de pôle : membres dont `samePole(member.pole, epreuve.pole)` (sans accents ni casse, `lib/auth-poles.ts`). Autre épreuve : tous les membres hors super-admin. |

Entrées communes : les dispos de tous les membres (`/availability/all`,
fusionnées avec `MERGE_TOLERANCE_MIN` comme aujourd'hui), la liste commune
des salles (`/api/rooms`), et **l'existant** : ouvertures déjà posées
(salles prises, créneaux déjà comptés) et affectations déjà en base
(`slot_member_assignments` → le membre est réservé sur ces horaires, quel
que soit le tour).

### 5.3 Règle de génération (fonction pure `lib/tour-generator.ts`)

Parcours jour par jour, tranche de 30 min par tranche (`CAPACITY_STEP_MIN`),
comme `tour-openings.ts` dont elle reprend la mécanique de bandes
(`openSince`, `closeBand`, `projected`, clôture exacte).

Pour chaque tranche :

1. **Membres libres** = éligibles d'au moins une épreuve, disponibles sur
   toute la tranche, non réservés sur cette tranche (par une affectation
   existante ou par un créneau déjà retenu dans cette génération).
2. **Ordre des épreuves** : pour chaque épreuve dont il reste des créneaux à
   produire, `charge = (créneaux restants × examinateurs par créneau) ÷
   nombre de membres éligibles`. On sert la charge la plus forte en premier ;
   à égalité, l'épreuve qui a le moins de membres éligibles. **Recalculé à
   chaque tranche.**
3. Pour l'épreuve servie : tant qu'il reste des créneaux à produire, au moins
   `examinateurs par créneau` membres éligibles libres, et une salle libre
   sur cette tranche :
   - retenir une salle (liste commune, jamais deux épreuves sur la même salle
     au même moment, ouvertures existantes comprises) ;
   - **réserver nommément** `examinateurs par créneau` membres. Préférence :
     ceux déjà réservés sur cette (épreuve, salle) à la tranche précédente
     (continuité d'un créneau à cheval sur deux tranches), puis ceux qui ont
     le moins de réservations dans cette génération (étalement) ;
   - ouvrir ou prolonger la bande (épreuve, salle).
4. Passer à l'épreuve suivante avec les membres encore libres.
5. Clôture des bandes non reconduites et contrôle exact de fin de tranche :
   inchangés par rapport à `tour-openings.ts`.

Exemple : mardi 14h–16h, 2 membres Dev Co (dont le respo) et 6 autres membres
disponibles ; Dev Co a 40 créneaux à produire pour 4 membres (charge 20),
le Business Game 10 créneaux × 4 examinateurs pour 25 membres (charge 1,6).
→ une salle Dev Co avec les 2 membres Dev Co, puis un Business Game avec
4 des 6 autres, les 2 restants libres.

Sortie : bandes par épreuve + un **récapitulatif** par épreuve : cible,
créneaux déjà existants, créneaux proposés, manque restant, et la cause
dominante du manque (« aucun membre du pôle disponible », « pas de salle
libre », « période épuisée »).

### 5.4 Validation et écriture

- Le récapitulatif s'affiche avant toute écriture, avec le détail des bandes
  (jour, salle, horaire) par épreuve, comme aujourd'hui.
- « Enregistrer » → `POST /api/openings` par bande (découpage en créneaux par
  l'API existante), puis **un seul** `POST /api/dispatch/run` global (même
  motif que `TourOpeningsPanel.confirmSave`).
- Relancer le bouton plus tard : les ouvertures existantes comptent dans le
  « déjà produit », leurs salles et les membres déjà affectés sont réservés ;
  il n'ajoute que le manque. **Aucune suppression**, jamais.

### 5.5 Garde-fous

- Épreuve de pôle sans aucun membre éligible → ligne du récap en alerte,
  rien de généré pour elle.
- `pole` d'une épreuve qui ne correspond à aucun `members.pole` (faute de
  frappe) → même alerte, avec les pôles connus listés.
- Si `tours.status` du tour est `termine` → bouton désactivé.

## 6. Dispatch : règles propres aux épreuves de pôle

Fichiers : `lib/dispatchService.ts`, `lib/dispatch-core.ts`.

1. **Éligibilité.** Le dispatch charge `members(id, pole)` (paginé). Sur un
   créneau dont l'épreuve est `is_pole_test` avec un `pole`, seuls les
   membres `samePole(member.pole, epreuve.pole)` sont candidats à une
   affectation automatique, à une promotion depuis la liste d'attente ou à
   une inscription `slot_availability_requests`. Un membre hors pôle déjà
   affecté **à la main** (`is_manual`) est conservé (le créneau est ancré,
   règle existante). Un membre hors pôle affecté automatiquement par un
   ancien run est retiré avec le motif « hors pôle » et notifié comme un
   retrait de disponibilité.
2. **Le pôle passe en premier.** Dans l'ordonnancement des créneaux à
   pourvoir, clé de tri = (épreuve de pôle d'abord, puis déficit de candidats
   comme aujourd'hui, puis chronologie). Comme seuls les membres du pôle
   peuvent prendre ces créneaux, les servir d'abord revient à donner au
   membre son pôle avant toute autre épreuve au même horaire. Le perdant est
   mis en liste d'attente sur le créneau non retenu (mécanisme existant).
3. **Équité** : inchangée (compteur par tour, poids 2 pour un créneau
   réservé). Les créneaux de pôle comptent dans la charge du membre comme
   les autres.
4. **Demande par épreuve** (`epreuveDemandById`) : déjà filtrée par pôle
   pour les candidats ; rien à changer.
5. `toggle-member` : garde-fou pôle inchangé, bypass admin conservé.

Le Tour 2 en cours n'a aucune épreuve de pôle : aucun effet sur lui.

## 7. Relance des vœux

### 7.1 Qui est relancé

Candidat **en lice** (aucun refus), **admis au tour 1** (c'est la condition
qui débloque les vœux dans `PUT /api/wishes/[candidateId]`), email vérifié,
**sans aucun vœu** (`candidate_wishes`, tout tour), tant que le Tour 2 n'est
pas `termine` et que ses vœux ne sont pas verrouillés.

Fonction pure `lib/wishes-reminder.ts` : `selectCandidatesToRemind(rows,
now)` applique ces règles + l'espacement (≥ 3 jours depuis
`candidates.wishes_reminded_at`). Tests unitaires.

### 7.2 Bandeau sur l'espace candidat

`app/candidates/dashboard/page.tsx` : si le candidat remplit les conditions
du § 7.1 (sans l'espacement), bandeau en haut : « Vos choix de pôles sont
attendus — ils sont indicatifs, pas définitifs » + bouton vers
`/candidates/wishes`. Décision côté serveur : `GET /api/wishes/status`
renvoie `{ needsWishes: boolean }` pour le candidat authentifié (jamais
d'id venant du client).

### 7.3 Mail automatique

- Route `GET /api/cron/wishes-reminder` (`force-dynamic`), ajoutée aux
  `crons` de `frontend/vercel.json` à `0 8 * * *` (même heure que
  `/api/health`). Protégée par `Authorization: Bearer ${CRON_SECRET}`
  (Vercel l'envoie automatiquement quand la variable existe) ; **Felix doit
  ajouter `CRON_SECRET` sur Vercel**. Sans la variable : la route refuse
  (503) et log, elle n'envoie jamais à découvert.
- La même logique est exposée en `POST /api/admin/wishes-reminder` (JWT
  admin, `dryRun` possible) : c'est par là que passe le **premier envoi**,
  déclenché par Claude après déploiement, sur feu vert explicite de Felix,
  et c'est aussi le bouton « Relancer maintenant » dans Annonces.
- Contenu (signé comme les autres mails candidats, cf. mémoire
  `rh-signature-christine`) :

  > **Objet :** Vos choix de pôles — pensez à les remplir
  >
  > Bonjour {prénom},
  >
  > N'oubliez pas de remplir vos choix de pôles sur votre espace candidat.
  > Ils ne sont pas définitifs : ils sont indicatifs et nous permettent de
  > savoir approximativement ce que vous souhaiteriez. Ils seront pris en
  > compte.
  >
  > Merci,
  > Christine Lamaille

- Envoi via `lib/resend.ts` (nouvelle fonction `sendWishesReminderEmails`,
  même batch/débit que `sendAnnouncementEmails`, secours Brevo), **dans la
  limite du quota du jour** (`emailsSentToday` / `EMAIL_DAILY_CAP`) : les
  candidats non servis le sont le lendemain. Notification in-app
  `candidate_notifications` (type `voeux_rappel`, lien `/candidates/wishes`)
  pour chaque candidat relancé. `wishes_reminded_at` mis à jour **seulement
  si** le mail est parti.
- Migration manuelle : `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS
  wishes_reminded_at TIMESTAMPTZ;` (dans `MIGRATIONS_A_APPLIQUER.sql` et
  `supabase-migration-wishes-reminder.sql`). Colonne absente → la route
  refuse d'envoyer (sinon elle relancerait tout le monde chaque jour) et le
  dit clairement.

### 7.4 Filtre dans Annonces

`lib/announcements.ts` : nouveau `CandidateFilter` `"no_wishes"` (« Vœux non
remplis ») = en lice ∧ admis T1 ∧ aucun vœu. Il nécessite les vœux dans
`resolveAudience` (une lecture de `candidate_wishes.candidate_id`). L'aperçu
et l'envoi partagent le même calcul, comme les autres filtres.

## 8. Migrations (manuelles, à signaler à Felix)

```sql
ALTER TABLE members    ADD COLUMN IF NOT EXISTS is_pole_lead BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS wishes_reminded_at TIMESTAMPTZ;
```

Plus la variable d'environnement `CRON_SECRET` sur Vercel.

## 9. Vérification

- **Tests unitaires (vitest)** : `tour-generator` (priorité par charge,
  réservation nommée, continuité, salles communes, relance sans
  suppression, épreuve de pôle sans membre), `dispatch-core` (éligibilité
  par pôle, tri pôle d'abord), `announcements` (filtre `no_wishes`),
  `wishes-reminder` (sélection + espacement + quota).
- **Simulation à blanc sur la prod**, en lecture seule (script jetable dans
  le scratchpad, jamais committé — cf. mémoires `rh-auto-commit-hook` et
  `rh-dispatch-simulation-locale`) : faux Tour 3 avec Dev Co, SI et Business
  Game sur les vraies dispos et les vrais vœux ; Felix relit le
  récapitulatif avant toute mise en prod.
- `tsc --noEmit` propre ; vérification dans le navigateur du panneau de
  génération, du formulaire membre et du bandeau candidat.
- Après déploiement : `dryRun` de la relance (liste des 39), puis envoi réel
  sur feu vert.

## 10. Fichiers touchés (prévision)

| Zone | Fichiers |
|---|---|
| Membres | `app/api/members/route.ts`, `app/api/members/[id]/route.ts`, `app/(dashboard)/dashboard/evaluations/page.tsx` |
| Génération | nouveau `lib/tour-generator.ts` (+ tests), `components/planning/TourOpeningsPanel.tsx`, `app/(dashboard)/dashboard/planning/page.tsx`, nouveau `GET /api/tour-settings/[tour]/generation-inputs` (attendus par épreuve, membres éligibles, réservations existantes) |
| Dispatch | `lib/dispatchService.ts`, `lib/dispatch-core.ts` (+ tests) |
| Relance | nouveaux `lib/wishes-reminder.ts` (+ tests), `app/api/cron/wishes-reminder/route.ts`, `app/api/admin/wishes-reminder/route.ts`, `app/api/wishes/status/route.ts` ; `lib/resend.ts`, `lib/announcements.ts` (+ tests), `app/api/announcements/route.ts`, page Annonces, `app/candidates/dashboard/page.tsx`, `frontend/vercel.json` |
| Migrations | `MIGRATIONS_A_APPLIQUER.sql`, `supabase-migration-pole-lead.sql`, `supabase-migration-wishes-reminder.sql` |
