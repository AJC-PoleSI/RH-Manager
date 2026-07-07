# Audit du Système de Création de Créneaux — RH Manager

**Date** : juillet 2026  
**Auteur** : Analyse de l'interface admin de planification  
**État du système** : Fonctionnel mais UX fastidieuse

---

## 🎯 Résumé exécutif

Le système de création de créneaux fonctionne correctement mais impose une charge cognitive et un nombre de clics élevés pour des tâches répétitives. La création suit un flux **accrétif** (clic par clic, créneau par créneau) plutôt que **batch** (grille entière, puis publish).

**Temps estimé actuellement** :
- Créer 10 créneaux (2 salles × 5 jours) : **5–10 min** (mode clic-glissé)
- Créer 40 créneaux (4 salles × 5 jours × 2 semaines) : **20–40 min**

**Problème principal** : Pas de vraie "usine à créneaux" — même avec "Génération rapide", le flux reste manual-heavy.

---

## 📋 État actuel détaillé

### Architecture

```
PlanningPage (admin)
  ├─ Tabs: creation | evaluators | candidates
  ├─ CalendarAdminBuilder
  │   ├─ FullCalendar (timeGridWeek)
  │   ├─ Config panel (min/max time)
  │   └─ Bulk generation panel
  └─ Workflow buttons (publish, dispatch, reset)
```

### Flux de création actuel

#### Mode 1 : Clic sur grille (1 créneau = 1 clic)
1. Admin clique sur une case horaire
2. Dialog prompt : "Choisissez la salle (1, 2, 3...)" via `window.prompt()`
3. 1 créneau créé
4. Répéter × N créneaux

**Temps par créneau** : 3-5 sec

#### Mode 2 : Génération rapide (partiellement automatisée)
1. Toggle "Génération rapide" → panel s'ouvre
2. Remplir : noms salles, plage horaire (de/à), **nombre de créneaux/jour**
3. Cocher jours (Lun/Mar/Mer/etc.)
4. Clic "Générer" → crée `count × days × rooms` créneaux

**Avantages** : Réduit drastiquement le nombre de clics  
**Inconvénients** :
- UI dense (7 inputs + jour picker)
- Pas de **prévisualisation** avant génération
- Pas de **modèles réutilisables** (faut re-remplir chaque fois)
- Plage horaire "fixe" : suppose que tu veux exactement N créneaux entre 08:00–18:00, pas une allocation intelligente basée sur dispos réelles

#### Mode 3 : Génération par croisement de dispos (advanced)
Endpoint `/dispatch/run` — algorithme qui :
- Récupère toutes les dispos membres (jour + heure)
- Groupes par créneau possible
- Crée des créneaux intelligemment
- Assigne les membres automatiquement

**État** : Codé mais rarement utilisé directement par l'admin (plutôt à la fin du workflow)

### Points de friction observés

| Friction | Cause | Sévérité | Notes |
|----------|-------|----------|-------|
| **Prompt salle brut** | `window.prompt()` au lieu d'UI rich | Moyenne | UX années 90, pas de feedback visuel |
| **Pas de preview** | Génération rapide crée directement sans validation | Haute | Impossible d'ajuster avant créer 30 créneaux |
| **Pas de templates** | À chaque fois = remplir les paramètres du 0 | Moyenne | Répétition inutile (même config chaque semaine) |
| **UI dense (Génération rapide)** | 7 inputs + jour picker dans un panel | Moyenne | Prend beaucoup de place, hard à scanner |
| **Pas de duplication** | Créer mardi = copier-coller mardi→mercredi ? | Haute | Faut recréer à la main ou refaire génération |
| **Pas de vue globale avant publish** | Les créneaux sont "draft" jusqu'à publish, visuellement mélangés | Moyenne | Difficile de voir "ai-je assez de créneaux pour cette épreuve ?" |
| **Plage horaire "rigide"** | Génération rapide force une plage fixe (08:00–18:00), pas flexible | Moyenne | Si les dispos forment des îlots (9–11 ET 14–16), dur à gérer |
| **Réinitialisation = loss total** | Reset slots = supprime TOUS les créneaux + dispos de l'épreuve | Basse | Pas reversible, mais c'est un feature intentionnel |

