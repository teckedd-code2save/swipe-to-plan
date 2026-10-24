#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/unstressed
exec 9>/opt/unstressed/deploy.lock
flock -n 9 || { echo 'Another Unstressed release is running.'; exit 1; }
image="${1:?Pass the immutable image tag already loaded on this host}"
[[ "$image" =~ ^ghcr\.io/teckedd-code2save/unstressed:[a-f0-9]{40}$ ]] || { echo 'Expected an immutable release tag.'; exit 1; }
docker image inspect "$image" >/dev/null
test -s .env
test -d data
docker network inspect unstressed >/dev/null 2>&1 || docker network create unstressed >/dev/null
if ss -H -ltn '( sport = :13001 )' | grep -q .; then echo 'Candidate port 13001 is occupied.'; exit 1; fi
previous="$(docker inspect unstressed-web --format '{{.Config.Image}}' 2>/dev/null || true)"
if [[ -z "$previous" ]] && ss -H -ltn '( sport = :13000 )' | grep -q .; then echo 'Live port 13000 is occupied.'; exit 1; fi
candidate="unstressed-candidate-${image##*:}"
trap 'docker rm -f "$candidate" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$candidate" --network unstressed --init --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 640m --pids-limit 100 --env-file .env \
  --tmpfs /tmp:size=32m,mode=1777 --tmpfs /data:size=16m,uid=1000,gid=1000,mode=0700 \
  -p 127.0.0.1:13001:4000 "$image" >/dev/null
healthy() {
  local port="$1"
  for attempt in $(seq 1 30); do
    if curl --max-time 5 -fsS "http://127.0.0.1:$port/api/health" >/dev/null && curl --max-time 5 -fsS "http://127.0.0.1:$port/" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
healthy 13001 || { echo 'Candidate failed its health check; live service untouched.'; exit 1; }
docker rm -f "$candidate" >/dev/null
# Protect durable accounts/days before an additive storage change reaches live data.
umask 077
mkdir -p backups
chmod 700 backups
tar -czf "backups/pre-${image##*:}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" data
if UNSTRESSED_IMAGE="$image" docker compose -f compose.yml up -d --no-build --pull never && healthy 13000; then
  [[ -z "$previous" || "$previous" == "$image" ]] || printf '%s\n' "$previous" > previous-image.txt
  printf '%s\n' "$image" > current-image.txt
  echo "Unstressed release healthy: $image"
else
  echo 'Release failed; restoring the previous image when available.'
  if [[ -n "$previous" ]]; then
    UNSTRESSED_IMAGE="$previous" docker compose -f compose.yml up -d --no-build --pull never
    healthy 13000
  fi
  exit 1
fi
