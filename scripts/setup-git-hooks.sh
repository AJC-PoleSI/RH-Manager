#!/usr/bin/env bash
# À exécuter une fois après clone : active le hook pre-commit Semgrep versionné.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

chmod +x .githooks/pre-commit scripts/semgrep-scan.sh

git config core.hooksPath .githooks

echo "Hooks git configurés (core.hooksPath=.githooks)."
echo "Semgrep (Docker) tournera désormais automatiquement à chaque commit."