---

## 🔍 Analyse détaillée des workflows

### Workflow A : "Je dois créer X créneaux pour une épreuve"

```
Entrée: Épreuve (E1, duree=60min, roulement=10min), Dates (Lun–Ven), Salles (2), Capa (1 cand/slot)
Sortie: 10 créneaux prêts à publier

Étapes actuelles:
1. Sélect E1
2. Ouvrir "Génération rapide"
3. Remplir: salles (2×), plage (08:00–18:00), count=5
4. Cocher Lun–Ven
5. Clic "Générer"
6. **Vérifier** : admin doit ouvrir le calendrier pour voir si c'est correct
7. Si erreur : reset + re-génération (perte de temps)
8. Publish → disponible aux examinateurs

Clics: 6–8
Temps: 2–3 min (si pas d'erreur)
```

**Frein** : Pas de "look before you leap" — faut générer, puis vérifier, puis potentiellement tout jeter.

### Workflow B : "Je veux dupliquer les créneaux de la semaine 1 sur la semaine 2, avec ajustements"

```
Entrée: Créneaux semaine 1 (lun–ven, 2 salles, 5 créneaux/jour)
Sortie: Même structure semaine 2, sauf salles 3–4

Étapes actuelles:
1. Impossible directement
   → Option A: Reset + re-générer (perte des assignations membres)
   → Option B: Clic-clic sur chaque créneau (30+ clics)
   → Option C: Programmer un script SQL custom

Temps: 5–10 min (manuelle) ou demander dev (custom)
```

**Frein** : Zéro support pour "copier-passer" de grilles horaires.

### Workflow C : "J'ai des dispos membres, générez les créneaux intelligemment"

```
Entrée: Dispos collectées (membres saisissent leurs dispo semaine X)
Sortie: Créneaux optimisés où chaque créneau a ≥2 évaluateurs

Étapes actuelles:
1. Admin ouvre "Récapitulatif des disponibilités"
2. Click "Repartition automatique" (bouton dédié)
3. Algo `/dispatch/run` crée les créneaux intelligemment
4. Affiche résumé (X slots created, Y members assigned)

Temps: 1 clic, 1–2 sec

État: Déjà assez fluide, mais PAS en mode "pré-génération" (crée direct sans preview)
```

**Force** : Automagique si les dispos sont solides.  
**Frein** : Si dispos sont creuses (peu de recouvrements), algo peut échouer silencieusement → créneaux orphelins.

---

## 💡 Améliorations proposées (par priorité)

### P1 : Prévisualisation avant génération

**Objectif** : Réduire les erreurs et la perte de temps due à la "génération-vérification-reset" loop.

**Approche** :
1. Avant de générer, afficher un **mini-calendrier** avec les créneaux simulés
2. Admin peut ajuster les paramètres en temps réel
3. Clic "Confirmer" → génère réellement

**Implémentation** :
- Ajouter un "mode aperçu" au panel "Génération rapide"
- Calculer les créneaux côté client (sans appel API)
- Afficher dans un tableau/calendrier mini
- Bouton "Confirmer" envoie `/slots/bulk-create`

**Impact** :
- ✅ Zéro re-génération par erreur
- ✅ Transparence totale
- ⏱️ +2–3 sec de UX, mais économise 5–10 min potentiellement

---

### P2 : Modèles de création réutilisables

**Objectif** : Économiser du temps sur les configurations répétitives.

**Approche** :
1. Admin crée une fois : "Épreuve standard = 2 salles, 08:00–18:00, 5 créneaux/jour"
2. Sauvegarde comme **template** (nom + params)
3. Semaine suivante : choisit le template, ajuste juste les dates → génère

**Implémentation** :
- Table `SlotGenerationTemplate` (name, epreuveId, rooms[], bulkGenStart/End, bulkGenCount)
- Dropdown dans panel "Génération rapide" : "Charger un template"
- Bouton "Enregistrer en tant que template"
- CRUD simple (delete, rename)

**Impact** :
- ✅ Économise 1–2 min par utilisation
- ✅ Réduit les erreurs de config
- ⏱️ Dev effort: **low** (DB + UI)

