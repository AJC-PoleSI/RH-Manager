-- Ouvrir un créneau aux candidats MALGRÉ un jury incomplet, sans toucher au
-- quota d'examinateurs.
--
-- POURQUOI UNE COLONNE ET PAS UN `min_members` ABAISSÉ
-- ───────────────────────────────────────────────────
-- Trois garde-fous comparent l'effectif d'un créneau à `min_members` avant de
-- le montrer aux candidats : /api/slots/available, /api/slots/enroll et
-- `slotStatusAfterDispatch`. Baisser le quota les fait tous tomber d'un coup —
-- mais le créneau ment alors sur lui-même : un business game prévu à 6
-- examinateurs qui se tient à 5 affiche « 5/5 », l'écart disparaît de l'écran
-- et le dispatch cesse de chercher le sixième.
--
-- `allow_understaffed` sépare les deux questions : « combien d'examinateurs ce
-- créneau demande-t-il ? » (min_members, inchangé) et « l'a-t-on ouvert quand
-- même ? » (ce drapeau, posé par l'admin). Le créneau reste affiché 5/6, le
-- dispatch continue de viser 6, et les candidats peuvent réserver.
--
-- Le drapeau ne lève JAMAIS la règle du zéro examinateur : un créneau sans
-- personne pour évaluer n'est pas ouvert, drapeau ou pas (règle applicative,
-- cf. lib/publish-understaffing.ts).

ALTER TABLE evaluation_slots
  ADD COLUMN IF NOT EXISTS allow_understaffed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN evaluation_slots.allow_understaffed IS
  'Ouvert aux candidats malgré un jury sous min_members (décision admin). N''ouvre jamais un créneau à zéro examinateur.';
