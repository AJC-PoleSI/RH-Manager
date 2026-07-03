# Intégration Befast ↔ RH Manager — Design

Date : 2026-07-03
Statut : approuvé (Approche A, app onboarding séparée, Befast maître)

## Contexte

Deux applications distinctes, sur **deux projets Supabase séparés**, avec **deux modèles d'auth incompatibles** :

| | RH Manager (`ynckz…`) | Befast (`rslzt…`) |
|---|---|---|
| But | Recrutement AJC (candidats) | Gestion interne AJC (membres, missions…) |
| Auth | JWT maison, table `candidates`, login **email + date de naissance** | **Supabase Auth** (mot de passe) + table `personnes` |
| Vérif email | token custom sur `candidates` | token custom (hashé) sur `personnes` |
| Stockage docs | — | Scaleway S3, chiffré |

## Objectif

Un candidat crée **un** compte → **deux** comptes existent (Befast + RH), même email.
**Befast est le maître** : source de vérité de l'identité et des documents. RH Manager est le miroir.

Exigences :
1. Point d'entrée unique (QR code) → **app onboarding séparée** : 1 formulaire, **1 seul email** de validation, redirection vers les deux.
2. Création **bidirectionnelle et idempotente** (inscription directe sur l'une crée l'autre).
3. Dans chaque app, un bouton « compléter votre autre compte » / switch, affiché tant que les documents ne sont pas complets.
4. Documents déposés sur Befast → **poussés** vers RH (sens unique).
5. **Isolation** : RH n'interroge jamais la base Befast ; il ne reçoit qu'un payload curé.

## Architecture

```
   QR ──► APP ONBOARDING (neuve, thin)
              │  POST /api/onboarding/register        (signé HMAC)
              ▼
        BEFAST (maître, orchestrateur)
          ├─ crée auth.users + personnes(role=candidat) + 1 email de vérif
          ├─ à la vérif : provisionne RH  ── POST {RH}/api/internal/provision
          ├─ tient la table account_links
          └─ push docs  ── POST {RH}/api/internal/documents
        RH MANAGER (miroir)
          ├─ /api/internal/provision   (upsert candidate, email_verified=true)
          ├─ /api/internal/documents   (reçoit le payload curé)
          └─ inscription directe → appelle {BEFAST}/api/onboarding/register
   Switch : {app}/api/sso/consume?token=…  (token HMAC court, 120 s)
```

## Contrat d'intégration (partagé par les 3 surfaces)

Secret unique `INTEGRATION_SECRET` (server-only), présent dans les 3 apps.

**1. Requêtes internes server-to-server** (`/api/internal/*`, `/api/onboarding/register`) :
- En-têtes `x-int-timestamp` (ms epoch) + `x-int-signature: sha256=<hmac_hex(secret, `${timestamp}.${rawBody}`)>`.
- Rejet si timestamp > 5 min ou signature invalide (comparaison constant-time).

**2. Token SSO / deep-link** (login inter-apps) :
- Format sans dépendance : `base64url(JSON payload).base64url(hmac)`.
- Payload : `{ purpose:'sso', email, target:'rh'|'befast', iat, exp }`, TTL 120 s.
- `target` empêche la réutilisation d'un token d'une app sur l'autre.

Implémenté à l'identique dans `lib/integration/token` (Befast), `frontend/src/lib/integration.ts` (RH), `lib/integration.ts` (onboarding).

## Flux d'inscription (QR → 2 comptes, 1 email)

1. Scan → onboarding. Formulaire : prénom, nom, email `@audencia.com`, date de naissance, mot de passe.
2. Onboarding `POST {BEFAST}/api/onboarding/register` (signé).
3. Befast : gating domaine → `auth.signUp` (email non confirmé) → `personnes` (role `candidat`, `date_of_birth`, `account_status='candidat'`) → 1 token de vérif → 1 email dont le lien pointe vers `{ONBOARDING}/verifier?token=…`.
4. Candidat clique → onboarding `POST {BEFAST}/api/onboarding/verify {token}`.
5. Befast : marque `email_verified`, confirme le user Supabase, **provisionne RH** (`/api/internal/provision`), upsert `account_links`, renvoie 2 liens SSO.
6. Onboarding affiche la page succès : « Déposer mes documents (Befast) » + « Voir RH Manager ».

## Bidirectionnel & idempotent

- Toute logique de miroir passe par Befast (`/api/onboarding/register|verify`), keyée sur l'email → idempotent.
- Inscription directe RH (`register-candidate`) : après création, appelle `{BEFAST}/api/onboarding/register` (mot de passe auto + le candidat le (re)définira). Best-effort.
- Inscription directe Befast (`signUp`) existante : après vérif, provisionne RH.

## Switch / SSO (sans re-login)

- RH → Befast : RH signe un token `target:'befast'`, redirige vers `{BEFAST}/api/sso/consume`. Befast vérifie, `admin.auth.admin.generateLink({type:'magiclink'})`, redirige vers l'action link (`redirectTo=/dashboard`).
- Befast → RH : Befast signe `target:'rh'`, redirige vers `{RH}/api/sso/consume`. RH vérifie, `signToken` (JWT RH), renvoie une petite page HTML qui pose `localStorage['token']` puis redirige vers `/`.

## Nudge « compléter l'autre compte »

- Flag `documents_complete` (source : Befast). Tant que `false` :
  - RH affiche « Complétez votre dossier sur Befast → [switch] ».
  - Befast affiche « Votre espace RH Manager est prêt → [switch] ».

## Documents Befast → RH (sens unique + isolation)

- Candidat dépose ses docs dans le portail Befast (Scaleway).
- À complétion, Befast `POST {RH}/api/internal/documents` : `{ email, documents:[{type, filename, signed_url, expires_at}] }` (URLs signées courtes).
- RH stocke des **références** (`candidates.befast_documents` jsonb) + `befast_documents_complete=true`. RH ne lit jamais Befast.

## Modèle de données

**RH `candidates`** (+) : `befast_person_id uuid`, `onboarding_source text`, `befast_documents jsonb`, `befast_documents_complete boolean default false`.

**Befast `personnes`** (+) : `date_of_birth date`, `rh_candidate_id uuid`, `is_candidate boolean default false`, `documents_complete boolean default false`.
**Befast `account_links`** (nouvelle) : `email text pk`, `befast_person_id uuid`, `rh_candidate_id uuid`, `documents_complete boolean`, `created_at`, `updated_at`.
**Befast `profils_types`** : ligne `slug='candidat'` (permissions vides = portail cloisonné).

## Sécurité

- `/api/internal/*` + `/api/onboarding/register` : HMAC obligatoire, sinon 401.
- Gating `@audencia.com` + fenêtre d'inscription (règle RH) sur l'onboarding.
- Rate-limit sur register/verify.
- Rôle `candidat` Befast : RLS strictes, aucun accès missions/trésorerie/membres.

## Découpage

- Phase 1 — Contrat + migrations + onboarding + provisioning des 2 comptes + page succès.
- Phase 2 — SSO switch + nudges.
- Phase 3 — Push documents + flag.
- Phase 4 — Idempotence/backfill + hooks inscriptions directes.

## Limites connues

Impossible de vérifier le flux cross-projet depuis l'environnement de dev (deux projets Supabase, secrets, migrations appliquées manuellement). Le code est correct-by-construction ; migrations et `.env` à appliquer par l'exploitant (voir `integration/README.md`).
