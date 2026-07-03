# Intégration BeFast ↔ RH Manager — Runbook

Relie **BeFast** (maître : identité + documents) et **RH Manager** (miroir : recrutement)
via un **hub d'onboarding** (cible du QR code). Un candidat crée **un** compte →
**deux** comptes existent, avec **un seul** email de vérification.

Design complet : [`docs/superpowers/specs/2026-07-03-befast-rh-integration-design.md`](../docs/superpowers/specs/2026-07-03-befast-rh-integration-design.md).

## Les 3 surfaces

| App | Repo | Port dev | Rôle |
|---|---|---|---|
| Onboarding | `~/Desktop/onboarding-ajc` | 3002 | Formulaire unique + 1 email → cible du QR |
| RH Manager | `~/Desktop/RH Manager Anti/frontend` | 3000 | Miroir candidat |
| BeFast | `~/Desktop/Befast` | **3001** | Maître : compte + documents |

> ⚠️ BeFast et RH tournent tous deux par défaut sur `next dev` (3000). En local,
> lancez BeFast sur **3001** (`next dev -p 3001`) et alignez son `NEXT_PUBLIC_SITE_URL`.

## 1. Variables d'environnement

Le même secret `INTEGRATION_SECRET` doit être **identique dans les 3 apps**.
Générez-le une fois : `openssl rand -hex 32`.

- **Onboarding** (`onboarding-ajc/.env`) : `INTEGRATION_SECRET`, `BEFAST_BASE_URL`, `RH_BASE_URL`.
- **RH** (`frontend/.env`) : `INTEGRATION_SECRET`, `BEFAST_BASE_URL` (+ existants).
- **BeFast** (`.env.local`) : `INTEGRATION_SECRET`, `RH_BASE_URL`, `ONBOARDING_BASE_URL` (+ existants).

Voir les `.env*.example` de chaque repo.

## 2. Migrations SQL (à appliquer manuellement dans chaque projet Supabase)

- **RH** (projet `ynckz…`) → SQL Editor → coller [`supabase-migration-befast-integration.sql`](../supabase-migration-befast-integration.sql).
  Ajoute `candidates.befast_person_id`, `onboarding_source`, `befast_documents`, `befast_documents_complete`.
- **BeFast** (projet `rslzt…`) → SQL Editor → coller `Befast/supabase/migrations/044_befast_rh_integration.sql`.
  Ajoute le rôle `candidat`, les colonnes candidat sur `personnes`, la table `account_links`.

## 3. Montage des composants UI

- **RH** — dashboard candidat : `import BefastNudge from "@/components/BefastNudge"`
  puis `<BefastNudge documentsComplete={candidate.befast_documents_complete} />`.
- **BeFast** — dashboard candidat : `import RhManagerNudge from "@/app/(dashboard)/_components/RhManagerNudge"`.
- **BeFast** — page de dépôt de documents du portail candidat :
  `import MarkDocumentsCompleteButton from "@/app/(dashboard)/_components/MarkDocumentsCompleteButton"`
  (bouton « J'ai déposé tous mes documents » → push vers RH).

## 4. Endpoints créés

**RH Manager**
- `POST /api/internal/provision` — upsert candidat (signé HMAC, appelé par BeFast).
- `POST /api/internal/documents` — reçoit le payload curé (signé HMAC).
- `GET  /api/sso/consume?token=` — SSO entrant → pose le JWT → `/`.
- `GET  /api/sso/switch` — SSO sortant (Bearer) → renvoie l'URL BeFast.
- Hook dans `POST /api/auth/register-candidate` → crée aussi le compte BeFast.

**BeFast** (maître)
- `POST /api/onboarding/register` — crée le compte candidat + 1 email (signé HMAC).
- `POST /api/onboarding/verify` — vérifie + provisionne RH + lie (token = credential).
- `GET  /api/sso/consume?token=` — SSO entrant → magic-link → `/dashboard`.
- `GET  /api/sso/switch` — SSO sortant (session) → redirige vers RH consume.
- `POST /api/integration/documents-complete` — push curé des docs vers RH.
- Hook dans `GET /verify-email` → provisionne RH pour les inscriptions directes.

**Onboarding**
- `POST /api/register` — proxy signé vers BeFast register.
- `POST /api/verify` — proxy signé vers BeFast verify + génère les deep-links SSO.

## 5. Flux nominal (QR)

1. Scan QR → `onboarding` (`/`). Formulaire : prénom, nom, email `@audencia.com`, date de naissance, mot de passe.
2. `POST /api/register` → BeFast crée le compte candidat + envoie **1** email dont le lien = `{ONBOARDING}/verifier?token=…`.
3. Clic email → `onboarding /verifier` → `POST /api/verify` → BeFast marque vérifié, confirme le compte, **provisionne RH**, lie les deux.
4. Page succès → 2 boutons SSO : « Déposer mes documents (BeFast) » / « Voir RH Manager ».
5. Candidat dépose ses docs sur BeFast → bouton « J'ai déposé tous mes documents » → push curé vers RH → nudges masqués.

Bidirectionnel : inscription directe RH → BeFast créé ; inscription directe BeFast → RH créé (best-effort, idempotent, keyé sur l'email).

## 6. Sécurité

- `/api/internal/*` + `/api/onboarding/register` : **HMAC obligatoire** (`x-int-timestamp` + `x-int-signature`, fenêtre 5 min, comparaison constant-time). Sans signature valide → 401.
- Tokens SSO : signés HMAC, TTL 120 s, champ `target` anti-rejeu inter-app.
- Isolation : RH ne lit jamais la base BeFast ; il ne reçoit qu'un payload curé (URLs signées courtes). `account_links` n'a aucune policy RLS → service-role uniquement.
- Gating `@audencia.com` sur l'onboarding et BeFast register.

## 7. Test manuel du contrat HMAC (sans front)

```bash
SECRET="votre_INTEGRATION_SECRET"
BODY='{"email":"test.user@audencia.com","firstName":"Test","lastName":"User"}'
TS=$(python3 -c 'import time;print(int(time.time()*1000))')
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)"
curl -sS -X POST http://localhost:3000/api/internal/provision \
  -H "content-type: application/json" \
  -H "x-int-timestamp: $TS" -H "x-int-signature: $SIG" \
  -d "$BODY"
# → {"candidateId":"…","created":true}   (401 si la signature est fausse)
```

## 8. Limites connues (à finaliser côté exploitant)

- **Non vérifiable depuis le dev local** : deux projets Supabase + secrets + migrations manuelles. Le code est correct-by-construction ; appliquez migrations + env puis testez le flux réel.
- **RLS du rôle `candidat`** : la migration crée le rôle sans permissions, mais le cloisonnement fin (empêcher un `candidat` de lire missions/trésorerie) dépend des policies RLS existantes de BeFast — à auditer avant ouverture publique.
- **Colonnes `documents_personnes`** : `documents-complete` lit `doc_type`/`type` et `file_name` de façon défensive ; vérifiez les noms réels de colonnes.
- **Inscription directe RH** : envoie potentiellement 2 emails (RH + BeFast). Le flux QR (recommandé) n'en envoie qu'un.
