-- ════════════════════════════════════════════════════════════════════════════
-- VERROUILLAGE RLS — correctif de l'exposition publique de la base
-- Audit du 19/08/2026, point #4 (critique) et #15 (élévation de privilèges)
--
-- CONSTAT (vérifié en direct contre la production avec la clé anon publique) :
--   • 22 tables sur 25 lisibles sans aucune authentification, dont
--     `members` (password_hash bcrypt + emails) et `candidates` (données
--     personnelles des candidats).
--   • PATCH et DELETE renvoyaient HTTP 204 sur `members` et `candidates` :
--     n'importe qui pouvait se promouvoir admin (is_admin = true) ou vider
--     la base.
--
-- POURQUOI CE CORRECTIF NE CASSE RIEN :
--   L'application n'utilise QUE la clé service_role (`supabaseAdmin`,
--   frontend/src/lib/supabase.ts). Vérifié : aucun fichier n'importe le
--   client anon, et le bundle JS de production ne contient aucune clé
--   Supabase (le navigateur ne parle jamais à la base en direct).
--   Or le rôle service_role possède l'attribut BYPASSRLS : il ignore
--   totalement les policies. Activer la RLS ne referme donc la porte que
--   pour anon/authenticated, c'est-à-dire pour personne côté applicatif.
--
-- RÉSERVE CONNUE :
--   frontend/src/app/(dashboard)/employees/* utilisent le client anon sur la
--   table `employees`, qui N'EXISTE PAS en production (HTTP 404) : ces pages
--   sont déjà inopérantes. Si `employees` est créée un jour, il faudra soit
--   passer ces pages sur supabaseAdmin, soit leur écrire des policies.
--
-- Script d'annulation en fin de fichier.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. RLS activée sur toutes les tables du schéma public ──────────────────
-- Boucle plutôt que liste en dur : couvre aussi les tables non recensées à
-- l'audit et reste correct si le schéma évolue. Idempotent.
DO $$
DECLARE
  t record;
  n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relkind = 'r'          -- tables ordinaires uniquement
      AND c.relrowsecurity = false -- pas déjà activées
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    n := n + 1;
    RAISE NOTICE 'RLS activée : %', t.relname;
  END LOOP;
  RAISE NOTICE '--- % table(s) verrouillée(s) ---', n;
END $$;

-- Aucune policy n'est créée volontairement : RLS active + zéro policy
-- = refus total pour anon et authenticated, passage libre pour service_role.

-- ─── 2. Retrait des privilèges de table (défense en profondeur) ─────────────
-- La RLS seule suffit, mais si une policy permissive est ajoutée par erreur
-- un jour, ce REVOKE reste un second verrou.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- ─── 3. Les futures tables héritent du verrou ───────────────────────────────
-- Sans ça, la prochaine table créée serait de nouveau exposée : c'est
-- exactement le mode de panne qui a produit cette faille.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- ─── 4. Contrôle : doit renvoyer 0 ligne ────────────────────────────────────
SELECT c.relname AS table_encore_exposee
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;

-- ════════════════════════════════════════════════════════════════════════════
-- ANNULATION (à n'exécuter que si l'application casse — ce qui rouvrirait
-- la faille : préférer corriger le code fautif)
-- ════════════════════════════════════════════════════════════════════════════
-- DO $$
-- DECLARE t record;
-- BEGIN
--   FOR t IN SELECT c.relname FROM pg_class c
--            JOIN pg_namespace ns ON ns.oid = c.relnamespace
--            WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.relname);
--   END LOOP;
-- END $$;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
