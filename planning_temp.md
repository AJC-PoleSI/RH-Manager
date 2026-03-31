# Cahier des charges: Phase 1
Plan d'action:
## 1. Modale de création
- Emplacement: `/frontend/src/app/(dashboard)/dashboard/settings/page.tsx` (et peut-être le modal dans la page `evaluations` s'il y en a une, mais le prompt précise "création d'une épreuve").
- Action: Retirer `onClick={closeModal}` du div overlay de la modale.

## 2. Listes déroulantes - Epreuves et Pôles
- "choix d'épreuves et les choix de pôles": 
  - Dans `settings/page.tsx`, l'input "Pôle" pour la création d'une épreuve est un champ texte. Le changer en liste déroulante `<select>`.
  - Recherchons également d'autres endroits où le "choix d'épreuve" est utilisé. Dans `./frontend/src/app/(dashboard)/dashboard/planning/page.tsx`, il manque une `<option>` par défaut dans le select d'épreuve.
  - S'assurer que les valeurs null/vides sont bien gérées dans les state pour éviter des bugs d'affichage.

## 3. Sécurité Admin
- Emplacement: API backend et frontend `/frontend/src/app/(dashboard)/dashboard/evaluations/page.tsx`.
- Cacher le bouton "delete" pour le super administrateur (normalement désigné par `isAdmin === true` ou un email spécifique, wait, comment l'admin est détecté?). Il faut supprimer la possibilité côté backend dans `api/members/[id]/route.ts` et dans le front.

## 4. Calcul des moyennes
- Réviser les mathématiques dans `dashboard/evaluations/page.tsx` et `dashboard/candidates/[id]/page.tsx`.
- L'erreur classique est "la moyenne des moyennes", qu'il faut remplacer par "la somme totale divisée par le nombre total d'éléments".
