#!/usr/bin/env bash
# Lance Semgrep via Docker sur le repo (ou sur les fichiers passés en argument).
# Utilisé par le hook pre-commit (.githooks/pre-commit) et à la main :
#   scripts/semgrep-scan.sh                 -> scan complet du repo
#   scripts/semgrep-scan.sh fichier1 fichier2 -> scan ciblé
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

IMAGE="semgrep/semgrep:latest"

RULESETS=(
  --config p/security-audit
  --config p/secrets
  --config p/owasp-top-ten
  --config p/javascript
  --config p/typescript
  --config p/react
  --config p/sql-injection
)

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker introuvable — impossible d'exécuter Semgrep." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Le daemon Docker ne répond pas — démarre Docker Desktop puis réessaie." >&2
  exit 1
fi

exec docker run --rm \
  -v "$REPO_ROOT:/src" \
  -w /src \
  "$IMAGE" \
  semgrep scan "${RULESETS[@]}" --error --metrics=off "$@"
