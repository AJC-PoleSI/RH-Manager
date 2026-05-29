-- ============================================
-- SEC-008 : normaliser tous les emails en minuscules
-- ============================================
-- Le code (login, inscription) compare et stocke désormais les emails en
-- minuscules. Cette migration aligne les données EXISTANTES pour éviter
-- qu'un compte stocké en casse mixte ne puisse plus se connecter.
--
-- ⚠️ À LANCER AVANT (ou juste après) le déploiement du code SEC-008.
-- ============================================

-- ── ÉTAPE 1 : détecter les collisions de casse AVANT de migrer ──
-- Ces deux requêtes DOIVENT renvoyer 0 ligne. Si elles renvoient des
-- lignes, cela signifie qu'il existe plusieurs comptes identiques à la
-- casse près (ex: Jean@x.com ET jean@x.com) : il faut les fusionner /
-- supprimer manuellement AVANT de lancer l'étape 2 (sinon violation de la
-- contrainte UNIQUE).

SELECT LOWER(email) AS email_lower, COUNT(*) AS nb
FROM candidates
GROUP BY LOWER(email)
HAVING COUNT(*) > 1;

SELECT LOWER(email) AS email_lower, COUNT(*) AS nb
FROM members
GROUP BY LOWER(email)
HAVING COUNT(*) > 1;

-- ── ÉTAPE 2 : normaliser (uniquement si l'étape 1 a renvoyé 0 ligne) ──

UPDATE candidates
SET email = LOWER(email)
WHERE email <> LOWER(email);

UPDATE members
SET email = LOWER(email)
WHERE email <> LOWER(email);