---

### P3 : Duplication de grilles (copier-coller semaines)

**Objectif** : Réutiliser une grille de créneaux sur une autre période.

**Approche** :
1. Admin sélecte une semaine source avec créneaux
2. Clic "Dupliquer cette grille"
3. Choisit la semaine destination
4. Optionnel : modifier les salles / horaires avant confirmer
5. Créneaux dupliqués sur nouvelle période

**Implémentation** :
- Modal : "Source week" + "Destination week" (date picker)
- Optional checkboxes : "Ajuster salles ?", "Décaler horaires ?"
- POST `/slots/duplicate` (sourceWeek, destWeek, adjustments)

**Impact** :
- ✅ Élimine copie-collage manuelle ou SQL
- ✅ Préserve assignations membres (si copie avant dispatch)
- ⏱️ Économise 10–20 min pour 2+ semaines similaires
- ⏱️ Dev effort: **medium** (backend logic + frontend modal)

---

### P4 : Mode tabulaire (édition en masse)

**Objectif** : Modifier plusieurs créneaux à la fois (salle, horaire, status).

**Approche** :
1. Tab "Édition en masse" dans le planning admin
2. Tableau : `[Date | Horaire | Salle | Status | Capacité | Membres | Actions]`
3. Filtres : par date, salle, status
4. Actions : change salle bulk, delete bulk, export bulk

**Implémentation** :
- React table (`@tanstack/react-table` ou datagrid custom)
- Colonnes éditables inline
- Checkboxes de sélection
- Bulk actions toolbar (delete, change room, etc.)

**Impact** :
- ✅ Visibilité totale de tous les créneaux
- ✅ Édition rapide (pas de modal)
- ✅ Export CSV (pour audit/backup)
- ⏱️ Économise 1–3 min sur des ajustements fin
- ⏱️ Dev effort: **medium-high** (complex table UX)

---

### P5 : Assistant intelligent (wizard)

**Objectif** : Guider l'admin de "combien de créneaux j'ai besoin ?" à "créneaux prêts".

**Approche** :
1. Form wizard (4–5 steps)
   - Step 1: "Combien de candidats ?" → input
   - Step 2: "Combien d'évaluateurs par groupe ?" → input
   - Step 3: "Combien de semaines ?" → date range
   - Step 4: Review + modify (salles, horaires)
   - Step 5: Générer + confirm
2. Système calcule : **nombre de créneaux = candidats ÷ capacité, arrondi haut**
3. Distribue sur les semaines / salles / horaires intelligemment

**Implémentation** :
- Component `SlotWizard` (multi-step form)
- Algo simple : `Math.ceil(candidateCount / capacityPerSlot)`
- Affiche calcul et "vous aurez besoin de ~8 créneaux"
- Permet to adjust avant génération

**Impact** :
- ✅ Très intuitif pour l'admin non-tech
- ✅ Réduit les erreurs de dimensionnement
- ⏱️ Pas d'économie temps (1–2 min), mais **UX clarity**
- ⏱️ Dev effort: **medium** (form + calculations)

---

### P6 : Intégration "dispos → créneaux" en une étape

**Objectif** : Automatiser le workflow "collecte dispos → génération créneaux → assignation".

**Approche** :
1. Admin ouvre panel "Workflow automatisé"
2. Choisit l'épreuve + date range
3. Clic "Analyser les dispos collectées"
4. Affiche : "X members × Y date-times → recommandation: Z créneaux"
5. Clic "Générer et assigner" → créneaux + assignations en une seule transaction

**Implémentation** :
- Endpoint `/slots/auto-generate-from-availability` (epreuveId, dateRange)
- Backend: croise dispos, génère créneaux, assigne members, tout atomic
- Frontend: affiche résumé avant confirmer

**Impact** :
- ✅ Workflow end-to-end super fluide
- ✅ Zéro double-travail
- ⏱️ Économise 5–10 min pour large pools de membres
- ⏱️ Dev effort: **high** (complex backend logic)

---

### P7 : Amélioration UX minor (gain rapide)

**Objectif** : Réduire la friction de l'UI existante.

