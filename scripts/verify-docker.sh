#!/usr/bin/env bash
# Reproduce the GitHub Actions offline Docker acceptance test on a Linux host.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo "Docker CLI is required" >&2; exit 1; }
image="signaturee-linux:local-test"
docker build --pull --tag "$image" .
common=(--rm --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --pids-limit 128 --memory 1g
  --tmpfs /tmp:rw,nosuid,nodev,mode=1777,size=268435456)
echo "Checking CLI as unprivileged user..."
docker run "${common[@]}" "$image" --help
echo "Checking restricted runtime UID..."
actual_uid="$(docker run "${common[@]}" --entrypoint /usr/bin/id "$image" -u)"
if [[ "$actual_uid" != 10001 ]]; then
  echo "Unexpected container UID: $actual_uid (expected 10001)" >&2
  exit 1
fi
echo "Generating synthetic HTML/TXT/RTF with real LibreOffice (no LDAP or network)..."
docker run "${common[@]}" --entrypoint node "$image" /app/scripts/container-smoke.js
echo "PASS: Docker image, restricted UID, real RTF conversion and atomic snapshot."
echo "NOTE: This does not validate LDAPS, real templates, CIFS or Classic Outlook."
