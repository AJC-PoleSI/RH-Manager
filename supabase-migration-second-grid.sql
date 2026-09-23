-- ════════════════════════════════════════════════════════════════════
-- Deuxième grille d'évaluation d'une épreuve (23/09/2026)
-- ════════════════════════════════════════════════════════════════════
-- Après le rendez-vous client, le candidat envoie une proposition commerciale
-- sous 24 h. Elle se note APRÈS l'entretien, souvent quand la note de
-- l'entretien est déjà close : grille et notes sont donc stockées à part.
--
--   • epreuves.secondary_grid : { "title": "...", "questions": [{ q, weight, hint? }] }
--     (mêmes critères que evaluation_questions ; null = pas de 2e grille) ;
--   • secondary_evaluations : UNE note par (candidat, épreuve), modifiable à
--     tout moment par n'importe quel examinateur du créneau ou un admin.
--
-- Code : frontend/src/lib/second-grid.ts, /api/evaluations/second-grid.
-- Tant que ce fichier n'est pas appliqué, l'application tourne comme avant
-- (le panneau « Proposition commerciale » n'apparaît simplement pas).

ALTER TABLE epreuves
  ADD COLUMN IF NOT EXISTS secondary_grid JSONB;

CREATE TABLE IF NOT EXISTS secondary_evaluations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  epreuve_id      UUID NOT NULL REFERENCES epreuves(id) ON DELETE CASCADE,
  scores          JSONB NOT NULL DEFAULT '{}'::jsonb,
  comment         TEXT,
  created_by      UUID REFERENCES members(id) ON DELETE SET NULL,
  last_edited_by  UUID REFERENCES members(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule note par candidat et par épreuve : deux examinateurs qui
-- saisissent en même temps écrivent la même ligne (upsert).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_secondary_evaluations_candidate_epreuve
  ON secondary_evaluations (candidate_id, epreuve_id);

CREATE INDEX IF NOT EXISTS idx_secondary_evaluations_epreuve
  ON secondary_evaluations (epreuve_id);

-- RLS sans policy : l'application n'utilise que la clé service_role.
ALTER TABLE secondary_evaluations ENABLE ROW LEVEL SECURITY;

-- Grille « Proposition commerciale » du Rendez-vous client (23 critères, /65).
-- Modifiable ensuite dans Paramètres → modifier l'épreuve.
UPDATE epreuves
SET secondary_grid = '{
  "title": "Proposition commerciale",
  "questions": [
    {
      "q": "Propale envoyée dans les 24 h",
      "weight": 3,
      "hint": "3 si la propale est reçue dans les 24 h après la fin du RDV, 0 sinon. Pas de note intermédiaire."
    },
    {
      "q": "Lisibilité – Mail professionnel",
      "weight": 3,
      "hint": "Mail d''envoi soigné : objet clair, formule de politesse, propale en pièce jointe, signature. Mail d''une ligne ou familier = 0-1."
    },
    {
      "q": "Lisibilité – Orthographe, grammaire, conjugaison",
      "weight": 3,
      "hint": "3 = aucune faute ou presque ; 2 = quelques fautes ; 1 = fautes régulières ; 0 = fautes nombreuses qui gênent la lecture."
    },
    {
      "q": "Lisibilité – Syntaxe des phrases",
      "weight": 3,
      "hint": "Phrases complètes, claires et bien construites : ni style télégraphique, ni phrases à rallonge. On juge la construction, pas l''orthographe (critère précédent)."
    },
    {
      "q": "Lisibilité – Pertinence des éléments sélectionnés (choix des slides, logo…)",
      "weight": 3,
      "hint": "Chaque slide et chaque visuel a une utilité ; logos du client et d''AJC présents ; pas de remplissage ni d''images décoratives sans lien."
    },
    {
      "q": "Lisibilité – Respect de la charte graphique",
      "weight": 3,
      "hint": "Utilise la charte AJC (couleurs, polices, logo, mise en page) de façon homogène sur tout le document."
    },
    {
      "q": "BONUS – Document envoyé en PDF",
      "weight": 1,
      "hint": "1 point si la propale est envoyée en PDF, 0 sinon (Word, PowerPoint, lien Canva…)."
    },
    {
      "q": "Contexte – Paragraphe explicatif de la situation",
      "weight": 3,
      "hint": "Reformule la situation du client telle qu''exposée au RDV (qui il est, son marché, son problème). Des généralités recopiées = 1 max : on veut voir qu''il a écouté."
    },
    {
      "q": "Contexte – Solution proposée claire et adaptée",
      "weight": 3,
      "hint": "On comprend en une lecture ce qu''AJC propose, et ça répond au besoin exprimé pendant le RDV."
    },
    {
      "q": "Méthodologie – Prestation cohérente avec notre problématique",
      "weight": 3,
      "hint": "La prestation répond à la problématique jouée pendant le RDV client, pas une prestation standard hors sujet."
    },
    {
      "q": "Méthodologie – Objectif de la prestation",
      "weight": 3,
      "hint": "Objectif(s) formulé(s) explicitement : ce que le client saura ou aura en main à la fin de l''étude."
    },
    {
      "q": "Méthodologie – Contraintes éventuelles",
      "weight": 3,
      "hint": "Reprend les contraintes évoquées au RDV (budget, délais, confidentialité, accès aux données…). Aucune mention = 0."
    },
    {
      "q": "Méthodologie – Méthodologie claire et cohérente",
      "weight": 3,
      "hint": "Étapes concrètes et ordonnées (ex. recherche documentaire → questionnaire → analyse → recommandations), adaptées à l''objectif."
    },
    {
      "q": "Méthodologie – Idée claire et détaillée du livrable",
      "weight": 3,
      "hint": "Le client sait ce qu''il recevra : forme (rapport, présentation, fichier), contenu, volume approximatif."
    },
    {
      "q": "Modalités – Description de l''interlocuteur (coordonnées, qui est-il)",
      "weight": 3,
      "hint": "Nom, rôle et coordonnées du chargé d''affaires (le candidat), présenté comme le point de contact du client."
    },
    {
      "q": "Modalités – Intervenants missionnés (nombre, pertinence des parcours)",
      "weight": 3,
      "hint": "Précise combien d''étudiants seront recrutés et avec quels profils ou parcours, en lien avec la mission."
    },
    {
      "q": "Modalités – Échéancier présent et réaliste",
      "weight": 3,
      "hint": "Absent = 0. Présent = 1,5 minimum (moyen) ; 3 s''il est détaillé par étape et réaliste."
    },
    {
      "q": "Modalités – Budget présent et réaliste",
      "weight": 3,
      "hint": "Absent = 0. Présent = 1,5 minimum (moyen) ; 3 s''il est cohérent et détaillé (ex. nombre de JEH × prix du JEH)."
    },
    {
      "q": "Modalités – Cahier des charges présent",
      "weight": 3,
      "hint": "3 si la propale contient une partie cahier des charges, 0 sinon. Son contenu se note au critère suivant."
    },
    {
      "q": "Modalités – Cahier des charges exhaustif",
      "weight": 3,
      "hint": "Couvre tout : périmètre, livrables, délais, budget, rôle de chacun. Retirer un point par élément important manquant."
    },
    {
      "q": "BONUS – Identification de risques pertinents",
      "weight": 1,
      "hint": "1 point si la propale identifie au moins un risque réaliste (idéalement avec la façon de le limiter), 0 sinon."
    },
    {
      "q": "AJC – Qui sommes-nous ?",
      "weight": 3,
      "hint": "Présente AJC : Junior-Entreprise d''Audencia, ce qu''elle fait, pourquoi lui faire confiance."
    },
    {
      "q": "AJC – Des références",
      "weight": 3,
      "hint": "Cite des missions ou des clients passés comparables. Aucune référence = 0."
    }
  ]
}'::jsonb
WHERE id = 'be211ba4-4f39-4e22-a265-9261193ccd63'
  AND secondary_grid IS NULL;

-- ─── Annulation ─────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS secondary_evaluations;
-- ALTER TABLE epreuves DROP COLUMN IF EXISTS secondary_grid;
