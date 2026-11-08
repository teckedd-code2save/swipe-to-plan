#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/unstressed
exec 9>/opt/unstressed/deploy.lock
flock -n 9 || { echo 'Another Unstressed release is running.'; exit 1; }
image="${1:?Pass the immutable image tag already loaded on this host}"
[[ "$image" =~ ^ghcr\.io/teckedd-code2save/unstressed:[a-f0-9]{40}$ ]] || { echo 'Expected an immutable release tag.'; exit 1; }
docker image inspect "$image" >/dev/null
# Keep this trusted probe with the current guarded deployment tooling, not the
# target runtime image: a deliberate rollback may predate the probe module.
probe_file=/opt/unstressed/probe-account-filesystem.js
probe_sha256=5b99cf0df19080151c0410f2824f6b83242625cf48ab6664dc9bc143b0cd6ce4
[[ -f "$probe_file" && -r "$probe_file" && ! -L "$probe_file" ]] || { echo 'Trusted filesystem probe source missing or unsafe; live service untouched.' >&2; exit 1; }
# Sentinel preserves trailing newlines; hashing and execution use the SAME bytes
# captured here, so a later transfer cannot replace the source under the probe.
probe_source="$(cat -- "$probe_file" && printf '.')" || { echo 'Cannot read trusted filesystem probe; live service untouched.' >&2; exit 1; }
probe_source="${probe_source%.}"
probe_actual="$(printf '%s' "$probe_source" | sha256sum)" || { echo 'Cannot verify trusted filesystem probe; live service untouched.' >&2; exit 1; }
[[ "${probe_actual%% *}" == "$probe_sha256" ]] || { echo 'Filesystem probe integrity mismatch; live service untouched.' >&2; exit 1; }
test -s .env
test -d data
docker network inspect unstressed >/dev/null 2>&1 || docker network create unstressed >/dev/null
if ss -H -ltn '( sport = :13001 )' | grep -q .; then echo 'Candidate port 13001 is occupied.'; exit 1; fi
# Distinguish confirmed absence from Docker errors; unknown writer state must
# never skip quiescence. Only this application's exact container is considered.
containers="$(docker ps -a --filter 'name=^/unstressed-web$' --format '{{.Names}}')" || { echo 'Cannot determine live writer state; release aborted.'; exit 1; }
previous=''
if [[ "$containers" == 'unstressed-web' ]]; then
  previous="$(docker inspect unstressed-web --format '{{.Config.Image}}')" || { echo 'Cannot inspect live writer; release aborted.'; exit 1; }
  [[ "$previous" =~ ^ghcr\.io/teckedd-code2save/unstressed(:[a-f0-9]{40}|@sha256:[a-f0-9]{64})$ ]] || { echo 'Live writer image is not an immutable release tag or digest; review before cutover.'; exit 1; }
elif [[ -n "$containers" ]]; then
  echo 'Unexpected live container lookup; release aborted.'; exit 1
fi
if [[ -z "$previous" ]] && ss -H -ltn '( sport = :13000 )' | grep -q .; then echo 'Live port 13000 is occupied.'; exit 1; fi
# Pending recovery evidence includes dangling symlinks. Inspection failure is unsafe.
intent_pending() {
  local found
  if ! found=$(find data -name '*.intent' -print -quit); then
    echo 'Cannot inspect account recovery state.' >&2; return 0
  fi
  [[ -n "$found" ]]
}
intent_pending && { echo 'Pending account intent: reconcile with the writer stopped before release; live service untouched.'; exit 1; }
protocol_aware() {
  [[ "$(docker image inspect "$1" --format '{{index .Config.Labels "io.unstressed.account-durability"}}' 2>/dev/null)" == '1' ]]
}
# Resume the SAME writer after an aborted cutover, not an arbitrary replacement.
resume_original() {
  [[ -n "$previous" ]] || return 0
  if intent_pending && ! protocol_aware "$previous"; then
    echo 'Original writer left stopped: pending intent requires protocol-aware recovery; do not start a legacy image.' >&2
    return 1
  fi
  docker start unstressed-web >/dev/null
}
candidate="unstressed-candidate-${image##*:}"
probe="unstressed-fsync-probe-${image##*:}"
trap 'docker rm -f "$candidate" "$probe" >/dev/null 2>&1 || true' EXIT
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
# Probe only an exclusive private namespace on the actual bind volume, as the
# runtime UID. No API, env file, secrets, ports, networking or account-file access.
if ! printf '%s' "$probe_source" | timeout --kill-after=5s 45s docker run --rm --interactive --name "$probe" --network none --user node --init \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true --no-healthcheck \
  --memory 64m --pids-limit 32 --mount type=bind,src=/opt/unstressed/data,dst=/data \
  --entrypoint node "$image" --input-type=module -; then
  echo 'Runtime filesystem probe failed; live service untouched. Verify storage primitives and private probe cleanup before retrying.' >&2
  exit 1
fi
# Quiesce the only writer before the final intent check and consistent backup.
# A grace-period kill may leave an intent; the next check must catch it.
if [[ -n "$previous" ]]; then
  docker stop --time 30 unstressed-web >/dev/null || { echo 'Could not stop the live writer; release aborted.'; exit 1; }
fi
if intent_pending; then
  echo 'Account intent appeared during shutdown; no replacement started. Reconcile before release.' >&2
  resume_original || true
  exit 1
fi
umask 077
if ! (mkdir -p backups && chmod 700 backups && tar -czf "backups/pre-${image##*:}-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" data); then
  echo 'Quiesced backup failed; no replacement started.' >&2
  resume_original || true
  exit 1
fi
if UNSTRESSED_IMAGE="$image" docker compose -f compose.yml up -d --no-build --pull never && healthy 13000; then
  [[ -z "$previous" || "$previous" == "$image" ]] || printf '%s\n' "$previous" > previous-image.txt
  printf '%s\n' "$image" > current-image.txt
  echo "Unstressed release healthy: $image"
else
  echo 'Release failed; stopping the failed writer before considering rollback.' >&2
  # A partially failed compose may have started a writer. Never inspect recovery
  # state or start the old image until the writer is conclusively quiesced.
  containers="$(docker ps -a --filter 'name=^/unstressed-web$' --format '{{.Names}}')" || { echo 'Cannot determine failed writer state; rollback blocked.' >&2; exit 1; }
  if [[ "$containers" == 'unstressed-web' ]]; then
    docker stop --time 30 unstressed-web >/dev/null || { echo 'Cannot quiesce failed writer; rollback blocked.' >&2; exit 1; }
  elif [[ -n "$containers" ]]; then
    echo 'Unexpected failed writer lookup; rollback blocked.' >&2; exit 1
  fi
  if intent_pending; then
    echo 'Rollback blocked: pending account intent. Keep writer stopped, preserve data and reconcile using protocol-aware code.' >&2
    exit 1
  fi
  if [[ -n "$previous" ]]; then
    UNSTRESSED_IMAGE="$previous" docker compose -f compose.yml up -d --no-build --pull never
    healthy 13000
  fi
  exit 1
fi
