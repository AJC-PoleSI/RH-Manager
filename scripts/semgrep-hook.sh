#!/usr/bin/env bash
# Hook PostToolUse (Write|Edit) : scanne immédiatement le fichier qui vient d'être modifié
# avec Semgrep (Docker). Si un problème bloquant est détecté, on le remonte à Claude
# (exit 2) pour correction immédiate, avant même que l'auto-commit ne tente de committer
# (et soit de toute façon bloqué par .githooks/pre-commit).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 0

INPUT="$(cat)"

FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('file_path', ''))
except Exception:
    print('')
")"

[ -z "$FILE_PATH" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/*) REL_PATH="${FILE_PATH#"$REPO_ROOT"/}" ;;
  *) exit 0 ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  exit 0
fi

OUTPUT="$("$REPO_ROOT/scripts/semgrep-scan.sh" "$REL_PATH" 2>&1)"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "$OUTPUT" >&2
  echo "" >&2
  echo "Semgrep a détecté un problème bloquant dans $REL_PATH. Corrige-le avant de continuer (ou explique pourquoi c'est un faux positif assumé)." >&2
  exit 2
fi

exit 0
