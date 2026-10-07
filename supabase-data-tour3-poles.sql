-- ------------------------------------------------------------
-- 07/10/2026 — DONNÉES du Tour 3 : grilles des épreuves de pôle
-- ------------------------------------------------------------
-- Fichiers fournis par Felix le 07/10 :
--   * « Consignes + grille d'éval épreuve quali – 3e tour.docx »
--       → Entretien de pôle – Audit Qualité : 12 critères /3 = 36 pts
--         (les deux bonus comptent ; le 2e n'avait pas de barème → /3) ;
--   * « Grille d'évaluation entretien trésorerie.xlsx »
--       → Entretien de pôle – Trésorerie : 3 parties = 82 pts
--         L'entretien 22 critères /3 (66) ; Cadre légal 5 questions /2 (10) ;
--         Mise en situation 3 questions /2 (6). Demi-points sur CL / MES.
--         (L'ancien total Excel oubliait 3 critères : ils comptent ici.)
--   * « grille-evaluation-business-game.xlsx » (onglet « Épreuve budgets »)
--       → Business Game – Trésorerie : 18 critères /3 = 54 pts (bonus compris),
--         pas de note de groupe (group_grid = {"disabled": true}).
-- Barème Bien 3 / Moyen 1 / Non 0 → boutons 0 à 3 (décision de Felix).
--
-- Garde-fous : tour 3, pôle et type attendus, 0 note sur l'épreuve (les
-- notes sont indexées par la position des critères).
--
-- BLOC 1 = grilles. BLOC 2 = consignes visibles des candidats (une phrase :
-- pôle, format, durée — choix de Felix). Les deux appliqués en prod le 07/10.

-- ===================== BLOC 1 : grilles =====================
DO $$
DECLARE
  ep record;
  n integer;
BEGIN
  SELECT name, tour, pole, is_group_epreuve INTO ep FROM epreuves WHERE id = '4c49d404-1acf-4d72-824c-4b413ee49215';
  IF NOT FOUND OR ep.tour <> 3 OR ep.pole IS DISTINCT FROM 'Audit Qualité' OR ep.is_group_epreuve IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Épreuve 4c49d404-1acf-4d72-824c-4b413ee49215 inattendue (%, tour %, pôle %) : rien n''est modifié.', ep.name, ep.tour, ep.pole;
  END IF;
  SELECT count(*) INTO n FROM candidate_evaluations WHERE epreuve_id = '4c49d404-1acf-4d72-824c-4b413ee49215';
  IF n > 0 THEN
    RAISE EXCEPTION '« % » a déjà % note(s) : rien n''est modifié.', ep.name, n;
  END IF;
  UPDATE epreuves
  SET evaluation_questions = $json$[{"q": "Tenue et ponctualité", "weight": 3, "input": "scale"}, {"q": "Précis et concis", "weight": 3, "input": "scale", "hint": "Tient dans les 10 minutes, va à l'essentiel"}, {"q": "Présentation structurée", "weight": 3, "input": "scale", "hint": "Ordre logique, pas de dispersion"}, {"q": "Erreurs critiques repérées", "weight": 3, "input": "scale", "hint": "Écarts avec la CE : montants, dates, périmètre, mentions contractuelles"}, {"q": "Erreurs moyennes repérées", "weight": 3, "input": "scale", "hint": "Incohérences internes, informations manquantes"}, {"q": "Erreurs mineures repérées", "weight": 3, "input": "scale", "hint": "Orthographe, syntaxe, charte graphique"}, {"q": "Croise bien le RDM ou le PVRF avec la CE", "weight": 3, "input": "scale", "hint": "Va-et-vient entre les deux documents"}, {"q": "Explique le pourquoi de chaque correction", "weight": 3, "input": "scale", "hint": "Le raisonnement est ce que l'épreuve évalue avant tout"}, {"q": "Bonus : identifie la conséquence de l'erreur", "weight": 3, "input": "scale", "hint": "Client, facturation, conformité, image de la structure"}, {"q": "Propose une correction concrète", "weight": 3, "input": "scale"}, {"q": "Hiérarchise les erreurs par gravité", "weight": 3, "input": "scale"}, {"q": "Bonus : propose une amélioration ou fait le lien avec la démarche qualité", "weight": 3, "input": "scale", "hint": "Par exemple une check-list de relecture, ou le lien avec la démarche qualité de la structure"}]$json$
  WHERE id = '4c49d404-1acf-4d72-824c-4b413ee49215';

  SELECT name, tour, pole, is_group_epreuve INTO ep FROM epreuves WHERE id = '41fc3b7f-e84e-4440-991b-149ae0f2bbfe';
  IF NOT FOUND OR ep.tour <> 3 OR ep.pole IS DISTINCT FROM 'Trésorerie' OR ep.is_group_epreuve IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Épreuve 41fc3b7f-e84e-4440-991b-149ae0f2bbfe inattendue (%, tour %, pôle %) : rien n''est modifié.', ep.name, ep.tour, ep.pole;
  END IF;
  SELECT count(*) INTO n FROM candidate_evaluations WHERE epreuve_id = '41fc3b7f-e84e-4440-991b-149ae0f2bbfe';
  IF n > 0 THEN
    RAISE EXCEPTION '« % » a déjà % note(s) : rien n''est modifié.', ep.name, n;
  END IF;
  UPDATE epreuves
  SET evaluation_questions = $json$[{"section": "L'entretien", "q": "Forme — Le candidat se présente", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — Bonne élocution", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — Souriant et courtois", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — À l'aise", "weight": 3, "input": "scale", "hint": "Pas stressé, bon débit de parole, pas de gestes parasites. 3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — Pro-actif", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — À l'écoute", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Attitude — Enthousiaste", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Motivation — Pourquoi la trésorerie", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Motivation — Connaissances sur le pôle trésorerie", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Motivation — Un poste qui l'intéresserait", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Éthique — Authenticité", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Éthique — Honnêteté", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Éthique — Spontanéité", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Sérieux", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Maturité", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Adaptabilité", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Réflexion", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Culture, centres d'intérêt", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Esprit d'équipe", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Organisation dans la vie et dans le travail", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Pose des questions pertinentes", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "L'entretien", "q": "Qualités — Parcours et engagement", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Cadre légal", "q": "Cadre légal — Question 1", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Cadre légal", "q": "Cadre légal — Question 2", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Cadre légal", "q": "Cadre légal — Question 3", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Cadre légal", "q": "Cadre légal — Question 4", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Cadre légal", "q": "Cadre légal — Question 5", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Mise en situation", "q": "Mise en situation — Question 1", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Mise en situation", "q": "Mise en situation — Question 2", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}, {"section": "Mise en situation", "q": "Mise en situation — Question 3", "weight": 2, "input": "number", "hint": "2 = réponse parfaite · 1,5 = il manque un léger détail qui a son importance · 1 = sur la bonne voie, il manque quelques éléments · 0,5 = le candidat tente quelque chose · 0 = pas de réponse, ou n'importe quoi pour donner une réponse"}]$json$
  WHERE id = '41fc3b7f-e84e-4440-991b-149ae0f2bbfe';

  SELECT name, tour, pole, is_group_epreuve INTO ep FROM epreuves WHERE id = '2408f486-747a-4dfe-ab49-65638565d2fe';
  IF NOT FOUND OR ep.tour <> 3 OR ep.pole IS DISTINCT FROM 'Trésorerie' OR ep.is_group_epreuve IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Épreuve 2408f486-747a-4dfe-ab49-65638565d2fe inattendue (%, tour %, pôle %) : rien n''est modifié.', ep.name, ep.tour, ep.pole;
  END IF;
  SELECT count(*) INTO n FROM candidate_evaluations WHERE epreuve_id = '2408f486-747a-4dfe-ab49-65638565d2fe';
  IF n > 0 THEN
    RAISE EXCEPTION '« % » a déjà % note(s) : rien n''est modifié.', ep.name, n;
  END IF;
  UPDATE epreuves
  SET evaluation_questions = $json$[{"section": "Forme", "q": "Venu habillé de manière décente", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "À l'écoute de son équipe", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "Sait se faire écouter de son équipe", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "Pro-actif", "weight": 3, "input": "scale", "hint": "Prend des initiatives, anticipe, n'attend pas qu'on vienne le chercher. 3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "Stimule son équipe", "weight": 3, "input": "scale", "hint": "Pousse les autres candidats à donner leur avis et à participer. 3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "Prend un rôle", "weight": 3, "input": "scale", "hint": "Trésorier, vice-trésorier (VT) ou coordinateur. 3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Forme", "q": "Enthousiasme", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "A bien compris le sujet", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Réalise les actions de son rôle, s'il en a choisi un", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Remarques pertinentes", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Argumente bien ses décisions", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Connaissances sur la JE", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Connaissances sur la trésorerie", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Travail réalisé dans les temps", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Travail de qualité", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Apporte des idées nouvelles", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Fond", "q": "Bonus : propose de se répartir selon les trois rôles du pôle", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}, {"section": "Impression laissée aux autres candidats", "q": "Apprécié par son groupe", "weight": 3, "input": "scale", "hint": "3 = Bien · 1 = Moyen · 0 = Non"}]$json$,
      group_grid = '{"disabled": true}'::jsonb
  WHERE id = '2408f486-747a-4dfe-ab49-65638565d2fe';

END $$;

-- ============ BLOC 2 : consignes (version courte validée par Felix, appliquée le 07/10) ============
DO $$
BEGIN
  UPDATE epreuves SET description = 'Épreuve du pôle Audit Qualité, individuelle, 25 minutes.'
  WHERE id = '4c49d404-1acf-4d72-824c-4b413ee49215' AND tour = 3;
  IF NOT FOUND THEN RAISE EXCEPTION 'Épreuve Audit Qualité introuvable.'; END IF;
  UPDATE epreuves SET description = 'Entretien individuel avec des membres du pôle Trésorerie, 20 minutes.'
  WHERE id = '41fc3b7f-e84e-4440-991b-149ae0f2bbfe' AND tour = 3;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entretien Trésorerie introuvable.'; END IF;
  UPDATE epreuves SET description = 'Business game du pôle Trésorerie, en groupe de 4, 30 minutes.'
  WHERE id = '2408f486-747a-4dfe-ab49-65638565d2fe' AND tour = 3;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business Game Trésorerie introuvable.'; END IF;
END $$;