**Actions** :
1. Remplacer `window.prompt()` par une **modal HTML** propre (sélect dropdown de salles + boutons)
2. Reorganizer le panel "Génération rapide" :
   - Collapsible sections (Salles / Plage / Nombre)
   - Icônes + tooltips (moins de texte)
   - Preset buttons ("08:00–18:00", "09:00–17:00", "14:00–19:00")
3. Ajouter **accounting** au panel : "Vous allez créer: 2 salles × 5 jours × 5 créneaux = 50 créneaux"

**Impact** :
- ✅ Moins de confusions
- ✅ Plus rapide à scanner
- ⏱️ Économise 1–2 min
- ⏱️ Dev effort: **low** (UI polish, no backend)

---

## 🗺️ Matrice de décision

| Amélioration | Effort | Impact Time | Impact UX | Dépendances | Priorité |
|-------------|--------|-------------|-----------|-------------|----------|
| P1: Prévisualisation | Low | ⭐⭐⭐ | ⭐⭐⭐ | Aucune | 🔴 P0 |
| P2: Templates | Low | ⭐⭐ | ⭐⭐ | Aucune | 🟡 P1 |
| P3: Duplication | Medium | ⭐⭐⭐ | ⭐⭐ | P1 (optional) | 🟡 P1 |
| P4: Édition tabulaire | Medium-High | ⭐⭐ | ⭐⭐⭐ | Aucune | 🟠 P2 |
| P5: Wizard | Medium | ⭐ | ⭐⭐⭐ | Aucune | 🟠 P2 |
| P6: Auto dispos→slots | High | ⭐⭐⭐ | ⭐⭐⭐ | Aucune | 🟢 P3 |
| P7: UX minor | Low | ⭐ | ⭐⭐ | Aucune | 🟠 P2 |

---

## 📐 Approche recommandée

### Phase 1 (1–2 jours) : Fondations
- **P1 (Prévisualisation)** : Majeur quality-of-life, très apprécié
- **P2 (Templates)** : Petit + gros gain pratique
- **P7 (UX minor)** : "Au passage" pendant les autres

### Phase 2 (3–5 jours) : Usabilité avancée
- **P3 (Duplication)** : Complète P1+P2 pour cas récurrents
- **P4 (Édition tabulaire)** : Complément pour fine-tuning
- **P5 (Wizard)** : Option pour nouveaux admins

### Phase 3 (optionnel, 5+ jours) : Automatisation
- **P6 (Auto dispos→slots)** : Lorsque dispos collecte est robuste

---

## ✅ Validation des améliorations

**Avant implémentation**, valider :
1. ✅ Gardent tous les **fonctionnalités existantes** (reset, publish, dispatch restent inchangés)
2. ✅ **Rétrocompatibilité** : pas de casse sur les créneaux existants
3. ✅ **Perfs** : génération rapide ne ralentit pas (batch inserts via Prisma)
4. ✅ **Sécurité** : autorisations (admin only) respectées
5. ✅ **Tests** : écrire tests e2e pour les workflows critiques

---

## 📝 Annexe : Exempla de temps économisés

### Scénario: Admin configure 3 épreuves, 2 semaines chacune (6 semaines total)

**Avant améliorations** :
- P/s: Génération manuelle × 6 = 12 min
- Ajustements + vérifications = 8 min
- **Total: 20 min**

**Après P1+P2+P3** :
- Créer template (semaine 1) = 2 min
- P/s: Dupliquer template sur 5 autres semaines = 1 min × 5 = 5 min
- Vérifications (avec preview) = 2 min
- **Total: 9 min** ← **55% gain**

---

## 🎓 Notes pour l'implémentation (Fable)

1. **Prévisualisation** : Côté client calc via utilitaire existing (`checkOverlap`, `addMinutes`) — pas d'API call needed
2. **Templates** : Simple CRUD, idéal pour reutilisation sur UI
3. **Duplication** : Backend loop sur `/slots/:slotId` updates avec offset date — atomic ideally
4. **Édition tabulaire** : React table library overkill; custom lightweight better pour perf
5. **Sécurité** : Toujours vérifier `isAdmin` côté backend

---

**Fin de l'audit.**
